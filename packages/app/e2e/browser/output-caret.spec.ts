import type { Page } from "@playwright/test";
import { APP_SETTINGS_KEY } from "@/hooks/use-settings/keys";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { splitCurrentPanelRight } from "../support/helpers/chat-outline";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerFocused,
  fillComposerDraft,
} from "../support/helpers/composer";
import { installDictationHarness } from "../support/helpers/dictation";
import {
  createMockAgent,
  openAgentRoute,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  FIELD_END_KEY,
  FIELD_START_KEY,
  LINE_START_KEY,
  WORD_DELETE_KEY,
  badSteps,
  caretSpot,
  caretStep,
  composerCursor,
  dragAcrossToolCall,
  expectChatAtBottom,
  focusedNoteCursor,
  expectCaret,
  lackingMargin,
  nextFrames,
  pressTimes,
  pressUntilCaretIn,
  readChat,
  seedCaretAgent,
  selectedText,
  setOutputCaretLines,
  startCaretFromKeyboard,
  turnOnOutputCaretSetting,
  walkCaret,
} from "../support/helpers/output-caret";
import {
  assistantMessageText,
  clickAssistantText,
  commentOn,
  dispatchInputAtOnce,
  expectCommentHighlights,
  expectNotes,
  expectSentComments,
  focusedNote,
  leaveFocusedField,
  noteInput,
  openAnsweredAgent,
  pendingCards,
  selectAssistantText,
  sentCommentCards,
  sentCommentsToggle,
  sentUserMessage,
} from "../support/helpers/output-comments";
import {
  continueToNextQuestion,
  submitQuestionAnswers,
  typeQuestionAnswer,
  waitForQuestionPrompt,
} from "../support/helpers/questions";
import { clickSettingsBackToWorkspace } from "../support/helpers/settings";
import { MAC_USER_AGENT, pinPlatform } from "../support/helpers/user-agent";

test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await pinPlatform(page, "Win32");
});

const FIRST = "The parser reads the config file before anything else.";
const SECOND = "Then the parser checks each entry, and the parser retries.";
const LAST = "Retries stop after three attempts.";
const RESPONSE = [FIRST, "", SECOND, "", LAST].join("\n");

const PROMPT = "Explain the parser.";

/** The reply followed by `paragraphs` short ones, so it runs well past the chat's height. */
function withFiller(paragraphs: number): string {
  const filler = Array.from({ length: paragraphs }, (_, index) => `Filler paragraph ${index}.`);
  return [RESPONSE, ...filler].join("\n\n");
}

function focusComposerHint(page: Page, shortcut: string) {
  return page.getByText(
    `Press ${shortcut} in the composer to jump to the start of the latest reply, and press it again to come back`,
  );
}

/** What the caret adds to each pane's output: the host's attributes, style and wrapping, and its CSS. */
async function readOutputHosts(page: Page) {
  return page.evaluate(() => {
    const names = ["contenteditable", "data-output-caret-host", "role", "tabindex", "inputmode"];
    const scrollers = document.querySelectorAll('[data-testid="agent-chat-scroll"]');
    const hosts = Array.from(scrollers, (scroller) => {
      const host = scroller.firstElementChild;
      if (!(host instanceof HTMLElement)) throw new Error("A chat has no content");
      const { overflowWrap, lineBreak } = getComputedStyle(host);
      return {
        attributes: Object.fromEntries(names.map((name) => [name, host.getAttribute(name)])),
        wrap: { overflowWrap, lineBreak },
        style: host.getAttribute("style"),
      };
    });
    const caretStyles = Array.from(document.querySelectorAll("style")).filter((style) =>
      style.textContent?.includes("[data-output-caret-host]"),
    );
    return { hosts, caretStyleCount: caretStyles.length };
  });
}

const NO_CARET_ATTRIBUTES = {
  contenteditable: null,
  "data-output-caret-host": null,
  role: null,
  tabindex: null,
  inputmode: null,
};

const CARET_ATTRIBUTES = {
  contenteditable: "true",
  "data-output-caret-host": "",
  role: "document",
  tabindex: "-1",
  inputmode: "none",
};

test("the caret setting names the focus-composer shortcut and unlocks the line counts", async ({
  page,
}) => {
  await gotoAppShell(page);
  await openSettings(page);
  const lockedHint = page.getByText("Turn on Keyboard caret in output to change these", {
    exact: true,
  });
  const lineInputs = [
    page.getByRole("textbox", { name: "Lines kept above the caret" }),
    page.getByRole("textbox", { name: "Lines kept below the caret" }),
  ];

  await expect(focusComposerHint(page, "Ctrl+L")).toBeVisible();
  await expect(lockedHint).toBeVisible();
  for (const input of lineInputs) {
    await expect(input).toBeDisabled();
  }

  await page.getByRole("switch", { name: "Keyboard caret in output" }).click();

  await expect(lockedHint).toHaveCount(0);
  for (const input of lineInputs) {
    await expect(input).toBeEditable();
  }

  // The field shows what was saved: a count past the limit, or with stray characters, isn't.
  const [above] = lineInputs;
  const savedAbove = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").outputCaretLinesAbove,
      APP_SETTINGS_KEY,
    );
  for (const { typed, saved } of [
    { typed: "99", saved: 20 },
    { typed: "7x", saved: 7 },
    { typed: "12", saved: 12 },
  ]) {
    await above.fill(typed);
    await above.press("Enter");
    await expect.poll(savedAbove).toBe(saved);
    await expect(above).toHaveValue(String(saved));
  }
});

const REPO_URL_QUESTION = "What is the GitHub private repo URL to push to?";
const COMMIT_MESSAGE_QUESTION = "What should the first commit message be?";

test("the agent's question takes a click and keys in the output, and its field keeps its own keys", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-question-",
    initialPrompt: "Emit synthetic questions: two free-write questions.",
  });
  const repoUrl = "git@github.com:user/private-repo.git";
  const field = page
    .getByTestId("question-form-card")
    .getByRole("textbox", { name: REPO_URL_QUESTION });
  try {
    await openAgentRoute(page, agent);
    await waitForQuestionPrompt(page);
    await expect
      .poll(async () => (await readOutputHosts(page)).hosts.map(({ attributes }) => attributes))
      .toEqual([CARET_ATTRIBUTES]);

    await typeQuestionAnswer(page, { question: REPO_URL_QUESTION, answer: repoUrl });
    const { spot, place } = await readChat(page);
    for (const { key, answer } of [
      { key: "ArrowUp", answer: repoUrl },
      { key: "ArrowDown", answer: repoUrl },
      { key: "Backspace", answer: repoUrl.slice(0, -1) },
      { key: "Escape", answer: repoUrl.slice(0, -1) },
    ]) {
      await page.keyboard.press(key);
      await expect(field, key).toBeFocused();
      await expect(field, key).toHaveValue(answer);
      await expectCaret(page, false);
      const read = await readChat(page);
      expect({ spot: read.spot, place: read.place }, key).toEqual({ spot, place });
    }

    await continueToNextQuestion(page);
    await typeQuestionAnswer(page, {
      question: COMMIT_MESSAGE_QUESTION,
      answer: "Initialize private repo",
    });
    await submitQuestionAnswers(page);
  } finally {
    await agent.cleanup();
  }
});

test("once there is a reply an arrow starts the caret, a click moves it, and Escape hides it", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-start-",
    featureValues: { mockAssistantResponse: RESPONSE },
  });
  try {
    await openAgentRoute(page, agent);
    await composerLocator(page).click();
    await page.keyboard.press("Control+L");
    await expectComposerFocused(page);
    await leaveFocusedField(page);
    await page.keyboard.press("ArrowDown");
    await expectCaret(page, false);
    await expect.poll(async () => (await readChat(page)).place).toBeNull();

    await agent.client.sendAgentMessage(agent.agentId, PROMPT);
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await expect(page.getByText(LAST)).toBeVisible();
    await startCaretFromKeyboard(page);
    await expect
      .poll(() => caretSpot(page))
      .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });

    await pressTimes(page, "Shift+ArrowRight", 3);
    await expect.poll(() => selectedText(page)).toBe("The");
    await page.keyboard.press("Escape");
    await expect.poll(() => caretSpot(page)).toBeNull();
    await expectCaret(page, false);

    await clickAssistantText(page, SECOND);
    await expect.poll(async () => (await caretSpot(page))?.text).toBe(SECOND);
    await expectCaret(page, true);

    await page.keyboard.press("Escape");
    await expectCaret(page, false);
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => caretSpot(page))
      .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });
  } finally {
    await agent.cleanup();
  }
});

test("keys pressed under an open menu leave the caret where it is", async ({ page }) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-menu-",
    response: RESPONSE,
  });
  try {
    await clickAssistantText(page, SECOND);
    const held = (await caretStep(page, null)).spot;

    await page.getByRole("button", { name: "Fork chat from here" }).last().focus();
    await page.keyboard.press("Enter");
    const menuItem = page.getByRole("menuitem", { name: "Fork in a new tab", exact: true });
    await expect(menuItem).toBeVisible();
    await leaveFocusedField(page);
    await page.keyboard.press("ArrowDown");
    await expect(menuItem).toBeVisible();
    await expect.poll(() => caretSpot(page)).toEqual(held);
    await page.keyboard.press("Escape");
    await expect(menuItem).toHaveCount(0);
    await expect.poll(() => caretSpot(page)).toEqual(held);
  } finally {
    await agent.cleanup();
  }
});

test("? opens the shortcuts dialog from the output, and a control outside the chat takes the keys", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-help-",
    response: RESPONSE,
  });
  const dialog = page.getByTestId("keyboard-shortcuts-dialog");
  try {
    await clickAssistantText(page, LAST);
    await expectCaret(page, true);
    await page.keyboard.press("Shift+?");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await clickAssistantText(page, LAST);
    await expectCaret(page, true);
    await page.getByTestId("sidebar-help").focus();
    await expectCaret(page, false);
    await page.keyboard.press("Shift+?");
    await expect(dialog).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("closing the command center or a dialog gives the caret and the scroll back", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-restore-",
    response: withFiller(25),
  });
  const commandCenter = page.getByTestId("command-center-panel");
  const dialog = page.getByTestId("keyboard-shortcuts-dialog");
  try {
    await clickAssistantText(page, "Filler paragraph 23.");
    const held = await caretStep(page, null);
    expect(held.scrollTop).toBeGreaterThan(0);

    for (const { key, overlay } of [
      { key: "Control+K", overlay: commandCenter },
      { key: "Shift+?", overlay: dialog },
    ]) {
      await page.keyboard.press(key);
      await expect(overlay).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(overlay).toHaveCount(0);
      await expectCaret(page, true);
      await expect
        .poll(async () => {
          const { spot, scrollTop } = await readChat(page);
          return { spot, scrollTop };
        })
        .toEqual({ spot: held.spot, scrollTop: held.scrollTop });
    }
  } finally {
    await agent.cleanup();
  }
});

test("the caret selects by key to comment on or quote, and moves into notes and out", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-comment-",
    response: RESPONSE,
  });
  try {
    await test.step("Enter comments on what Shift and the arrows selected", async () => {
      await startCaretFromKeyboard(page);
      await pressTimes(page, "ArrowRight", 4);
      await pressTimes(page, "Shift+ArrowRight", 6);
      await expect.poll(() => selectedText(page)).toBe("parser");
      await expectCaret(page, false);

      await page.keyboard.press("Enter");
      await expect(focusedNote(page)).toHaveCount(1);
      await page.keyboard.type("why parser?");
      await page.keyboard.press("Escape");

      await expect(focusedNote(page)).toHaveCount(0);
      await expectCaret(page, true);
      await expectNotes(page, ["why parser?"]);
      await expectCommentHighlights(page, [
        { text: "The [parser] reads the config file before anything else.", tint: "pending" },
      ]);
    });

    await test.step("arrows carry the caret into the note and out on either side", async () => {
      await page.keyboard.press("ArrowDown");
      await expect(focusedNote(page)).toHaveCount(1);
      await expect.poll(() => focusedNoteCursor(page)).toBe(0);
      await expectCaret(page, false);

      await page.keyboard.press("ArrowUp");
      await expect(focusedNote(page)).toHaveCount(0);
      await expect.poll(async () => (await caretSpot(page))?.text).toBe(FIRST);

      await page.keyboard.press("ArrowDown");
      await expect(focusedNote(page)).toHaveCount(1);
      await page.keyboard.press("ArrowDown");
      await expect(focusedNote(page)).toHaveCount(0);
      await expect.poll(async () => (await caretSpot(page))?.text).toBe(SECOND);

      await page.keyboard.press("ArrowUp");
      await expect(focusedNote(page)).toHaveCount(1);
      await expect.poll(() => focusedNoteCursor(page)).toBe("why parser?".length);
      await page.keyboard.press("Escape");
      await expectCaret(page, true);
      await expectNotes(page, ["why parser?"]);
    });

    await test.step("Shift+Enter quotes the selection into the composer", async () => {
      await clickAssistantText(page, SECOND);
      await page.keyboard.press(LINE_START_KEY);
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: SECOND, offset: 0, rowKind: "assistant_message" });
      await pressTimes(page, "Shift+ArrowRight", 4);
      await expect.poll(() => selectedText(page)).toBe("Then");

      await page.keyboard.press("Shift+Enter");

      await expectComposerDraft(page, "> Then\n\n");
      await expect(pendingCards(page)).toHaveCount(1);
      await expectCaret(page, true);
    });

    await test.step("Enter on a control presses it instead of commenting", async () => {
      await pressTimes(page, "Shift+ArrowRight", 4);
      await page.getByRole("button", { name: "Fork chat from here" }).last().focus();
      await page.keyboard.press("Enter");
      const menuItem = page.getByRole("menuitem", { name: "Fork in a new tab", exact: true });
      await expect(menuItem).toBeVisible();
      await expect(focusedNote(page)).toHaveCount(0);
      await expect(pendingCards(page)).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(menuItem).toHaveCount(0);
    });

    await test.step("an arrow out of an empty note drops it", async () => {
      await clickAssistantText(page, LAST);
      await pressTimes(page, "Shift+ArrowRight", 3);
      await page.keyboard.press("Enter");
      await expect(focusedNote(page)).toHaveCount(1);

      await page.keyboard.press("ArrowUp");

      await expect(pendingCards(page)).toHaveCount(1);
      await expect.poll(async () => (await caretSpot(page))?.text).toBe(LAST);
      await expectCaret(page, true);
    });

    await test.step("up from a note's second line stays in the note", async () => {
      await noteInput(pendingCards(page)).click();
      await focusedNote(page).fill("why\nwhy");
      await page.keyboard.press(FIELD_START_KEY);
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => focusedNoteCursor(page)).toBe("why\n".length);

      await page.keyboard.press("ArrowUp");
      await expect(focusedNote(page)).toHaveCount(1);
      await expect.poll(() => focusedNoteCursor(page)).toBe(0);

      await page.keyboard.press("ArrowUp");
      await expect(focusedNote(page)).toHaveCount(0);
      await expectCaret(page, true);
    });
  } finally {
    await agent.cleanup();
  }
});

test("keys typed while a new note takes focus all reach it, Enter too", async ({ page }) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-type-ahead-",
    response: RESPONSE,
  });
  try {
    await leaveFocusedField(page);
    await selectAssistantText(page, { text: "config" });
    await dispatchInputAtOnce(page, ["a", "Enter", "b"]);

    await expectNotes(page, ["a\nb"]);
  } finally {
    await agent.cleanup();
  }
});

test("dictation over what Shift and the arrows selected fills a comment on it", async ({
  page,
}) => {
  const dictation = await installDictationHarness(page, { transcript: "why the parser?" });
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-dictation-",
    response: RESPONSE,
  });
  try {
    await startCaretFromKeyboard(page);
    await pressTimes(page, "ArrowRight", 4);
    await pressTimes(page, "Shift+ArrowRight", 6);
    await expect.poll(() => selectedText(page)).toBe("parser");

    await page.getByRole("button", { name: "Start dictation" }).click();
    await expect(focusedNote(page)).toHaveCount(1);
    await dictation.waitForAudio();
    await page.getByRole("button", { name: "Insert transcription", exact: true }).click();

    await expectNotes(page, ["why the parser?"]);
    await expectCommentHighlights(page, [
      { text: "The [parser] reads the config file before anything else.", tint: "active" },
    ]);
  } finally {
    await agent.cleanup();
  }
});

test("with the output focused, Shift+Space pages up", async ({ page }) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-page-",
    response: withFiller(40),
  });
  try {
    await clickAssistantText(page, "Filler paragraph 39.");
    const { scrollTop } = await caretStep(page, null);
    const clientHeight = await page
      .getByTestId("agent-chat-scroll")
      .evaluate((chat) => chat.clientHeight);
    await page.keyboard.press("Shift+Space");
    // As a browser pages: seven eighths of the chat's height, give or take the pixel it rounds to.
    await expect
      .poll(async () =>
        Math.abs(scrollTop - (await readChat(page)).scrollTop - clientHeight * 0.875),
      )
      .toBeLessThanOrEqual(1);
  } finally {
    await agent.cleanup();
  }
});

test("Tab after a click goes on from there, to the reply's own controls", async ({ page }) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-tab-",
    response: RESPONSE,
  });
  try {
    await clickAssistantText(page, LAST);
    await expectCaret(page, true);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("assistant-turn-footer").locator(":focus")).toHaveCount(1);
  } finally {
    await agent.cleanup();
  }
});

test("on a compact screen the caret stays off, and Settings doesn't offer it", async ({ page }) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-compact-",
    response: RESPONSE,
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText(LAST)).toBeVisible();
    await page.getByText(FIRST).click();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-output-caret-host]")).toHaveCount(0);

    // Enter comments on a selection only where the caret is: here it leaves the selection alone.
    await leaveFocusedField(page);
    await selectAssistantText(page, { text: "config" });
    await page.keyboard.press("Enter");
    await expect(pendingCards(page)).toHaveCount(0);

    await page.goto("/settings/general");
    await expect(page.getByRole("textbox", { name: "Terminal scrollback lines" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Keyboard caret in output" })).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("the caret opens the sent comments card it walks into, and folds only what it opened", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-sent-",
    response: RESPONSE,
  });
  try {
    await commentOn(page, { quote: "config", note: "why config?" });
    await fillComposerDraft(page, "Please revise.");
    await composerLocator(page).press("Enter");
    const userMessage = sentUserMessage(page, "Please revise.");
    await expectSentComments(userMessage, "1 comment");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await expect(sentCommentCards(userMessage)).toHaveCount(0);

    await startCaretFromKeyboard(page);
    await page.keyboard.press("ArrowUp");
    await expect(sentCommentCards(userMessage)).toHaveCount(1);
    await expect.poll(async () => (await caretSpot(page))?.text).toBe("why config?");

    await pressUntilCaretIn(page, { key: "ArrowDown", text: FIRST });
    await expect(sentCommentCards(userMessage)).toHaveCount(0);

    await sentCommentsToggle(userMessage).click();
    await expect(sentCommentCards(userMessage)).toHaveCount(1);
    await pressUntilCaretIn(page, { key: "ArrowDown", text: FIRST });
    await pressUntilCaretIn(page, { key: "ArrowUp", text: "why config?" });
    await pressUntilCaretIn(page, { key: "ArrowDown", text: FIRST });
    await expect(sentCommentCards(userMessage)).toHaveCount(1);
  } finally {
    await agent.cleanup();
  }
});

test("while a reply streams the caret and a selection keep their place, and Escape interrupts once the caret is hidden", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await turnOnOutputCaretSetting(page);
  // A short paragraph every 50 ms: past the chat's height in seconds, and streaming for minutes,
  // so an Escape that doesn't interrupt leaves it running.
  const tail = Array.from({ length: 3000 }, (_, index) => `Line ${index}.`).join("\n\n");
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-stream-",
    featureValues: {
      mockStreamingAssistantResponse: `${RESPONSE}\n\n${tail}`,
      mockStreamingAssistantIntervalMs: 50,
    },
  });
  const streamedLine = (index: number) => page.getByText(`Line ${index}.`, { exact: true });
  /** Waits until the reply has streamed `lines` more than it has now. */
  const streamOn = async (lines: number) => {
    const texts = await page.getByText(/^Line \d+\.$/).allTextContents();
    const last = Math.max(...texts.map((text) => Number(text.slice(5, -1))));
    await expect(streamedLine(last + lines)).toBeAttached({ timeout: 30_000 });
  };
  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, PROMPT);
    await expect(streamedLine(0)).toBeVisible({ timeout: 30_000 });

    await test.step("a move up stops the chat following the output", async () => {
      await startCaretFromKeyboard(page);
      await page.keyboard.press("ArrowUp");
      await expect.poll(async () => (await caretSpot(page))?.rowKind).toBe("user_message");
      await expect(page.getByTestId("scroll-to-bottom-button")).toBeVisible();
      const { scrollTop } = await caretStep(page, null);
      await streamOn(20);
      expect((await readChat(page)).scrollTop).toBe(scrollTop);
    });

    await test.step("the caret keeps its place in the reply as it streams", async () => {
      await page.keyboard.press("ArrowDown");
      await pressTimes(page, "ArrowRight", 4);
      const before = await caretStep(page, null);
      expect(before.spot).toEqual({ text: FIRST, offset: 4, rowKind: "assistant_message" });
      await streamOn(40);
      const after = await readChat(page);
      expect(after.place).toEqual(before.place);
      expect(after.caret).toEqual(before.caret);
    });

    await test.step("Escape leaves a note, then hides the caret, which stays hidden as the reply streams", async () => {
      await pressTimes(page, "Shift+ArrowRight", 6);
      await page.keyboard.press("Enter");
      await expect(focusedNote(page)).toHaveCount(1);
      await page.keyboard.type("note");

      await page.keyboard.press("Escape");
      await expect(focusedNote(page)).toHaveCount(0);
      await expectCaret(page, true);

      await page.keyboard.press("Escape");
      await expectCaret(page, false);
      await streamOn(40);
      await expectCaret(page, false);
      await expect.poll(async () => (await readChat(page)).place).toBeNull();
    });

    await test.step("a triple-click's selection stays as the reply streams", async () => {
      // A triple-click selects the paragraph with its line break, ending past its text.
      await page.getByText(SECOND, { exact: true }).click({ clickCount: 3 });
      await expect.poll(() => selectedText(page)).toBe(`${SECOND}\n`);
      await streamOn(40);
      expect(await selectedText(page)).toBe(`${SECOND}\n`);

      // Collapsed to the selection's end, the next paragraph's start, as in a text field.
      await page.keyboard.press("ArrowRight");
      await expectCaret(page, true);
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: LAST, offset: 0, rowKind: "assistant_message" });
    });

    await test.step("Escape interrupts once the caret is hidden", async () => {
      await page.keyboard.press("Escape");
      await expectCaret(page, false);
      await page.keyboard.press("Escape");
      await agent.client.waitForAgentUpsert(
        agent.agentId,
        ({ status }) => status === "idle",
        10_000,
      );
    });
  } finally {
    await agent.cleanup();
  }
});

test("the composer and the latest reply hand the caret back and forth", async ({ page }) => {
  test.setTimeout(120_000);
  await turnOnOutputCaretSetting(page);
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-composer-",
    initialPrompt: PROMPT,
    featureValues: {
      mockAssistantResponse: withFiller(30),
      mockAssistantTrailingActivity: true,
    },
  });
  const lastFiller = "Filler paragraph 29.";
  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expect(page.locator('[data-row-kind="thought"]')).toBeAttached({ timeout: 30_000 });

    await test.step("the shortcut goes to the start of the latest reply and back", async () => {
      await composerLocator(page).click();
      await page.keyboard.press("Control+L");
      await expect(composerLocator(page)).not.toBeFocused();
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });
      await expect
        .poll(async () => lackingMargin([await readChat(page)], { above: 5, below: 5 }))
        .toEqual([]);

      await page.keyboard.press("Control+L");
      await expectComposerFocused(page);
      await expectCaret(page, false);

      await page.keyboard.press("Control+L");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });
      await expectCaret(page, true);
    });

    await test.step("down past the end focuses the composer at the very bottom", async () => {
      await expect(page.getByTestId("scroll-to-bottom-button")).toBeVisible();
      await walkCaret(page, { key: "ArrowDown", isDone: (step) => step.isComposerFocused });
      await expectChatAtBottom(page);
    });

    await test.step("up at the top of the draft enters the reply, and down comes back", async () => {
      await fillComposerDraft(page, "first line\nsecond line");
      await composerLocator(page).press(FIELD_START_KEY);
      await composerLocator(page).press("ArrowDown");
      await composerLocator(page).press("ArrowUp");
      await expectComposerFocused(page);
      await expect.poll(() => composerCursor(page)).toBe(0);
      await composerLocator(page).press("ArrowUp");

      await expect(composerLocator(page)).not.toBeFocused();
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: lastFiller, offset: lastFiller.length, rowKind: "assistant_message" });

      await page.keyboard.press("ArrowDown");
      await expectComposerFocused(page);
      await expect.poll(() => composerCursor(page)).toBe("first line\nsecond line".length);
      await expectComposerDraft(page, "first line\nsecond line");
    });

    await test.step("up while an IME composes at the top of the draft stays in the composer", async () => {
      await composerLocator(page).fill("");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", {
        text: "にほ",
        selectionStart: 0,
        selectionEnd: 0,
      });
      await expect.poll(() => composerCursor(page)).toBe(0);

      await page.keyboard.press("ArrowUp");

      await expectComposerFocused(page);
      await expectCaret(page, false);
      await expect.poll(async () => (await readChat(page)).place).toBeNull();
      await cdp.detach();
    });
  } finally {
    await agent.cleanup();
  }
});

test("the caret keeps the lines set in Settings from the chat's edges, fewer when they don't fit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-margin-",
    response: withFiller(25),
  });
  try {
    await test.step("five lines each side by default, down until the chat scrolls and back up", async () => {
      const lines = { above: 5, below: 5 };
      await startCaretFromKeyboard(page);
      const top = await caretStep(page, null);
      const down = await walkCaret(page, {
        key: "ArrowDown",
        isDone: (step) => step.scrollTop > top.scrollTop,
      });
      expect(lackingMargin(down, lines)).toEqual([]);

      const bottom = await caretStep(page, null);
      const up = await walkCaret(page, {
        key: "ArrowUp",
        isDone: (step) => step.spot?.rowKind === "user_message",
      });
      expect(lackingMargin(up, lines)).toEqual([]);
      expect(Math.min(...up.map((step) => step.scrollTop))).toBeLessThan(bottom.scrollTop);
    });

    await test.step("ten lines below once Settings asks for them", async () => {
      const lines = { above: 5, below: 10 };
      await setOutputCaretLines(page, { below: 10 });
      await startCaretFromKeyboard(page);
      const top = await caretStep(page, null);
      const down = await walkCaret(page, {
        key: "ArrowDown",
        isDone: (step) => step.scrollTop > top.scrollTop,
      });
      expect(lackingMargin(down, lines)).toEqual([]);
    });

    await test.step("in a short chat twenty lines each side shrink to fit", async () => {
      await page.setViewportSize({ width: 1280, height: 500 });
      await setOutputCaretLines(page, { above: 20, below: 20 });
      await startCaretFromKeyboard(page);
      const down = await walkCaret(page, {
        key: "ArrowDown",
        isDone: (step) => step.isComposerFocused,
      });
      expect(badSteps(down, "forward")).toEqual([]);
    });
  } finally {
    await agent.cleanup();
  }
});

test("the caret steps over a tool call and thinking while the mouse still selects them", async ({
  page,
}) => {
  await turnOnOutputCaretSetting(page);
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-tools-",
    initialPrompt: PROMPT,
    featureValues: { mockAssistantResponse: RESPONSE, mockAssistantTrailingActivity: true },
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await agent.client.sendAgentMessage(agent.agentId, "Next.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    const toolCall = page.locator('[data-row-kind="tool_call"]').first();
    await expect(toolCall).toBeVisible({ timeout: 30_000 });
    // Collapsed, a tool call shows no selectable text; its detail does.
    await toolCall.getByText("Shell", { exact: true }).click();
    await expect(toolCall.getByText("$", { exact: false })).toBeVisible();

    await clickAssistantText(page, LAST);
    await page.keyboard.press("ArrowDown");
    // The user's message sits to the right, so the column lands at its start.
    await expect
      .poll(() => caretSpot(page))
      .toEqual({ text: "Next.", offset: 0, rowKind: "user_message" });

    // The mock's trailing tool call runs the shell command `true`.
    expect(await dragAcrossToolCall(page)).toBe("true");
    await expect.poll(async () => (await caretSpot(page))?.rowKind).toBe("tool_call");
  } finally {
    await agent.cleanup();
  }
});

interface OutputChanges {
  /** Edits the browser tried in the output, by input type; each should have been cancelled. */
  edits: string[];
  /** Changes to the output's text and nodes. */
  mutations: string[];
  /** What each paste that reached the page carried. */
  pastes: string[];
}

/** Starts recording what reaches and changes the output, for `takeOutputChanges`. */
async function watchOutput(page: Page): Promise<void> {
  await page.locator("[data-output-caret-host]").evaluate((host) => {
    const changes: OutputChanges = { edits: [], mutations: [], pastes: [] };
    Object.assign(window, { __outputChanges: changes });
    new MutationObserver((records) => {
      for (const record of records)
        changes.mutations.push(`${record.type} in ${record.target.nodeName}`);
    }).observe(host, { childList: true, characterData: true, subtree: true });
    // On the document, after the output's own listeners have had their say.
    document.addEventListener("beforeinput", (event) => {
      const where = event.target instanceof Node && host.contains(event.target) ? "" : " elsewhere";
      const cancelled = event.defaultPrevented ? "" : " (not cancelled)";
      changes.edits.push(`${event.inputType}${where}${cancelled}`);
    });
    document.addEventListener("paste", (event) => {
      changes.pastes.push(event.clipboardData?.getData("text/plain") ?? "no text");
    });
  });
}

/** What reached and changed the output since the last take, once the page has drawn it. */
async function takeOutputChanges(page: Page): Promise<OutputChanges> {
  await nextFrames(page);
  return page.evaluate(() => {
    const { __outputChanges: changes } = window as unknown as { __outputChanges: OutputChanges };
    const taken = { ...changes };
    Object.assign(changes, { edits: [], mutations: [], pastes: [] });
    return taken;
  });
}

test("nothing typed, pasted, cut, undone or composed changes the output, and its links and buttons still work", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await turnOnOutputCaretSetting(page);
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-read-only-",
    response: [
      FIRST,
      "",
      "See [the docs](https://example.com/docs) now.",
      "",
      "```sh",
      "npm test",
      "```",
      "",
      LAST,
    ].join("\n"),
  });
  const clipboardText = () => page.evaluate(() => navigator.clipboard.readText());
  const focusOutput = () => page.locator("[data-output-caret-host]").focus();
  const cancelled = (...edits: string[]) => ({ edits, mutations: [], pastes: [] });
  try {
    await watchOutput(page);

    await test.step("keys that edit a field, with the caret in the text", async () => {
      await clickAssistantText(page, FIRST);
      await expectCaret(page, true);
      const keys = [
        { key: "x", edit: "insertText" },
        { key: "Backspace", edit: "deleteContentBackward" },
        { key: "Delete", edit: "deleteContentForward" },
        { key: "Enter", edit: "insertParagraph" },
        { key: WORD_DELETE_KEY, edit: "deleteWordBackward" },
        { key: "ControlOrMeta+B", edit: "formatBold" },
        { key: "ControlOrMeta+I", edit: "formatItalic" },
        { key: "ControlOrMeta+U", edit: "formatUnderline" },
      ];
      for (const { key, edit } of keys) {
        await page.keyboard.press(key);
        expect(await takeOutputChanges(page), key).toEqual(cancelled(edit));
      }
      await expect(pendingCards(page)).toHaveCount(0);
      await expectCaret(page, true);
    });

    await test.step("Backspace and Delete over a selection", async () => {
      for (const { key, edit } of [
        { key: "Backspace", edit: "deleteContentBackward" },
        { key: "Delete", edit: "deleteContentForward" },
      ]) {
        await selectAssistantText(page, { text: "config" });
        await focusOutput();
        await page.keyboard.press(key);
        expect(await takeOutputChanges(page), key).toEqual(cancelled(edit));
        expect(await selectedText(page)).toBe("config");
      }
      await expect(pendingCards(page)).toHaveCount(0);
    });

    // The browser keeps one undo history for the page: undo in the output would undo the composer.
    await test.step("undo after an edit in the composer", async () => {
      await fillComposerDraft(page, "Draft");
      await composerLocator(page).press("End");
      await page.keyboard.type(" kept");
      await expectComposerDraft(page, "Draft kept");
      await clickAssistantText(page, FIRST);
      await expectCaret(page, true);
      await takeOutputChanges(page);

      await page.keyboard.press("ControlOrMeta+Z");

      expect({
        changes: await takeOutputChanges(page),
        draft: await composerLocator(page).inputValue(),
      }).toEqual({ changes: cancelled("historyUndo elsewhere"), draft: "Draft kept" });
      await composerLocator(page).fill("");
    });

    await test.step("a paste with no selection, and a cut that copies", async () => {
      await page.evaluate(() => navigator.clipboard.writeText("PASTED"));
      await clickAssistantText(page, FIRST);
      await takeOutputChanges(page);
      await page.keyboard.press("ControlOrMeta+V");
      expect(await takeOutputChanges(page)).toEqual({
        edits: ["insertFromPaste"],
        mutations: [],
        pastes: ["PASTED"],
      });
      await expect(pendingCards(page)).toHaveCount(0);

      await selectAssistantText(page, { text: "config" });
      await focusOutput();
      await page.keyboard.press("ControlOrMeta+X");
      await expect.poll(clipboardText).toBe("config");
      expect(await takeOutputChanges(page)).toEqual(cancelled());
    });

    await test.step("an IME's composition goes after the composer's draft, not into the output", async () => {
      await fillComposerDraft(page, "Draft ");
      await composerLocator(page).press(FIELD_START_KEY);
      await clickAssistantText(page, FIRST);
      await expectCaret(page, true);
      await takeOutputChanges(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", {
        text: "にほ",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await cdp.send("Input.insertText", { text: "日本" });
      await cdp.detach();
      await expectComposerFocused(page);
      await expectComposerDraft(page, "Draft 日本");
      // Composed in the composer, where it is left to type.
      const composed = "insertCompositionText elsewhere (not cancelled)";
      expect(await takeOutputChanges(page)).toEqual(cancelled(composed, composed));
      await expect(page.locator("[data-output-caret-host]")).toHaveAttribute("inputmode", "none");
    });

    await test.step("a link opens and the code's copy button copies", async () => {
      const opened = context.waitForEvent(
        "request",
        (request) => request.isNavigationRequest() && request.url() === "https://example.com/docs",
      );
      const openedPage = context.waitForEvent("page");
      await page.getByText("the docs", { exact: true }).click();
      await opened;
      await (await openedPage).close();

      await page.getByText("npm test", { exact: true }).hover();
      await page.getByRole("button", { name: "Copy code" }).click();
      await expect.poll(clipboardText).toBe("npm test");
    });
  } finally {
    await agent.cleanup();
  }
});

/** Opens a second agent beside `left`'s, in a pane of its own on the right, each chat answered. */
async function openRightPane(page: Page, left: MockAgentWorkspace, reply: string): Promise<void> {
  const rightId = await createMockAgent(left, {
    title: "Right pane",
    initialPrompt: PROMPT,
    featureValues: { mockAssistantResponse: reply },
  });
  await left.client.waitForFinish(rightId, 30_000);
  await splitCurrentPanelRight(page);
  await page.getByRole("button", { name: "Right pane", exact: true }).click();
  await page.keyboard.press("Meta+Alt+Shift+ArrowRight");
  await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveCount(2);
  await expect(page.getByText(reply)).toBeVisible();
  await expect(assistantMessageText(page).filter({ hasText: FIRST })).toBeVisible();
}

// The app's Mac bindings under a Mac user agent; the text keys stay the host browser's own.
test.describe("macOS", () => {
  test.use({ userAgent: MAC_USER_AGENT });

  test.beforeEach(async ({ page }) => {
    await pinPlatform(page, "MacIntel");
  });

  test("⌘L jumps to the latest reply, and the browser's document keys go to the output's ends", async ({
    page,
  }) => {
    await turnOnOutputCaretSetting(page);
    const agent = await openAnsweredAgent(page, {
      repoPrefix: "output-caret-mac-",
      response: RESPONSE,
    });
    try {
      await composerLocator(page).click();
      await page.keyboard.press("Meta+L");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });

      await page.keyboard.press(FIELD_END_KEY);
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: LAST, offset: LAST.length, rowKind: "assistant_message" });
      await page.keyboard.press(FIELD_START_KEY);
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: PROMPT, offset: 0, rowKind: "user_message" });

      await page.keyboard.press("Meta+L");
      await expectComposerFocused(page);
      await openSettings(page);
      await expect(focusComposerHint(page, "⌘L")).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("in split panes the caret, ⌘L and the hand-off past the end stay in the focused pane", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await turnOnOutputCaretSetting(page);
    const left = await openAnsweredAgent(page, {
      repoPrefix: "output-caret-split-",
      response: RESPONSE,
    });
    const rightReply = "The right pane's reply.";
    try {
      await openRightPane(page, left, rightReply);
      const composers = page.getByRole("textbox", { name: "Message agent..." });

      await composers.nth(1).click();
      await page.keyboard.press("Meta+L");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: rightReply, offset: 0, rowKind: "assistant_message" });
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: rightReply, offset: 1, rowKind: "assistant_message" });
      await expectCaret(page, true);

      await page.keyboard.press("ArrowDown");
      await expect(composers.nth(1)).toBeFocused();

      await composers.nth(0).click();
      await page.keyboard.press("Meta+L");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: FIRST, offset: 0, rowKind: "assistant_message" });
      await pressUntilCaretIn(page, { key: "ArrowDown", text: LAST });
      await page.keyboard.press("ArrowDown");
      await expect(composers.nth(0)).toBeFocused();
    } finally {
      await left.cleanup();
    }
  });

  test("turning the setting on and off mid-session adds the caret to both panes and takes it all away", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const left = await openAnsweredAgent(page, {
      repoPrefix: "output-caret-toggle-",
      response: RESPONSE,
    });
    const caretSwitch = page.getByRole("switch", { name: "Keyboard caret in output" });
    const composers = page.getByRole("textbox", { name: "Message agent..." });
    const toggleCaret = async () => {
      await openSettings(page);
      await caretSwitch.click();
      await clickSettingsBackToWorkspace(page);
      await expect(composers).toHaveCount(2);
    };
    try {
      await openRightPane(page, left, "The right pane's reply.");
      const off = await readOutputHosts(page);
      const offHost = {
        attributes: NO_CARET_ATTRIBUTES,
        wrap: { overflowWrap: "normal", lineBreak: "auto" },
      };
      expect(off.hosts.map(({ attributes, wrap }) => ({ attributes, wrap }))).toEqual([
        offHost,
        offHost,
      ]);
      expect(off.caretStyleCount).toBe(0);

      // Only the focused pane's output takes the caret; the other gives back what it had.
      await toggleCaret();
      for (const [focused, other] of [
        [1, 0],
        [0, 1],
      ]) {
        await composers.nth(focused).click();
        await expect
          .poll(async () => {
            const { hosts, caretStyleCount } = await readOutputHosts(page);
            return {
              focused: hosts[focused]?.attributes,
              wrap: hosts[focused]?.wrap,
              other: hosts[other],
              caretStyleCount,
            };
          })
          .toEqual({
            focused: CARET_ATTRIBUTES,
            // Pinned to how the output laid out before it was editable.
            wrap: { overflowWrap: "normal", lineBreak: "auto" },
            other: off.hosts[other],
            caretStyleCount: 1,
          });
      }

      await toggleCaret();
      await expect.poll(() => readOutputHosts(page)).toEqual(off);
      for (const composer of [composers.nth(0), composers.nth(1)]) {
        await composer.click();
        await page.keyboard.press("Meta+L");
        await expect(composer).toBeFocused();
        await composer.fill("first line\nsecond line");
        await composer.press(FIELD_START_KEY);
        await composer.press("ArrowUp");
        await expect(composer).toBeFocused();
        await expectCaret(page, false);
        await leaveFocusedField(page);
        await page.keyboard.press("ArrowDown");
        await expectCaret(page, false);
        await expect.poll(async () => (await readChat(page)).place).toBeNull();
      }
    } finally {
      await left.cleanup();
    }
  });
});
