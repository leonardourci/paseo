import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import { generateMessageId, type StreamItem } from "@/types/stream";
import { parseOutputComments, withOutputComments, type OutputComment } from "./fence";
import { findCommentTarget } from "./match";
import {
  isSendable,
  loadedComments,
  type PendingOutputComment,
  type SentOutputComment,
} from "./store";

interface PendingText {
  text: string;
  pending: readonly PendingOutputComment[];
  loaded: readonly string[] | undefined;
}

interface OutgoingText extends PendingText {
  /** The images sent with the message, in send order. */
  imageIds: readonly string[];
}

interface PreparedOutgoingText {
  text: string;
  sent: SentOutputComment[];
  lastOutputId: string | undefined;
}

interface QueuedText {
  items: readonly StreamItem[];
  text: string;
  lastOutputId: string | undefined;
}

interface RestoredTextInput extends QueuedText {
  /** The images coming back with the text, in send order. */
  imageIds: readonly string[];
}

interface RestoredMessage {
  text: string;
  comments: PendingOutputComment[];
}

interface CommentImagesInput {
  attachments: UserComposerAttachment[];
  draft: readonly UserComposerAttachment[];
  pending: readonly PendingOutputComment[];
}

const IMAGE_MARKERS = /(?:^|\n)(\[Image \d+\](?: \[Image \d+\])*)$/;

export function attachedImages(attachments: readonly ComposerAttachment[]): AttachmentMetadata[] {
  return attachments.flatMap((attachment) =>
    attachment.kind === "image" ? [attachment.metadata] : [],
  );
}

export function imageAttachmentIds(attachments: readonly ComposerAttachment[]): string[] {
  return attachedImages(attachments).map((image) => image.id);
}

function noteWithImages(comment: PendingOutputComment, imageIds: readonly string[]): string {
  const markers = comment.imageIds
    .map((id) => imageIds.indexOf(id) + 1)
    .filter((position) => position > 0)
    .sort((a, b) => a - b)
    .map((position) => `[Image ${position}]`)
    .join(" ");
  return [comment.note.trim(), markers].filter((part) => part.length > 0).join("\n");
}

/** Reverses `noteWithImages`: the images a marker names that are still at hand get relinked. */
function splitImageMarkers(
  note: string,
  imageIds: readonly string[],
): Pick<PendingOutputComment, "note" | "imageIds"> {
  const markers = IMAGE_MARKERS.exec(note);
  if (!markers) return { note, imageIds: [] };
  const linked = Array.from(
    markers[1].matchAll(/\d+/g),
    ([position]) => imageIds[Number(position) - 1],
  );
  return {
    note: note.slice(0, markers.index),
    imageIds: linked.filter((id): id is string => id !== undefined),
  };
}

/** Counted back from the end of the loaded output, which the message will follow. */
function ordinalOf(
  sourceItemId: string,
  loaded: readonly string[] | undefined,
): number | undefined {
  if (loaded === undefined) return undefined;
  const index = loaded.indexOf(sourceItemId);
  return index === -1 ? undefined : loaded.length - index;
}

function toOutputComment(
  comment: PendingOutputComment,
  { imageIds, loaded }: Pick<OutgoingText, "imageIds" | "loaded">,
): OutputComment {
  return {
    quote: comment.quote,
    note: noteWithImages(comment, imageIds),
    startBlock: comment.startBlock,
    occurrence: comment.occurrence,
    isCode: comment.isCode,
    endItem: comment.endItem,
    messageOrdinal: ordinalOf(comment.sourceItemId, loaded),
  };
}

/** Fences would make a command's arguments, so a command leaves every comment pending. */
function isCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

function commentsToSend({ text, pending, loaded }: PendingText): PendingOutputComment[] {
  return isCommand(text) ? [] : loadedComments(pending, loaded);
}

/** The comments the next message would carry. */
export function sendableComments({
  pending,
  imageIds,
  loaded,
}: Omit<OutgoingText, "text">): PendingOutputComment[] {
  return loadedComments(pending, loaded).filter((comment) => isSendable(comment, imageIds));
}

export function prepareOutgoingText(outgoing: OutgoingText): PreparedOutgoingText {
  const sent = commentsToSend(outgoing);
  const comments = sent
    .filter((comment) => isSendable(comment, outgoing.imageIds))
    .map((comment) => toOutputComment(comment, outgoing));
  return {
    text: withOutputComments(outgoing.text, comments),
    sent: sent.map(({ id, note }) => ({ id, note })),
    lastOutputId: comments.length > 0 ? outgoing.loaded?.at(-1) : undefined,
  };
}

/** The images only comments staying pending use; a comment sent with the text takes its own. */
export function heldImageIds(input: PendingText): string[] {
  const sentImageIds = new Set(commentsToSend(input).flatMap(({ imageIds }) => imageIds));
  return input.pending.flatMap(({ imageIds }) => imageIds).filter((id) => !sentImageIds.has(id));
}

/** `attachments`, plus the draft's images that a pending comment still uses. */
export function withCommentImages({
  attachments,
  draft,
  pending,
}: CommentImagesInput): UserComposerAttachment[] {
  const used = new Set(pending.flatMap(({ imageIds }) => imageIds));
  const present = new Set(imageAttachmentIds(attachments));
  const missing = draft.filter(
    (attachment) =>
      attachment.kind === "image" &&
      used.has(attachment.metadata.id) &&
      !present.has(attachment.metadata.id),
  );
  return missing.length > 0 ? [...attachments, ...missing] : attachments;
}

/**
 * Where the output a queued message was written against ends in `items`, or null once that
 * output is gone and its comments' ordinals mean nothing.
 */
function queuedOutputEnd(
  items: readonly StreamItem[],
  lastOutputId: string | undefined,
): number | null {
  if (lastOutputId === undefined) return items.length;
  const index = items.findIndex((item) => item.id === lastOutputId);
  return index === -1 ? null : index + 1;
}

/**
 * A queued message's ordinals count back from the output it was queued behind. By the time it
 * sends, the agent may have written more, so each ordinal moves back past the newer messages.
 */
export function placeQueuedText({ items, text, lastOutputId }: QueuedText): string {
  const end = queuedOutputEnd(items, lastOutputId);
  const isOutputGone = end === null;
  const newer = isOutputGone
    ? 0
    : items.slice(end).filter((item) => item.kind === "assistant_message").length;
  const areOrdinalsCurrent = !isOutputGone && newer === 0;
  const parsed = parseOutputComments(text);
  if (areOrdinalsCurrent || parsed.comments.length === 0) return text;
  const comments = parsed.comments.map(({ position: _position, messageOrdinal, ...comment }) => ({
    ...comment,
    messageOrdinal:
      isOutputGone || messageOrdinal === undefined ? undefined : messageOrdinal + newer,
  }));
  return withOutputComments(parsed.rest, comments);
}

/**
 * Turns a sent message back into composer text and pending comments, each aimed at the output
 * it was written against, or at the latest output holding its quote once the output a queued
 * message followed is gone. A comment no output holds stays in the text.
 */
export function restoreOutgoingText({
  items,
  text,
  lastOutputId,
  imageIds,
}: RestoredTextInput): RestoredMessage {
  const end = queuedOutputEnd(items, lastOutputId);
  const parsed = parseOutputComments(text);
  const comments: PendingOutputComment[] = [];
  const unresolved: OutputComment[] = [];
  for (const { position: _position, ...parsedComment } of parsed.comments) {
    const comment = end === null ? { ...parsedComment, messageOrdinal: undefined } : parsedComment;
    const target = findCommentTarget({ items, end: end ?? items.length, comment });
    if (!target) {
      unresolved.push({ ...comment, messageOrdinal: undefined });
      continue;
    }
    comments.push({
      id: generateMessageId(),
      sourceItemId: target.sourceItemId,
      startBlock: target.startBlock,
      endBlock: target.endBlock,
      quote: comment.quote,
      occurrence: comment.occurrence,
      isCode: comment.isCode,
      endItem: target.endItem,
      ...splitImageMarkers(comment.note, imageIds),
    });
  }
  return { text: withOutputComments(parsed.rest, unresolved), comments };
}
