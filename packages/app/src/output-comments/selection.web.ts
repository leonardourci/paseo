import { findMessageRows, findRenderedMatches } from "@/agent-stream/chat-find/ranges.web";
import { createAssistantRangeClipboardContent } from "@/assistant-selection-copy/content.web";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_TAG_ATTRIBUTE,
} from "@/assistant-selection-copy/markup";
import type { QuoteAnchor } from "./fence";
import { blockHolds, quotePieces } from "./match";
import type { MessageBlocks, MessageBlocksOf } from "./types";

export const ROW = "[data-history-row-id]";
/** A reply's Markdown block, as `OutputCommentsMessage` renders it. */
export const BLOCK = "[data-output-block]";
/** Semantic HTML from the Markdown renderer, or the copy markers of text the app draws. */
const tagged = (tag: string) => `${tag}, [${MARKDOWN_COPY_TAG_ATTRIBUTE}="${tag}"]`;
const CODE = `${tagged("pre")}, ${tagged("code")}`;
const LIST_ITEM = tagged("li");
const ITEM_OR_QUOTE = `${LIST_ITEM}, ${tagged("blockquote")}`;
const IGNORED = `[${MARKDOWN_COPY_IGNORE_ATTRIBUTE}]`;

export interface CommentableSelection extends QuoteAnchor {
  rect: DOMRect;
}

interface CommentableSelectionInput {
  selection: Selection | null;
  root: HTMLElement;
  blocksOf: MessageBlocksOf;
}

interface QuotePiecesInput {
  /** The message's rendered blocks, by index. */
  rows: ReadonlyMap<number, HTMLElement>;
  anchor: Pick<QuoteAnchor, "quote" | "isCode" | "startBlock" | "endBlock">;
  blocks: MessageBlocks;
}

interface OccurrenceInput {
  row: HTMLElement;
  piece: string | undefined;
  selected: Range;
}

interface SelectionEnd {
  block: HTMLElement;
  range: Range;
}

export function rowOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(ROW) ?? null;
}

function blockOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(BLOCK) ?? null;
}

function blockIndexOf(block: HTMLElement): number {
  return Number(block.dataset.outputBlock);
}

function findMessageBlocks(root: HTMLElement, sourceItemId: string): HTMLElement[] {
  return findMessageRows(root, sourceItemId).flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(BLOCK)),
  );
}

export function messageRowsByBlock(
  root: HTMLElement,
  sourceItemId: string,
): Map<number, HTMLElement> {
  return new Map(
    findMessageBlocks(root, sourceItemId).map((block) => [blockIndexOf(block), block]),
  );
}

/** The quote's pieces, a row each, grouped by what the rows hold, rendered or not. */
export function quotePiecesInRows({ rows, anchor, blocks }: QuotePiecesInput): string[] {
  return quotePieces(anchor, (offset, text) => {
    const block = anchor.startBlock + offset;
    const row = rows.get(block);
    if (!row) return blockHolds(blocks[block] ?? "", text);
    return findRenderedMatches(row, text, { mode: "quote" }).length > 0;
  });
}

/**
 * The occurrence of the quote's first piece that starts where the selection does, else the first
 * after its start (a selection opening on a space or a formatting edge), else the first.
 */
function occurrenceAt({ row, piece, selected }: OccurrenceInput): number {
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

/** A nested list continued after a comment card, carrying where its items sit in the source. */
const CONTINUATION = "[data-output-item-parent]";

/** The items at `parent`'s level, a continuation's own top level kept apart from the block's. */
function itemsBeside(scope: Element, parent: Element | null, continuation: Element | null) {
  return Array.from(scope.querySelectorAll(LIST_ITEM)).filter(
    (candidate) =>
      parentItemOrQuote(candidate) === parent &&
      (parent !== null || candidate.closest(CONTINUATION) === continuation),
  );
}

/**
 * The path, as `listItemPaths` numbers the block's Markdown, of the item the range ends in.
 * Each level counts on across sibling lists.
 */
function endItemPath(block: HTMLElement, range: Range): number[] | undefined {
  let item = lastSelectedText(block, range)?.parentElement?.closest(ITEM_OR_QUOTE) ?? null;
  const path: number[] = [];
  while (item) {
    if (!item.matches(LIST_ITEM)) return undefined;
    const parent = parentItemOrQuote(item);
    const continuation = parent ? null : item.closest<HTMLElement>(CONTINUATION);
    const index = itemsBeside(parent ?? continuation ?? block, parent, continuation).indexOf(item);
    if (continuation) {
      const { outputItemParent = "", outputItemStart = "0" } = continuation.dataset;
      const parentPath = outputItemParent.split(".").map(Number);
      return [...parentPath, Number(outputItemStart) + index, ...path];
    }
    path.unshift(index);
    item = parent;
  }
  return path.length > 0 ? path : undefined;
}

/**
 * A triple-click ends the range at the start of whatever follows the paragraph (the next block,
 * or a turn footer), so the end is the message's last block holding selected text, and the range
 * is cut back to that block.
 */
function selectionEnd(range: Range, root: HTMLElement, sourceItemId: string): SelectionEnd | null {
  const endRow = rowOf(range.endContainer);
  const endsInOtherMessage =
    endRow !== null && endRow.dataset.messageId !== sourceItemId && selectsTextIn(endRow, range);
  if (endsInOtherMessage) return null;
  const block = findMessageBlocks(root, sourceItemId).findLast((candidate) =>
    selectsTextIn(candidate, range),
  );
  if (!block) return null;
  if (block.contains(range.endContainer)) return { block, range };
  const clamped = range.cloneRange();
  clamped.setEnd(block, block.childNodes.length);
  return { block, range: clamped };
}

export function readCommentableSelection({
  selection,
  root,
  blocksOf,
}: CommentableSelectionInput): CommentableSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const sourceItemId = rowOf(range.startContainer)?.dataset.messageId;
  const startRow = blockOf(range.startContainer);
  if (!sourceItemId || !startRow) return null;
  const startBlock = blockIndexOf(startRow);
  const end = selectionEnd(range, root, sourceItemId);
  const endBlock = end ? blockIndexOf(end.block) : null;
  const content = end ? createAssistantRangeClipboardContent(end.range) : null;
  if (!end || endBlock === null || !content) return null;
  const rect = end.range.getBoundingClientRect();
  const hasArea = rect.width > 0 || rect.height > 0;
  if (!hasArea) return null;
  const isCode = isInsideCode(end.range);
  // Code keeps its leading indentation.
  const quote = isCode ? content.plainText.trimEnd() : content.plainText.trim();
  const [piece] = quotePiecesInRows({
    rows: messageRowsByBlock(root, sourceItemId),
    anchor: { quote, isCode, startBlock, endBlock },
    blocks: blocksOf(sourceItemId),
  });
  const occurrence = occurrenceAt({ row: startRow, piece, selected: range });
  const endItem = endItemPath(end.block, end.range);
  return { sourceItemId, startBlock, endBlock, quote, occurrence, isCode, endItem, rect };
}
