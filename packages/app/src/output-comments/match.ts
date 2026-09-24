import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import type { AssistantMessageItem, StreamItem, UserMessageItem } from "@/types/stream";
import {
  parseOutputComments,
  type OutputComment,
  type ParsedOutputComment,
  type QuoteAnchor,
} from "./fence";

const parser = createAssistantMarkdownParser();
type MarkdownToken = ReturnType<typeof parser.parse>[number];
const TEXT_TOKENS = new Set(["text", "code_inline", "code_block", "fence"]);

type QuoteLocation = Pick<QuoteAnchor, "startBlock" | "endBlock">;

export interface DeliveredOutputComment extends QuoteAnchor {
  key: string;
  note: string;
}

export type DeliveredOutputComments = ReadonlyMap<string, readonly DeliveredOutputComment[]>;

interface NormalizedMessage {
  text: string;
  blockStarts: number[];
}

type CommentTarget = Pick<QuoteAnchor, "sourceItemId" | "startBlock" | "endBlock">;

type QuoteText = Pick<QuoteAnchor, "quote" | "isCode">;

interface CommentTargetInput {
  items: readonly StreamItem[];
  end: number;
  comment: OutputComment;
}

export const EMPTY_DELIVERED_COMMENTS: DeliveredOutputComments = new Map();

function collectText(tokens: readonly MarkdownToken[], parts: string[]): void {
  for (const token of tokens) {
    if (token.children) {
      collectText(token.children, parts);
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      parts.push(" ");
    } else if (TEXT_TOKENS.has(token.type)) {
      parts.push(token.content);
    }
  }
  parts.push(" ");
}

function markdownToPlainText(markdown: string): string {
  const parts: string[] = [];
  collectText(parser.parse(markdown, {}), parts);
  return parts.join("");
}

/**
 * The quote's text per block it spans, blank for a block with no text (a rule) so each piece
 * stays at its block's offset. Code is one piece, as written.
 */
export function quotePieces({ quote, isCode }: QuoteText): string[] {
  return isCode ? [quote] : splitMarkdownBlocks(quote).map(markdownToPlainText);
}

interface QuoteSnippet {
  before: string;
  match: string;
  after: string;
}

const SNIPPET_BEFORE = 40;
const SNIPPET_MATCH = 80;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Occurrences may overlap: the second "very very" in "very very very" starts inside the first. */
function indexOfOccurrence(text: string, needle: string, occurrence: number): number {
  let at = text.indexOf(needle);
  for (let seen = 0; seen < occurrence && at !== -1; seen += 1) {
    at = text.indexOf(needle, at + 1);
  }
  return at;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** The quote as the reader sees it: one line, without Markdown syntax. */
export function quotePlainText({ quote, isCode }: QuoteText): string {
  return collapseWhitespace(isCode ? quote : markdownToPlainText(quote));
}

export function quoteSnippet(
  blockText: string,
  anchor: Pick<QuoteAnchor, "quote" | "occurrence" | "isCode">,
): QuoteSnippet {
  const block = collapseWhitespace(markdownToPlainText(blockText));
  const whole = quotePlainText(anchor);
  const pieces = quotePieces(anchor).map(collapseWhitespace);
  // Its own occurrence where the block still has it, else the first.
  const candidates: [string | undefined, number][] = [
    [whole, anchor.occurrence],
    [whole, 0],
    [pieces[0], anchor.occurrence],
    [pieces[0], 0],
    [pieces.at(-1), 0],
  ];
  for (const [needle, occurrence] of candidates) {
    if (!needle) continue;
    const at = indexOfOccurrence(block, needle, occurrence);
    if (at === -1) continue;
    // Context before the quote only takes the room the quote leaves on the line, so a quote that
    // fills it starts the line.
    const room = Math.max(0, Math.min(SNIPPET_BEFORE, SNIPPET_MATCH - needle.length));
    const start = Math.max(0, at - room);
    const leading = block.slice(start, at).trimStart();
    const before = start > 0 && leading ? `…${leading}` : leading;
    const after = needle.length > SNIPPET_MATCH ? "" : block.slice(at + needle.length);
    return { before, match: clip(needle, SNIPPET_MATCH), after };
  }
  return { before: "", match: clip(whole, SNIPPET_MATCH), after: "" };
}

function normalizeForMatch(markdown: string): string {
  return markdownToPlainText(markdown).replace(/\s+/g, "");
}

const normalizedMessages = new WeakMap<AssistantMessageItem, NormalizedMessage>();

function normalizeMessage(item: AssistantMessageItem): NormalizedMessage {
  const cached = normalizedMessages.get(item);
  if (cached) return cached;
  const normalized: NormalizedMessage = { text: "", blockStarts: [] };
  for (const block of splitMarkdownBlocks(item.text)) {
    normalized.blockStarts.push(normalized.text.length);
    normalized.text += normalizeForMatch(block);
  }
  normalizedMessages.set(item, normalized);
  return normalized;
}

function blockAt(blockStarts: readonly number[], position: number): number {
  let block = 0;
  for (const [index, start] of blockStarts.entries()) {
    if (start <= position) block = index;
  }
  return block;
}

function locateInMessage(
  message: NormalizedMessage,
  { quote, isCode, startBlock }: Pick<QuoteAnchor, "quote" | "isCode" | "startBlock">,
): QuoteLocation | null {
  const needle = isCode ? quote.replace(/\s+/g, "") : normalizeForMatch(quote);
  if (!needle) return null;
  let first: QuoteLocation | null = null;
  for (
    let at = message.text.indexOf(needle);
    at !== -1;
    at = message.text.indexOf(needle, at + 1)
  ) {
    const location = {
      startBlock: blockAt(message.blockStarts, at),
      endBlock: blockAt(message.blockStarts, at + needle.length - 1),
    };
    if (location.startBlock === startBlock) return location;
    first ??= location;
  }
  return first;
}

const parsedTurns = new WeakMap<UserMessageItem, ParsedOutputComment[]>();

function commentsOf(item: UserMessageItem): ParsedOutputComment[] {
  const cached = parsedTurns.get(item);
  if (cached) return cached;
  const { comments } = parseOutputComments(item.text);
  parsedTurns.set(item, comments);
  return comments;
}

function locateComment(item: AssistantMessageItem, comment: OutputComment): CommentTarget | null {
  const location = locateInMessage(normalizeMessage(item), comment);
  return location ? { ...location, sourceItemId: item.id } : null;
}

/** The assistant message `ordinal` back from `end`: 1 is the last one before it. */
function assistantMessageBefore(
  items: readonly StreamItem[],
  end: number,
  ordinal: number,
): AssistantMessageItem | null {
  let seen = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "assistant_message") continue;
    seen += 1;
    if (seen === ordinal) return item;
  }
  return null;
}

/**
 * The assistant message the comment's ordinal names, counted back from `end`, while it still holds
 * the quote. Otherwise the nearest one before `end` that does.
 */
export function findCommentTarget({
  items,
  end,
  comment,
}: CommentTargetInput): CommentTarget | null {
  const named =
    comment.messageOrdinal === undefined
      ? null
      : assistantMessageBefore(items, end, comment.messageOrdinal);
  const placed = named ? locateComment(named, comment) : null;
  if (placed) return placed;
  for (let index = end - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind !== "assistant_message") continue;
    const location = locateComment(candidate, comment);
    if (location) return location;
  }
  return null;
}

function holdsQuoteAt(item: AssistantMessageItem, anchor: QuoteAnchor): boolean {
  const location = locateInMessage(normalizeMessage(item), anchor);
  if (location?.startBlock !== anchor.startBlock || location.endBlock !== anchor.endBlock) {
    return false;
  }
  const block = collapseWhitespace(
    markdownToPlainText(splitMarkdownBlocks(item.text)[anchor.startBlock]),
  );
  const piece = collapseWhitespace(quotePieces(anchor)[0] ?? "");
  return indexOfOccurrence(block, piece, anchor.occurrence) !== -1;
}

/**
 * The one assistant message holding the quote where it was made, same blocks and occurrence. Null
 * when none does, or when several do and the choice would be a guess.
 */
export function findMovedCommentSource(
  items: readonly StreamItem[],
  anchor: QuoteAnchor,
): string | null {
  const matches = items.filter(
    (item): item is AssistantMessageItem =>
      item.kind === "assistant_message" && holdsQuoteAt(item, anchor),
  );
  return matches.length === 1 && matches[0] ? matches[0].id : null;
}

export function deliveredCommentKey(turnItemId: string, position: number): string {
  return `${turnItemId}:${position}`;
}

export function throughLastCommentTurn(items: readonly StreamItem[]): readonly StreamItem[] {
  const last = items.findLastIndex(
    (item) => item.kind === "user_message" && commentsOf(item).length > 0,
  );
  return items.slice(0, last + 1);
}

/**
 * Fences carry no message id (ids change when a session is rebuilt), so each comment resolves by
 * its ordinal, counted back from its turn, or else by its quote.
 */
export function resolveDeliveredOutputComments(
  items: readonly StreamItem[],
): DeliveredOutputComments {
  const delivered = new Map<string, DeliveredOutputComment[]>();
  for (const [index, item] of items.entries()) {
    if (item.kind !== "user_message") continue;
    for (const { position, ...comment } of commentsOf(item)) {
      const target = findCommentTarget({ items, end: index, comment });
      if (!target) continue;
      const list = delivered.get(target.sourceItemId) ?? [];
      list.push({ ...comment, ...target, key: deliveredCommentKey(item.id, position) });
      delivered.set(target.sourceItemId, list);
    }
  }
  // A shared empty map keeps consumers still while a chat without comments streams.
  return delivered.size > 0 ? delivered : EMPTY_DELIVERED_COMMENTS;
}
