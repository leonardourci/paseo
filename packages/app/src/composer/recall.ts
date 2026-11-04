import equal from "fast-deep-equal";
import type { UserComposerAttachment } from "@/attachments/types";
import type { PendingOutputComment } from "@/output-comments/store";
import { parseOutputComments } from "@/output-comments/fence";
import { restoreOutgoingText } from "@/output-comments/send";
import type { SentAgentMessage } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import type { ComposerKeyPressEvent } from "@/composer/input/input";

export interface ComposerRecallMessage {
  text: string;
  unresolvedQuote: string | null;
  comments: PendingOutputComment[];
  attachments: UserComposerAttachment[];
}

interface RecalledMessage {
  index: number;
  message: ComposerRecallMessage;
}

const EMPTY_MESSAGE: ComposerRecallMessage = {
  text: "",
  unresolvedQuote: null,
  comments: [],
  attachments: [],
};

export function prepareRecallMessages(
  messages: readonly SentAgentMessage[],
  items: readonly StreamItem[],
): ComposerRecallMessage[] {
  const prepared: ComposerRecallMessage[] = [];
  for (const { message, lastOutputId } of messages) {
    const images = message.images ?? [];
    const restored = restoreOutgoingText({
      items: items.slice(
        0,
        items.findIndex((item) => item.id === message.id),
      ),
      text: message.text,
      lastOutputId,
      requireOriginalSource: true,
      imageIds: images.map((image) => image.id),
    });
    const unresolved = parseOutputComments(restored.text);
    const recalled: ComposerRecallMessage = {
      ...restored,
      text: unresolved.rest,
      unresolvedQuote: unresolved.comments[0]?.quote ?? null,
      attachments: images.map((metadata) => ({ kind: "image", metadata })),
    };
    const previous = prepared.at(-1);
    const sameContent =
      previous &&
      previous.text === recalled.text &&
      previous.unresolvedQuote === recalled.unresolvedQuote &&
      equal(previous.attachments, recalled.attachments) &&
      equal(
        previous.comments.map(({ id: _id, ...comment }) => comment),
        recalled.comments.map(({ id: _id, ...comment }) => comment),
      );
    if (!sameContent) prepared.push(recalled);
  }
  return prepared;
}

/**
 * Walks the messages already sent to an agent from an empty composer, like a
 * shell's Up/Down history. A message stays recalled only while the composer
 * still holds its exact text; the first edit hands the arrows back to the caret.
 */
export class ComposerRecall {
  private recalled: RecalledMessage | null = null;

  /** True while the composer shows a recalled message the user has not edited. */
  isShowing(text: string): boolean {
    return this.recalled !== null && this.recalled.message.text === text;
  }

  /**
   * Returns the restored draft for this key press, or null to
   * leave the key to the input. `readSentMessages` is newest first and is only
   * read for keys recall acts on.
   */
  handleKeyPress(
    event: ComposerKeyPressEvent,
    readSentMessages: () => readonly ComposerRecallMessage[],
    draft: ComposerRecallMessage = EMPTY_MESSAGE,
  ): ComposerRecallMessage | null {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
    if (event.hasModifier) return null;
    const { text, selection } = event.input;
    if (selection.start !== selection.end) return null;

    const matchesDraft =
      this.recalled &&
      equal(this.recalled.message.comments, draft.comments) &&
      equal(this.recalled.message.attachments, draft.attachments);
    const recalled = this.isShowing(text) && matchesDraft ? this.recalled : null;
    if (!recalled) {
      this.recalled = null;
      if (
        event.key !== "ArrowUp" ||
        text.length > 0 ||
        draft.comments.length > 0 ||
        draft.attachments.length > 0
      )
        return null;
      return this.show(readSentMessages(), 0);
    }

    if (event.key === "ArrowUp") {
      if (!isCaretOnFirstLine(text, selection.start)) return null;
      return this.show(readSentMessages(), recalled.index + 1);
    }
    if (!isCaretOnLastLine(text, selection.start)) return null;
    if (recalled.index === 0) {
      this.recalled = null;
      return EMPTY_MESSAGE;
    }
    return this.show(readSentMessages(), recalled.index - 1);
  }

  private show(
    messages: readonly ComposerRecallMessage[],
    index: number,
  ): ComposerRecallMessage | null {
    const message = messages[index];
    if (message === undefined) return null;
    this.recalled = {
      index,
      message:
        message.unresolvedQuote === null ? message : (this.recalled?.message ?? EMPTY_MESSAGE),
    };
    return message;
  }
}

function isCaretOnFirstLine(text: string, caret: number): boolean {
  return !text.slice(0, caret).includes("\n");
}

function isCaretOnLastLine(text: string, caret: number): boolean {
  return !text.slice(caret).includes("\n");
}
