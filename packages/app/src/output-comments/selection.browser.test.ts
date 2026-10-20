import { afterEach, describe, expect, it } from "vitest";
import { rangesForQuote } from "./ranges.web";
import { readCommentableSelection } from "./selection.web";
import {
  inlineCode,
  mountMessage,
  mountTranscript,
  paragraph,
  renderedList,
} from "./test-transcript";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function noBlocks(): readonly string[] {
  return [];
}

function mountHeading(html: string): { root: HTMLElement; heading: HTMLElement } {
  const root = mountMessage(`<h2>${html}</h2>`);
  const heading = root.querySelector<HTMLElement>("h2");
  if (!heading) throw new Error("Expected heading fixture");
  return { root, heading };
}

function textOf(node: Node | null | undefined): Text {
  if (!(node instanceof Text)) throw new Error("Expected a text node");
  return node;
}

function textReading(root: HTMLElement, data: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.data === data) return node;
  }
  throw new Error(`Expected a text node reading "${data}"`);
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
    expect(
      readCommentableSelection({
        selection: select([text, same], [text, same + 1]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
      quote: "m",
      occurrence: 0,
    });
    const merge = HEADING.lastIndexOf("merge");
    expect(
      readCommentableSelection({
        selection: select([text, merge], [text, merge + 1]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
      quote: "m",
      occurrence: 1,
    });
  });

  it("counts a repeat that overlaps the one before it", () => {
    const { root, heading } = mountHeading("very very very");
    const text = textOf(heading.firstChild);
    expect(
      readCommentableSelection({
        selection: select([text, 5], [text, 14]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
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
    expect(readCommentableSelection({ selection, root, blocksOf: noBlocks })).toMatchObject({
      occurrence: 1,
    });
  });
});

function paragraphTexts(root: HTMLElement): Text[] {
  return Array.from(root.querySelectorAll("p"), (element) => textOf(element.firstChild));
}

describe("readCommentableSelection across rows", () => {
  it("keeps a triple-clicked paragraph to its own block", () => {
    const root = mountMessage(paragraph("alpha beta"), paragraph("gamma"));
    const [first, next] = paragraphTexts(root);
    if (!first || !next) throw new Error("Expected two paragraphs");
    expect(
      readCommentableSelection({
        selection: select([first, 0], [next, 0]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
      startBlock: 0,
      endBlock: 0,
      quote: "alpha beta",
    });
  });

  it("groups a quote's pieces by the Markdown of a row that isn't rendered", () => {
    const root = mountMessage(
      ["alpha", "alpha", "beta", "gamma"].map(paragraph).join(""),
      paragraph("unrendered"),
      paragraph("delta"),
    );
    // A copy across rows reads them from the chat they are in.
    root.dataset.testid = "agent-chat-scroll";
    root.querySelector('[data-output-block="1"]')?.remove();
    const [, second, , , delta] = paragraphTexts(root);
    if (!second || !delta) throw new Error("Expected the rendered paragraphs");
    const selection = select([second, 0], [delta, 5]);
    // Block 1 holds "beta gamma", leaving the first row only "alpha": its second one.
    const blocks = ["alpha", "Then beta gamma.", "delta"];
    expect(readCommentableSelection({ selection, root, blocksOf: () => blocks })).toMatchObject({
      quote: "alpha\n\nbeta\n\ngamma\n\ndelta",
      startBlock: 0,
      endBlock: 2,
      occurrence: 1,
    });
    // Without it the first row keeps "alpha beta", which only the second "alpha" starts.
    expect(readCommentableSelection({ selection, root, blocksOf: noBlocks })).toMatchObject({
      occurrence: 0,
    });
  });

  it("refuses a selection that runs into another message's text", () => {
    const root = mountTranscript(["m1", paragraph("alpha beta")], ["m2", paragraph("gamma")]);
    const [first, other] = paragraphTexts(root);
    if (!first || !other) throw new Error("Expected two paragraphs");
    expect(
      readCommentableSelection({
        selection: select([first, 0], [other, 2]),
        root,
        blocksOf: noBlocks,
      }),
    ).toBeNull();
  });
});

describe("readCommentableSelection in code", () => {
  it("quotes the code as written and marks it as code", () => {
    const root = mountMessage("<pre><code>x = 1\n# comment\ny = 2</code></pre>");
    const code = textOf(root.querySelector("code")?.firstChild);
    expect(
      readCommentableSelection({
        selection: select([code, 0], [code, 15]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
      quote: "x = 1\n# comment",
      isCode: true,
    });
  });
});

function listItem(text: string, nestedList = ""): string {
  return `<li>${paragraph(text)}${nestedList}</li>`;
}

function list(tag: "ul" | "ol", ...items: string[]): string {
  return `<${tag}>${items.join("")}</${tag}>`;
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
      name: "reads a nested list continued after a card as the source numbers it",
      html: `${list("ul", listItem("alpha", list("ul", listItem("alpha one"))))}<div data-output-item-parent="0" data-output-item-start="1">${list("ul", listItem("alpha two"))}</div>${list("ul", listItem("beta"))}`,
      start: ["alpha two", 0] as const,
      end: ["alpha two", 9] as const,
      read: { quote: "alpha two", endBlock: 0, endItem: [0, 1] },
    },
    {
      name: "counts top-level items past a continued nested list",
      html: `${list("ul", listItem("alpha", list("ul", listItem("alpha one"))))}<div data-output-item-parent="0" data-output-item-start="1">${list("ul", listItem("alpha two"))}</div>${list("ul", listItem("beta"))}`,
      start: ["beta", 0] as const,
      end: ["beta", 4] as const,
      read: { quote: "beta", endBlock: 0, endItem: [1] },
    },
    {
      name: "records no item inside a blockquote",
      html: `<blockquote>${list("ul", listItem("quoted"))}</blockquote>`,
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
    expect(readCommentableSelection({ selection, root, blocksOf: noBlocks })).toMatchObject(read);
  });

  it.each([
    ["a paragraph", paragraph("plain text"), "p"],
    ["a table cell", "<table><tbody><tr><td>plain text</td></tr></tbody></table>", "td"],
    ["a code block", "<pre><code>plain text</code></pre>", "code"],
  ])("records no item when the selection ends in %s", (_, html, textSelector) => {
    const root = mountMessage(html);
    const text = textOf(root.querySelector(textSelector)?.firstChild);
    expect(
      readCommentableSelection({
        selection: select([text, 0], [text, 5]),
        root,
        blocksOf: noBlocks,
      }),
    ).toMatchObject({
      quote: "plain",
      endItem: undefined,
    });
  });
});

describe("readCommentableSelection across ordered list items", () => {
  it("quotes from inside one item into the next, and the quote paints all of it", () => {
    const root = mountMessage(
      renderedList(
        "ol",
        `${inlineCode("currency-pt-br")}<span> worktree: 21 files. It is not in 1.15.0.</span>`,
        `${inlineCode("analytics")}<span> and </span>${inlineCode("installments")}<span> worktrees.</span>`,
      ),
    );
    const itemStart = textReading(root, "currency-pt-br");
    const and = textReading(root, " and ");
    const selection = select([itemStart, 0], [and, 4]);
    const read = readCommentableSelection({ selection, root, blocksOf: noBlocks });
    expect(read).toMatchObject({
      // Copying part of a semantic list keeps the items, not their numbers.
      quote: "`currency-pt-br` worktree: 21 files. It is not in 1.15.0.\n\n`analytics` and",
      endBlock: 0,
      endItem: [1],
    });
    if (!read) throw new Error("Expected a commentable selection");
    expect(rangesForQuote({ root, anchor: read, blocks: [] }).map(String)).toEqual([
      String(selection.getRangeAt(0)),
    ]);
  });
});
