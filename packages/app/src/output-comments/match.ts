import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
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
/** Where a reply's text breaks its line, so a card's line keeps to the quote's own block. */
const LINE_ENDS = new Set([
  "paragraph_close",
  "heading_close",
  "tr_close",
  "fence",
  "code_block",
  "hr",
]);

export interface DeliveredOutputComment extends QuoteAnchor {
  key: string;
  note: string;
}

export type DeliveredOutputComments = ReadonlyMap<string, readonly DeliveredOutputComment[]>;

type QuoteText = Pick<QuoteAnchor, "quote" | "isCode">;

type QuoteContext = Pick<QuoteAnchor, "occurrence" | "prefix" | "suffix">;

export type LocatedQuote = QuoteText & QuoteContext;

/** Where a match sits in the text it was found in. */
export interface TextMatch {
  start: number;
  end: number;
}

type CommentTarget = Pick<QuoteAnchor, "sourceItemId">;

interface CommentTargetInput {
  items: readonly StreamItem[];
  end: number;
  comment: OutputComment;
}

interface QuoteSnippet {
  before: string;
  match: string;
  after: string;
}

export const EMPTY_DELIVERED_COMMENTS: DeliveredOutputComments = new Map();

/** How much of the reply's text on each side of a quote a comment keeps. */
const CONTEXT_LENGTH = 32;
const SNIPPET_BEFORE = 40;
const SNIPPET_MATCH = 80;

function collectText(tokens: readonly MarkdownToken[], parts: string[]): void {
  for (const token of tokens) {
    if (token.children) {
      collectText(token.children, parts);
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      parts.push(" ");
    } else if (TEXT_TOKENS.has(token.type)) {
      parts.push(token.content);
    }
    if (LINE_ENDS.has(token.type)) parts.push("\n");
  }
  parts.push(" ");
}

function markdownToPlainText(markdown: string): string {
  const parts: string[] = [];
  collectText(parser.parse(markdown, {}), parts);
  return parts.join("");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/** The quote as the reader sees it: one line, without Markdown syntax. */
export function quotePlainText({ quote, isCode }: QuoteText): string {
  return collapseWhitespace(isCode ? quote : markdownToPlainText(quote));
}

/**
 * A reply's text as the reader sees it, a line per block: what quotes are found in. A quote reads
 * the line breaks as spaces, so it runs across blocks.
 */
export function replyPlainText(markdown: string): string {
  return markdownToPlainText(markdown)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}

const replyTexts = new WeakMap<AssistantMessageItem, string>();

/** Parsed once per reply, and only for replies a comment is looked for in. */
export function replyTextOf(item: AssistantMessageItem): string {
  const cached = replyTexts.get(item);
  if (cached !== undefined) return cached;
  const text = replyPlainText(item.text);
  replyTexts.set(item, text);
  return text;
}

/** The reply's text on each side of a match, as a comment keeps it. */
export function contextAround(
  text: string,
  match: TextMatch,
): Pick<QuoteAnchor, "prefix" | "suffix"> {
  return {
    prefix: collapseWhitespace(text.slice(Math.max(0, match.start - CONTEXT_LENGTH), match.start)),
    suffix: collapseWhitespace(text.slice(match.end, match.end + CONTEXT_LENGTH)),
  };
}

/**
 * Whitespace aside, since the rendered text and the Markdown space blocks apart differently. A
 * suffix read while the reply still streamed may be cut short, so it only has to start what follows.
 */
function hasContext(text: string, match: TextMatch, { prefix, suffix }: QuoteContext): boolean {
  const reach = CONTEXT_LENGTH * 4;
  const before = withoutWhitespace(text.slice(Math.max(0, match.start - reach), match.start));
  const after = withoutWhitespace(text.slice(match.end, match.end + reach));
  return (
    before.endsWith(withoutWhitespace(prefix ?? "")) &&
    after.startsWith(withoutWhitespace(suffix ?? ""))
  );
}

/**
 * Which of the quote's matches in `text` is the comment's: its own occurrence while its context
 * still surrounds it, else the first its context surrounds, else its own occurrence. -1 when the
 * reply has none of them, so a quote the reply lost shows as unresolved instead of on other words.
 */
export function pickOccurrence(
  text: string,
  matches: readonly TextMatch[],
  context: QuoteContext,
): number {
  if (context.prefix !== undefined || context.suffix !== undefined) {
    const own = matches[context.occurrence];
    if (own && hasContext(text, own, context)) return context.occurrence;
    const surrounded = matches.findIndex((match) => hasContext(text, match, context));
    if (surrounded !== -1) return surrounded;
  }
  return context.occurrence < matches.length ? context.occurrence : -1;
}

/** Occurrences may overlap: the second "very very" in "very very very" starts inside the first. */
export function matchesIn(text: string, needle: string): TextMatch[] {
  const matches: TextMatch[] = [];
  if (!needle) return matches;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    matches.push({ start: at, end: at + needle.length });
  }
  return matches;
}

/** Where the comment's quote is in the reply's text, or null when the reply no longer holds it. */
export function locateQuote(replyText: string, anchor: LocatedQuote): TextMatch | null {
  // Same length, so the matches stand in the reply's text too.
  const text = replyText.replaceAll("\n", " ");
  const matches = matchesIn(text, quotePlainText(anchor));
  return matches[pickOccurrence(text, matches, anchor)] ?? null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** The quote with the text around it in its blocks, or null when the reply no longer holds it. */
export function quoteSnippet(replyText: string, anchor: LocatedQuote): QuoteSnippet | null {
  const match = locateQuote(replyText, anchor);
  if (!match) return null;
  const needle = replyText.slice(match.start, match.end).replaceAll("\n", " ");
  const lineStart = replyText.lastIndexOf("\n", match.start - 1) + 1;
  const lineEnd = replyText.indexOf("\n", match.end);
  // Context before the quote only takes the room the quote leaves on the line, so a quote that
  // fills it starts the line.
  const room = Math.max(0, Math.min(SNIPPET_BEFORE, SNIPPET_MATCH - needle.length));
  const start = Math.max(lineStart, match.start - room);
  const leading = replyText.slice(start, match.start).trimStart();
  const before = start > lineStart && leading ? `…${leading}` : leading;
  // The line ellipsizes, so a long block's rest would only weigh on the text.
  const end = Math.min(lineEnd === -1 ? replyText.length : lineEnd, match.end + SNIPPET_MATCH);
  const after = needle.length > SNIPPET_MATCH ? "" : replyText.slice(match.end, end);
  return { before, match: clip(needle, SNIPPET_MATCH), after };
}

const parsedTurns = new WeakMap<UserMessageItem, ParsedOutputComment[]>();

function commentsOf(item: UserMessageItem): ParsedOutputComment[] {
  const cached = parsedTurns.get(item);
  if (cached) return cached;
  const { comments } = parseOutputComments(item.text);
  parsedTurns.set(item, comments);
  return comments;
}

function holdsQuote(item: AssistantMessageItem, comment: LocatedQuote): boolean {
  return locateQuote(replyTextOf(item), comment) !== null;
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
  if (named && holdsQuote(named, comment)) return { sourceItemId: named.id };
  for (let index = end - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind === "assistant_message" && holdsQuote(candidate, comment)) {
      return { sourceItemId: candidate.id };
    }
  }
  return null;
}

/**
 * The one assistant message holding the quote where it was made, same occurrence and context. Null
 * when none does, or when several do and the choice would be a guess.
 */
export function findMovedCommentSource(
  items: readonly StreamItem[],
  anchor: QuoteAnchor,
): string | null {
  const matches = items.filter(
    (item): item is AssistantMessageItem =>
      item.kind === "assistant_message" && holdsQuote(item, anchor),
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
