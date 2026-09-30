import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CHAT_SCROLL_SELECTOR } from "@/assistant-selection-copy/content.web";
import { AUTOCOMPLETE_POPOVER_SELECTOR } from "@/components/ui/autocomplete-popover";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useAppSettings } from "@/hooks/use-settings";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { useOutputCommentsComposer } from "@/output-comments/composer-context";
import { ROW, rowOf } from "@/output-comments/selection.web";
import { useExpandedSentCommentsStore } from "@/output-comments/store";
import { CONTROL, SURFACE_LAYER, surfaceRootOf } from "@/output-comments/surface.web";
import { usePaneFocus } from "@/panels/pane-context";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import {
  HOST_CSS,
  besideNote,
  caretBox,
  comparePositions,
  enterNote,
  focusOf,
  hasSentComments,
  isOnNoteEdgeLine,
  isOutputPosition,
  isPendingNote,
  isRowAheadUnmounted,
  latestReplyEnd,
  latestReplyStart,
  nearestRowText,
  noteBetween,
  placeFocus,
  sentCommentsEdge,
  textBesideNote,
  type CaretBox,
  type CaretDirection,
  type TextPosition,
} from "./caret.web";
import { OutputCaretRowContext } from "./context";
import { OUTPUT_CARET_HOST_ATTRIBUTE, isEditingSurface } from "./host";
import type { OutputCaretLayerProps } from "./types";

interface CaretMargin {
  linesAbove: number;
  linesBelow: number;
}

interface AttachInput {
  layer: HTMLElement;
  scroller: HTMLElement;
  host: HTMLElement;
  stopFollowingOutput: () => void;
  scrollToBottom: () => void;
  margin: CaretMargin;
  onRow: (rowId: string | null) => void;
}

interface AttachedCaret {
  enterFromFocusShortcut: () => boolean;
  hideCaret: () => boolean;
  detach: () => void;
}

interface Move {
  direction: CaretDirection;
  extend: boolean;
}

interface LineMove {
  move: Move;
  before: TextPosition;
  from: CaretBox;
}

interface SelectionPoints {
  anchor: TextPosition;
  focus: TextPosition;
}

const COMPOSER_INPUT = '[data-testid="message-input-root"] textarea';
const COMPOSER_TRACKS = '[data-testid="composer-track-bar"]';
const ROWS_TIMEOUT_MS = 3000;
const EXPAND_TIMEOUT_MS = 1000;
// Ahead of the composer's handlers, at 200 while it has focus: Escape hides the caret before it
// interrupts.
const SHORTCUT_PRIORITY = 300;
const MAX_SAME_LINE_STEPS = 8;
// As a browser pages: most of a screen, keeping a strip of the last one in view.
const PAGE_FRACTION = 0.875;
const CARET_KEY = /^(Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down))$/;
const BACKWARD_KEY = /^(ArrowUp|ArrowLeft|Home|PageUp)$/;
const COARSE_POINTER = "(pointer: coarse)";

/**
 * Editable so the browser draws and moves the caret; nothing else of a field: no spellcheck,
 * Grammarly, tab stop or on-screen keyboard. `document` keeps screen readers reading it as output.
 */
const HOST_ATTRIBUTES: Record<string, string> = {
  contenteditable: "true",
  [OUTPUT_CARET_HOST_ATTRIBUTE]: "",
  role: "document",
  tabindex: "-1",
  inputmode: "none",
  spellcheck: "false",
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
};

function hasModifier(event: KeyboardEvent): boolean {
  return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

function isLineKey(event: KeyboardEvent): boolean {
  return event.key === "ArrowUp" || event.key === "ArrowDown";
}

/** The nearest match in this pane, short of an ancestor that holds another chat too. */
function nearestInPane<T extends Element>(layer: HTMLElement, selector: string): T | null {
  for (let element = layer.parentElement; element; element = element.parentElement) {
    if (element.querySelectorAll(CHAT_SCROLL_SELECTOR).length > 1) return null;
    const match = element.querySelector<T>(selector);
    if (match) return match;
  }
  return null;
}

/**
 * Where the browser draws and steps the caret as this needs: Firefox has no `-webkit-user-modify`,
 * which keeps it off what isn't text, and Safari before 17.4 no `checkVisibility`.
 */
const IS_CARET_SUPPORTED =
  CSS.supports("-webkit-user-modify", "read-only") && "checkVisibility" in Element.prototype;

/** A touch screen would open its keyboard on the editable output. */
function hasCoarsePointer(): boolean {
  return window.matchMedia(COARSE_POINTER).matches;
}

function subscribeToPointer(onChange: () => void): () => void {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether this device and browser can have the keyboard caret. */
export function useIsOutputCaretAvailable(): boolean {
  const isCompact = useIsCompactFormFactor();
  const isCoarse = useSyncExternalStore(subscribeToPointer, hasCoarsePointer);
  return !isCompact && !isCoarse && IS_CARET_SUPPORTED;
}

function attachCaret({
  layer,
  scroller,
  host,
  stopFollowingOutput,
  scrollToBottom,
  margin,
  onRow,
}: AttachInput): AttachedCaret {
  const ownAttributes = Object.keys(HOST_ATTRIBUTES).map((name) => ({
    name,
    value: host.getAttribute(name),
  }));
  for (const [name, value] of Object.entries(HOST_ATTRIBUTES)) host.setAttribute(name, value);
  let isAttached = true;
  let frame = 0;
  let pollFrame = 0;
  let restoreFrame = 0;
  let lastSelection: SelectionPoints | null = null;
  let blurredScrollTop: number | null = null;
  let isFocusingHost = false;
  let rowId: string | null = null;
  let autoExpandedRowId: string | null = null;
  let lastMove: Move | null = null;
  let isLeavingNote = false;
  let revealMargin = { top: 0, bottom: 0 };

  function currentFocus(): TextPosition | null {
    const selection = window.getSelection();
    return selection ? focusOf(selection) : null;
  }

  /**
   * The lines kept above and below the caret. Margins that leave no room for the caret's line
   * shrink in proportion. Not CSS scroll padding, which moves where the list anchors its scroll.
   */
  function measureRevealMargin(): void {
    const start = latestReplyStart(scroller);
    const lineHeight = start ? (caretBox(start)?.height ?? 0) : 0;
    if (lineHeight === 0) return;
    const tracks = nearestInPane(layer, COMPOSER_TRACKS)?.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const covered = tracks && tracks.height > 0 ? Math.max(0, view.bottom - tracks.top) : 0;
    const room = Math.max(0, scroller.clientHeight - covered - lineHeight);
    const lines = margin.linesAbove + margin.linesBelow;
    const line = lines * lineHeight > room ? room / lines : lineHeight;
    revealMargin = { top: margin.linesAbove * line, bottom: margin.linesBelow * line + covered };
  }

  function reveal(): void {
    const focus = currentFocus();
    const box = focus ? caretBox(focus) : null;
    if (!box) return;
    const view = scroller.getBoundingClientRect();
    const top = view.top + revealMargin.top;
    const bottom = view.bottom - revealMargin.bottom;
    const delta = box.top < top ? box.top - top : Math.max(0, box.top + box.height - bottom);
    if (delta < 0) stopFollowingOutput();
    if (delta !== 0) scroller.scrollBy({ top: delta });
  }

  function focusHost(): void {
    isFocusingHost = true;
    host.focus({ preventScroll: true });
    isFocusingHost = false;
  }

  function jumpTo(position: TextPosition, input: { extend?: boolean } = {}): void {
    focusHost();
    placeFocus({ position, extend: input.extend });
    reveal();
  }

  function pollUntil(input: { timeoutMs: number; isReady: () => boolean; onReady: () => void }) {
    cancelAnimationFrame(pollFrame);
    const deadline = performance.now() + input.timeoutMs;
    const poll = () => {
      pollFrame = 0;
      if (input.isReady()) input.onReady();
      else if (performance.now() < deadline) pollFrame = requestAnimationFrame(poll);
    };
    pollFrame = requestAnimationFrame(poll);
  }

  function modifyLine(move: Move): void {
    window.getSelection()?.modify(move.extend ? "extend" : "move", move.direction, "line");
  }

  /** Makes a line move the browser couldn't yet, once `isReady`. */
  function retryLineMove(move: Move, isReady: () => boolean): void {
    pollUntil({
      timeoutMs: ROWS_TIMEOUT_MS,
      isReady,
      onReady: () => {
        modifyLine(move);
        reveal();
      },
    });
  }

  function foldSentComments(): void {
    const expanded = useExpandedSentCommentsStore.getState();
    if (autoExpandedRowId && expanded.itemIds.has(autoExpandedRowId)) {
      expanded.toggle(autoExpandedRowId);
    }
    autoExpandedRowId = null;
  }

  function openSentComments(row: HTMLElement, move: Move): void {
    const id = row.dataset.historyRowId;
    const expanded = useExpandedSentCommentsStore.getState();
    if (!id || !hasSentComments(row) || expanded.itemIds.has(id)) return;
    expanded.toggle(id);
    autoExpandedRowId = id;
    pollUntil({
      timeoutMs: EXPAND_TIMEOUT_MS,
      isReady: () => sentCommentsEdge(row, move.direction) !== null,
      onReady: () => {
        const edge = sentCommentsEdge(row, move.direction);
        if (edge) jumpTo(edge, { extend: move.extend });
      },
    });
  }

  /**
   * A caret that came to rest between the rows, such as at the output's very start, goes to the
   * nearest text. A mouse selection that ends there stays as the mouse left it, and so does a
   * focused field's: the page reports a text field's caret as the field's place among its
   * parent's children, which snapping would move out of the field, taking its focus.
   */
  function snapIntoRows(focus: TextPosition, move: Move | null): boolean {
    const isCaretMove = move !== null || window.getSelection()?.isCollapsed === true;
    if (isInRow(focus) || !isCaretMove || isEditingSurface(document.activeElement)) return false;
    const snapped = nearestRowText(scroller, focus);
    if (snapped) placeFocus({ position: snapped, extend: move?.extend });
    return true;
  }

  function saveSelection(): void {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return;
    lastSelection = {
      anchor: { node: selection.anchorNode, offset: selection.anchorOffset },
      focus: { node: selection.focusNode, offset: selection.focusOffset },
    };
  }

  // Once a frame: a held key fires selectionchange faster than the chat can lay out.
  function onSelectionFrame(): void {
    frame = 0;
    const move = lastMove;
    lastMove = null;
    const focus = currentFocus();
    const isInOutput = focus !== null && isOutputPosition(scroller, focus.node);
    if (focus && isInOutput && snapIntoRows(focus, move)) return;
    if (isInOutput) saveSelection();
    // The browser only scrolls the caret into view; the lines around it are kept here.
    if (move && isInOutput) reveal();
    const row = focus && isInOutput ? rowOf(focus.node) : null;
    const nextRowId = row?.dataset.historyRowId ?? null;
    if (nextRowId === rowId) return;
    rowId = nextRowId;
    onRow(rowId);
    if (autoExpandedRowId !== null && autoExpandedRowId !== rowId) foldSentComments();
    if (row && move) openSentComments(row, move);
  }

  /** False in a pane without a composer. */
  function focusComposerEnd(): boolean {
    const composer = nearestInPane<HTMLTextAreaElement>(layer, COMPOSER_INPUT);
    if (!composer) return false;
    composer.focus();
    composer.setSelectionRange(composer.value.length, composer.value.length);
    return true;
  }

  function focusComposer(): void {
    if (focusComposerEnd()) scrollToBottom();
  }

  function mountedRows(): string {
    const rows = scroller.querySelectorAll<HTMLElement>(ROW);
    return Array.from(rows, (row) => row.dataset.historyRowId).join();
  }

  /** The browser's caret can't reach rows the list hasn't rendered: scroll so it renders them. */
  function scrollForRows(move: Move): void {
    const rows = mountedRows();
    const half = scroller.clientHeight / 2;
    scroller.scrollBy({ top: move.direction === "backward" ? -half : half });
    retryLineMove(move, () => mountedRows() !== rows);
  }

  function isInRow(position: TextPosition): boolean {
    return rowOf(position.node) !== null;
  }

  function lineTop(box: { top: number }): number {
    return box.top + scroller.scrollTop;
  }

  /**
   * Up and down stop on each cell of a table row as if it were a line of its own: from a stop still
   * on the line the move started on, the move carries on.
   */
  function carryPastInlineBoxes(input: {
    move: Move;
    before: TextPosition;
    isOnFromLine: (box: CaretBox | null) => boolean;
  }): TextPosition | null {
    const { move, before, isOnFromLine } = input;
    let after = currentFocus();
    for (let step = 0; step < MAX_SAME_LINE_STEPS && after; step += 1) {
      const isStopOnLine =
        comparePositions(after, before) !== 0 && isInRow(after) && isOnFromLine(caretBox(after));
      if (!isStopOnLine) break;
      const previous = after;
      modifyLine(move);
      after = currentFocus();
      if (after && comparePositions(after, previous) === 0) break;
    }
    return after;
  }

  /**
   * After the browser has moved the caret a line: a note the move stepped over takes it, and a
   * move that stayed on its line hit the rendered rows' edge.
   */
  function afterLineMove({ move, before, from }: LineMove): void {
    const fromTop = lineTop(from);
    const isOnFromLine = (box: CaretBox | null) =>
      box !== null && Math.abs(lineTop(box) - fromTop) < from.height / 2;
    const after = carryPastInlineBoxes({ move, before, isOnFromLine });
    const to = after && isInRow(after) ? caretBox(after) : null;
    const isStuck = !to || isOnFromLine(to);
    const note = move.extend
      ? null
      : noteBetween(scroller, {
          from: before,
          to: isStuck ? null : after,
          direction: move.direction,
        });
    if (note) enterNote(note, move.direction);
    else if (!isStuck) return;
    else if (
      move.direction === "backward" ||
      isRowAheadUnmounted(scroller, { focus: before, direction: move.direction })
    ) {
      scrollForRows(move);
    } else if (!move.extend) {
      focusComposer();
    }
  }

  /**
   * A caret scrolled out of view may sit in a row kept mounted far from the rendered rows, which the
   * browser would jump straight to: the chat goes back to the caret first.
   */
  function moveFromOutOfView(move: Move, focus: TextPosition): void {
    reveal();
    retryLineMove(move, () => !isRowAheadUnmounted(scroller, { focus, direction: move.direction }));
  }

  function onLineKey(event: KeyboardEvent, move: Move): void {
    const focus = currentFocus();
    const box = focus ? caretBox(focus) : null;
    if (!focus || !box) return;
    const view = scroller.getBoundingClientRect();
    if (box.top >= view.top && box.top + box.height <= view.bottom) {
      setTimeout(() => {
        if (isAttached) afterLineMove({ move, before: focus, from: box });
      }, 0);
      return;
    }
    event.preventDefault();
    moveFromOutOfView(move, focus);
  }

  function enterFromComposer(event: KeyboardEvent): boolean {
    const { target } = event;
    if (event.key !== "ArrowUp" || hasModifier(event) || !(target instanceof HTMLTextAreaElement)) {
      return false;
    }
    const isAtDraftTop = target.selectionStart === 0 && target.selectionEnd === 0;
    if (!isAtDraftTop || target !== nearestInPane(layer, COMPOSER_INPUT)) return false;
    if (document.querySelector(AUTOCOMPLETE_POPOVER_SELECTOR)) return false;
    const position = latestReplyEnd(scroller);
    if (!position) return false;
    event.preventDefault();
    stopFollowingOutput();
    jumpTo(position);
    return true;
  }

  /**
   * The focus-composer shortcut, pressed in the composer, puts the caret at the start of the
   * latest reply. Anywhere else it is left to focus the composer.
   */
  function enterFromFocusShortcut(): boolean {
    const composer = nearestInPane<HTMLTextAreaElement>(layer, COMPOSER_INPUT);
    if (!composer || document.activeElement !== composer) return false;
    const start = latestReplyStart(scroller);
    // With no reply yet, the key does nothing and the composer keeps focus.
    if (start) jumpTo(start);
    return true;
  }

  /**
   * With the page, the pane, or a control in the chat focused, a caret key takes the caret: from
   * the selection in the output, which the browser then moves with the key, or at the latest reply.
   */
  function enterFromChat(event: KeyboardEvent): boolean {
    const active = document.activeElement;
    if (!CARET_KEY.test(event.key) || active === host || isEditingSurface(active)) return false;
    const isChatFocus =
      !active || active === document.body || active.contains(scroller) || host.contains(active);
    if (!isChatFocus) return false;
    const focus = currentFocus();
    if (focus && isOutputPosition(scroller, focus.node)) {
      focusHost();
      return false;
    }
    const start = latestReplyStart(scroller);
    if (!start) return false;
    event.preventDefault();
    jumpTo(start);
    return true;
  }

  /** Up or down on a note's first or last line carries the caret out of the note. */
  function leaveNoteByLine(event: KeyboardEvent): boolean {
    const note = event.target;
    if (!isLineKey(event) || hasModifier(event) || !isPendingNote(note)) return false;
    if (note.selectionStart !== note.selectionEnd || !scroller.contains(note)) return false;
    if (document.querySelector(AUTOCOMPLETE_POPOVER_SELECTOR)) return false;
    const direction = event.key === "ArrowUp" ? "backward" : "forward";
    if (!isOnNoteEdgeLine(note, direction)) return false;
    event.preventDefault();
    leaveNote(note, direction);
    return true;
  }

  function hideCaret(): boolean {
    if (document.activeElement !== host) return false;
    window.getSelection()?.removeAllRanges();
    host.blur();
    return true;
  }

  function pageBy(pages: number): void {
    scroller.scrollBy({ top: pages * scroller.clientHeight * PAGE_FRACTION });
  }

  /** Escape hides the caret, Tab leaves the output and Space pages it, as in the chat without it. */
  function onNonCaretKey(event: KeyboardEvent): boolean {
    if (event.key === "Escape") {
      event.preventDefault();
      hideCaret();
      return true;
    }
    // Blurred with the selection kept, the browser's next stop is the one after the caret.
    if (event.key === "Tab") {
      host.blur();
      return true;
    }
    const isSpace = event.key === " " && !event.altKey && !event.ctrlKey && !event.metaKey;
    if (!isSpace) return false;
    event.preventDefault();
    pageBy(event.shiftKey ? -1 : 1);
    return true;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || hasActiveWebOverlay() || isImeComposingKeyboardEvent(event)) {
      return;
    }
    if (leaveNoteByLine(event) || enterFromComposer(event) || enterFromChat(event)) return;
    if (document.activeElement !== host || onNonCaretKey(event) || !CARET_KEY.test(event.key)) {
      return;
    }
    const move: Move = {
      direction: BACKWARD_KEY.test(event.key) ? "backward" : "forward",
      extend: event.shiftKey,
    };
    lastMove = move;
    if (move.direction === "backward") stopFollowingOutput();
    if (isLineKey(event) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      onLineKey(event, move);
    }
  };

  const onSelectionChange = () => {
    if (frame === 0) frame = requestAnimationFrame(onSelectionFrame);
  };

  // Nothing typed, pasted, dropped, cut or undone changes the output. The paste that comments on a
  // selection ran on the paste event, before this.
  const onBeforeInput = (event: InputEvent) => {
    if (!isEditingSurface(event.target)) event.preventDefault();
  };

  // The page keeps one undo history, so an undo in the output would undo the composer's typing.
  const onHistoryInput = (event: InputEvent) => {
    if (document.activeElement === host && event.inputType.startsWith("history")) {
      event.preventDefault();
    }
  };

  // A cut only copies, through the chat's Markdown copy handler.
  const onCut = (event: ClipboardEvent) => {
    if (isEditingSurface(event.target)) return;
    event.preventDefault();
    document.execCommand("copy");
  };

  // In editable text a press on a control would move the caret beside it; the press still clicks.
  const onMouseDown = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(CONTROL)) event.preventDefault();
  };

  /**
   * Whether the caret is at the output's very start, where focusing it from script puts it. A press
   * focuses it before placing the caret, and a selection placed in it focuses it keeping its place.
   */
  function isCaretAtStart(): boolean {
    const selection = window.getSelection();
    const node = selection?.focusNode;
    if (!selection?.isCollapsed || !node || !host.contains(node)) return false;
    const before = document.createRange();
    before.setStart(host, 0);
    before.setEnd(node, selection.focusOffset);
    return before.toString() === "";
  }

  // Script focusing the output from elsewhere in the page, as a closing dialog does, puts the caret
  // at its start and scrolls there before the focus event. The caret and the scroll go back to where
  // they were when it left.
  const onHostFocus = () => {
    // The composer's track bar grows and shrinks without resizing the chat.
    measureRevealMargin();
    const scrollTop = blurredScrollTop;
    blurredScrollTop = null;
    if (scrollTop === null || isFocusingHost || !isCaretAtStart()) return;
    const selection = lastSelection;
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0;
      const isInHost =
        selection !== null &&
        host.contains(selection.anchor.node) &&
        host.contains(selection.focus.node);
      if (isInHost) {
        const { anchor, focus } = selection;
        window
          .getSelection()
          ?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      }
      scroller.scrollTop = scrollTop;
    });
  };

  // The window losing focus leaves the caret and the scroll as they are when it comes back. A dialog
  // closing can blur and refocus the output before the restore: that blur saw the jump, not the place.
  const onHostBlur = () => {
    if (restoreFrame !== 0) return;
    blurredScrollTop = document.hasFocus() ? scroller.scrollTop : null;
  };

  // Composition text can't be cancelled: it goes after the composer's draft before it lands here.
  const onCompositionStart = (event: CompositionEvent) => {
    if (event.target === host && !focusComposerEnd()) host.blur();
  };

  // Escape, or a click away, leaves a note: the caret comes back to just before it.
  const onFocusOut = (event: FocusEvent) => {
    const note = event.target;
    if (isLeavingNote || !isPendingNote(note) || !scroller.contains(note)) return;
    if (event.relatedTarget !== null || !document.hasFocus()) return;
    const before = textBesideNote(scroller, { note, direction: "backward" });
    focusHost();
    placeFocus({ position: before ?? besideNote(note, "backward") });
  };

  // Worked out before the blur, which deletes an empty note's card.
  function leaveNote(note: HTMLTextAreaElement, direction: CaretDirection): void {
    const beside = textBesideNote(scroller, { note, direction });
    const from = besideNote(note, direction);
    const nextNote = noteBetween(scroller, { from, to: beside, direction });
    isLeavingNote = true;
    note.blur();
    isLeavingNote = false;
    if (nextNote) enterNote(nextNote, direction);
    else if (beside) jumpTo(beside);
    else if (direction === "forward") focusComposer();
  }

  const resizeObserver = new ResizeObserver(measureRevealMargin);
  resizeObserver.observe(scroller);
  measureRevealMargin();
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("beforeinput", onHistoryInput, true);
  host.addEventListener("focus", onHostFocus);
  host.addEventListener("blur", onHostBlur);
  host.addEventListener("beforeinput", onBeforeInput);
  host.addEventListener("cut", onCut);
  host.addEventListener("mousedown", onMouseDown);
  host.addEventListener("compositionstart", onCompositionStart);

  return {
    enterFromFocusShortcut,
    hideCaret,
    detach: () => {
      isAttached = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pollFrame);
      cancelAnimationFrame(restoreFrame);
      resizeObserver.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("beforeinput", onHistoryInput, true);
      host.removeEventListener("focus", onHostFocus);
      host.removeEventListener("blur", onHostBlur);
      host.removeEventListener("beforeinput", onBeforeInput);
      host.removeEventListener("cut", onCut);
      host.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("compositionstart", onCompositionStart);
      for (const { name, value } of ownAttributes) {
        if (value === null) host.removeAttribute(name);
        else host.setAttribute(name, value);
      }
      onRow(null);
    },
  };
}

export function OutputCaretLayer({ viewportRef, children }: OutputCaretLayerProps) {
  const isPanelActive = useRetainedPanelActive();
  const { isInteractive } = usePaneFocus();
  const { settings } = useAppSettings();
  const isAvailable = useIsOutputCaretAvailable();
  // Without a composer, IME text would land in the output: nothing in it is a field to take it.
  const hasComposer = useOutputCommentsComposer() !== null;
  const linesAbove = settings.outputCaretLinesAbove;
  const linesBelow = settings.outputCaretLinesBelow;
  const isEnabled =
    settings.outputCaretEnabled && isAvailable && hasComposer && isPanelActive && isInteractive;
  const handlerId = `output-caret-${useId()}`;
  const layerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<AttachedCaret | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const scroller = layer
      ? surfaceRootOf(layer)?.querySelector<HTMLElement>(CHAT_SCROLL_SELECTOR)
      : null;
    const host = scroller?.firstElementChild;
    if (!isEnabled || !layer || !scroller || !(host instanceof HTMLElement)) return;
    const attached = attachCaret({
      layer,
      scroller,
      host,
      stopFollowingOutput: () => viewportRef.current?.stopFollowingOutput?.(),
      scrollToBottom: () => viewportRef.current?.scrollToBottom("jump-to-bottom"),
      margin: { linesAbove, linesBelow },
      onRow: setRowId,
    });
    attachedRef.current = attached;
    return () => {
      attachedRef.current = null;
      attached.detach();
    };
  }, [isEnabled, linesAbove, linesBelow, viewportRef]);

  useKeyboardActionHandler({
    handlerId,
    actions: ["message-input.focus", "agent.interrupt"],
    enabled: isEnabled,
    priority: SHORTCUT_PRIORITY,
    handle: (action) => {
      const attached = attachedRef.current;
      if (!attached) return false;
      if (action.id === "agent.interrupt") return attached.hideCaret();
      return attached.enterFromFocusShortcut();
    },
  });

  return (
    <OutputCaretRowContext.Provider value={rowId}>
      {children}
      <div ref={layerRef} style={SURFACE_LAYER}>
        {isEnabled ? <style>{HOST_CSS}</style> : null}
      </div>
    </OutputCaretRowContext.Provider>
  );
}
