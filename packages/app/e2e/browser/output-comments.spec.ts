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
  removeAttachmentPill,
  sendDraftToQueue,
} from "../support/helpers/composer";
import { stubListCommands } from "../support/helpers/list-commands";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  assistantMessageText,
  badgeOnTopAt,
  cardImages,
  cardPlaces,
  commentOn,
  composerPill,
  composerTray,
  deliveredCards,
  dispatchInputAtOnce,
  doubleClickAssistantText,
  dropImage,
  expectActiveCards,
  expectBadges,
  expectCommentHighlights,
  expectComposerPill,
  expectHighlightTints,
  expectNotes,
  expectQuoteInView,
  expectSentComments,
  focusedNote,
  gapBelowVirtualRow,
  historyRow,
  hoverBadge,
  leaveFocusedField,
  mentionPopover,
  noteInput,
  openAnsweredAgent,
  pasteImage,
  pasteOnDocument,
  pasteOverAssistantText,
  pendingCards,
  queuedMessageRow,
  removeAllComments,
  removeAllCommentsAnswering,
  rowOverhang,
  scrollChatUpTo,
  scrollSentToggleToTop,
  selectAssistantText,
  sentBubbleSlack,
  sentCommentCards,
  sentCommentsToggle,
  sentImages,
  sentUserMessage,
  settledToggleEdges,
  textBadge,
  textBadges,
  tintedQuotes,
  toggleShift,
  trayImages,
  typeOverAssistantText,
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

const LIST_RESPONSE = [
  "The parser runs in three passes:",
  "",
  "- Tokenize the source",
  "- Build the tree",
  "  - Link each node",
  "  - Check each link",
  "- Emit the output",
  "1. Ship the build",
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

test("typing over selected output starts a comment that takes every key and survives a reload", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-type-",
    response: RESPONSE,
  });
  try {
    await typeOverAssistantText(page, "config", "why this file?");

    await expect(noteInput(pendingCards(page))).toBeFocused();
    await expectNotes(page, ["why this file?"]);

    await leaveFocusedField(page);
    await selectAssistantText(page, { text: "three" });
    await dispatchInputAtOnce(page, [
      ..."twox",
      "Backspace",
      "Enter",
      ..."lines",
      { paste: " pasted" },
    ]);

    await expect(noteInput(pendingCards(page).nth(1))).toBeFocused();
    await expectNotes(page, ["why this file?", "two\nlines pasted"]);
    await expectBadges(page, [1, 2]);
    await expectComposerPill(page, "2 comments");
    await expectCommentHighlights(page, [
      { text: CONFIG_QUOTE, tint: "pending" },
      { text: THREE_QUOTE, tint: "active" },
    ]);

    // The store persists asynchronously; reloading before it lands would lose the note.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("@paseo:output-comments")))
      .toContain('"note":"two\\nlines pasted"');
    await page.reload();

    await expect(pendingCards(page)).toHaveCount(2, { timeout: 30_000 });
    await expectNotes(page, ["why this file?", "two\nlines pasted"]);
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

test("pasting text over selected output starts a comment or joins the one on that text", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-paste-",
    response: RESPONSE,
  });
  try {
    await leaveFocusedField(page);
    await pasteOnDocument(page, { text: "ignored" });
    await selectAssistantText(page, { text: "config" });
    await pasteOnDocument(page, {});
    // Had either paste started a comment, this one would join it or sit beside it.
    await pasteOnDocument(page, { text: "why this\r\nfile?" });

    await expect(noteInput(pendingCards(page))).toBeFocused();
    await expectNotes(page, ["why this\nfile?"]);
    await expectCommentHighlights(page, [{ text: CONFIG_QUOTE, tint: "active" }]);
    await page.keyboard.type(" really");
    await expectNotes(page, ["why this\nfile? really"]);

    await pasteOverAssistantText(page, "config", { text: "and this" });

    await expect(noteInput(pendingCards(page))).toBeFocused();
    await expectNotes(page, ["why this\nfile? really\nand this"]);
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

test("badges on overlapping quotes pile and spread on hover", async ({ page }) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-piles-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config file", note: "1" });
    await commentOn(page, { quote: "file", note: "2" });
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);

    await expect.poll(() => badgeOnTopAt(page, 1)).toBe("2");

    await hoverBadge(page, 2);

    await expect.poll(() => badgeOnTopAt(page, 1)).toBe("1");
    await expect.poll(() => badgeOnTopAt(page, 2)).toBe("2");
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

test("images pasted over selected output or into a note, or dropped on one, join the composer tray and leave with it", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-images-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "see this" });
    const card = pendingCards(page).first();
    const tray = composerTray(page);

    await pasteImage(noteInput(card));
    await expect(cardImages(card)).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(1);

    await removeAttachmentPill(card, "output-comment-image", "Remove image attachment");
    await expect(cardImages(card)).toHaveCount(0);
    await expect(trayImages(page)).toHaveCount(0);
    await expectNotes(page, ["see this"]);

    await dropImage(noteInput(card));
    await expect(cardImages(card)).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(1);

    await removeAttachmentPill(tray, "composer-image-attachment-pill", "Remove image attachment");
    await expect(trayImages(page)).toHaveCount(0);
    await expect(cardImages(card)).toHaveCount(0);

    await pasteOverAssistantText(page, "config", { image: true });

    await expect(noteInput(card)).toBeFocused();
    await expect(cardImages(card)).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(1);
    await expectNotes(page, ["see this"]);

    await pasteOverAssistantText(page, "three", { image: true });

    const second = pendingCards(page).nth(1);
    await expect(noteInput(second)).toBeFocused();
    await expect(cardImages(second)).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(2);
    await expectNotes(page, ["see this", ""]);

    await pasteOverAssistantText(page, "three", { text: "and this", image: true });

    await expect(noteInput(second)).toBeFocused();
    await expect(cardImages(second)).toHaveCount(2);
    await expect(trayImages(page)).toHaveCount(3);
    await expectNotes(page, ["see this", "and this"]);
    await page.keyboard.type(" too");
    await expectNotes(page, ["see this", "and this too"]);

    await second.getByTestId("output-comment-remove").click();

    await expect(pendingCards(page)).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(1);

    await card.getByTestId("output-comment-remove").click();

    await expect(pendingCards(page)).toHaveCount(0);
    await expect(trayImages(page)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("the composer pill opens the first comment and removes the comments it counts, with their images", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-remove-all-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "Retries", note: "x" });
    await page.keyboard.press("Backspace");
    // The store persists asynchronously; reloading before it lands would lose the note.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("@paseo:output-comments")))
      .toContain('"note":""');
    await page.reload();

    await expect(pendingCards(page)).toHaveCount(1, { timeout: 30_000 });
    await expectNotes(page, [""]);
    await expect(composerPill(page)).toHaveCount(0);

    // A dialog nobody handles is dismissed, so this removal also proves no dialog asked first.
    await commentOn(page, { quote: "config", note: "alone" });
    await page.keyboard.press("Escape");
    await expectComposerPill(page, "1 comment");
    await removeAllComments(page);

    await expectNotes(page, [""]);
    await expect(composerPill(page)).toHaveCount(0);

    await commentOn(page, { quote: "config", note: "one" });
    await pasteImage(focusedNote(page));
    await commentOn(page, { quote: "three", note: "two" });
    await pasteImage(focusedNote(page));
    await page.keyboard.press("Escape");
    await expect(trayImages(page)).toHaveCount(2);
    await expectNotes(page, ["one", "", "two"]);
    await expectComposerPill(page, "2 comments");

    await composerPill(page).click();
    await expect(noteInput(pendingCards(page).first())).toBeFocused();
    await page.keyboard.press("Escape");

    expect(await removeAllCommentsAnswering(page, { accept: false })).toBe(
      "Remove 2 comments?\n\nTheir text and images will be removed from your message.",
    );
    await expectNotes(page, ["one", "", "two"]);
    await expect(trayImages(page)).toHaveCount(2);
    await expectComposerPill(page, "2 comments");

    await removeAllCommentsAnswering(page, { accept: true });

    await expectNotes(page, [""]);
    await expect(composerPill(page)).toHaveCount(0);
    await expect(trayImages(page)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("a note suggests files and skills but not commands", async ({ page }) => {
  await stubListCommands(page, [
    { name: "review-diff", description: "Review the diff", argumentHint: "", kind: "skill" },
    { name: "compact", description: "Compact the context", argumentHint: "", kind: "command" },
  ]);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-mention-",
    repo: { files: [{ path: "docs/parser-notes.md", content: "# Parser notes\n" }] },
    response: RESPONSE,
  });
  try {
    const note = noteInput(pendingCards(page));
    const suggestion = mentionPopover(page).getByText("parser-notes.md");
    await commentOn(page, { quote: "config", note: "see @parser-no" });

    await expect(suggestion).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Enter");

    await expectNotes(page, ['see "docs/parser-notes.md"']);
    await expect(mentionPopover(page)).toHaveCount(0);

    await page.keyboard.type(" or @parser-no");
    await suggestion.click();

    await expectNotes(page, ['see "docs/parser-notes.md" or "docs/parser-notes.md"']);
    await expect(note).toBeFocused();
    await expect(mentionPopover(page)).toHaveCount(0);

    await page.keyboard.type(" /");
    await expect(
      mentionPopover(page).getByText("/review-diff", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(mentionPopover(page).getByText("/compact", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Enter");

    await expectNotes(page, ['see "docs/parser-notes.md" or "docs/parser-notes.md" /review-diff ']);
    await expect(mentionPopover(page)).toHaveCount(0);

    await page.keyboard.type("@parser-no");
    await expect(suggestion).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(mentionPopover(page)).toHaveCount(0);
    await expect(note).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(note).not.toBeFocused();
    await expectNotes(page, [
      'see "docs/parser-notes.md" or "docs/parser-notes.md" /review-diff @parser-no',
    ]);
  } finally {
    await agent.cleanup();
  }
});

test("a comment's card follows the list item its quote ends in, before and after sending", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-comments-list-",
    response: LIST_RESPONSE,
  });
  try {
    await commentOn(page, { quote: "the tree", note: "why a tree?" });
    await commentOn(page, { quote: "Link each", note: "every node?" });
    await commentOn(page, { quote: "Tokenize", through: "the output", note: "all passes" });
    await commentOn(page, { quote: "Ship", note: "then ship" });

    const places = [
      { before: "Link each node", after: "Check each link" },
      { before: "Build the tree", after: "Emit the output" },
      { before: "Emit the output", after: null },
      { before: "Ship the build", after: null },
    ];
    await expect.poll(() => cardPlaces(pendingCards(page))).toEqual(places);
    await expectNotes(page, ["every node?", "why a tree?", "all passes", "then ship"]);

    await fillComposerDraft(page, "Please revise.");
    await composerLocator(page).press("Enter");

    await expect(pendingCards(page)).toHaveCount(0);
    await expect.poll(() => cardPlaces(deliveredCards(page))).toEqual(places);

    await agent.client.sendAgentMessage(
      agent.agentId,
      withOutputComments("", [
        {
          quote: "Ship the build",
          note: "an item this list lacks",
          startBlock: 1,
          occurrence: 0,
          isCode: false,
          endItem: [9],
        },
      ]),
    );

    await expect
      .poll(() => cardPlaces(deliveredCards(page)))
      .toEqual([...places, { before: "Tokenize the source", after: null }]);
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
    await pasteImage(noteInput(pendingCards(page).nth(1)));
    await expect(trayImages(page)).toHaveCount(1);

    await fillComposerDraft(page, "/mock handled-command");
    await composerLocator(page).press("Enter");

    const command = sentUserMessage(page, "/mock handled-command");
    await expect(command.locator('[data-message-text="true"]')).toHaveText("/mock handled-command");
    await expect(page.getByText("Mock command handled", { exact: true })).toBeVisible();
    await expect(command.getByTestId("user-message-output-comments")).toHaveCount(0);
    await expect(sentImages(command)).toHaveCount(0);
    await expectNotes(page, ["why config?", "maybe five"]);
    await expectComposerPill(page, "2 comments");
    await expect(cardImages(pendingCards(page).nth(1))).toHaveCount(1);
    await expect(trayImages(page)).toHaveCount(1);
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
        "Retries stop after three attempts.\nmaybe five\n[Image 1]",
      ],
      { useInnerText: true },
    );
    await expect
      .poll(() => tintedQuotes(sentCommentCards(userMessage).first()))
      .toEqual(["config"]);
    await expect.poll(() => tintedQuotes(sentCommentCards(userMessage).nth(1))).toEqual(["three"]);
    await expect(sentImages(userMessage)).toHaveCount(1);

    await sentCommentsToggle(userMessage).click();

    await expect(sentCommentCards(userMessage)).toHaveCount(0);
    await expect.poll(() => toggleShift(userMessage, collapsed)).toBeLessThanOrEqual(1);

    await expect(pendingCards(page)).toHaveCount(0);
    await expect(deliveredCards(page)).toHaveText(
      [
        "The parser reads the config file before anything else. why config?",
        "Retries stop after three attempts. maybe five [Image 1]",
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
    // Editing the queued message replaces the draft's attachments, but not a pending comment's.
    await commentOn(page, { quote: "three", note: "since queued" });
    await pasteImage(noteInput(pendingCards(page)));
    await pasteImage(composerLocator(page));
    await expect(trayImages(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Edit queued message" }).click();

    await expectComposerDraft(page, "Queued text.");
    await expectNotes(page, ["queued note", "since queued"]);
    await expectComposerPill(page, "2 comments");
    await expect(trayImages(page)).toHaveCount(1);
    await expect(cardImages(pendingCards(page).nth(1))).toHaveCount(1);

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
