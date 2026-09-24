import { afterEach, describe, expect, it } from "vitest";
import { readCommentableSelection } from "./selection.web";
import { mountMessage, mountTranscript, paragraph } from "./test-transcript";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function mountHeading(html: string): { root: HTMLElement; heading: HTMLElement } {
  const root = mountMessage(`<div data-paseo-markdown-tag="h2">${html}</div>`);
  const heading = root.querySelector<HTMLElement>('[data-paseo-markdown-tag="h2"]');
  if (!heading) throw new Error("Expected heading fixture");
  return { root, heading };
}

function textOf(node: Node | null | undefined): Text {
  if (!(node instanceof Text)) throw new Error("Expected a text node");
  return node;
}

function select(start: [Node, number], end: [Node, number]): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected a selection");
  selection.setBaseAndExtent(start[0], start[1], end[0], end[1]);
  return selection;
}

describe("readCommentableSelection occurrence", () => {
  const HEADING = "Merge on the same quote, merge again";

  it("counts case-sensitive repeats of the quote up to where the selection starts", () => {
    const { root, heading } = mountHeading(HEADING);
    const text = textOf(heading.firstChild);
    const same = HEADING.indexOf("same") + 2;
    expect(readCommentableSelection(select([text, same], [text, same + 1]), root)).toMatchObject({
      quote: "m",
      occurrence: 0,
    });
    const merge = HEADING.lastIndexOf("merge");
    expect(readCommentableSelection(select([text, merge], [text, merge + 1]), root)).toMatchObject({
      quote: "m",
      occurrence: 1,
    });
  });

  it("counts a repeat that overlaps the one before it", () => {
    const { root, heading } = mountHeading("very very very");
    const text = textOf(heading.firstChild);
    expect(readCommentableSelection(select([text, 5], [text, 14]), root)).toMatchObject({
      quote: "very very",
      occurrence: 1,
    });
  });

  it("finds the repeat when the selection starts on the edge of bold text", () => {
    const { root, heading } = mountHeading(
      "Merge on the <strong>same</strong> quote, the <strong>same</strong> again",
    );
    const second = heading.querySelectorAll("strong")[1];
    const before = textOf(second?.previousSibling);
    const bold = textOf(second?.firstChild);
    const selection = select([before, before.length], [bold, 4]);
    expect(readCommentableSelection(selection, root)).toMatchObject({ occurrence: 1 });
  });
});

function paragraphTexts(root: HTMLElement): Text[] {
  return Array.from(root.querySelectorAll('[data-paseo-markdown-tag="p"]'), (element) =>
    textOf(element.firstChild),
  );
}

describe("readCommentableSelection across rows", () => {
  it("keeps a triple-clicked paragraph to its own block", () => {
    const root = mountMessage(paragraph("alpha beta"), paragraph("gamma"));
    const [first, next] = paragraphTexts(root);
    if (!first || !next) throw new Error("Expected two paragraphs");
    expect(readCommentableSelection(select([first, 0], [next, 0]), root)).toMatchObject({
      startBlock: 0,
      endBlock: 0,
      quote: "alpha beta",
    });
  });

  it("refuses a selection that runs into another message's text", () => {
    const root = mountTranscript(["m1", paragraph("alpha beta")], ["m2", paragraph("gamma")]);
    const [first, other] = paragraphTexts(root);
    if (!first || !other) throw new Error("Expected two paragraphs");
    expect(readCommentableSelection(select([first, 0], [other, 2]), root)).toBeNull();
  });
});

describe("readCommentableSelection in code", () => {
  it("quotes the code as written and marks it as code", () => {
    const root = mountMessage(
      '<div data-paseo-markdown-tag="pre"><span data-paseo-markdown-tag="code">x = 1\n# comment\ny = 2</span></div>',
    );
    const code = textOf(root.querySelector('[data-paseo-markdown-tag="code"]')?.firstChild);
    expect(readCommentableSelection(select([code, 0], [code, 15]), root)).toMatchObject({
      quote: "x = 1\n# comment",
      isCode: true,
    });
  });
});

function listItem(text: string, nestedList = ""): string {
  return `<div data-paseo-markdown-tag="li"><span data-paseo-markdown-ignore="true">•</span><div>${paragraph(text)}${nestedList}</div></div>`;
}

function list(tag: "ul" | "ol", ...items: string[]): string {
  return `<div data-paseo-markdown-tag="${tag}">${items.join("")}</div>`;
}

function textOfParagraph(root: HTMLElement, text: string): Text {
  const found = paragraphTexts(root).find((node) => node.data === text);
  if (!found) throw new Error(`Expected a paragraph reading "${text}"`);
  return found;
}

describe("readCommentableSelection list item", () => {
  const NESTED = list(
    "ul",
    listItem("alpha"),
    listItem("beta", list("ul", listItem("beta one"), listItem("beta two"))),
    listItem("gamma"),
  );

  it.each([
    {
      name: "records the top-level item the selection ends in",
      html: NESTED,
      start: ["alpha", 0] as const,
      end: ["beta", 4] as const,
      read: { quote: "alpha\n\nbeta", endBlock: 0, endItem: [1] },
    },
    {
      name: "records a nested item by its path",
      html: NESTED,
      start: ["beta two", 0] as const,
      end: ["beta two", 8] as const,
      read: { quote: "beta two", endBlock: 0, endItem: [1, 1] },
    },
    {
      name: "puts an end at the start of the next item in the item before, as a triple-click does",
      html: NESTED,
      start: ["beta", 0] as const,
      end: ["beta one", 0] as const,
      read: { quote: "beta", endBlock: 0, endItem: [1] },
    },
    {
      name: "counts on into an ordered list that follows a bullet list in the same block",
      html: list("ul", listItem("alpha"), listItem("beta")) + list("ol", listItem("gamma")),
      start: ["gamma", 0] as const,
      end: ["gamma", 5] as const,
      read: { quote: "gamma", endBlock: 0, endItem: [2] },
    },
    {
      name: "records no item inside a blockquote",
      html: `<div data-paseo-markdown-tag="blockquote">${list("ul", listItem("quoted"))}</div>`,
      start: ["quoted", 0] as const,
      end: ["quoted", 6] as const,
      read: { quote: "quoted", endBlock: 0, endItem: undefined },
    },
  ])("$name", ({ html, start, end, read }) => {
    const root = mountMessage(html);
    const selection = select(
      [textOfParagraph(root, start[0]), start[1]],
      [textOfParagraph(root, end[0]), end[1]],
    );
    expect(readCommentableSelection(selection, root)).toMatchObject(read);
  });

  it.each([
    ["a paragraph", paragraph("plain text"), '[data-paseo-markdown-tag="p"]'],
    [
      "a table cell",
      '<div data-paseo-markdown-tag="table"><div data-paseo-markdown-tag="tbody"><div data-paseo-markdown-tag="tr"><div data-paseo-markdown-tag="td">plain text</div></div></div></div>',
      '[data-paseo-markdown-tag="td"]',
    ],
    [
      "a code block",
      '<div data-paseo-markdown-tag="pre"><span data-paseo-markdown-tag="code">plain text</span></div>',
      '[data-paseo-markdown-tag="code"]',
    ],
  ])("records no item when the selection ends in %s", (_, html, textSelector) => {
    const root = mountMessage(html);
    const text = textOf(root.querySelector(textSelector)?.firstChild);
    expect(readCommentableSelection(select([text, 0], [text, 5]), root)).toMatchObject({
      quote: "plain",
      endItem: undefined,
    });
  });
});
