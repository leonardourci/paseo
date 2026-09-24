import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { parseOutputComments, withOutputComments } from "./fence";
import type { PendingOutputComment } from "./store";
import {
  placeQueuedText,
  prepareOutgoingText,
  restoreOutgoingText,
  sendableComments,
} from "./send";

const noted: PendingOutputComment = {
  id: "c1",
  sourceItemId: "a1",
  startBlock: 1,
  endBlock: 1,
  quote: "beta",
  occurrence: 0,
  isCode: false,
  note: "why?",
};
const blank: PendingOutputComment = {
  id: "c2",
  sourceItemId: "a1",
  startBlock: 2,
  endBlock: 2,
  quote: "gamma",
  occurrence: 0,
  isCode: false,
  note: "  \n",
};
const pending = [noted, blank];
const FENCED = "```paseo-comment block=1\n> beta\n\nwhy?\n```";

describe("sendableComments", () => {
  it("keeps only the comments that would be sent", () => {
    expect(sendableComments({ pending: [noted, blank], loaded: undefined })).toEqual([noted]);
  });

  it("leaves out comments on output that isn't loaded until it loads again", () => {
    const older = { ...noted, id: "c3", sourceItemId: "older" };
    expect(sendableComments({ pending: [noted, older], loaded: ["a1"] })).toEqual([noted]);
    expect(sendableComments({ pending: [noted, older], loaded: ["a1", "older"] })).toEqual([
      noted,
      older,
    ]);
    expect(sendableComments({ pending: [noted, older], loaded: [] })).toEqual([]);
  });
});

describe("prepareOutgoingText", () => {
  it("appends the fences and reports the comments with the notes sent", () => {
    expect(prepareOutgoingText({ text: "reply", pending: [noted], loaded: undefined })).toEqual({
      text: `reply\n\n${FENCED}`,
      sent: [{ id: "c1", note: "why?" }],
    });
  });

  it("leaves blank comments out of the text but still reports them", () => {
    expect(prepareOutgoingText({ text: "reply", pending, loaded: undefined })).toEqual({
      text: `reply\n\n${FENCED}`,
      sent: [
        { id: "c1", note: "why?" },
        { id: "c2", note: "  \n" },
      ],
    });
  });

  it("leaves the text alone with no pending comments", () => {
    expect(prepareOutgoingText({ text: "reply", pending: [], loaded: undefined })).toEqual({
      text: "reply",
      sent: [],
    });
  });

  it("keeps the comments pending when the message is a slash command", () => {
    expect(
      prepareOutgoingText({
        text: "  /compact now",
        pending: [noted],
        loaded: undefined,
      }),
    ).toEqual({
      text: "  /compact now",
      sent: [],
    });
  });

  it("sends and reports only the comments on loaded output", () => {
    const older = { ...noted, id: "c3", sourceItemId: "older", note: "held" };
    expect(prepareOutgoingText({ text: "reply", pending: [noted, older], loaded: ["a1"] })).toEqual(
      {
        text: "reply\n\n```paseo-comment block=1 msg=1\n> beta\n\nwhy?\n```",
        sent: [{ id: "c1", note: "why?" }],
        lastOutputId: "a1",
      },
    );
  });

  it("numbers each comment's output back from the newest, which the message follows", () => {
    const earlier = { ...noted, id: "c3", sourceItemId: "a0", note: "earlier" };
    const prepared = prepareOutgoingText({
      text: "",
      pending: [noted, earlier],
      loaded: ["a0", "a1", "a2"],
    });
    expect(parseOutputComments(prepared.text).comments.map((c) => c.messageOrdinal)).toEqual([
      2, 3,
    ]);
    expect(prepared.lastOutputId).toBe("a2");
  });
});

describe("restoreOutgoingText", () => {
  const items: StreamItem[] = [
    {
      kind: "assistant_message",
      id: "a1",
      text: "Alpha.\n\nThe beta line.",
      timestamp: new Date(0),
    },
  ];

  it("gives back the typed text and the comments, aimed at the output", () => {
    const { text } = prepareOutgoingText({
      text: "reply\n\n\nmore",
      pending: [noted],
      loaded: undefined,
    });
    const restored = restoreOutgoingText({ items, text, lastOutputId: undefined });
    expect(restored.text).toBe("reply\n\n\nmore");
    expect(restored.comments).toEqual([{ ...noted, id: expect.any(String) }]);
  });

  it("keeps a comment whose output is gone in the text", () => {
    const text = withOutputComments("reply", [
      { quote: "absent", note: "n", startBlock: 0, occurrence: 0, isCode: false },
    ]);
    expect(restoreOutgoingText({ items, text, lastOutputId: undefined })).toEqual({
      text,
      comments: [],
    });
  });
});

describe("restoring a repeated quote", () => {
  const repeated: StreamItem[] = ["a1", "a2", "a3"].map((id) => ({
    kind: "assistant_message",
    id,
    text: "Alpha.\n\nThe beta line.",
    timestamp: new Date(0),
  }));

  function restoredSource(text: string, lastOutputId?: string): string | undefined {
    return restoreOutgoingText({ items: repeated, text, lastOutputId }).comments[0]?.sourceItemId;
  }

  it("aims each comment at the message its ordinal names, not the latest with the quote", () => {
    const { text } = prepareOutgoingText({
      text: "",
      pending: [noted],
      loaded: ["a1", "a2", "a3"],
    });
    expect(restoredSource(text)).toBe("a1");
  });

  it("counts a queued message's ordinals back from where it was queued", () => {
    const { text } = prepareOutgoingText({
      text: "",
      pending: [{ ...noted, sourceItemId: "a2" }],
      loaded: ["a1", "a2"],
    });
    expect(restoredSource(text, "a2")).toBe("a2");
    expect(restoredSource(text, "gone")).toBe("a3");
  });
});

describe("placeQueuedText", () => {
  const output: StreamItem[] = ["a1", "a2", "a3"].map((id) => ({
    kind: "assistant_message",
    id,
    text: "The beta line.",
    timestamp: new Date(0),
  }));
  const { text: queued } = prepareOutgoingText({
    text: "reply",
    pending: [noted],
    loaded: ["a1"],
  });

  it("moves the ordinals back past output written after the message was queued", () => {
    expect(placeQueuedText({ items: output, text: queued, lastOutputId: "a1" })).toBe(
      "reply\n\n```paseo-comment block=1 msg=3\n> beta\n\nwhy?\n```",
    );
  });

  it("leaves the text alone when nothing was written since", () => {
    expect(placeQueuedText({ items: output.slice(0, 1), text: queued, lastOutputId: "a1" })).toBe(
      queued,
    );
  });

  it("drops the ordinals once the output it was queued behind is gone", () => {
    expect(placeQueuedText({ items: output, text: queued, lastOutputId: "gone" })).toBe(
      `reply\n\n${FENCED}`,
    );
  });
});
