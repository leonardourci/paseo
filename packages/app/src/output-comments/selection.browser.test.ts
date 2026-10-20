import { afterEach, describe, expect, it } from "vitest";
import { rangeForQuote } from "./ranges.web";
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
    expect(readCommentableSelection({ selection, root })).toMatchObject({
      occurrence: 1,
    });
  });
});

function paragraphTexts(root: HTMLElement): Text[] {
  return Array.from(root.querySelectorAll("p"), (element) => textOf(element.firstChild));
}

describe("readCommentableSelection across rows", () => {
  it("keeps a triple-clicked paragraph to its own text", () => {
    const root = mountMessage(paragraph("alpha beta"), paragraph("gamma"));
    const [first, next] = paragraphTexts(root);
    if (!first || !next) throw new Error("Expected two paragraphs");
    expect(
      readCommentableSelection({
        selection: select([first, 0], [next, 0]),
        root,
      }),
    ).toMatchObject({ quote: "alpha beta", suffix: "gamma" });
  });

  it("counts repeats across the whole reply, with the text around the one selected", () => {
    const root = mountMessage(paragraph("retry now"), paragraph("then retry later"));
    const [, second] = paragraphTexts(root);
    if (!second) throw new Error("Expected two paragraphs");
    expect(
      readCommentableSelection({ selection: select([second, 5], [second, 10]), root }),
    ).toMatchObject({ quote: "retry", occurrence: 1, prefix: "retry now then", suffix: "later" });
  });

  it("quotes across paragraphs of the reply", () => {
    const root = mountMessage(paragraph("alpha"), paragraph("beta"), paragraph("gamma"));
    const [first, , third] = paragraphTexts(root);
    if (!first || !third) throw new Error("Expected three paragraphs");
    // A copy across paragraphs reads them from the chat they are in.
    root.dataset.testid = "agent-chat-scroll";
    expect(
      readCommentableSelection({ selection: select([first, 2], [third, 3]), root }),
    ).toMatchObject({ quote: "pha\n\nbeta\n\ngam", occurrence: 0 });
  });

  it("takes a selection in a reply still streaming in, whose quote paints once it is done", () => {
    const root = mountMessage(paragraph("alpha beta"));
    const reply = root.querySelector<HTMLElement>('[data-testid="assistant-message"]')!;
    reply.dataset.messageStreaming = "true";
    const [first] = paragraphTexts(root);
    if (!first) throw new Error("Expected a paragraph");
    const read = readCommentableSelection({ selection: select([first, 0], [first, 5]), root });
    expect(read).toMatchObject({ quote: "alpha", suffix: "beta" });
    if (!read) throw new Error("Expected a commentable selection");
    expect(rangeForQuote({ root, anchor: read })).toBeNull();
    delete reply.dataset.messageStreaming;
    expect(String(rangeForQuote({ root, anchor: read }))).toBe("alpha");
  });

  it("refuses a selection that runs into another message's text", () => {
    const root = mountTranscript(["m1", paragraph("alpha beta")], ["m2", paragraph("gamma")]);
    const [first, other] = paragraphTexts(root);
    if (!first || !other) throw new Error("Expected two paragraphs");
    expect(
      readCommentableSelection({
        selection: select([first, 0], [other, 2]),
        root,
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
      }),
    ).toMatchObject({
      quote: "x = 1\n# comment",
      isCode: true,
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
    const read = readCommentableSelection({ selection, root });
    expect(read).toMatchObject({
      // Copying part of a semantic list keeps the items, not their numbers.
      quote: "`currency-pt-br` worktree: 21 files. It is not in 1.15.0.\n\n`analytics` and",
    });
    if (!read) throw new Error("Expected a commentable selection");
    expect(String(rangeForQuote({ root, anchor: read }))).toBe(String(selection.getRangeAt(0)));
  });
});
