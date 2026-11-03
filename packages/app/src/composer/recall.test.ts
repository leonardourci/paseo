import { describe, expect, it } from "vitest";
import type { ComposerKeyPressEvent } from "@/composer/input/input";
import {
  ComposerRecall,
  prepareRecallMessages,
  type ComposerRecallMessage,
} from "@/composer/recall";

function plainMessage(text: string): ComposerRecallMessage {
  return { text, unresolvedQuote: null, comments: [], attachments: [] };
}

const SENT = ["add tests", "fix the auth bug"];

function press(
  key: string,
  text: string,
  options: { caret?: number; selectionEnd?: number; hasModifier?: boolean } = {},
): ComposerKeyPressEvent {
  const caret = options.caret ?? text.length;
  return {
    key,
    hasModifier: options.hasModifier ?? false,
    preventDefault: () => undefined,
    input: { text, selection: { start: caret, end: options.selectionEnd ?? caret } },
  };
}

/** Drives recall the way the composer does: each result becomes the composer text, caret at the end. */
function composerWithRecall(sent: readonly string[] = SENT) {
  const recall = new ComposerRecall();
  let text = "";
  let draft: ComposerRecallMessage = plainMessage(text);
  return {
    recall,
    get text() {
      return text;
    },
    type(next: string) {
      text = next;
    },
    press(key: string, options: { caret?: number; hasModifier?: boolean } = {}) {
      const result = recall.handleKeyPress(
        press(key, text, options),
        () => sent.map(plainMessage),
        draft,
      );
      if (result !== null) {
        text = result.text;
        draft = result;
      }
      return result?.text ?? null;
    },
  };
}

describe("ComposerRecall", () => {
  it("passes unresolved entries in both directions without replacing the visible draft", () => {
    const recall = new ComposerRecall();
    const missing = { ...plainMessage("missing"), unresolvedQuote: "original quote" };
    const messages = [missing, plainMessage("older"), missing, plainMessage("oldest")];
    let draft = plainMessage("");
    const navigate = (key: string) => {
      const result = recall.handleKeyPress(press(key, draft.text, { caret: 0 }), () => messages, draft);
      if (result && result.unresolvedQuote === null) draft = result;
      return result;
    };
    expect(navigate("ArrowUp")).toEqual(missing);
    expect(draft.text).toBe("");
    expect(navigate("ArrowUp")?.text).toBe("older");
    expect(navigate("ArrowUp")).toEqual(missing);
    expect(draft.text).toBe("older");
    expect(navigate("ArrowUp")?.text).toBe("oldest");
    expect(navigate("ArrowDown")).toEqual(missing);
    expect(draft.text).toBe("oldest");
    expect(navigate("ArrowDown")?.text).toBe("older");
    expect(navigate("ArrowDown")).toEqual(missing);
    expect(navigate("ArrowDown")?.text).toBe("");
  });
  it("walks back through sent messages and forward to an empty composer", () => {
    const composer = composerWithRecall();

    expect(composer.press("ArrowUp")).toBe("add tests");
    expect(composer.press("ArrowUp")).toBe("fix the auth bug");
    expect(composer.press("ArrowDown")).toBe("add tests");
    expect(composer.press("ArrowDown")).toBe("");
    expect(composer.recall.isShowing(composer.text)).toBe(false);
  });

  it("leaves the caret to the input past the oldest message", () => {
    const composer = composerWithRecall();
    composer.press("ArrowUp");
    composer.press("ArrowUp");

    expect(composer.press("ArrowUp")).toBeNull();
    expect(composer.text).toBe("fix the auth bug");
  });

  it("only starts from an empty composer", () => {
    const composer = composerWithRecall();
    composer.type("half written");

    expect(composer.press("ArrowUp")).toBeNull();
    expect(composer.press("ArrowDown")).toBeNull();
  });

  it("ignores Down from an empty composer and Up with no history", () => {
    expect(composerWithRecall().press("ArrowDown")).toBeNull();
    expect(composerWithRecall([]).press("ArrowUp")).toBeNull();
  });

  it("hands the arrows back to the caret once the recalled message is edited", () => {
    const composer = composerWithRecall();
    composer.press("ArrowUp");
    composer.type("add tests for login");

    expect(composer.recall.isShowing(composer.text)).toBe(false);
    expect(composer.press("ArrowUp")).toBeNull();
    expect(composer.press("ArrowDown")).toBeNull();
  });

  it("moves between lines of a multi-line message before changing message", () => {
    const composer = composerWithRecall(["first line\nsecond line", "older"]);
    composer.press("ArrowUp");

    expect(composer.press("ArrowUp", { caret: "first line\nsec".length })).toBeNull();
    expect(composer.press("ArrowUp", { caret: 3 })).toBe("older");
    expect(composer.press("ArrowDown")).toBe("first line\nsecond line");
    expect(composer.press("ArrowDown", { caret: 3 })).toBeNull();
    expect(composer.press("ArrowDown")).toBe("");
  });

  it("ignores modified arrows, other keys, and a selection", () => {
    const composer = composerWithRecall();

    expect(composer.press("ArrowUp", { hasModifier: true })).toBeNull();
    expect(composer.press("Enter")).toBeNull();
    composer.press("ArrowUp");
    const recall = composer.recall;
    expect(
      recall.handleKeyPress(press("ArrowUp", "add tests", { caret: 0, selectionEnd: 3 }), () =>
        SENT.map(plainMessage),
      ),
    ).toBeNull();
  });
});

describe("prepareRecallMessages", () => {
  it("restores a sent comment and its image against the output preceding its original message", () => {
    const at = new Date(0);
    const image = {
      id: "note-image",
      mimeType: "image/png",
      storageType: "web-indexeddb" as const,
      storageKey: "note-image",
      createdAt: 0,
    };
    const first = {
      kind: "assistant_message" as const,
      id: "original",
      text: "The repeated quote.",
      timestamp: at,
    };
    const sent = {
      kind: "user_message" as const,
      id: "sent",
      text: "Please revise.\n\n```paseo-comment msg=1\n> repeated quote\n\nclarify this\n[Image 1]\n```",
      timestamp: at,
      images: [image],
    };
    const newer = {
      kind: "assistant_message" as const,
      id: "newer",
      text: "The repeated quote.",
      timestamp: at,
    };
    const messages = prepareRecallMessages(
      [{ message: sent, lastOutputId: "original" }],
      [first, sent, newer],
    );
    expect(messages).toEqual([
      {
        text: "Please revise.",
        unresolvedQuote: null,
        comments: [
          {
            id: expect.any(String),
            sourceItemId: "original",
            quote: "repeated quote",
            occurrence: 0,
            isCode: false,
            note: "clarify this",
            imageIds: ["note-image"],
          },
        ],
        attachments: [{ kind: "image", metadata: image }],
      },
    ]);
  });
  it("refuses to move a recalled comment when its original output has not been loaded", () => {
    const at = new Date(0);
    const wrong = {
      kind: "assistant_message" as const,
      id: "wrong",
      text: "The repeated quote.",
      timestamp: at,
    };
    const sent = {
      kind: "user_message" as const,
      id: "sent",
      text: "Please revise.\n\n```paseo-comment msg=2\n> repeated quote\n\nclarify this\n```",
      timestamp: at,
    };
    expect(
      prepareRecallMessages([{ message: sent, lastOutputId: "wrong" }], [wrong, sent]),
    ).toEqual([
      {
        text: "Please revise.",
        unresolvedQuote: "repeated quote",
        comments: [],
        attachments: [],
      },
    ]);
  });
});
