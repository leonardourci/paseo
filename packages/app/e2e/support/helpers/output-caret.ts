import { expect, type Page } from "@playwright/test";
import { APP_SETTINGS_KEY } from "@/hooks/use-settings/keys";
import { openSettings } from "./app";
import { composerLocator } from "./composer";
import {
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "./mock-agent";
import { assistantMessageText, leaveFocusedField } from "./output-comments";
import { clickSettingsBackToWorkspace } from "./settings";

/** Where the page's selection focus is: the text it sits in, how far in, and the row kind. */
interface CaretSpot {
  text: string;
  offset: number;
  rowKind: string | null;
}

interface CaretPlace {
  rowId: string;
  /** Characters from the start of the row, which a re-render of the row keeps. */
  rowOffset: number;
  /** Which of the row's text nodes it is in, telling apart the two sides of a block's edge. */
  textIndex: number;
}

interface Edges {
  top: number;
  bottom: number;
}

interface CaretBox extends Edges {
  left: number;
}

export interface ChatRead {
  spot: CaretSpot | null;
  place: CaretPlace | null;
  /** Inside something that isn't the output's content: a list marker, a timestamp, a button. */
  notContent: string | null;
  /** Where the focus went from `from`: 1 after it, -1 before, 0 same, null when `from`'s row is gone. */
  order: number | null;
  /** The browser's caret while the output has it, in the page's viewport. */
  caret: CaretBox | null;
  /** Where the chat stops being visible: its own edges, or above the composer's tracks. */
  view: Edges;
  scrollTop: number;
  maxScrollTop: number;
  lastRowBottom: number | null;
  hasScrollToBottomButton: boolean;
  isComposerFocused: boolean;
}

export interface CaretStep extends ChatRead {
  isCaretInView: boolean;
}

interface CaretLines {
  above: number;
  below: number;
}

const IS_MAC_HOST = process.platform === "darwin";
/** Text fields edit with the host browser's keys, whatever platform the app believes it is on. */
export const FIELD_START_KEY = IS_MAC_HOST ? "Meta+ArrowUp" : "Control+Home";
export const FIELD_END_KEY = IS_MAC_HOST ? "Meta+ArrowDown" : "Control+End";
/** On a Mac, Home and End scroll a text field rather than move its caret. */
export const LINE_START_KEY = IS_MAC_HOST ? "Meta+ArrowLeft" : "Home";
export const LINE_END_KEY = IS_MAC_HOST ? "Meta+ArrowRight" : "End";
export const WORD_DELETE_KEY = IS_MAC_HOST ? "Alt+Backspace" : "Control+Backspace";

/** The output has the browser's caret: it has focus and a collapsed selection in it. */
export async function expectCaret(page: Page, isShown: boolean): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.activeElement;
        const selection = window.getSelection();
        return (
          host?.hasAttribute("data-output-caret-host") === true &&
          selection?.isCollapsed === true &&
          selection.focusNode !== null &&
          host.contains(selection.focusNode)
        );
      }),
    )
    .toBe(isShown);
}

/** An agent for a caret test; it answers once `initialPrompt` is given. */
export function seedCaretAgent(
  options: Pick<MockAgentOptions, "repoPrefix" | "initialPrompt" | "featureValues">,
): Promise<MockAgentWorkspace> {
  return seedMockAgentWorkspace({ title: "Output caret", ...options });
}

/** Turns the caret on before every load, keeping whatever else the app has saved since. */
export async function turnOnOutputCaretSetting(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...saved, outputCaretEnabled: true }));
  }, APP_SETTINGS_KEY);
}

/** Sets how many lines the caret keeps on each side through Settings, and goes back to the chat. */
export async function setOutputCaretLines(
  page: Page,
  lines: { above?: number; below?: number },
): Promise<void> {
  await openSettings(page);
  const inputs = [
    { name: "Lines kept above the caret", value: lines.above },
    { name: "Lines kept below the caret", value: lines.below },
  ];
  for (const { name, value } of inputs) {
    if (value === undefined) continue;
    const input = page.getByRole("textbox", { name });
    await input.fill(String(value));
    await input.press("Enter");
    await expect(input).toHaveValue(String(value));
  }
  await clickSettingsBackToWorkspace(page);
  await expect(assistantMessageText(page).first()).toBeVisible({ timeout: 30_000 });
}

/** Places the caret the way a user starts it without the mouse: an arrow with no field focused. */
export async function startCaretFromKeyboard(page: Page): Promise<void> {
  await leaveFocusedField(page);
  await page.keyboard.press("ArrowDown");
  await expectCaret(page, true);
}

/** Resolves once the page has drawn two more frames, so what the last input changed is on screen. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/** Reads the chat after two frames, so a move made on the last key has been drawn. */
export async function readChat(page: Page, from: CaretPlace | null = null): Promise<ChatRead> {
  await nextFrames(page);
  return page.evaluate((previous) => {
    const NOT_CONTENT =
      '[data-paseo-markdown-list-marker], [data-testid="user-message-timestamp"], button, [role="button"]';

    function placeIn(row: HTMLElement | null, node: Node, offset: number) {
      const rowId = row?.dataset.historyRowId;
      if (!row || !rowId) return null;
      const range = document.createRange();
      range.selectNodeContents(row);
      range.setEnd(node, offset);
      const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let textIndex = 0;
      while (texts.nextNode() && texts.currentNode !== node) textIndex += 1;
      return { rowId, rowOffset: range.toString().length, textIndex };
    }

    function orderFrom(place: CaretPlace, row: HTMLElement): number | null {
      if (!previous) return null;
      if (previous.rowId === place.rowId) {
        const byOffset = Math.sign(place.rowOffset - previous.rowOffset);
        return byOffset === 0 ? Math.sign(place.textIndex - previous.textIndex) : byOffset;
      }
      const previousRow = document.querySelector(
        `[data-history-row-id="${CSS.escape(previous.rowId)}"]`,
      );
      if (!previousRow) return null;
      const isAfter = previousRow.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
      return isAfter ? 1 : -1;
    }

    function readFocus() {
      const selection = window.getSelection();
      const node = selection?.focusNode;
      if (!selection || !node) return { spot: null, place: null, notContent: null, order: null };
      const element = node instanceof Element ? node : node.parentElement;
      const row = element?.closest<HTMLElement>("[data-history-row-id]") ?? null;
      const place = placeIn(row, node, selection.focusOffset);
      return {
        spot: {
          text: node.textContent ?? "",
          offset: selection.focusOffset,
          rowKind: row?.dataset.rowKind ?? null,
        },
        place,
        notContent: element?.closest(NOT_CONTENT)?.outerHTML.slice(0, 80) ?? null,
        order: place && row ? orderFrom(place, row) : null,
      };
    }

    /** The character's box on either side of `offset`, and whether the caret is at its end. */
    function characterBeside(node: Node, offset: number) {
      if (!(node instanceof Text)) return null;
      const range = document.createRange();
      const after = offset < node.length ? offset : offset - 1;
      if (after < 0) return null;
      range.setStart(node, after);
      range.setEnd(node, after + 1);
      const rects = Array.from(range.getClientRects());
      const isAtEnd = after < offset;
      const rect = isAtEnd ? rects.at(-1) : rects[0];
      return rect ? { rect, isAtEnd } : null;
    }

    /** Beside the character at the focus, as the browser draws its caret, one line high. */
    function readCaret() {
      const selection = window.getSelection();
      const host = document.activeElement;
      const node = selection?.focusNode;
      if (!selection?.isCollapsed || !node || !host?.hasAttribute("data-output-caret-host")) {
        return null;
      }
      const offset = selection.focusOffset;
      const beside = node.childNodes[offset] ?? node.childNodes[offset - 1];
      const character = characterBeside(node, offset) ?? {
        rect: beside instanceof Element ? beside.getBoundingClientRect() : null,
        isAtEnd: false,
      };
      const { rect, isAtEnd } = character;
      if (!rect) return null;
      const element = node instanceof Element ? node : node.parentElement;
      const lineHeight = element ? Number.parseFloat(getComputedStyle(element).lineHeight) : NaN;
      const height = Math.min(rect.height, Number.isNaN(lineHeight) ? 20 : lineHeight);
      return { left: isAtEnd ? rect.right : rect.left, top: rect.top, height };
    }

    function readView(scroller: HTMLElement) {
      const scrollerBox = scroller.getBoundingClientRect();
      const tracks = document.querySelector('[data-testid="composer-track-bar"]');
      const tracksTop = tracks?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      const caret = readCaret();
      const lastRow = Array.from(scroller.querySelectorAll("[data-history-row-id]")).at(-1);
      const active = document.activeElement;
      return {
        caret:
          caret && caret.height > 0
            ? { left: caret.left, top: caret.top, bottom: caret.top + caret.height }
            : null,
        view: { top: scrollerBox.top, bottom: Math.min(scrollerBox.bottom, tracksTop) },
        scrollTop: scroller.scrollTop,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
        lastRowBottom: lastRow?.getBoundingClientRect().bottom ?? null,
        hasScrollToBottomButton:
          document.querySelector('[data-testid="scroll-to-bottom-button"]') !== null,
        isComposerFocused:
          active instanceof HTMLTextAreaElement &&
          active.closest('[data-testid="message-input-root"]') !== null,
      };
    }

    const focusNode = window.getSelection()?.focusNode;
    const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement;
    const scroller =
      focusElement?.closest<HTMLElement>('[data-testid="agent-chat-scroll"]') ??
      document.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!scroller) throw new Error("No chat on the page");
    return { ...readFocus(), ...readView(scroller) };
  }, from);
}

/** Settled at the very bottom: no button to scroll there, and the last row in view. */
export async function expectChatAtBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const read = await readChat(page);
      return {
        hasScrollToBottomButton: read.hasScrollToBottomButton,
        isAtBottom: read.scrollTop >= read.maxScrollTop - 4,
        isLastRowShown: read.lastRowBottom !== null && read.lastRowBottom <= read.view.bottom + 1,
      };
    })
    .toEqual({ hasScrollToBottomButton: false, isAtBottom: true, isLastRowShown: true });
}

/**
 * Whether the drawn caret has `lines` of its own height between it and each edge of the chat. An
 * edge the chat can't scroll any further toward owes no margin.
 */
function keepsMargin(read: ChatRead, lines: CaretLines): boolean {
  if (!read.caret) return false;
  const { top, bottom } = read.caret;
  const height = bottom - top;
  const isAboveKept = read.scrollTop <= 1 || top - read.view.top >= lines.above * height - 1;
  const isBelowKept =
    read.scrollTop >= read.maxScrollTop - 1 ||
    read.view.bottom - bottom >= lines.below * height - 1;
  return isAboveKept && isBelowKept;
}

/** The reads whose caret lacks the margin, so a failure shows where each was. */
export function lackingMargin<T extends ChatRead>(reads: readonly T[], lines: CaretLines): T[] {
  return reads.filter((read) => !keepsMargin(read, lines));
}

export async function caretSpot(page: Page): Promise<CaretSpot | null> {
  return (await readChat(page)).spot;
}

function isSameRead(left: ChatRead, right: ChatRead): boolean {
  return JSON.stringify([left.place, left.caret]) === JSON.stringify([right.place, right.caret]);
}

/**
 * The caret once a move has settled: two reads agree, it has left `from`, and it is drawn or has
 * handed off to the composer. Opening a sent card or mounting rows finishes after the key.
 */
export async function caretStep(page: Page, from: CaretPlace | null): Promise<CaretStep> {
  let read = await readChat(page, from);
  await expect
    .poll(async () => {
      const next = await readChat(page, from);
      const hasMoved = from === null || JSON.stringify(next.place) !== JSON.stringify(from);
      const isShown = next.caret !== null || next.isComposerFocused;
      const isSettled = isSameRead(read, next) && hasMoved && isShown;
      read = next;
      return isSettled ? "settled" : JSON.stringify(next);
    })
    .toBe("settled");
  const { caret, view } = read;
  const isCaretInView = caret !== null && caret.top >= view.top && caret.bottom <= view.bottom;
  return { ...read, isCaretInView };
}

export async function walkCaret(
  page: Page,
  input: { key: string; isDone: (step: CaretStep) => boolean; maxPresses?: number },
): Promise<CaretStep[]> {
  const steps: CaretStep[] = [];
  const maxPresses = input.maxPresses ?? 400;
  let from = (await caretStep(page, null)).place;
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press(input.key);
    const step = await caretStep(page, from);
    steps.push(step);
    if (input.isDone(step)) return steps;
    from = step.place;
  }
  throw new Error(
    `The caret walk did not end within ${maxPresses} presses; last steps: ${JSON.stringify(steps.slice(-5), null, 2)}`,
  );
}

export function badSteps(
  steps: readonly CaretStep[],
  direction: "forward" | "backward",
): Array<CaretStep & { problem: string }> {
  const expectedOrder = direction === "forward" ? 1 : -1;
  const bad: Array<CaretStep & { problem: string }> = [];
  for (const step of steps) {
    if (step.isComposerFocused) continue;
    if (!step.isCaretInView) bad.push({ ...step, problem: "caret not drawn in view" });
    else if (step.notContent) bad.push({ ...step, problem: "caret outside content" });
    else if (step.spot?.rowKind === "tool_call" || step.spot?.rowKind === "thought") {
      bad.push({ ...step, problem: "caret in a skipped row" });
    } else if (step.order !== expectedOrder) {
      bad.push({ ...step, problem: `caret did not advance (order ${step.order})` });
    }
  }
  return bad;
}

/** Each run of steps with the same value, in order, leaving out the composer. */
export function runsOf(
  steps: readonly CaretStep[],
  pick: (spot: CaretSpot) => string | null,
): Array<string | null> {
  const runs: Array<string | null> = [];
  for (const step of steps) {
    if (step.isComposerFocused || !step.spot) continue;
    const value = pick(step.spot);
    if (runs.at(-1) !== value) runs.push(value);
  }
  return runs;
}

export async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

export async function pressTimes(page: Page, key: string, times: number): Promise<void> {
  for (let press = 0; press < times; press += 1) await page.keyboard.press(key);
}

/** Presses once, waits for the caret to go somewhere, and presses again until it is in `text`. */
export async function pressUntilCaretIn(
  page: Page,
  input: { key: string; text: string; maxPresses?: number },
): Promise<void> {
  const maxPresses = input.maxPresses ?? 100;
  for (let press = 0; press < maxPresses; press += 1) {
    const before = await caretSpot(page);
    if (before?.text.includes(input.text)) return;
    await page.keyboard.press(input.key);
    await expect.poll(() => caretSpot(page), { timeout: 5_000 }).not.toEqual(before);
  }
  throw new Error(`${input.key} did not bring the caret to ${input.text} in ${maxPresses} presses`);
}

export async function composerCursor(page: Page): Promise<number> {
  return composerLocator(page).evaluate((input) => {
    if (!(input instanceof HTMLTextAreaElement)) throw new Error("Expected the composer textarea");
    return input.selectionStart;
  });
}

export async function focusedNoteCursor(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const note = document.activeElement;
    return note instanceof HTMLTextAreaElement && note.dataset.testid === "output-comment-input"
      ? note.selectionStart
      : null;
  });
}

/** Drags the mouse across the first selectable text in the tool call and returns what it selected. */
export async function dragAcrossToolCall(page: Page): Promise<string> {
  const line = await page.evaluate(() => {
    const row = document.querySelector('[data-row-kind="tool_call"]');
    const walker = row ? document.createTreeWalker(row, NodeFilter.SHOW_TEXT) : null;
    for (let node = walker?.nextNode(); node; node = walker?.nextNode()) {
      if (!(node instanceof Text) || node.data.trim().length < 3 || !node.parentElement) continue;
      if (getComputedStyle(node.parentElement).userSelect === "none") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { left: rect.left + 1, right: rect.right - 1, y: rect.top + rect.height / 2 };
    }
    return null;
  });
  if (!line) throw new Error("The tool call has no text to select");
  await page.mouse.move(line.left, line.y);
  await page.mouse.down();
  await page.mouse.move(line.right, line.y, { steps: 5 });
  await page.mouse.up();
  return selectedText(page);
}
