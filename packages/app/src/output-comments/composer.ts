import { useCallback, useMemo } from "react";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import {
  placeQueuedText,
  prepareOutgoingText,
  restoreOutgoingText,
  sendableComments,
} from "./send";
import { EMPTY_PENDING_COMMENTS, useLoadedOutputStore, useOutputCommentsStore } from "./store";

interface AgentText {
  serverId: string;
  agentId: string;
  text: string;
  lastOutputId?: string;
}

interface OutgoingMessage {
  text: string;
  lastOutputId: string | undefined;
  markSent: () => void;
}

interface UseComposerOutputCommentsInput {
  serverId: string;
  agentId: string;
}

interface ComposerOutputComments {
  count: number;
  prepare: (text: string) => OutgoingMessage;
}

function agentStreamItems(serverId: string, agentId: string): StreamItem[] {
  const session = useSessionStore.getState().sessions[serverId];
  return [
    ...(session?.agentStreamTail.get(agentId) ?? []),
    ...(session?.agentStreamHead.get(agentId) ?? []),
  ];
}

/** Puts a message's comments back into the pending ones and returns the text without them. */
export function restoreOutputComments({
  serverId,
  agentId,
  text,
  lastOutputId,
}: AgentText): string {
  const restored = restoreOutgoingText({
    items: agentStreamItems(serverId, agentId),
    text,
    lastOutputId,
  });
  if (restored.comments.length > 0) {
    useOutputCommentsStore.getState().restoreComments({
      draftKey: buildDraftStoreKey({ serverId, agentId }),
      comments: restored.comments,
    });
  }
  return restored.text;
}

export function placeQueuedOutputComments({
  serverId,
  agentId,
  text,
  lastOutputId,
}: AgentText): string {
  return placeQueuedText({ items: agentStreamItems(serverId, agentId), text, lastOutputId });
}

export function useComposerOutputComments({
  serverId,
  agentId,
}: UseComposerOutputCommentsInput): ComposerOutputComments {
  const draftKey = useMemo(() => buildDraftStoreKey({ serverId, agentId }), [agentId, serverId]);
  const loaded = useLoadedOutputStore((state) => state.assistantIds[draftKey]);
  // A count rather than the list, so typing a note doesn't render the composer.
  const count = useOutputCommentsStore(
    (state) =>
      sendableComments({ pending: state.drafts[draftKey] ?? EMPTY_PENDING_COMMENTS, loaded })
        .length,
  );
  const removeSent = useOutputCommentsStore((state) => state.removeSent);
  const prepare = useCallback(
    (text: string): OutgoingMessage => {
      const prepared = prepareOutgoingText({
        text,
        pending: useOutputCommentsStore.getState().drafts[draftKey] ?? EMPTY_PENDING_COMMENTS,
        loaded: useLoadedOutputStore.getState().assistantIds[draftKey],
      });
      const markSent = () => {
        if (prepared.sent.length > 0) removeSent({ draftKey, comments: prepared.sent });
      };
      return { text: prepared.text, lastOutputId: prepared.lastOutputId, markSent };
    },
    [draftKey, removeSent],
  );
  return { count, prepare };
}
