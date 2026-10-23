import { afterEach, describe, expect, it } from "vitest";
import type { QuoteAnchor } from "./fence";
import { rangeForQuote } from "./ranges.web";
import { inlineCode, mountMessage, paragraph, renderedList } from "./test-transcript";

afterEach(() => {
  document.body.replaceChildren();
});

function anchor(quote: Pick<QuoteAnchor, "quote"> & Partial<QuoteAnchor>): QuoteAnchor {
  return { sourceItemId: "m1", occurrence: 0, isCode: false, ...quote };
}

function quoted(root: HTMLElement, target: QuoteAnchor): string | null {
  return rangeForQuote({ root, anchor: target })?.toString() ?? null;
}

describe("rangeForQuote", () => {
  it("finds a quote that runs across list items", () => {
    const item = (text: string) =>
      `<div data-paseo-markdown-tag="li"><span data-paseo-markdown-ignore="true">•</span>${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="ul">${item("first item")}${item("second item")}</div>`,
    );
    expect(quoted(root, anchor({ quote: "item\n- second" }))).toBe("item•second");
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
    expect(quoted(root, anchor({ quote }))).toBe("currency-pt-br worktree: 21 files.analytics and");
  });

  it("finds a quote across paragraphs and lists as one range", () => {
    const root = mountMessage(
      paragraph("Ready, in draft."),
      renderedList("ul", "Tokenize the source"),
      paragraph("Run this:"),
    );
    const quote = "in draft.\n\n- Tokenize the source\n\nRun";
    expect(quoted(root, anchor({ quote }))).toBe("in draft.Tokenize the sourceRun");
  });

  it("finds a quote across a block with no text", () => {
    const root = mountMessage(
      paragraph("alpha"),
      '<div data-paseo-markdown-tag="hr"></div>',
      paragraph("gamma"),
    );
    expect(quoted(root, anchor({ quote: "alpha\n\n* * *\n\ngamma" }))).toBe("alphagamma");
  });

  it("finds a quote that runs across table cells", () => {
    const cell = (text: string) => `<div data-paseo-markdown-tag="td">${text}</div>`;
    const root = mountMessage(
      `<div data-paseo-markdown-tag="tr">${cell("left")}${cell("right")}</div>`,
    );
    expect(quoted(root, anchor({ quote: "left\nright" }))).toBe("leftright");
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
    expect(quoted(root, anchor({ quote: code, isCode: true }))).toBe(code);
  });

  it("finds a repeat that overlaps the one before it", () => {
    const root = mountMessage(paragraph("very very very"));
    const range = rangeForQuote({ root, anchor: anchor({ quote: "very very", occurrence: 1 }) });
    expect(range && [range.startOffset, range.toString()]).toEqual([5, "very very"]);
  });

  it("finds a quote that starts on an emoji", () => {
    const root = mountMessage(paragraph("Shipped 🎉 party 🎉 party"));
    const range = rangeForQuote({ root, anchor: anchor({ quote: "🎉 party", occurrence: 1 }) });
    expect(range && [range.startOffset, range.toString()]).toEqual([17, "🎉 party"]);
  });

  it("counts repeats across the whole reply", () => {
    const root = mountMessage(paragraph("retry now"), paragraph("retry later"));
    const range = rangeForQuote({ root, anchor: anchor({ quote: "retry", occurrence: 1 }) });
    expect(range?.startContainer.parentElement?.textContent).toBe("retry later");
  });

  it("follows the comment's context to its repeat", () => {
    const root = mountMessage(paragraph("retry now"), paragraph("then retry later"));
    const range = rangeForQuote({
      root,
      anchor: anchor({ quote: "retry", occurrence: 0, prefix: "now then", suffix: "later" }),
    });
    expect(range?.startContainer.parentElement?.textContent).toBe("then retry later");
  });

  it("finds nothing for a quote the reply lost, nor in a reply still streaming", () => {
    const root = mountMessage(paragraph("retry now"));
    expect(quoted(root, anchor({ quote: "gone" }))).toBeNull();
    expect(quoted(root, anchor({ quote: "retry", occurrence: 1 }))).toBeNull();
    root.querySelector<HTMLElement>('[data-testid="assistant-message"]')!.dataset.messageStreaming =
      "true";
    expect(quoted(root, anchor({ quote: "retry" }))).toBeNull();
  });
});
