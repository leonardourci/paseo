import { expect, type Page } from "../fixtures";
import { daemonWsRoutePattern } from "./daemon-port";

type WebSocketMessage = string | Buffer;
type SessionRequest = Record<string, unknown>;

interface SessionSocket {
  send(message: string): void;
}

interface DictationHarnessOptions {
  transcript: string;
}

export interface DictationHarness {
  /** Resolves once one more dictation than before has streamed audio. */
  waitForAudio: () => Promise<void>;
  setTranscript: (text: string) => void;
  /** Transcripts wait until the returned release, as a slow speech-to-text would. */
  holdTranscripts: () => () => void;
  requestCount: (type: string) => number;
}

function parseEnvelope(message: WebSocketMessage): {
  type?: unknown;
  message?: Record<string, unknown>;
} | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw) as { type?: unknown; message?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function sessionMessage(message: WebSocketMessage): SessionRequest | null {
  const envelope = parseEnvelope(message);
  return envelope?.type === "session" && envelope.message ? envelope.message : null;
}

function sendSessionMessage(client: SessionSocket, message: SessionRequest): void {
  client.send(JSON.stringify({ type: "session", message }));
}

function enableDictationCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseEnvelope(message);
  const payload = envelope?.message?.payload;
  if (
    envelope?.message?.type !== "status" ||
    !payload ||
    typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "server_info"
  ) {
    return message;
  }

  (payload as Record<string, unknown>).capabilities = {
    voice: {
      dictation: { enabled: true, reason: "" },
      voice: { enabled: false, reason: "Realtime voice is disabled in this test." },
    },
  };
  return JSON.stringify(envelope);
}

async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

/**
 * Stands in for the daemon's speech-to-text: the app records a synthetic tone and every finished
 * dictation transcribes to the current transcript. Install before the page loads.
 */
export async function installDictationHarness(
  page: Page,
  options: DictationHarnessOptions,
): Promise<DictationHarness> {
  let transcript = options.transcript;
  const withAudio = new Set<string>();
  const requests = new Map<string, number>();
  let awaited = 0;
  let heldFinals: (() => void)[] | null = null;
  await installSyntheticMicrophone(page);

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const request = sessionMessage(message);
      const type = request?.type;
      const dictationId = typeof request?.dictationId === "string" ? request.dictationId : null;
      if (typeof type === "string") requests.set(type, (requests.get(type) ?? 0) + 1);

      if (type === "dictation_stream_start" && dictationId) {
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: -1 },
        });
        return;
      }
      if (type === "dictation_stream_chunk" && dictationId) {
        const seq = typeof request?.seq === "number" ? request.seq : 0;
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: seq },
        });
        withAudio.add(dictationId);
        return;
      }
      if (type === "dictation_stream_finish" && dictationId) {
        sendSessionMessage(ws, {
          type: "dictation_stream_finish_accepted",
          payload: { dictationId, timeoutMs: 5_000 },
        });
        const text = transcript;
        const sendFinal = () =>
          sendSessionMessage(ws, {
            type: "dictation_stream_final",
            payload: { dictationId, text },
          });
        if (heldFinals) heldFinals.push(sendFinal);
        else sendFinal();
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => ws.send(enableDictationCapability(message)));
  });

  return {
    waitForAudio: async () => {
      awaited += 1;
      const expected = awaited;
      await expect.poll(() => withAudio.size).toBeGreaterThanOrEqual(expected);
    },
    setTranscript: (text) => {
      transcript = text;
    },
    holdTranscripts: () => {
      const held: (() => void)[] = [];
      heldFinals = held;
      return () => {
        heldFinals = null;
        for (const sendFinal of held) sendFinal();
      };
    },
    requestCount: (type) => requests.get(type) ?? 0,
  };
}
