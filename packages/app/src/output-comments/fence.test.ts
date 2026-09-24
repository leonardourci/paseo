import { describe, expect, it } from "vitest";
import {
  appendBlockquote,
  parseOutputComments,
  withOutputComments,
  type OutputComment,
} from "./fence";

const comment: OutputComment = {
  quote: "Move the timeout to 20s",
  note: "Keep 8s.",
  startBlock: 2,
  occurrence: 0,
  isCode: false,
};
const FENCED = "```paseo-comment block=2\n> Move the timeout to 20s\n\nKeep 8s.\n```";

describe("withOutputComments", () => {
  it("returns the text unchanged when there are no comments", () => {
    expect(withOutputComments("hello", [])).toBe("hello");
  });

  it("puts one fence per comment after the typed text", () => {
    expect(withOutputComments("my reply", [comment])).toBe(`my reply\n\n${FENCED}`);
  });

  it("sends the comments alone when nothing was typed", () => {
    expect(withOutputComments("", [comment])).toBe(FENCED);
  });

  it.each([
    ["backtick", "```sh\nnpm test", "```"],
    ["tilde", "~~~~\nnpm test", "~~~~"],
  ])("closes a %s code block the typed text leaves open", (_, text, closing) => {
    const sent = withOutputComments(text, [comment]);
    expect(sent).toBe(`${text}\n${closing}\n\n${FENCED}`);
    expect(parseOutputComments(sent)).toEqual({
      comments: [{ ...comment, position: 0 }],
      rest: `${text}\n${closing}`,
    });
  });

  it("uses a longer fence than any backtick run inside the comment", () => {
    const quoted: OutputComment = {
      quote: "```ts\nconst a = 1;\n```",
      note: "why?",
      startBlock: 0,
      occurrence: 0,
      isCode: false,
    };
    const text = withOutputComments("", [quoted]);
    expect(text).toBe("````paseo-comment block=0\n> ```ts\n> const a = 1;\n> ```\n\nwhy?\n````");
    expect(parseOutputComments(text).comments).toEqual([{ ...quoted, position: 0 }]);
  });
});

describe("parseOutputComments", () => {
  it("round-trips several comments and keeps the typed text", () => {
    const second: OutputComment = {
      quote: "line one\n\nline three",
      note: "> not a quote\nsecond line",
      startBlock: 0,
      occurrence: 3,
      isCode: false,
    };
    expect(parseOutputComments(withOutputComments("my reply", [comment, second]))).toEqual({
      comments: [
        { ...comment, position: 0 },
        { ...second, position: 1 },
      ],
      rest: "my reply",
    });
  });

  it("reads fences with other text after them (resumed session with attachment text)", () => {
    const text = `my reply\n\n${FENCED}\n\n${FENCED}\n\nAttached file: notes.md`;
    expect(parseOutputComments(text)).toEqual({
      comments: [
        { ...comment, position: 0 },
        { ...comment, position: 1 },
      ],
      rest: "my reply\n\nAttached file: notes.md",
    });
  });

  it.each([
    ["backtick", `\`\`\`\`md\n${FENCED}\n\`\`\`\``],
    ["tilde", `~~~md\n${FENCED}\n\`\`\`\`\n~~~`],
  ])("keeps a fence inside the user's own %s code block as text", (_, typed) => {
    expect(parseOutputComments(typed)).toEqual({ comments: [], rest: typed });
    expect(parseOutputComments(withOutputComments(typed, [comment]))).toEqual({
      comments: [{ ...comment, position: 0 }],
      rest: typed,
    });
  });

  it("gives back the typed text byte for byte, Windows line endings and all", () => {
    const typed = "first\r\n\r\nsecond";
    const text = `${typed}\r\n\r\n${FENCED.replaceAll("\n", "\r\n")}`;
    expect(parseOutputComments(text)).toEqual({
      comments: [{ ...comment, position: 0 }],
      rest: typed,
    });
  });

  it("keeps the typed text's own blank lines", () => {
    const text = "  indented\n\n\n\nafter three blank lines";
    expect(parseOutputComments(withOutputComments(text, [comment])).rest).toBe(text);
  });

  it.each<[string, OutputComment, string]>([
    [
      "a quote of raw code",
      { ...comment, quote: "x = 1\n# comment\n\n  y = 2", isCode: true },
      "```paseo-comment block=2 code\n> x = 1\n> # comment\n>\n>   y = 2\n\nKeep 8s.\n```",
    ],
    [
      "which repeat of the quote was meant",
      { ...comment, occurrence: 2 },
      "```paseo-comment block=2 occ=2\n> Move the timeout to 20s\n\nKeep 8s.\n```",
    ],
    [
      "which assistant message back from the turn the quote came from",
      { ...comment, occurrence: 1, messageOrdinal: 3 },
      "```paseo-comment block=2 occ=1 msg=3\n> Move the timeout to 20s\n\nKeep 8s.\n```",
    ],
    [
      "the top-level list item the quote ends in",
      { ...comment, messageOrdinal: 1, endItem: [2], isCode: true },
      "```paseo-comment block=2 msg=1 item=2 code\n> Move the timeout to 20s\n\nKeep 8s.\n```",
    ],
    [
      "the nested list item the quote ends in",
      { ...comment, messageOrdinal: 1, endItem: [1, 0, 3], isCode: true },
      "```paseo-comment block=2 msg=1 item=1.0.3 code\n> Move the timeout to 20s\n\nKeep 8s.\n```",
    ],
  ])("round-trips %s", (_, sent, text) => {
    expect(withOutputComments("", [sent])).toBe(text);
    expect(parseOutputComments(text).comments).toEqual([{ ...sent, position: 0 }]);
  });

  it("reads no list item from a fence without one", () => {
    expect(parseOutputComments(FENCED).comments[0]).not.toHaveProperty("endItem");
  });
});

describe("parseOutputComments on text without comments", () => {
  it.each([
    ["a message without comments", "  indented\n\n\n\nafter three blank lines\n"],
    ["an ordinary code fence", "```ts\nconst a = 1;\n```"],
    ["a fence with no quote", "```paseo-comment block=0\njust text\n```"],
    ["a fence with no note", "```paseo-comment block=0\n> quoted\n```"],
    ["a fence with no block", "```paseo-comment\n> q\n\nn\n```"],
    ["a fence with a malformed list item", "```paseo-comment block=0 item=1.\n> q\n\nn\n```"],
    [
      "a fence with a number too long to read",
      `\`\`\`paseo-comment block=${"9".repeat(309)}\n> q\n\nn\n\`\`\``,
    ],
    [
      "a fence after an unclosed code block",
      `\`\`\`\`md\nnever closed\n\n${withOutputComments("", [comment])}`,
    ],
  ])("returns %s as plain text", (_, text) => {
    expect(parseOutputComments(text)).toEqual({ comments: [], rest: text });
  });
});

describe("appendBlockquote", () => {
  it("quotes into an empty composer", () => {
    expect(appendBlockquote("", "a\nb")).toBe("> a\n> b\n\n");
  });

  it("adds a blank line after existing text", () => {
    expect(appendBlockquote("hi  \n", "a")).toBe("hi\n\n> a\n\n");
  });
});
