import { expect, test } from "../support/fixtures";
import {
  LINE_END_KEY,
  LINE_START_KEY,
  badSteps,
  caretSpot,
  caretStep,
  expectChatAtBottom,
  expectCaret,
  readChat,
  runsOf,
  startCaretFromKeyboard,
  turnOnOutputCaretSetting,
  walkCaret,
  type ChatRead,
} from "../support/helpers/output-caret";
import {
  assistantMessageText,
  clickAssistantText,
  openAnsweredAgent,
  scrollChatUpTo,
  sentUserMessage,
} from "../support/helpers/output-comments";
import { pinPlatform } from "../support/helpers/user-agent";

test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await pinPlatform(page, "Win32");
  await turnOnOutputCaretSetting(page);
});

const PROMPTS = ["Explain the parser.", "Next.", "And the last one."] as const;
const FIRST = "The parser reads the config file before anything else.";
const SECOND = "Then the parser checks each entry, and the parser retries.";
const REPLY_LINES = [
  FIRST,
  SECOND,
  ...Array.from({ length: 12 }, (_, index) => `Filler paragraph ${index}.`),
];
const REPLY = REPLY_LINES.join("\n\n");

const WRAPPING_ITEM =
  "Open the settings file and find the section that controls how the parser reads each entry, then write down the current values before changing anything in it, so that nothing is lost.";
const END_OF_SAMPLE = "End of sample.";
// A link is one stop: the browser's caret would bounce between its box and the line.
const INLINE_TEXTS = [
  "The ",
  "parser",
  " reads ",
  " with ",
  "readConfig()",
  " and ",
  "then",
  " stops.",
];
const MARKDOWN = [
  "Steps to follow:",
  "",
  `1. ${WRAPPING_ITEM}`,
  "2. Change the retry limit to three attempts.",
  "3. Run the checks.",
  "",
  "Parts of the parser:",
  "",
  "- Reader",
  "  - Opens the file",
  "- Checker",
  "",
  "The **parser** reads [the config](https://example.com/config) with `readConfig()` and *then* stops.",
  "",
  "These run in order:",
  "- first the reader",
  "- then the checker",
  "",
  "Run this:",
  "",
  "```sh",
  "npm test",
  "```",
  "",
  "| Name | Retries |",
  "| --- | --- |",
  "| reader | 3 |",
  "| checker | 1 |",
  "",
  END_OF_SAMPLE,
].join("\n");

// The first text of each line, walking down from the reply's first character.
const MARKDOWN_LINES = [
  "Steps to follow:",
  WRAPPING_ITEM,
  "Change the retry limit to three attempts.",
  "Run the checks.",
  "Parts of the parser:",
  "Reader",
  "Opens the file",
  "Checker",
  "The ",
  "These run in order:",
  "first the reader",
  "then the checker",
  "Run this:",
  "npm test",
  "Name",
  "reader",
  "checker",
  END_OF_SAMPLE,
];

test("the caret walks a long, partly rendered history up and down through every message, always in view", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(globalThis, {
      __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD: 1,
      __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS: 1,
    });
  });
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-history-",
    response: REPLY,
  });
  try {
    for (const prompt of PROMPTS.slice(1)) {
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await agent.client.waitForFinish(agent.agentId, 30_000);
    }
    await expect(page.getByText(PROMPTS[2])).toBeVisible();
    await expect(page.getByText(PROMPTS[0])).toHaveCount(0);

    await test.step("up from the latest reply past the rows the list hasn't rendered", async () => {
      await startCaretFromKeyboard(page);
      const up = await walkCaret(page, {
        key: "ArrowUp",
        isDone: (step) => step.spot?.text === PROMPTS[0],
      });
      expect(badSteps(up, "backward")).toEqual([]);
      expect(runsOf(up, (spot) => spot.rowKind)).toEqual([
        "user_message",
        "assistant_message",
        "user_message",
        "assistant_message",
        "user_message",
      ]);
      await expect(page.getByText(PROMPTS[0])).toBeInViewport();
    });

    await test.step("down to the composer", async () => {
      const down = await walkCaret(page, {
        key: "ArrowDown",
        isDone: (step) => step.isComposerFocused,
      });
      expect(badSteps(down, "forward")).toEqual([]);
      expect(runsOf(down, (spot) => spot.text)).toEqual([
        ...REPLY_LINES,
        PROMPTS[1],
        ...REPLY_LINES,
        PROMPTS[2],
        ...REPLY_LINES,
      ]);
    });

    await test.step("a move from a caret scrolled out of view goes to its own next line", async () => {
      await scrollChatUpTo(page, sentUserMessage(page, PROMPTS[0]));
      await assistantMessageText(page).filter({ hasText: FIRST }).first().scrollIntoViewIfNeeded();
      await clickAssistantText(page, FIRST);
      const clicked = await caretStep(page, null);
      await page.getByTestId("scroll-to-bottom-button").click();
      await expectChatAtBottom(page);
      await expectCaret(page, false);

      await page.keyboard.press("ArrowDown");

      await expect.poll(async () => (await caretSpot(page))?.text).toBe(SECOND);
      const moved = await readChat(page);
      const messageOf = (read: ChatRead) => read.place?.rowId.split(":")[0] ?? null;
      expect(messageOf(clicked)).not.toBeNull();
      expect(messageOf(moved)).toBe(messageOf(clicked));
      await expect
        .poll(async () => {
          const { caret, view } = await readChat(page);
          const isInView = caret !== null && caret.top >= view.top && caret.bottom <= view.bottom;
          return { caret, view, isInView };
        })
        .toMatchObject({ isInView: true });
    });
  } finally {
    await agent.cleanup();
  }
});

test("the caret moves only through the text of lists, formatting, code and a table", async ({
  page,
}) => {
  const agent = await openAnsweredAgent(page, {
    repoPrefix: "output-caret-markdown-",
    response: MARKDOWN,
  });
  try {
    const itemLines = await page.evaluate((item) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent !== item) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = Array.from(range.getClientRects(), (rect) => Math.round(rect.top));
        return new Set(tops).size;
      }
      throw new Error("The wrapping item did not render");
    }, WRAPPING_ITEM);
    expect(itemLines).toBeGreaterThan(1);

    await test.step("down through every line and back up", async () => {
      await startCaretFromKeyboard(page);
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: MARKDOWN_LINES[0], offset: 0, rowKind: "assistant_message" });
      const down = await walkCaret(page, {
        key: "ArrowDown",
        isDone: (step) => step.isComposerFocused,
      });
      expect(badSteps(down, "forward")).toEqual([]);
      expect(runsOf(down, (spot) => spot.text)).toEqual(MARKDOWN_LINES.slice(1));
      expect(down.filter((step) => step.spot?.text === WRAPPING_ITEM)).toHaveLength(itemLines);

      // From the composer the caret enters at the reply's end; the line start key puts it back in the
      // first column.
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press(LINE_START_KEY);
      const up = await walkCaret(page, {
        key: "ArrowUp",
        isDone: (step) => step.spot?.rowKind === "user_message",
      });
      expect(badSteps(up, "backward")).toEqual([]);
      // The web lays a table out column by column, and the browser's caret goes up the column it
      // enters from below: the last one.
      expect(runsOf(up, (spot) => spot.text)).toEqual([
        "1",
        "3",
        "Retries",
        "npm test",
        "Run this:",
        "then the checker",
        "first the reader",
        "These run in order:",
        "The ",
        "Checker",
        "Opens the file",
        "Reader",
        "Parts of the parser:",
        "Run the checks.",
        "Change the retry limit to three attempts.",
        WRAPPING_ITEM,
        "Steps to follow:",
        "Explain the parser.",
      ]);
      expect(up.filter((step) => step.spot?.text === WRAPPING_ITEM)).toHaveLength(itemLines);
    });

    await test.step("right through each piece of a formatted paragraph", async () => {
      await clickAssistantText(page, "readConfig()");
      await page.keyboard.press(LINE_START_KEY);
      const right = await walkCaret(page, {
        key: "ArrowRight",
        isDone: (step) => step.spot?.text === " stops." && step.spot.offset === 7,
      });
      expect(badSteps(right, "forward")).toEqual([]);
      expect(runsOf(right, (spot) => spot.text)).toEqual(INLINE_TEXTS);
      const lefts = right.map((step) => step.caret?.left);
      expect(new Set(lefts).size, "a press that left the drawn caret where it was").toBe(
        lefts.length,
      );
    });

    await test.step("sideways past the code block's copy button", async () => {
      await clickAssistantText(page, "npm test");
      await page.keyboard.press(LINE_END_KEY);
      await caretStep(page, null);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: "Name", offset: 0, rowKind: "assistant_message" });
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(() => caretSpot(page))
        .toEqual({ text: "npm test", offset: "npm test".length, rowKind: "assistant_message" });
    });
  } finally {
    await agent.cleanup();
  }
});
