import { findMessageRows, findRenderedQuote } from "@/agent-stream/chat-find/ranges.web";
import { createAssistantRangeClipboardContent } from "@/assistant-selection-copy/content.web";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_TAG_ATTRIBUTE,
} from "@/assistant-selection-copy/markup";
import type { QuoteAnchor } from "./fence";
import { contextAround, quotePlainText } from "./match";

export const ROW = "[data-history-row-id]";
/** An assistant reply's text, rendered whole as one Markdown text. */
const REPLY = '[data-testid="assistant-message"]';
/** A reply still streaming in, which comments wait out before finding their quotes. */
const STREAMING = '[data-message-streaming="true"]';
/** Semantic HTML from the Markdown renderer, or the copy markers of text the app draws. */
const tagged = (tag: string) => `${tag}, [${MARKDOWN_COPY_TAG_ATTRIBUTE}="${tag}"]`;
const CODE = `${tagged("pre")}, ${tagged("code")}`;
const IGNORED = `[${MARKDOWN_COPY_IGNORE_ATTRIBUTE}]`;

export interface CommentableSelection extends QuoteAnchor {
  rect: DOMRect;
}

interface CommentableSelectionInput {
  selection: Selection | null;
  root: HTMLElement;
}

export function rowOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(ROW) ?? null;
}

function replyOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(REPLY) ?? null;
}

/** The rendered, complete replies of a message: a list can render the same row twice. */
export function findReplies(root: HTMLElement, sourceItemId: string): HTMLElement[] {
  return findMessageRows(root, sourceItemId).flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(REPLY)).filter(
      (reply) => !reply.matches(STREAMING),
    ),
  );
}

/**
 * The occurrence of the quote that starts where the selection does, else the first after its start
 * (a selection opening on a space or a formatting edge), else the first; with the reply's text
 * around it.
 */
function placeInReply(
  reply: HTMLElement,
  quote: Pick<QuoteAnchor, "quote" | "isCode">,
  selected: Range,
): Pick<QuoteAnchor, "occurrence" | "prefix" | "suffix"> {
  const { text, matches } = findRenderedQuote(reply, quotePlainText(quote));
  const startsAt = (index: number) =>
    matches[index]!.range.compareBoundaryPoints(Range.START_TO_START, selected);
  const exact = matches.findIndex((_match, index) => startsAt(index) === 0);
  const after = matches.findIndex((_match, index) => startsAt(index) > 0);
  const occurrence = Math.max(0, exact !== -1 ? exact : after);
  const match = matches[occurrence];
  return match ? { occurrence, ...contextAround(text, match) } : { occurrence };
}

/** Copying a selection inside code yields the code itself, not Markdown. */
function isInsideCode(range: Range): boolean {
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(CODE));
}

function selectsTextIn(element: HTMLElement, range: Range): boolean {
  const probe = document.createRange();
  probe.selectNodeContents(element);
  probe.setEnd(range.endContainer, range.endOffset);
  return probe.toString().trim().length > 0;
}

/** The last text node the range selects any of, and where in it the selection ends. */
function lastSelectedText(reply: HTMLElement, range: Range): { node: Text; end: number } | null {
  const walker = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT);
  let last: { node: Text; end: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    if (node.parentElement?.closest(IGNORED)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (node.data.slice(start, end).trim()) last = { node, end };
  }
  return last;
}

/**
 * The selection cut back to the reply's last selected text: a triple-click ends the range at the
 * start of whatever follows the paragraph (the next one, or a turn footer). Null when it runs on
 * into another message's text.
 */
function selectionInReply(range: Range, reply: HTMLElement, sourceItemId: string): Range | null {
  const endRow = rowOf(range.endContainer);
  const endsInOtherMessage =
    endRow !== null && endRow.dataset.messageId !== sourceItemId && selectsTextIn(endRow, range);
  if (endsInOtherMessage) return null;
  const last = lastSelectedText(reply, range);
  if (!last) return null;
  const clamped = range.cloneRange();
  clamped.setEnd(last.node, last.end);
  return clamped;
}

export function readCommentableSelection({
  selection,
  root,
}: CommentableSelectionInput): CommentableSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const sourceItemId = rowOf(range.startContainer)?.dataset.messageId;
  const reply = replyOf(range.startContainer);
  if (!sourceItemId || !reply) return null;
  const selected = selectionInReply(range, reply, sourceItemId);
  const content = selected ? createAssistantRangeClipboardContent(selected) : null;
  if (!selected || !content) return null;
  const rect = selected.getBoundingClientRect();
  const hasArea = rect.width > 0 || rect.height > 0;
  if (!hasArea) return null;
  const isCode = isInsideCode(selected);
  // Code keeps its leading indentation.
  const quote = isCode ? content.plainText.trimEnd() : content.plainText.trim();
  const place = placeInReply(reply, { quote, isCode }, range);
  return { sourceItemId, quote, isCode, ...place, rect };
}
