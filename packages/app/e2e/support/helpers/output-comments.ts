import { expect, type Locator, type Page } from "@playwright/test";
import { HIGHLIGHT_ALPHA, type Tint } from "@/output-comments/tint";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "./mock-agent";

export interface CommentHighlight {
  /** The text node the quote sits in, with the quoted part in brackets. */
  text: string;
  tint: Tint | number;
}

interface CommentQuote extends CommentHighlight {
  /** 1-based, in the order the quotes are painted: pending comments, then delivered ones. */
  comment: number;
  inView: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  width: number;
  height: number;
}

interface AssistantTextTarget {
  text: string;
  /** Which case-sensitive occurrence of `text` in the reply. */
  occurrence?: number;
}

interface QuoteInView {
  /** 1-based, in the order the quotes are painted. */
  comment: number;
  inView: boolean;
}

interface ToggleEdges {
  right: number;
  top: number;
}

interface CommentOnInput {
  quote: string;
  note: string;
  occurrence?: number;
}

const TINTS: readonly Tint[] = ["active", "pending", "delivered"];

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator.toString()} has no box`);
  return box;
}

export async function openAnsweredAgent(
  page: Page,
  options: Pick<MockAgentOptions, "repoPrefix"> & { response: string },
): Promise<MockAgentWorkspace> {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: options.repoPrefix,
    title: "Output comments",
    initialPrompt: "Explain the parser.",
    featureValues: { mockAssistantResponse: options.response },
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expect(assistantMessageText(page).first()).toBeVisible({ timeout: 30_000 });
    return agent;
  } catch (error) {
    await agent.cleanup();
    throw error;
  }
}

/** The reply's text, one element per Markdown block. */
export function assistantMessageText(page: Page): Locator {
  return page.getByTestId("assistant-message");
}

export function pendingCards(page: Page): Locator {
  return page.getByTestId("output-comment-pending");
}

export function deliveredCards(page: Page): Locator {
  return page.getByTestId("output-comment-delivered");
}

export function noteInput(card: Locator): Locator {
  return card.getByTestId("output-comment-input");
}

export function textBadges(page: Page): Locator {
  return page.getByTestId("output-comment-text-badge");
}

export function textBadge(page: Page, number: number): Locator {
  return page.getByRole("button", { name: `Comment ${number}`, exact: true });
}

/** In number order, whatever order the badges render in. */
export async function expectBadges(page: Page, numbers: number[]): Promise<void> {
  await expect
    .poll(async () => (await textBadges(page).allTextContents()).map(Number).sort((a, b) => a - b))
    .toEqual(numbers);
}

export function composerPill(page: Page): Locator {
  return page.getByTestId("composer-output-comments-pill");
}

export async function expectComposerPill(page: Page, label: string): Promise<void> {
  await expect(composerPill(page)).toHaveText(`Comments on the output ${label}`, {
    useInnerText: true,
  });
}

export function sentUserMessage(page: Page, text: string): Locator {
  return page.getByTestId("user-message").filter({ hasText: text });
}

export function queuedMessageRow(page: Page, text: string): Locator {
  return page.getByTestId("queued-message").filter({ hasText: text });
}

/** Leaves the composer or a note without a click, which would scroll what it lands on into view. */
export async function leaveFocusedField(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

/**
 * Selects an occurrence of `text` in the reply, counted case-sensitively, and returns the
 * selection's centre.
 */
export async function selectAssistantText(
  page: Page,
  { text, occurrence = 0 }: AssistantTextTarget,
): Promise<Point> {
  return assistantMessageText(page).evaluateAll(
    (blocks, target) => {
      const texts: Text[] = [];
      for (const block of blocks) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node instanceof Text) texts.push(node);
        }
      }
      function find(needle: string, fromText: number, fromOffset: number) {
        for (let index = fromText; index < texts.length; index += 1) {
          const at = texts[index].data.indexOf(needle, index === fromText ? fromOffset : 0);
          if (at !== -1) return { index, at };
        }
        return null;
      }
      let start = find(target.text, 0, 0);
      for (let seen = 0; start && seen < target.occurrence; seen += 1) {
        start = find(target.text, start.index, start.at + 1);
      }
      if (!start) {
        throw new Error(`Could not find occurrence ${target.occurrence} of "${target.text}"`);
      }
      const range = document.createRange();
      range.setStart(texts[start.index], start.at);
      range.setEnd(texts[start.index], start.at + target.text.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    { text, occurrence },
  );
}

export async function doubleClickAssistantText(page: Page, text: string): Promise<void> {
  const centre = await selectAssistantText(page, { text });
  await page.mouse.dblclick(centre.x, centre.y);
}

function focusedNote(page: Page): Locator {
  return page.locator('[data-testid="output-comment-input"]:focus');
}

/** Types over the quote; the rest of the note follows once its first key has focused the note. */
export async function commentOn(
  page: Page,
  { quote, note, occurrence = 0 }: CommentOnInput,
): Promise<void> {
  await leaveFocusedField(page);
  await selectAssistantText(page, { text: quote, occurrence });
  await page.keyboard.type(note.slice(0, 1));
  await expect(focusedNote(page)).toHaveCount(1);
  await page.keyboard.type(note.slice(1));
}

/** An alpha no tint paints stays a number, so a failure shows what was painted. */
function tintOf(alpha: number): Tint | number {
  return TINTS.find((tint) => HIGHLIGHT_ALPHA[tint] === alpha) ?? alpha;
}

async function readCommentQuotes(page: Page): Promise<CommentQuote[]> {
  const quotes = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="agent-chat-scroll"]');
    if (!scroller) throw new Error("The chat has no scroller");
    const view = scroller.getBoundingClientRect();
    const colors = new Map<string, string>();
    for (const style of document.querySelectorAll("style")) {
      for (const rule of style.sheet?.cssRules ?? []) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const name = /^::highlight\((.+)\)$/.exec(rule.selectorText)?.[1];
        if (name) colors.set(name, rule.style.backgroundColor);
      }
    }
    function alphaOf(name: string): number {
      const color = colors.get(name);
      if (!color) throw new Error(`${name} has no ::highlight rule`);
      const probe = document.createElement("div");
      probe.style.backgroundColor = color;
      document.body.append(probe);
      const computed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return Math.round(Number(/([\d.]+)\)$/.exec(computed)?.[1]) * 100) / 100;
    }
    return Array.from(CSS.highlights.entries())
      .filter(([name]) => name.startsWith("paseo-output-comment-"))
      .sort(([a], [b]) => Number(a.split("-").at(-1)) - Number(b.split("-").at(-1)))
      .flatMap(([name, highlight], index) =>
        Array.from(highlight, (range) => {
          const before = (range.startContainer.textContent ?? "").slice(0, range.startOffset);
          const after = (range.endContainer.textContent ?? "").slice(range.endOffset);
          const rect = range instanceof Range ? range.getBoundingClientRect() : null;
          return {
            comment: index + 1,
            text: `${before}[${range.toString()}]${after}`,
            alpha: alphaOf(name),
            inView: rect !== null && rect.top >= view.top && rect.bottom <= view.bottom,
          };
        }),
      );
  });
  return quotes.map(({ comment, text, alpha, inView }) => ({
    comment,
    text,
    tint: tintOf(alpha),
    inView,
  }));
}

export async function expectCommentHighlights(
  page: Page,
  expected: CommentHighlight[],
): Promise<void> {
  await expect
    .poll(async () => (await readCommentQuotes(page)).map(({ text, tint }) => ({ text, tint })))
    .toEqual(expected);
}

export async function expectHighlightTints(page: Page, expected: Tint[]): Promise<void> {
  await expect
    .poll(async () => (await readCommentQuotes(page)).map(({ tint }) => tint))
    .toEqual(expected);
}

/** Whether the first painted range of the comment's quote lies wholly inside the chat. */
export async function expectQuoteInView(
  page: Page,
  { comment: number, inView }: QuoteInView,
): Promise<void> {
  await expect
    .poll(async () => (await readCommentQuotes(page)).find(({ comment }) => comment === number))
    .toMatchObject({ inView });
}

export async function expectNotes(page: Page, notes: string[]): Promise<void> {
  await expect
    .poll(() =>
      page.getByTestId("output-comment-input").evaluateAll((inputs) =>
        inputs.map((input) => {
          if (!(input instanceof HTMLTextAreaElement)) throw new Error("A note is not a textarea");
          return input.value;
        }),
      ),
    )
    .toEqual(notes);
}

/** An active card draws its whole border in the accent its left edge always has. */
export async function expectActiveCards(page: Page, expected: boolean[]): Promise<void> {
  await expect
    .poll(() =>
      pendingCards(page).evaluateAll((cards) =>
        cards.map((card) => {
          const style = getComputedStyle(card);
          return style.borderTopColor === style.borderLeftColor;
        }),
      ),
    )
    .toEqual(expected);
}

export function sentCommentsToggle(userMessage: Locator): Locator {
  return userMessage.getByTestId("user-message-output-comments-toggle");
}

export async function expectSentComments(userMessage: Locator, label: string): Promise<void> {
  await expect(sentCommentsToggle(userMessage)).toHaveText(label);
}

/** In the page's viewport. */
export async function sentToggleEdges(userMessage: Locator): Promise<ToggleEdges> {
  const box = await boxOf(sentCommentsToggle(userMessage));
  return { right: box.x + box.width, top: box.y };
}

/** How far the toggle has moved from `from`, along whichever edge moved more. */
export async function toggleShift(userMessage: Locator, from: ToggleEdges): Promise<number> {
  const edges = await sentToggleEdges(userMessage);
  return Math.max(Math.abs(edges.right - from.right), Math.abs(edges.top - from.top));
}

/** Read once two reads in a row agree, so a baseline isn't taken while the chat still scrolls. */
export async function settledToggleEdges(userMessage: Locator): Promise<ToggleEdges> {
  let edges = await sentToggleEdges(userMessage);
  await expect
    .poll(async () => {
      const previous = edges;
      edges = await sentToggleEdges(userMessage);
      return edges.right === previous.right && edges.top === previous.top;
    })
    .toBe(true);
  return edges;
}

/** How much narrower the sent message's bubble is than the chat column. */
export async function sentBubbleSlack(userMessage: Locator): Promise<number> {
  const [row, bubble] = await Promise.all([
    boxOf(userMessage),
    boxOf(userMessage.getByTestId("user-message-output-comments").locator("..")),
  ]);
  return Math.round(row.width - bubble.width);
}

export function sentCommentCards(userMessage: Locator): Locator {
  return userMessage.getByTestId("user-message-output-comments").locator(":scope > div");
}

export async function tintedQuotes(card: Locator): Promise<string[]> {
  return card
    .locator("span")
    .evaluateAll((spans) =>
      spans
        .filter((span) => getComputedStyle(span).backgroundColor !== "rgba(0, 0, 0, 0)")
        .map((span) => span.textContent ?? ""),
    );
}

/** The list row a message renders in; only a virtualized one has `data-index`. */
export function historyRow(userMessage: Locator): Locator {
  return userMessage.locator("xpath=ancestor::*[@data-history-row-id][1]");
}

/** Scrolls the chat up by wheel, as a reader does, until `target` renders. */
export async function scrollChatUpTo(page: Page, target: Locator): Promise<void> {
  await page.getByTestId("agent-chat-scroll").hover();
  await expect(async () => {
    await page.mouse.wheel(0, -400);
    await expect(target).toHaveCount(1, { timeout: 250 });
  }).toPass({ intervals: [0], timeout: 20_000 });
}

/** Scrolls the chat so the sent message's toggle sits just inside its top edge. */
export async function scrollSentToggleToTop(userMessage: Locator): Promise<void> {
  await sentCommentsToggle(userMessage).evaluate((toggle) => {
    const scroller = toggle.closest('[data-testid="agent-chat-scroll"]');
    if (!scroller) throw new Error("The toggle is outside the chat.");
    const offset = toggle.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += offset - 2;
  });
}

/** How far a row's top sits above the top of the chat; negative when it starts inside. */
export async function rowOverhang(page: Page, row: Locator): Promise<number> {
  const [chat, box] = await Promise.all([boxOf(page.getByTestId("agent-chat-scroll")), boxOf(row)]);
  return Math.round(chat.y - box.y);
}

/** The space between a virtualized row and the next, 0 once the list has measured its size. */
export async function gapBelowVirtualRow(row: Locator): Promise<number> {
  return row.evaluate((element) => {
    const next = element.parentElement?.querySelector(
      `[data-index="${Number(element.getAttribute("data-index")) + 1}"]`,
    );
    if (!next) throw new Error("No virtualized row follows this one.");
    return Math.round(next.getBoundingClientRect().top - element.getBoundingClientRect().bottom);
  });
}
