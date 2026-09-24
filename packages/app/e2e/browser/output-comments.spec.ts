import { withOutputComments } from "@/output-comments/fence";
import { expect, test } from "../support/fixtures";
import { expectNearBottom } from "../support/helpers/agent-bottom-anchor";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import {
  cancelAgent,
  composerLocator,
  expectComposerDraft,
  expectQueuedMessageButton,
  fillComposerDraft,
  sendDraftToQueue,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  assistantMessageText,
  commentOn,
  composerPill,
  deliveredCards,
  doubleClickAssistantText,
  expectActiveCards,
  expectBadges,
  expectCommentHighlights,
  expectComposerPill,
  expectHighlightTints,
  expectNotes,
  expectQuoteInView,
  expectSentComments,
  gapBelowVirtualRow,
  historyRow,
  leaveFocusedField,
  noteInput,
  openAnsweredAgent,
  pendingCards,
  queuedMessageRow,
  rowOverhang,
  scrollChatUpTo,
  scrollSentToggleToTop,
  selectAssistantText,
  sentBubbleSlack,
  sentCommentCards,
  sentCommentsToggle,
  sentUserMessage,
  settledToggleEdges,
  textBadge,
  textBadges,
  tintedQuotes,
  toggleShift,
} from "../support/helpers/output-comments";
import {
  expectReconnectingToastGone,
  expectReconnectingToastVisible,
} from "../support/helpers/workspace-ui";

// Tall enough that the comment cards don't push the badged lines out of the chat.
test.use({ viewport: { width: 1280, height: 1000 } });

const RESPONSE = [
  "The parser reads the config file before anything else.",
  "",
  "Then the parser checks each entry, the Parser logs failures, and the parser retries.",
  "",
  "Retries stop after three attempts.",
].join("\n");

const CONFIG_QUOTE = "The parser reads the [config] file before anything else.";
const THREE_QUOTE = "Retries stop after [three] attempts.";

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

// A first paragraph far taller than the chat, so its start scrolls out of view.
const TALL_RESPONSE = [`Opening needle ${words("filler", 2000)}`, "", "Closing anchor line."].join(
  "\n",
);

const STREAMING_TAIL = words("tail", 1500);

// A reply of many rows, so a message before it falls outside the rows rendered around the view.
const LONG_RESPONSE = [
  RESPONSE,
  ...Array.from({ length: 30 }, (_, index) => `Filler paragraph ${index}.`),
].join("\n\n");

test("typing over selected output starts a comment that survives a reload", async ({ page }) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-type-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "why this file?" });

    await expect(noteInput(pendingCards(page))).toBeFocused();
    await expectNotes(page, ["why this file?"]);

    await commentOn(page, { quote: "three", note: "two\nlines" });

    await expect(noteInput(pendingCards(page).nth(1))).toBeFocused();
    await expectNotes(page, ["why this file?", "two\nlines"]);
    await expectBadges(page, [1, 2]);
    await expectComposerPill(page, "2 comments");
    await expectCommentHighlights(page, [
      { text: CONFIG_QUOTE, tint: "pending" },
      { text: THREE_QUOTE, tint: "active" },
    ]);

    // The store persists asynchronously; reloading before it lands would lose the note.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("@paseo:output-comments")))
      .toContain('"note":"two\\nlines"');
    await page.reload();

    await expect(pendingCards(page)).toHaveCount(2, { timeout: 30_000 });
    await expectNotes(page, ["why this file?", "two\nlines"]);
    await expectBadges(page, [1, 2]);
    await expectComposerPill(page, "2 comments");
    await expectCommentHighlights(page, [
      { text: CONFIG_QUOTE, tint: "pending" },
      { text: THREE_QUOTE, tint: "pending" },
    ]);
  } finally {
    await agent.cleanup();
  }
});

test("the selection toolbar quotes into the composer or comments on the selection as it is when pressed", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-toolbar-",
    response: RESPONSE,
  });
  try {
    const toolbar = page.getByTestId("output-comment-toolbar");
    await doubleClickAssistantText(page, "three");
    await page.getByTestId("output-comment-toolbar-quote").click();

    await expectComposerDraft(page, "> three\n\n");
    await expect(toolbar).toHaveCount(0);
    await expect(pendingCards(page)).toHaveCount(0);

    await doubleClickAssistantText(page, "config");
    await expect(toolbar).toBeVisible();
    // Changed without a pointer or Shift, as a keyboard select-all does, so the toolbar stays.
    await selectAssistantText(page, { text: "three" });
    await page.getByTestId("output-comment-toolbar-comment").click();

    await expect(noteInput(pendingCards(page))).toBeFocused();
    await expectNotes(page, [""]);
    await expect(toolbar).toHaveCount(0);
    await expectCommentHighlights(page, [{ text: THREE_QUOTE, tint: "active" }]);
  } finally {
    await agent.cleanup();
  }
});

test("typing over the same text joins its comment and each repeat keeps its own", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-merge-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "parser", note: "a" });
    await commentOn(page, { quote: "parser", note: "b" });

    await expectNotes(page, ["a\nb"]);

    await commentOn(page, { quote: "Parser", note: "c" });
    await commentOn(page, { quote: "parser", note: "d", occurrence: 2 });

    await expectNotes(page, ["a\nb", "c", "d"]);
    await expectCommentHighlights(page, [
      { text: "The [parser] reads the config file before anything else.", tint: "pending" },
      {
        text: "Then the parser checks each entry, the [Parser] logs failures, and the parser retries.",
        tint: "pending",
      },
      {
        text: "Then the parser checks each entry, the Parser logs failures, and the [parser] retries.",
        tint: "active",
      },
    ]);
  } finally {
    await agent.cleanup();
  }
});

test("a note keeps its edits until it is emptied or removed", async ({ page }) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-edit-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "old" });
    await page.keyboard.press("Escape");

    const card = pendingCards(page);
    await expect(noteInput(card)).not.toBeFocused();
    await expectNotes(page, ["old"]);

    await noteInput(card).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("new");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await leaveFocusedField(page);

    await expectNotes(page, ["new\nsecond line"]);
    await expectComposerPill(page, "1 comment");

    await commentOn(page, { quote: "three", note: "x" });
    await page.keyboard.press("Backspace");
    await expect(pendingCards(page)).toHaveCount(2);
    await leaveFocusedField(page);

    await expect(pendingCards(page)).toHaveCount(1);
    await expectNotes(page, ["new\nsecond line"]);

    await card.getByTestId("output-comment-remove").click();

    await expect(pendingCards(page)).toHaveCount(0);
    await expect(textBadges(page)).toHaveCount(0);
    await expect(composerPill(page)).toHaveCount(0);
    await expectCommentHighlights(page, []);
  } finally {
    await agent.cleanup();
  }
});

test("a badge focuses its card and a card reveals its quote, each marking it active", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-active-",
    response: TALL_RESPONSE,
  });
  try {
    await commentOn(page, { quote: "needle", note: "n" });
    await commentOn(page, { quote: "anchor", note: "a" });
    await page.keyboard.press("Escape");
    await expectHighlightTints(page, ["pending", "pending"]);

    await textBadge(page, 2).click();

    await expect(noteInput(pendingCards(page).nth(1))).toBeFocused();
    await expectHighlightTints(page, ["pending", "active"]);
    await expectActiveCards(page, [false, true]);

    const firstCard = pendingCards(page).first();
    await firstCard.scrollIntoViewIfNeeded();
    await expectQuoteInView(page, { comment: 1, inView: false });
    await firstCard.click({ position: { x: 4, y: 4 } });

    await expectHighlightTints(page, ["active", "pending"]);
    await expectActiveCards(page, [true, false]);
    await expectQuoteInView(page, { comment: 1, inView: true });
  } finally {
    await agent.cleanup();
  }
});

test("comments wait out a slash command and go with the next message", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-send-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "why config?" });
    await commentOn(page, { quote: "three", note: "maybe five" });

    await fillComposerDraft(page, "/mock handled-command");
    await composerLocator(page).press("Enter");

    const command = sentUserMessage(page, "/mock handled-command");
    await expect(command.locator('[data-message-text="true"]')).toHaveText("/mock handled-command");
    await expect(page.getByText("Mock command handled", { exact: true })).toBeVisible();
    await expect(command.getByTestId("user-message-output-comments")).toHaveCount(0);
    await expectNotes(page, ["why config?", "maybe five"]);
    await expectComposerPill(page, "2 comments");
    await expect(deliveredCards(page)).toHaveCount(0);

    await fillComposerDraft(page, "Please revise.");
    await composerLocator(page).press("Enter");

    const userMessage = sentUserMessage(page, "Please revise.");
    await expect(userMessage.locator('[data-message-text="true"]')).toHaveText("Please revise.");
    await expectSentComments(userMessage, "2 comments");
    await expect.poll(() => sentBubbleSlack(userMessage)).toBeGreaterThan(0);
    await expect(
      assistantMessageText(page).filter({ hasText: "Retries stop after three attempts." }),
    ).toHaveCount(2);
    const scrollToBottom = page.getByTestId("scroll-to-bottom-button");
    await expectNearBottom(page);
    await expect(scrollToBottom).toHaveCount(0);
    const collapsed = await settledToggleEdges(userMessage);
    await sentCommentsToggle(userMessage).click();

    await expect.poll(() => sentBubbleSlack(userMessage)).toBe(0);
    await expect.poll(() => toggleShift(userMessage, collapsed)).toBeLessThanOrEqual(1);
    // Opening downward past the bottom of the chat, rather than scrolling the chat to follow it.
    await expect(scrollToBottom).toBeVisible();
    await expect(sentCommentCards(userMessage)).toHaveText(
      [
        "The parser reads the config file before anything else.\nwhy config?",
        "Retries stop after three attempts.\nmaybe five",
      ],
      { useInnerText: true },
    );
    await expect
      .poll(() => tintedQuotes(sentCommentCards(userMessage).first()))
      .toEqual(["config"]);
    await expect.poll(() => tintedQuotes(sentCommentCards(userMessage).nth(1))).toEqual(["three"]);

    await sentCommentsToggle(userMessage).click();

    await expect(sentCommentCards(userMessage)).toHaveCount(0);
    await expect.poll(() => toggleShift(userMessage, collapsed)).toBeLessThanOrEqual(1);

    await expect(pendingCards(page)).toHaveCount(0);
    await expect(deliveredCards(page)).toHaveText(
      [
        "The parser reads the config file before anything else. why config?",
        "Retries stop after three attempts. maybe five",
      ],
      { useInnerText: true },
    );
    await expect(deliveredCards(page).getByRole("textbox")).toHaveCount(0);
    await expect(textBadges(page)).toHaveCount(0);
    await expect(composerPill(page)).toHaveCount(0);
    await expectCommentHighlights(page, [
      { text: CONFIG_QUOTE, tint: "delivered" },
      { text: THREE_QUOTE, tint: "delivered" },
    ]);

    // The composer covers the button under the last message, so press it from the keyboard.
    await userMessage.getByRole("button", { name: "Copy message" }).press("Enter");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Please revise.");

    await page.reload();

    await expect(deliveredCards(page)).toHaveCount(2, { timeout: 30_000 });
    await expectSentComments(userMessage, "2 comments");
    await expect.poll(() => sentBubbleSlack(userMessage)).toBeGreaterThan(0);
    await expectCommentHighlights(page, [
      { text: CONFIG_QUOTE, tint: "delivered" },
      { text: THREE_QUOTE, tint: "delivered" },
    ]);
  } finally {
    await agent.cleanup();
  }
});

test("a sent message in virtualized history keeps its toggle in place and stays open when it renders again", async ({
  page,
}) => {
  // Every row before the latest message goes to the virtualized history.
  await page.addInitScript(() => {
    Object.assign(globalThis, {
      __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD: 1,
      __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS: 1,
    });
  });
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-virtualized-",
    response: LONG_RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "why config?" });
    await commentOn(page, { quote: "three", note: "maybe five" });
    await fillComposerDraft(page, "Please revise.");
    await composerLocator(page).press("Enter");
    const userMessage = sentUserMessage(page, "Please revise.");
    await expect(userMessage).toHaveAttribute("aria-busy", "false");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await agent.client.sendAgentMessage(agent.agentId, "Next.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await expect(userMessage).toHaveCount(0);

    await scrollChatUpTo(page, userMessage);
    const row = historyRow(userMessage);
    await expect(row).toHaveAttribute("data-index");
    await scrollSentToggleToTop(userMessage);
    await expect.poll(() => rowOverhang(page, row)).toBeGreaterThan(0);
    const collapsed = await settledToggleEdges(userMessage);
    await sentCommentsToggle(userMessage).click();

    const cards = [
      "The parser reads the config file before anything else.\nwhy config?",
      "Retries stop after three attempts.\nmaybe five",
    ];
    await expect(sentCommentCards(userMessage)).toHaveText(cards, { useInnerText: true });
    await expect.poll(() => gapBelowVirtualRow(row)).toBe(0);
    await expect.poll(() => toggleShift(userMessage, collapsed)).toBeLessThanOrEqual(1);

    await sentCommentsToggle(userMessage).click();

    await expect(sentCommentCards(userMessage)).toHaveCount(0);
    await expect.poll(() => gapBelowVirtualRow(row)).toBe(0);

    await sentCommentsToggle(userMessage).click();
    await expect(sentCommentCards(userMessage)).toHaveCount(2);
    await page.getByTestId("scroll-to-bottom-button").click();
    await expect(userMessage).toHaveCount(0);
    await scrollChatUpTo(page, userMessage);

    await expect(sentCommentCards(userMessage)).toHaveText(cards, { useInnerText: true });
    await expect.poll(() => gapBelowVirtualRow(row)).toBe(0);
  } finally {
    await agent.cleanup();
  }
});

test("a sent comment on text no output holds shows its quote as plain text", async ({ page }) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-unplaced-",
    response: RESPONSE,
  });
  try {
    await agent.client.sendAgentMessage(
      agent.agentId,
      withOutputComments("Earlier notes.", [
        {
          quote: "The **cache** is warm",
          note: "from an older session",
          startBlock: 0,
          occurrence: 0,
          isCode: false,
        },
      ]),
    );
    const userMessage = sentUserMessage(page, "Earlier notes.");
    await sentCommentsToggle(userMessage).click();

    await expect(sentCommentCards(userMessage)).toHaveText(
      ["The cache is warm\nfrom an older session"],
      { useInnerText: true },
    );
    await expect.poll(() => tintedQuotes(sentCommentCards(userMessage).first())).toEqual([]);
    await expect(deliveredCards(page)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("comments send on their own and an empty comment neither counts nor sends", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-only-",
    response: RESPONSE,
  });
  try {
    const send = page.getByRole("button", { name: "Send message" });
    await commentOn(page, { quote: "three", note: "x" });
    await page.keyboard.press("Backspace");

    await expect(pendingCards(page)).toHaveCount(1);
    await expect(composerPill(page)).toHaveCount(0);
    await expect(send).toHaveCount(0);

    await commentOn(page, { quote: "config", note: "only this" });
    await commentOn(page, { quote: "three", note: "x" });
    await page.keyboard.press("Backspace");

    await expect(pendingCards(page)).toHaveCount(2);
    await expectComposerPill(page, "1 comment");
    await expect(send).toBeEnabled();
    await send.click();

    const userMessage = page
      .getByTestId("user-message")
      .filter({ has: page.getByTestId("user-message-output-comments") });
    await expectSentComments(userMessage, "1 comment");
    await expect(userMessage.locator('[data-message-text="true"]')).toHaveCount(0);
    await expect(userMessage.getByRole("button", { name: "Copy message" })).toHaveCount(0);
    await expect(pendingCards(page)).toHaveCount(0);
    await expect(deliveredCards(page)).toHaveText(
      ["The parser reads the config file before anything else. only this"],
      { useInnerText: true },
    );
  } finally {
    await agent.cleanup();
  }
});

test("queueing carries the comments, and editing the queued message restores them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "output-comments-queue-",
    title: "Output comments queue",
    featureValues: {
      mockStreamingAssistantResponse: `${RESPONSE}\n\n${STREAMING_TAIL}`,
      mockStreamingAssistantIntervalMs: 20,
    },
  });
  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Explain the parser.");
    await expect(page.getByText("tail0", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await cancelAgent(page);
    await agent.client.waitForAgentUpsert(agent.agentId, ({ status }) => status === "idle");

    await commentOn(page, { quote: "config", note: "queued note" });
    await agent.client.sendAgentMessage(agent.agentId, "Keep streaming.");
    await expect(page.getByTestId("turn-working-indicator")).toBeVisible({ timeout: 30_000 });

    await fillComposerDraft(page, "Queued text.");
    await sendDraftToQueue(page);

    await expectQueuedMessageButton(page);
    await expect(queuedMessageRow(page, "Queued text.").getByText("1 comment")).toBeVisible();
    await expect(composerPill(page)).toHaveCount(0);
    await expect(pendingCards(page)).toHaveCount(0);
    await commentOn(page, { quote: "three", note: "since queued" });

    await page.getByRole("button", { name: "Edit queued message" }).click();

    await expectComposerDraft(page, "Queued text.");
    await expectNotes(page, ["queued note", "since queued"]);
    await expectComposerPill(page, "2 comments");

    await sendDraftToQueue(page);
    await expectQueuedMessageButton(page);
    await page.getByRole("button", { name: "Send queued message now" }).click();

    const userMessage = sentUserMessage(page, "Queued text.");
    await expectSentComments(userMessage, "2 comments");
    await expect(pendingCards(page)).toHaveCount(0);
    await expect(composerPill(page)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("a failed send keeps the comments pending for the retry", async ({ page }) => {
  const gate = await installDaemonWebSocketGate(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-failed-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "keep" });
    await fillComposerDraft(page, "Try to send.");
    gate.holdNextClientRequest("send_agent_message_request");
    await composerLocator(page).press("Enter");
    await gate.waitForHeldClientRequest();
    await gate.drop();

    await expectReconnectingToastVisible(page);
    await expectComposerDraft(page, "Try to send.");
    await expect(sentUserMessage(page, "Try to send.")).toHaveCount(0);
    await expectNotes(page, ["keep"]);
    await expectComposerPill(page, "1 comment");

    gate.restore();
    await expectReconnectingToastGone(page);
    await composerLocator(page).press("Enter");
    await expect.poll(() => gate.getClientRequestCount("send_agent_message_request")).toBe(2);
    gate.releaseHeldClientRequest();

    await expectSentComments(sentUserMessage(page, "Try to send."), "1 comment");
    await expect(pendingCards(page)).toHaveCount(0);
  } finally {
    gate.restore();
    await agent.cleanup();
  }
});
