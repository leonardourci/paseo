import { afterEach, describe, expect, it } from "vitest";
import type { QuoteAnchor } from "./fence";
import { rangesForQuote } from "./ranges.web";
import { inlineCode, mountMessage, paragraph, renderedList } from "./test-transcript";

afterEach(() => {
  document.body.replaceChildren();
});

function anchor(quote: Pick<QuoteAnchor, "quote"> & Partial<QuoteAnchor>): QuoteAnchor {
  return { sourceItemId: "m1", startBlock: 0, endBlock: 0, occurrence: 0, isCode: false, ...quote };
}

interface QuotedInput {
  root: HTMLElement;
  anchor: QuoteAnchor;
  blocks?: string[];
}

function quoted({ blocks = [], ...input }: QuotedInput): string[] {
  return rangesForQuote({ ...input, blocks }).map((range) => range.toString());
}

describe("rangesForQuote", () => {
  it("finds a quote that runs across list items", () => {
    const item = (text: string) =>
      `<div data-paseo-markdown-tag="li"><span data-paseo-markdown-ignore="true">•</span>${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="ul">${item("first item")}${item("second item")}</div>`,
    );
    expect(quoted({ root, anchor: anchor({ quote: "item\n- second" }) })).toEqual(["item•second"]);
  });

  it("finds a quote that runs from inside one ordered list item into the next", () => {
    const root = mountMessage(
      renderedList(
        "ol",
        `${inlineCode("currency-pt-br")}<span> worktree: 21 files.</span>`,
        `${inlineCode("analytics")}<span> and more</span>`,
      ),
    );
    const quote = "`currency-pt-br` worktree: 21 files.\n\n2. `analytics` and";
    expect(quoted({ root, anchor: anchor({ quote }) })).toEqual([
      "currency-pt-br worktree: 21 files.2.analytics and",
    ]);
  });

  it("keeps the blocks a row holds together when the quote runs on into the next row", () => {
    const root = mountMessage(
      paragraph("Ready, in draft.") + renderedList("ul", "Tokenize the source"),
      paragraph("Run this:"),
    );
    const quote = "in draft.\n\n- Tokenize the source\n\nRun";
    expect(quoted({ root, anchor: anchor({ quote, endBlock: 1 }) })).toEqual([
      "in draft.•Tokenize the source",
      "Run",
    ]);
  });

  it("groups the quote's rows as when all are rendered, while a later one is not", () => {
    const quote = "Start.\n\nReady.\n\n- one";
    const blocks = ["Start.", "Ready.\n- one"];
    const target = anchor({ quote, endBlock: 1 });
    const allRendered = mountMessage(
      paragraph("Start."),
      paragraph("Ready.") + renderedList("ul", "one"),
    );
    expect(quoted({ root: allRendered, anchor: target, blocks })).toEqual(["Start.", "Ready.•one"]);
    document.body.replaceChildren();

    const firstRendered = mountMessage(paragraph("Start."));
    expect(quoted({ root: firstRendered, anchor: target, blocks })).toEqual(["Start."]);
  });

  it("finds a quote that runs across table cells", () => {
    const cell = (text: string) => `<div data-paseo-markdown-tag="td">${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="tr">${cell("left")}${cell("right")}</div>`,
    );
    expect(quoted({ root, anchor: anchor({ quote: "left\nright" }) })).toEqual(["leftright"]);
  });

  it("finds part of a code block as written", () => {
    const code = "x = 1\n# comment\ny = 2\n\nz = 3";
    const lines = code
      .split("\n")
      .map((line) => `<span>${line}</span>`)
      .join("<span>\n</span>");
    const root = mountMessage(
      `<div data-paseo-markdown-tag="pre"><span data-paseo-markdown-tag="code">${lines}</span></div>`,
    );
    expect(quoted({ root, anchor: anchor({ quote: code, isCode: true }) })).toEqual([code]);
  });

  it("finds a repeat that overlaps the one before it", () => {
    const root = mountMessage(paragraph("very very very"));
    const ranges = rangesForQuote({
      root,
      anchor: anchor({ quote: "very very", occurrence: 1 }),
      blocks: [],
    });
    expect(ranges.map((range) => [range.startOffset, range.toString()])).toEqual([
      [5, "very very"],
    ]);
  });

  it("keeps each piece on its own block past a block with no text", () => {
    const root = mountMessage(
      paragraph("alpha"),
      '<div data-paseo-markdown-tag="hr"></div>',
      paragraph("gamma"),
    );
    expect(
      quoted({ root, anchor: anchor({ quote: "alpha\n\n* * *\n\ngamma", endBlock: 2 }) }),
    ).toEqual(["alpha", "gamma"]);
  });
});
