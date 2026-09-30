import { MARKDOWN_COPY_IGNORE_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { ROW, rowOf } from "@/output-comments/selection.web";
import { PENDING_CARD } from "@/output-comments/surface.web";
import { OUTPUT_CARET_HOST_ATTRIBUTE } from "./host";

export type CaretDirection = "backward" | "forward";

const SENT_COMMENTS = '[data-testid="user-message-output-comments"]';
const SENT_COMMENTS_TOGGLE = '[data-testid="user-message-output-comments-toggle"]';
const FIELD = "textarea, input";
const SKIPPED_ROWS = '[data-row-kind="tool_call"], [data-row-kind="thought"]';
/**
 * What the keyboard caret steps over, as `contenteditable="false"` would, without touching the DOM.
 * The mouse still selects it.
 */
const ISLANDS = [
  "button",
  '[role="button"]',
  `[${MARKDOWN_COPY_IGNORE_ATTRIBUTE}]`,
  '[data-testid="user-message-trailing-row"]',
  '[data-testid="user-message-timestamp"]',
  '[data-testid="assistant-turn-footer"]',
  SKIPPED_ROWS,
  PENDING_CARD,
  // Up and down bounce between a link's inline box and its line, never leaving either.
  ":has(> a[href])",
].join(", ");
const NOT_CONTENT = `${FIELD}, ${ISLANDS}`;
const VISIBLE_CHARACTER = /[^\s\u200b\ufeff]/;
/** What lays out a note's text, so a copy of it wraps where the note does. */
const NOTE_TEXT_STYLES = [
  "paddingLeft",
  "paddingRight",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "overflowWrap",
  "tabSize",
  "textIndent",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "wordSpacing",
] as const;

const HOST = `[${OUTPUT_CARET_HOST_ATTRIBUTE}]`;

export const HOST_CSS = `
/* The caret shows the focus; a ring would box the whole chat. */
${HOST}, ${HOST}:focus-visible { outline: none; }
/* One caret colour, not each text's (muted, code, link). Editable text wraps long words and keeps
   trailing spaces; inheriting, the output lays out as before. */
${HOST} { caret-color: var(--colors-foreground); overflow-wrap: inherit; line-break: inherit; }
/* Islands, empty boxes, and spacers beside the rows would each take a caret stop where no text is. */
${HOST} :is(${ISLANDS}), ${HOST} div:empty, ${HOST} > :not(${ROW}, :has(${ROW})) {
  -webkit-user-modify: read-only;
}`;

export interface TextPosition {
  node: Node;
  offset: number;
}

export interface CaretBox {
  top: number;
  height: number;
}

export function isOutputPosition(scroller: HTMLElement, node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return scroller.contains(node) && !element?.closest(FIELD);
}

export function focusOf(selection: Selection): TextPosition | null {
  const node = selection.focusNode;
  return node ? { node, offset: selection.focusOffset } : null;
}

export function placeFocus(input: { position: TextPosition; extend?: boolean }): void {
  const selection = window.getSelection();
  const { node, offset } = input.position;
  if (input.extend) selection?.extend(node, offset);
  else selection?.collapse(node, offset);
}

/** Negative when `position` is before `reference`, positive after, zero at it. */
export function comparePositions(position: TextPosition, reference: TextPosition): number {
  const range = document.createRange();
  range.setStart(reference.node, reference.offset);
  return range.comparePoint(position.node, position.offset);
}

function isContentText(node: Node): node is Text {
  if (!(node instanceof Text) || !VISIBLE_CHARACTER.test(node.data)) return false;
  const parent = node.parentElement;
  if (!parent?.closest(ROW) || parent.closest(NOT_CONTENT)) return false;
  return parent.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function contentTexts(root: Node): Text[] {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isContentText(node)) texts.push(node);
  }
  return texts;
}

function rowStart(row: HTMLElement): TextPosition | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isContentText(node)) return { node, offset: 0 };
  }
  return null;
}

function rowEnd(row: HTMLElement): TextPosition | null {
  const last = contentTexts(row).at(-1);
  return last ? { node: last, offset: last.length } : null;
}

function textRows(scroller: HTMLElement): HTMLElement[] {
  const rows = Array.from(scroller.querySelectorAll<HTMLElement>(ROW));
  return rows.filter((row) => rowStart(row) !== null);
}

/** The assistant rows after the last user message that has an answer. */
function latestReply(rows: readonly HTMLElement[]): HTMLElement[] {
  let current: HTMLElement[] = [];
  let latest: HTMLElement[] = [];
  for (const row of rows) {
    if (row.dataset.rowKind === "user_message") current = [];
    if (row.dataset.rowKind !== "assistant_message") continue;
    current.push(row);
    latest = current;
  }
  return latest;
}

/** Where a caret that came to rest between the rows belongs: the nearest end of their text. */
export function nearestRowText(scroller: HTMLElement, position: TextPosition): TextPosition | null {
  const rows = textRows(scroller);
  const first = rows[0];
  const start = first ? rowStart(first) : null;
  if (start && comparePositions(position, start) <= 0) return start;
  const last = rows.at(-1);
  return last ? rowEnd(last) : null;
}

export function latestReplyStart(scroller: HTMLElement): TextPosition | null {
  const [first] = latestReply(textRows(scroller));
  return first ? rowStart(first) : null;
}

export function latestReplyEnd(scroller: HTMLElement): TextPosition | null {
  const last = latestReply(textRows(scroller)).at(-1);
  return last ? rowEnd(last) : null;
}

/** Virtualized rows carry their index; unrendered ones past the last still fill the container. */
function isAdjacent(above: HTMLElement, below: HTMLElement): boolean {
  const { index } = above.dataset;
  if (index === undefined) return true;
  if (below.dataset.index !== undefined) return Number(below.dataset.index) === Number(index) + 1;
  const containerRect = above.parentElement?.getBoundingClientRect();
  return !containerRect || containerRect.bottom - above.getBoundingClientRect().bottom < 1;
}

function textRowBeside(
  scroller: HTMLElement,
  input: { row: HTMLElement; direction: CaretDirection },
): HTMLElement | "unmounted" | null {
  const { row, direction } = input;
  const rows = Array.from(scroller.querySelectorAll<HTMLElement>(ROW));
  const at = rows.indexOf(row);
  const ahead = direction === "forward" ? rows.slice(at + 1) : rows.slice(0, at).toReversed();
  let previous = row;
  for (const next of ahead) {
    const isMounted =
      direction === "forward" ? isAdjacent(previous, next) : isAdjacent(next, previous);
    if (!isMounted) return "unmounted";
    if (rowStart(next)) return next;
    previous = next;
  }
  return null;
}

export function isRowAheadUnmounted(
  scroller: HTMLElement,
  input: { focus: TextPosition; direction: CaretDirection },
): boolean {
  const row = rowOf(input.focus.node);
  return (
    row !== null && textRowBeside(scroller, { row, direction: input.direction }) === "unmounted"
  );
}

function lineHeightOf(element: Element): number {
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  return Number.isNaN(lineHeight) ? Number.parseFloat(style.fontSize) * 1.2 : lineHeight;
}

function rangeEdge(input: { range: Range; edge: "start" | "end" }): CaretBox | null {
  const { range, edge } = input;
  const rects = range.getClientRects();
  const rect = edge === "start" ? rects[0] : rects[rects.length - 1];
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!rect || !element) return null;
  return { top: rect.top, height: Math.min(rect.height, lineHeightOf(element)) };
}

/**
 * Measures the character beside the position: in Chromium a collapsed range at a block's start
 * reports the previous line's end.
 */
export function caretBox(position: TextPosition): CaretBox | null {
  const { node, offset } = position;
  const range = document.createRange();
  if (node instanceof Text && offset < node.length) {
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const box = rangeEdge({ range, edge: "start" });
    if (box) return box;
  }
  if (node instanceof Text && offset > 0) {
    range.setStart(node, offset - 1);
    range.setEnd(node, offset);
    const box = rangeEdge({ range, edge: "end" });
    if (box) return box;
  }
  range.setStart(node, offset);
  range.collapse(true);
  const collapsed = rangeEdge({ range, edge: "end" });
  if (collapsed) return collapsed;
  const afterNode = node.childNodes[offset];
  if (afterNode) {
    range.selectNode(afterNode);
    return rangeEdge({ range, edge: "start" });
  }
  const beforeNode = node.childNodes[offset - 1];
  if (!beforeNode) return null;
  range.selectNode(beforeNode);
  return rangeEdge({ range, edge: "end" });
}

export function isPendingNote(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement && target.closest(PENDING_CARD) !== null;
}

/**
 * The first pending note between `from` and `to` in the move's direction; `to` null searches to the
 * output's edge.
 */
export function noteBetween(
  scroller: HTMLElement,
  input: { from: TextPosition; to: TextPosition | null; direction: CaretDirection },
): HTMLTextAreaElement | null {
  const { from, to, direction } = input;
  const notes = Array.from(
    scroller.querySelectorAll<HTMLTextAreaElement>(`${PENDING_CARD} textarea`),
  );
  const isForward = direction === "forward";
  const isBetween = (note: HTMLTextAreaElement) => {
    const at = besideNote(note, "backward");
    const fromOrder = comparePositions(at, from);
    const isPastFrom = isForward ? fromOrder > 0 : fromOrder < 0;
    const isShortOfTo =
      to === null || (isForward ? comparePositions(at, to) < 0 : comparePositions(at, to) > 0);
    return isPastFrom && isShortOfTo;
  };
  return (isForward ? notes.find(isBetween) : notes.findLast(isBetween)) ?? null;
}

export function textBesideNote(
  scroller: HTMLElement,
  input: { note: HTMLTextAreaElement; direction: CaretDirection },
): TextPosition | null {
  const at = besideNote(input.note, "backward");
  const texts = contentTexts(scroller);
  if (input.direction === "backward") {
    const text = texts.findLast((node) => comparePositions({ node, offset: node.length }, at) < 0);
    return text ? { node: text, offset: text.length } : null;
  }
  const text = texts.find((node) => comparePositions({ node, offset: 0 }, at) > 0);
  return text ? { node: text, offset: 0 } : null;
}

export function enterNote(note: HTMLTextAreaElement, direction: CaretDirection): void {
  const at = direction === "forward" ? 0 : note.value.length;
  note.focus();
  note.setSelectionRange(at, at);
}

export function besideNote(note: HTMLTextAreaElement, direction: CaretDirection): TextPosition {
  const range = document.createRange();
  if (direction === "backward") range.setStartBefore(note);
  else range.setStartAfter(note);
  return { node: range.startContainer, offset: range.startOffset };
}

/** The top of the line the note's caret would stand on at `offset`, on a copy of its text box. */
function noteLineTop(note: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(note);
  const copy = document.createElement("div");
  for (const name of NOTE_TEXT_STYLES) copy.style[name] = style[name];
  copy.style.position = "absolute";
  copy.style.visibility = "hidden";
  copy.style.boxSizing = "border-box";
  copy.style.width = `${note.clientWidth}px`;
  const marker = document.createElement("span");
  // The caret stands on the line of the character after it, a line of its own past a trailing break.
  marker.textContent = note.value.slice(offset, offset + 1) || "\u200b";
  copy.append(note.value.slice(0, offset), marker, note.value.slice(offset + 1));
  document.body.append(copy);
  const top = marker.offsetTop;
  copy.remove();
  return top;
}

/** Whether the note's caret is on its first line, or its last, as the note wraps its text. */
export function isOnNoteEdgeLine(note: HTMLTextAreaElement, direction: CaretDirection): boolean {
  const edge = direction === "backward" ? 0 : note.value.length;
  return noteLineTop(note, note.selectionStart) === noteLineTop(note, edge);
}

export function hasSentComments(row: HTMLElement): boolean {
  return row.dataset.rowKind === "user_message" && row.querySelector(SENT_COMMENTS_TOGGLE) !== null;
}

export function sentCommentsEdge(row: HTMLElement, direction: CaretDirection): TextPosition | null {
  const comments = row.querySelector<HTMLElement>(SENT_COMMENTS);
  if (!comments) return null;
  return direction === "forward" ? rowStart(comments) : rowEnd(comments);
}
