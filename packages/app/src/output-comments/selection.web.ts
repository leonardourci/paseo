import { findMessageRows, findRenderedMatches } from "@/agent-stream/chat-find/ranges.web";
import { getAssistantBlockIndex } from "@/agent-stream/presentation";
import { createAssistantRangeClipboardContent } from "@/assistant-selection-copy/content.web";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_TAG_ATTRIBUTE,
} from "@/assistant-selection-copy/markup";
import type { QuoteAnchor } from "./fence";
import { quotePieces } from "./match";

const ROW = "[data-history-row-id]";
const ASSISTANT_MESSAGE = '[data-testid="assistant-message"]';
const CODE = `[${MARKDOWN_COPY_TAG_ATTRIBUTE}="pre"], [${MARKDOWN_COPY_TAG_ATTRIBUTE}="code"]`;
const LIST_ITEM = `[${MARKDOWN_COPY_TAG_ATTRIBUTE}="li"]`;
const ITEM_OR_QUOTE = `${LIST_ITEM}, [${MARKDOWN_COPY_TAG_ATTRIBUTE}="blockquote"]`;
const IGNORED = `[${MARKDOWN_COPY_IGNORE_ATTRIBUTE}]`;

export interface CommentableSelection extends QuoteAnchor {
  rect: DOMRect;
}

interface SelectionEnd {
  row: HTMLElement;
  range: Range;
}

function rowOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(ROW) ?? null;
}

export function blockIndexOfRow(row: HTMLElement): number | null {
  return getAssistantBlockIndex(row.dataset.historyRowId ?? "");
}

/**
 * The occurrence of the quote's first piece that starts where the selection does, else the first
 * after its start (a selection opening on a space or a formatting edge), else the first.
 */
function occurrenceAt(
  row: HTMLElement,
  anchor: Pick<QuoteAnchor, "quote" | "isCode">,
  selected: Range,
): number {
  const [piece] = quotePieces(anchor);
  if (!piece) return 0;
  const matches = findRenderedMatches(row, piece, { mode: "quote" });
  const startsAt = (match: Range) => match.compareBoundaryPoints(Range.START_TO_START, selected);
  const exact = matches.findIndex((match) => startsAt(match) === 0);
  if (exact !== -1) return exact;
  return Math.max(
    0,
    matches.findIndex((match) => startsAt(match) > 0),
  );
}

/** Copying a selection inside code yields the code itself, not Markdown. */
function isInsideCode(range: Range): boolean {
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(CODE));
}

function selectsTextIn(row: HTMLElement, range: Range): boolean {
  const probe = document.createRange();
  probe.selectNodeContents(row);
  probe.setEnd(range.endContainer, range.endOffset);
  return probe.toString().trim().length > 0;
}

/** The last text node the range selects any of, so an end at the start of a line isn't in it. */
function lastSelectedText(row: HTMLElement, range: Range): Text | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    if (node.parentElement?.closest(IGNORED)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (node.data.slice(start, end).trim()) last = node;
  }
  return last;
}

function parentItemOrQuote(element: Element): Element | null {
  return element.parentElement?.closest(ITEM_OR_QUOTE) ?? null;
}

/** The DOM reading of `getMarkdownListItemPath`, for the item the range ends in. */
function endItemPath(row: HTMLElement, range: Range): number[] | undefined {
  let item = lastSelectedText(row, range)?.parentElement?.closest(ITEM_OR_QUOTE) ?? null;
  const path: number[] = [];
  while (item) {
    if (!item.matches(LIST_ITEM)) return undefined;
    const parent = parentItemOrQuote(item);
    const level = Array.from((parent ?? row).querySelectorAll(LIST_ITEM)).filter(
      (candidate) => parentItemOrQuote(candidate) === parent,
    );
    path.unshift(level.indexOf(item));
    item = parent;
  }
  return path.length > 0 ? path : undefined;
}

/**
 * A triple-click ends the range at the start of whatever follows the paragraph (the next row,
 * or a turn footer), so the end is the message's last row holding selected text, and the range
 * is cut back to that row's Markdown.
 */
function selectionEnd(range: Range, root: HTMLElement, sourceItemId: string): SelectionEnd | null {
  const endRow = rowOf(range.endContainer);
  const endsInOtherMessage =
    endRow !== null && endRow.dataset.messageId !== sourceItemId && selectsTextIn(endRow, range);
  if (endsInOtherMessage) return null;
  const row = findMessageRows(root, sourceItemId).findLast((candidate) =>
    selectsTextIn(candidate, range),
  );
  const message = row?.querySelector(ASSISTANT_MESSAGE);
  if (!row || !message) return null;
  if (message.contains(range.endContainer)) return { row, range };
  const clamped = range.cloneRange();
  clamped.setEnd(message, message.childNodes.length);
  return { row, range: clamped };
}

export function readCommentableSelection(
  selection: Selection | null,
  root: HTMLElement,
): CommentableSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startRow = rowOf(range.startContainer);
  const sourceItemId = startRow?.dataset.messageId;
  const startBlock = startRow ? blockIndexOfRow(startRow) : null;
  if (!sourceItemId || startBlock === null) return null;
  const end = selectionEnd(range, root, sourceItemId);
  const endBlock = end ? blockIndexOfRow(end.row) : null;
  const content = end ? createAssistantRangeClipboardContent(end.range) : null;
  if (!end || endBlock === null || !content) return null;
  const rect = end.range.getBoundingClientRect();
  const hasArea = rect.width > 0 || rect.height > 0;
  if (!hasArea) return null;
  const isCode = isInsideCode(end.range);
  // Code keeps its leading indentation.
  const quote = isCode ? content.plainText.trimEnd() : content.plainText.trim();
  const occurrence = occurrenceAt(startRow, { quote, isCode }, range);
  const endItem = endItemPath(end.row, end.range);
  return { sourceItemId, startBlock, endBlock, quote, occurrence, isCode, endItem, rect };
}
