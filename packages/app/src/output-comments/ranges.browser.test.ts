import { afterEach, describe, expect, it } from "vitest";
import type { QuoteAnchor } from "./fence";
import { rangesForQuote } from "./ranges.web";
import { mountMessage, paragraph } from "./test-transcript";

afterEach(() => {
  document.body.replaceChildren();
});

function anchor(quote: Pick<QuoteAnchor, "quote"> & Partial<QuoteAnchor>): QuoteAnchor {
  return { sourceItemId: "m1", startBlock: 0, endBlock: 0, occurrence: 0, isCode: false, ...quote };
}

function quoted(root: HTMLElement, target: QuoteAnchor): string[] {
  return rangesForQuote(root, target).map((range) => range.toString());
}

describe("rangesForQuote", () => {
  it("finds a quote that runs across list items", () => {
    const item = (text: string) =>
      `<div data-paseo-markdown-tag="li"><span data-paseo-markdown-ignore="true">•</span>${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="ul">${item("first item")}${item("second item")}</div>`,
    );
    expect(quoted(root, anchor({ quote: "item\n- second" }))).toEqual(["item•second"]);
  });

  it("finds a quote that runs across table cells", () => {
    const cell = (text: string) => `<div data-paseo-markdown-tag="td">${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="tr">${cell("left")}${cell("right")}</div>`,
    );
    expect(quoted(root, anchor({ quote: "left\nright" }))).toEqual(["leftright"]);
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
    expect(quoted(root, anchor({ quote: code, isCode: true }))).toEqual([code]);
  });

  it("finds a repeat that overlaps the one before it", () => {
    const root = mountMessage(paragraph("very very very"));
    const ranges = rangesForQuote(root, anchor({ quote: "very very", occurrence: 1 }));
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
    expect(quoted(root, anchor({ quote: "alpha\n\n* * *\n\ngamma", endBlock: 2 }))).toEqual([
      "alpha",
      "gamma",
    ]);
  });
});
