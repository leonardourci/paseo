import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { withOutputComments, type OutputComment, type QuoteAnchor } from "./fence";
import {
  findMovedCommentSource,
  listItemPaths,
  quoteEndNode,
  quotePlainText,
  quoteSnippet,
  readTopLevelNodes,
  resolveDeliveredOutputComments,
} from "./match";

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

type TurnComment = Pick<OutputComment, "quote"> & Partial<OutputComment>;

function commentTurn(id: string, comment: TurnComment): StreamItem {
  return {
    kind: "user_message",
    id,
    text: withOutputComments("", [
      { note: "n", startBlock: 0, occurrence: 0, isCode: false, ...comment },
    ]),
    timestamp: new Date(0),
  };
}

function locate(messageText: string, comment: TurnComment) {
  const delivered = resolveDeliveredOutputComments([
    assistant("a1", messageText),
    commentTurn("u1", comment),
  ]);
  const found = delivered.get("a1")?.[0];
  return found ? { startBlock: found.startBlock, endBlock: found.endBlock } : null;
}

const THREE_BLOCKS = "First paragraph.\n\nSecond has the phrase.\n\nThird has the phrase.";

describe("quoteSnippet", () => {
  const ONE_ROW = { startBlock: 0, endBlock: 0 };

  it("splits the paragraph around a quote found mid-way", () => {
    expect(
      quoteSnippet("The **cache** is\nwarm and ready.", {
        ...ONE_ROW,
        quote: "is warm",
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({
      before: "The cache ",
      match: "is warm",
      after: " and ready.",
    });
  });

  it.each([
    { name: "keeps a before of 40 characters whole", lead: 39, before: `${"a".repeat(39)} ` },
    {
      name: "cuts a longer before to its last 40 characters behind an ellipsis",
      lead: 40,
      before: `…${"a".repeat(39)} `,
    },
  ])("$name", ({ lead, before }) => {
    expect(
      quoteSnippet(`${"a".repeat(lead)} target rest`, {
        ...ONE_ROW,
        quote: "target",
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({ before, match: "target", after: " rest" });
  });

  it.each([
    {
      name: "shows a quote of 80 characters whole, with what follows it",
      length: 80,
      clipped: false,
    },
    { name: "clips a quote of 81 characters and drops what follows it", length: 81, clipped: true },
  ])("$name", ({ length, clipped }) => {
    const quote = "q".repeat(length);
    expect(
      quoteSnippet(`Lead ${quote} tail.`, { ...ONE_ROW, quote, occurrence: 0, isCode: false }),
    ).toEqual({
      before: "",
      match: clipped ? `${"q".repeat(80)}…` : quote,
      after: clipped ? "" : " tail.",
    });
  });

  it("starts a quote that fills the line at the quote, clipped, with no context", () => {
    const quote = "word ".repeat(30).trim();
    expect(
      quoteSnippet(`Start ${quote} end.`, { ...ONE_ROW, quote, occurrence: 0, isCode: false }),
    ).toEqual({
      before: "",
      match: `${"word ".repeat(16).trim()}…`,
      after: "",
    });
  });

  it("gives a quote near the line's length only the context that fits beside it", () => {
    const quote = "b".repeat(70);
    expect(
      quoteSnippet(`Some leading context here ${quote} tail.`, {
        ...ONE_ROW,
        quote,
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({
      before: "…text here ",
      match: quote,
      after: " tail.",
    });
  });

  it("finds a quote spanning blocks by its piece in this block", () => {
    expect(
      quoteSnippet("Second block here.", {
        ...ONE_ROW,
        endBlock: 1,
        quote: "end of first.\n\nSecond block",
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({
      before: "",
      match: "Second block",
      after: " here.",
    });
  });

  it.each([
    { quote: "m", occurrence: 0, before: "Merge on the sa", after: "e quote, merge again" },
    { quote: "m", occurrence: 1, before: "Merge on the same quote, ", after: "erge again" },
    { quote: "M", occurrence: 0, before: "", after: "erge on the same quote, merge again" },
  ])(
    "tints repeat $occurrence of $quote, matching case exactly",
    ({ quote, occurrence, before, after }) => {
      const heading = "## Merge on the same quote, merge again";
      expect(quoteSnippet(heading, { ...ONE_ROW, quote, occurrence, isCode: false })).toEqual({
        before,
        match: quote,
        after,
      });
    },
  );

  it("shows a quote across rows by this block's piece, not by where its first row's text repeats", () => {
    expect(
      quoteSnippet("End two. Intro. more", {
        quote: "Intro.\n\n- one\n\nEnd two.",
        occurrence: 0,
        isCode: false,
        startBlock: 0,
        endBlock: 1,
      }),
    ).toEqual({ before: "", match: "End two.", after: " Intro. more" });
  });

  it("finds a quote that runs across list items", () => {
    expect(
      quoteSnippet("- Tokenize the source\n- Build the tree", {
        ...ONE_ROW,
        quote: "the source\n- Build",
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({ before: "Tokenize ", match: "the source Build", after: " the tree" });
  });

  it("tints the first repeat when the one the comment was made on is gone", () => {
    expect(
      quoteSnippet("Merge on the same quote", {
        ...ONE_ROW,
        quote: "m",
        occurrence: 5,
        isCode: false,
      }),
    ).toEqual({ before: "Merge on the sa", match: "m", after: "e quote" });
  });

  it("counts repeats that overlap, as a selection does", () => {
    expect(
      quoteSnippet("very very very", {
        ...ONE_ROW,
        quote: "very very",
        occurrence: 1,
        isCode: false,
      }),
    ).toEqual({ before: "very ", match: "very very", after: "" });
  });

  it("finds a code quote in its code block", () => {
    expect(
      quoteSnippet("```sh\n# build\nnpm run build\n```", {
        ...ONE_ROW,
        quote: "# build\nnpm",
        occurrence: 0,
        isCode: true,
      }),
    ).toEqual({ before: "", match: "# build npm", after: " run build" });
  });

  it("falls back to the quote alone when the block lacks it", () => {
    expect(
      quoteSnippet("Something else.", {
        ...ONE_ROW,
        quote: "`absent` text",
        occurrence: 0,
        isCode: false,
      }),
    ).toEqual({
      before: "",
      match: "absent text",
      after: "",
    });
  });
});

describe("resolveDeliveredOutputComments locating", () => {
  const code = "x = 1\n# comment\ny = 2\n\nz = 3";

  it.each([
    {
      name: "prefers the occurrence in the hinted third block",
      message: THREE_BLOCKS,
      quote: "the phrase",
      hint: 2,
      blocks: [2, 2],
    },
    {
      name: "prefers the occurrence in the hinted second block",
      message: THREE_BLOCKS,
      quote: "the phrase",
      hint: 1,
      blocks: [1, 1],
    },
    {
      name: "falls back to the first occurrence when the hint matches none",
      message: THREE_BLOCKS,
      quote: "the phrase",
      hint: 9,
      blocks: [1, 1],
    },
    {
      name: "reports both ends of a quote that spans blocks",
      message: THREE_BLOCKS,
      quote: "paragraph.\n\nSecond",
      hint: 0,
      blocks: [0, 1],
    },
    {
      name: "matches the rendered text across markup",
      message: "Some **bold**\ntext.",
      quote: "bold text",
      hint: 0,
      blocks: [0, 0],
    },
    {
      name: "matches the rendered text across escapes",
      message: "Use a*b here.",
      quote: "a\\*b",
      hint: 0,
      blocks: [0, 0],
    },
    {
      name: "matches a quote of raw code as written, not as Markdown",
      message: `Intro.\n\n\`\`\`py\n${code}\n\`\`\``,
      quote: code,
      hint: 1,
      isCode: true,
      blocks: [1, 1],
    },
  ])("$name", ({ message, quote, hint, isCode = false, blocks: [startBlock, endBlock] }) => {
    expect(locate(message, { quote, startBlock: hint, isCode })).toEqual({ startBlock, endBlock });
  });

  it("returns null when the text is not there", () => {
    expect(locate(THREE_BLOCKS, { quote: "absent" })).toBeNull();
  });
});

describe("resolveDeliveredOutputComments", () => {
  it("targets the assistant output before the comment turn", () => {
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", "Alpha beta."),
      commentTurn("u1", { quote: "beta" }),
    ]);
    expect(delivered.get("a1")).toEqual([
      {
        key: "u1:0",
        sourceItemId: "a1",
        quote: "beta",
        note: "n",
        occurrence: 0,
        isCode: false,
        startBlock: 0,
        endBlock: 0,
      },
    ]);
  });

  it("keys comments by their turn and their place in it", () => {
    const twoComments: StreamItem = {
      kind: "user_message",
      id: "u1",
      text: withOutputComments("", [
        { quote: "Alpha", note: "n", startBlock: 0, occurrence: 0, isCode: false },
        { quote: "beta", note: "n", startBlock: 0, occurrence: 0, isCode: false },
      ]),
      timestamp: new Date(0),
    };
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", "Alpha beta."),
      twoComments,
      assistant("a2", "Gamma."),
      commentTurn("u2", { quote: "Gamma" }),
    ]);
    expect(delivered.get("a1")?.map((comment) => comment.key)).toEqual(["u1:0", "u1:1"]);
    expect(delivered.get("a2")?.map((comment) => comment.key)).toEqual(["u2:0"]);
  });

  it("carries which repeat of the quote the comment was made on", () => {
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", "one and one"),
      commentTurn("u1", { quote: "one", occurrence: 1 }),
    ]);
    expect(delivered.get("a1")).toEqual([
      {
        key: "u1:0",
        sourceItemId: "a1",
        quote: "one",
        note: "n",
        occurrence: 1,
        isCode: false,
        startBlock: 0,
        endBlock: 0,
      },
    ]);
  });

  it("keeps the list item a comment ends in only on the block its fence names", () => {
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", "Intro.\n\n- Alpha\n- Beta"),
      commentTurn("u1", { quote: "Beta", startBlock: 1, endItem: [1] }),
      commentTurn("u2", { quote: "Beta", startBlock: 0, endItem: [1] }),
    ]);
    expect(delivered.get("a1")?.map(({ key, endItem }) => [key, endItem])).toEqual([
      ["u1:0", [1]],
      ["u2:0", undefined],
    ]);
  });

  it.each<{ name: string; items: StreamItem[]; targets: string[] }>([
    {
      name: "prefers the nearest earlier output that contains the quote",
      items: [
        assistant("a1", "shared phrase"),
        assistant("a2", "shared phrase too"),
        commentTurn("u1", { quote: "shared phrase" }),
      ],
      targets: ["a2"],
    },
    {
      name: "reaches back past outputs that lack the quote",
      items: [
        assistant("a1", "only here"),
        assistant("a2", "something else"),
        commentTurn("u1", { quote: "only here" }),
      ],
      targets: ["a1"],
    },
    {
      name: "targets the message its ordinal names, though a later one repeats the quote",
      items: [
        assistant("a1", "shared phrase"),
        assistant("a2", "shared phrase too"),
        commentTurn("u1", { quote: "shared phrase", messageOrdinal: 2 }),
      ],
      targets: ["a1"],
    },
    {
      name: "counts only assistant messages back to the one the ordinal names",
      items: [
        assistant("a1", "shared phrase"),
        { kind: "user_message", id: "u0", text: "go on", timestamp: new Date(0) },
        assistant("a2", "shared phrase"),
        {
          kind: "thought",
          id: "t1",
          text: "shared phrase",
          timestamp: new Date(0),
          status: "ready",
        },
        commentTurn("u1", { quote: "shared phrase", messageOrdinal: 2 }),
      ],
      targets: ["a1"],
    },
    {
      name: "falls back to the nearest message with the quote when the named one lacks it",
      items: [
        assistant("a1", "shared phrase"),
        assistant("a2", "shared phrase"),
        assistant("a3", "something else"),
        commentTurn("u1", { quote: "shared phrase", messageOrdinal: 1 }),
      ],
      targets: ["a2"],
    },
    {
      name: "never targets output that comes after the comment turn",
      items: [commentTurn("u1", { quote: "x" }), assistant("a1", "x")],
      targets: [],
    },
  ])("$name", ({ items, targets }) => {
    expect([...resolveDeliveredOutputComments(items).keys()]).toEqual(targets);
  });
});

describe("findMovedCommentSource", () => {
  const anchor: QuoteAnchor = {
    sourceItemId: "before-reload",
    startBlock: 1,
    endBlock: 1,
    quote: "the phrase",
    occurrence: 1,
    isCode: false,
  };

  it("finds the one message holding the quote in the same block and repeat", () => {
    const items = [
      assistant("a1", "the phrase, the phrase\n\nother"),
      assistant("a2", "Intro.\n\nthe phrase and the phrase"),
      assistant("a3", "Intro.\n\nthe phrase once"),
    ];
    expect(findMovedCommentSource(items, anchor)).toBe("a2");
  });

  it("finds none when several messages could be it", () => {
    const text = "Intro.\n\nthe phrase, the phrase";
    expect(
      findMovedCommentSource([assistant("a1", text), assistant("a2", text)], anchor),
    ).toBeNull();
  });
});

describe("quotePlainText", () => {
  it("reads Markdown as rendered text on one line", () => {
    expect(
      quotePlainText({ quote: "**Arm A (control):** runs\n`claude-opus-5`", isCode: false }),
    ).toBe("Arm A (control): runs claude-opus-5");
  });

  it("keeps code as written", () => {
    expect(quotePlainText({ quote: "**x**\n  y", isCode: true })).toBe("**x** y");
  });
});

describe("listItemPaths", () => {
  it.each([
    {
      name: "numbers nested items by their path",
      block: "- one\n- two\n  - two.one",
      paths: ["0", "1", "1.0"],
    },
    { name: "counts on across sibling lists", block: "- one\n\n1. two", paths: ["0", "1"] },
    {
      name: "counts on from a bullet list into an ordered list that follows it directly",
      block: "- one\n- two\n1. three",
      paths: ["0", "1", "2"],
    },
    { name: "numbers no item inside a blockquote", block: "- one\n\n> - quoted", paths: ["0"] },
    { name: "finds no items in a block without a list", block: "Just a paragraph.", paths: [] },
  ])("$name", ({ block, paths }) => {
    expect([...listItemPaths(block).keys()]).toEqual(paths);
  });
});

describe("quoteEndNode", () => {
  const anchor = { occurrence: 0, isCode: false, startBlock: 0, endBlock: 0 };
  it.each([
    {
      name: "finds a paragraph a list follows with no blank line",
      block: "The parser is ready, in draft.\n- one\n- two",
      quote: "ready, in draft.",
      node: 0,
    },
    {
      name: "finds a heading a paragraph follows",
      block: "# The parser\nIt reads the config.",
      quote: "parser",
      node: 0,
    },
    {
      name: "finds a paragraph a code fence follows",
      block: "Run this:\n```sh\nnpm test\n```",
      quote: "Run this:",
      node: 0,
    },
    {
      name: "finds code a paragraph follows",
      block: "```sh\nnpm test\n```\nThen check.",
      quote: "npm test",
      isCode: true,
      node: 0,
    },
    {
      name: "finds the node holding the occurrence",
      block: "# Retry\nRetry now.\n- Retry later",
      quote: "Retry",
      occurrence: 1,
      node: 1,
    },
    {
      name: "finds the node holding the end of a quote across two nodes",
      block: "Ready.\n- one\n- two\n# Next",
      quote: "Ready.\n- one",
      node: 1,
    },
    {
      name: "reads the end block's piece of a quote across blocks",
      block: "Ready.\n- one\n- two\n# Next",
      quote: "Intro.\n\nReady.\n- one",
      startBlock: 0,
      endBlock: 1,
      node: 1,
    },
    {
      name: "finds the end of a quote that copying broke into blocks within one",
      block: "# The parser\nIt reads the config.\n- one",
      quote: "parser\n\nIt reads",
      node: 1,
    },
    {
      name: "reads every block of the end block's piece of a quote across blocks",
      block: "Ready.\n- one\n- two\n# Next",
      quote: "Intro.\n\nReady.\n\n- one",
      startBlock: 0,
      endBlock: 1,
      node: 1,
    },
    {
      name: "leaves a quote ending in the last node to the block",
      block: "# Retry\nRetry now.\n- Retry later",
      quote: "Retry",
      occurrence: 2,
      node: null,
    },
    {
      name: "leaves a block of one node as it is",
      block: "Just a paragraph\nthat wraps.",
      quote: "Just a",
      node: null,
    },
    {
      name: "places nothing when the block no longer holds the quote",
      block: "# Retry\nRetry now.",
      quote: "Gone",
      node: null,
    },
  ])("$name", ({ block, node, ...quote }) => {
    expect(quoteEndNode(readTopLevelNodes(block), { ...anchor, ...quote })).toBe(node);
  });
});
