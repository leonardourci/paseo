import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { withOutputComments, type OutputComment, type QuoteAnchor } from "./fence";
import {
  contextAround,
  findMovedCommentSource,
  inReadingOrder,
  locateQuote,
  matchesIn,
  pickOccurrence,
  quotePlainText,
  quoteSnippet,
  replyPlainText,
  resolveDeliveredOutputComments,
  type LocatedQuote,
} from "./match";

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

type TurnComment = Pick<OutputComment, "quote"> & Partial<OutputComment>;

function commentTurn(id: string, comment: TurnComment): StreamItem {
  return {
    kind: "user_message",
    id,
    text: withOutputComments("", [{ note: "n", occurrence: 0, isCode: false, ...comment }]),
    timestamp: new Date(0),
  };
}

function snippet(markdown: string, quote: Pick<LocatedQuote, "quote"> & Partial<LocatedQuote>) {
  return quoteSnippet(replyPlainText(markdown), { occurrence: 0, isCode: false, ...quote });
}

describe("quoteSnippet", () => {
  it("shows the reply's text around a quote found mid-way", () => {
    expect(snippet("The **cache** is\nwarm and ready.", { quote: "is warm" })).toEqual({
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
    expect(snippet(`${"a".repeat(lead)} target rest`, { quote: "target" })).toEqual({
      before,
      match: "target",
      after: " rest",
    });
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
    expect(snippet(`Lead ${quote} tail.`, { quote })).toEqual({
      before: "",
      match: clipped ? `${"q".repeat(80)}…` : quote,
      after: clipped ? "" : " tail.",
    });
  });

  it("shows only a line's worth of the reply after the quote", () => {
    const after = snippet(`Lead target ${"rest ".repeat(100)}`, { quote: "target" })?.after;
    expect(after).toHaveLength(80);
  });

  it("keeps the line to the quote's own blocks", () => {
    expect(snippet("First block.\n\nThe quote here.\n\n- Next item", { quote: "quote" })).toEqual({
      before: "The ",
      match: "quote",
      after: " here.",
    });
  });

  it("finds a quote that runs across paragraphs and list items", () => {
    expect(
      snippet("Intro.\n\n- Tokenize the source\n- Build the tree", {
        quote: "Intro.\n\n- Tokenize the source\n- Build",
      }),
    ).toEqual({ before: "", match: "Intro. Tokenize the source Build", after: " the tree" });
  });

  it.each([
    { quote: "m", occurrence: 0, before: "Merge on the sa", after: "e quote, merge again" },
    { quote: "m", occurrence: 1, before: "Merge on the same quote, ", after: "erge again" },
    { quote: "M", occurrence: 0, before: "", after: "erge on the same quote, merge again" },
  ])(
    "tints repeat $occurrence of $quote across the reply, matching case exactly",
    ({ quote, occurrence, before, after }) => {
      expect(snippet("## Merge on the same quote, merge again", { quote, occurrence })).toEqual({
        before,
        match: quote,
        after,
      });
    },
  );

  it("counts repeats that overlap, as a selection does", () => {
    expect(snippet("very very very", { quote: "very very", occurrence: 1 })).toEqual({
      before: "very ",
      match: "very very",
      after: "",
    });
  });

  it("finds a code quote in its code block", () => {
    expect(
      snippet("```sh\n# build\nnpm run build\n```", { quote: "# build\nnpm", isCode: true }),
    ).toEqual({ before: "", match: "# build npm", after: " run build" });
  });

  it.each([
    { name: "a quote the reply lacks", quote: { quote: "`absent` text" } },
    { name: "a repeat the reply lacks", quote: { quote: "m", occurrence: 5 } },
  ])("leaves $name unresolved", ({ quote }) => {
    expect(snippet("Merge on the same quote", quote)).toBeNull();
  });
});

describe("pickOccurrence", () => {
  const text = "Retry now. Then retry later. And retry once more.";
  const matches = matchesIn(text, "retry");

  it("takes the comment's own occurrence while its context surrounds it", () => {
    expect(pickOccurrence(text, matches, { occurrence: 1, prefix: "And", suffix: "once" })).toBe(1);
  });

  it("follows the context to the occurrence it surrounds when the count no longer fits", () => {
    expect(pickOccurrence(text, matches, { occurrence: 0, prefix: "And", suffix: "once" })).toBe(1);
  });

  it("reads context with whitespace aside and a suffix cut short", () => {
    expect(pickOccurrence(text, matches, { occurrence: 0, prefix: "Then\n", suffix: "la" })).toBe(
      0,
    );
  });

  it("takes the comment's occurrence when no match has its context", () => {
    expect(pickOccurrence(text, matches, { occurrence: 1, prefix: "gone", suffix: "" })).toBe(1);
  });

  it("finds none when the reply has fewer occurrences and no context fits", () => {
    expect(pickOccurrence(text, matches, { occurrence: 2 })).toBe(-1);
  });
});

describe("contextAround", () => {
  it("keeps a little of the text on each side, on one line", () => {
    const text = `${"a ".repeat(30)}\nthe quote\n${"b ".repeat(30)}`;
    const [match] = matchesIn(text, "the quote");
    expect(contextAround(text, match!)).toEqual({
      prefix: "a ".repeat(15).trim(),
      suffix: "b ".repeat(16).trim(),
    });
  });
});

describe("locateQuote", () => {
  it("finds a comment's quote by its context though its occurrence moved", () => {
    const reply = replyPlainText("The retry loop.\n\nA retry later, and a retry once more.");
    const anchor = {
      quote: "retry",
      isCode: false,
      occurrence: 0,
      prefix: "and a",
      suffix: "once",
    };
    const match = locateQuote(reply, anchor);
    expect(match && reply.slice(match.start - 6, match.end + 5)).toBe("and a retry once");
  });
});

describe("inReadingOrder", () => {
  const items = [
    assistant("a", "First reply, one point."),
    assistant("b", "Opening line.\n\nLater line and the same line again."),
  ];
  const comment = (id: string, sourceItemId: string, quote: string, occurrence = 0) => ({
    id,
    sourceItemId,
    quote,
    occurrence,
    isCode: false,
  });

  it("orders by reply, then by where each quote reads, whatever order they were added in", () => {
    const added = [
      comment("1", "b", "line", 2),
      comment("2", "b", "Opening"),
      comment("3", "missing", "gone"),
      comment("4", "a", "one point"),
      comment("5", "b", "Later line"),
    ];
    expect(inReadingOrder(added, items).map((entry) => entry.id)).toEqual([
      "4",
      "2",
      "5",
      "1",
      "3",
    ]);
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
      },
    ]);
  });

  it.each([
    { name: "across markup", message: "Some **bold**\ntext.", quote: "bold text" },
    { name: "across escapes", message: "Use a*b here.", quote: "a\\*b" },
    {
      name: "across blocks",
      message: "First paragraph.\n\nSecond.",
      quote: "paragraph.\n\nSecond",
    },
  ])("finds the quote in the reply's rendered text $name", ({ message, quote }) => {
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", message),
      commentTurn("u1", { quote }),
    ]);
    expect(delivered.get("a1")).toHaveLength(1);
  });

  it("matches a quote of raw code as written, not as Markdown", () => {
    const code = "x = 1\n# comment\ny = 2\n\nz = 3";
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", `Intro.\n\n\`\`\`py\n${code}\n\`\`\``),
      commentTurn("u1", { quote: code, isCode: true }),
    ]);
    expect(delivered.get("a1")).toHaveLength(1);
  });

  it("drops a comment whose quote or repeat no output holds", () => {
    expect(
      resolveDeliveredOutputComments([
        assistant("a1", "one and one"),
        commentTurn("u1", { quote: "absent" }),
        commentTurn("u2", { quote: "one", occurrence: 2 }),
      ]).size,
    ).toBe(0);
  });

  it("keys comments by their turn and their place in it", () => {
    const twoComments: StreamItem = {
      kind: "user_message",
      id: "u1",
      text: withOutputComments("", [
        { quote: "Alpha", note: "n", occurrence: 0, isCode: false },
        { quote: "beta", note: "n", occurrence: 0, isCode: false },
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
    expect(delivered.get("a1")?.[0]).toMatchObject({ occurrence: 1 });
  });

  it("shows a comment sent before whole-reply quotes by its quote, its block aside", () => {
    const legacy: StreamItem = {
      kind: "user_message",
      id: "u1",
      text: "```paseo-comment block=1 occ=1 item=0\n> Beta\n\nn\n```",
      timestamp: new Date(0),
    };
    const delivered = resolveDeliveredOutputComments([
      assistant("a1", "Intro.\n\n- Beta\n- Gamma"),
      legacy,
    ]);
    expect(delivered.get("a1")).toEqual([
      { key: "u1:0", sourceItemId: "a1", quote: "Beta", note: "n", occurrence: 0, isCode: false },
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
    quote: "the phrase",
    occurrence: 1,
    isCode: false,
    prefix: "and",
    suffix: "",
  };

  it("finds the one message holding the quote with its context", () => {
    const items = [
      assistant("a1", "the phrase once"),
      assistant("a2", "Intro.\n\nthe phrase and the phrase"),
      assistant("a3", "Intro, then the phrase"),
    ];
    expect(findMovedCommentSource(items, anchor)).toBe("a2");
  });

  it("finds none when several messages could be it", () => {
    const text = "Intro.\n\nthe phrase and the phrase";
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
