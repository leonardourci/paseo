import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { assistantMessageText, leaveFocusedField } from "../support/helpers/output-comments";
import {
  nextFrames,
  seedCaretAgent,
  turnOnOutputCaretSetting,
} from "../support/helpers/output-caret";

test.use({ viewport: { width: 1280, height: 1000 } });

const FIRST = "The parser reads the config file before anything else.";
const REPLY = [
  "# Parser notes",
  FIRST,
  "It reads **each entry**, checks it with `validate()`, and *retries* a failed read. See [the config docs](https://example.com/config) for the format, or this long link: https://example.com/a/very/long/path/that/does/not/break/on/its/own/because/it/has/no/spaces/at/all/anywhere.",
  "Averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongwordwithnospaces ends here.",
  "1. Open the settings file and find the section that controls how the parser reads each entry.\n2. Change the retry limit to three attempts.\n   - nested item\n   - another nested item",
  "> A quoted line that the parser prints when it gives up.",
  "```ts\nconst retries = 3;\nexport function read(path: string) {\n  return parse(path, { retries });\n}\n```",
  "| Name | Retries |\n| --- | --- |\n| reader | 3 |\n| checker | 1 |",
  "Trailing spaces   and    runs of spaces stay as they are.",
  ...Array.from({ length: 20 }, (_, index) => `Filler paragraph ${index} with some words to wrap.`),
].join("\n\n");

interface PixelDiff {
  /** Any difference at all. */
  exact: number;
  /** More than two shades in a channel: the floating button's shadow composites a shade off. */
  visible: number;
}

async function differingPixels(page: Page, left: Buffer, right: Buffer): Promise<PixelDiff> {
  return page.evaluate(
    async ([leftPng, rightPng]) => {
      async function pixels(png: string): Promise<ImageData> {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D canvas");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      }
      const [a, b] = await Promise.all([pixels(leftPng), pixels(rightPng)]);
      if (a.width !== b.width || a.height !== b.height) {
        return { exact: Number.POSITIVE_INFINITY, visible: Number.POSITIVE_INFINITY };
      }
      const diff = { exact: 0, visible: 0 };
      for (let index = 0; index < a.data.length; index += 4) {
        let most = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          most = Math.max(most, Math.abs(a.data[index + channel] - b.data[index + channel]));
        }
        if (most > 0) diff.exact += 1;
        if (most > 2) diff.visible += 1;
      }
      return diff;
    },
    [left.toString("base64"), right.toString("base64")],
  );
}

/**
 * Shoots the chat scrolled to an end, again until it stayed there through the shot: after a load it
 * follows the output for a while, and may scroll away between a check and the shot.
 */
async function shootChat(page: Page, scrollTo: "top" | "bottom"): Promise<Buffer> {
  const scroller = page.getByTestId("agent-chat-scroll");
  const readScroll = () =>
    scroller.evaluate((element, where) => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const end = where === "top" ? 0 : scrollHeight - clientHeight;
      return { scrollTop, scrollHeight, isAtEnd: Math.abs(scrollTop - end) <= 1 };
    }, scrollTo);
  await page.mouse.move(0, 0);
  const taken: { shot?: Buffer } = {};
  await expect(async () => {
    await scroller.evaluate((element, where) => {
      element.scrollTop = where === "top" ? 0 : element.scrollHeight;
    }, scrollTo);
    await nextFrames(page);
    const before = await readScroll();
    taken.shot = await scroller.screenshot({ animations: "disabled" });
    expect(await readScroll()).toEqual({ ...before, isAtEnd: true });
  }).toPass({ timeout: 10_000 });
  if (!taken.shot) throw new Error("The chat was not shot");
  return taken.shot;
}

test("turning the caret on, and focusing the output, changes no pixel of the chat", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const agent = await seedCaretAgent({
    repoPrefix: "output-caret-visual-",
    initialPrompt: "Explain the parser.",
    featureValues: { mockAssistantResponse: REPLY, mockAssistantTrailingActivity: true },
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expect(assistantMessageText(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-row-kind="tool_call"]').first()).toBeAttached();
    const offShots = [await shootChat(page, "top"), await shootChat(page, "bottom")];
    await expect(page.locator("[data-output-caret-host]")).toHaveCount(0);

    await turnOnOutputCaretSetting(page);
    await page.reload();
    await expect(assistantMessageText(page).first()).toBeVisible({ timeout: 30_000 });
    const host = page.locator("[data-output-caret-host]");
    await expect(host).toHaveCount(1);
    // The light theme's foreground, #1a1a1e.
    expect(await host.evaluate((element) => getComputedStyle(element).caretColor)).toBe(
      "rgb(26, 26, 30)",
    );
    // The output focused by a key, as the app's focus ring would show. The shot hides the caret,
    // which alone may show: whatever else focus or editing draws would show.
    await leaveFocusedField(page);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-output-caret-host]:focus-visible")).toHaveCount(1);
    const onShots = [await shootChat(page, "top"), await shootChat(page, "bottom")];

    const differing = [
      await differingPixels(page, offShots[0], onShots[0]),
      await differingPixels(page, offShots[1], onShots[1]),
    ];
    expect(
      differing.map((diff) => diff.visible),
      JSON.stringify(differing),
    ).toEqual([0, 0]);
  } finally {
    await agent.cleanup();
  }
});
