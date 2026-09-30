import { afterEach, describe, expect, it } from "vitest";
import { rowOf } from "@/output-comments/selection.web";
import { mountTranscript, paragraph } from "@/output-comments/test-transcript";
import {
  HOST_CSS,
  besideNote,
  caretBox,
  focusOf,
  isOnNoteEdgeLine,
  isRowAheadUnmounted,
  latestReplyEnd,
  latestReplyStart,
  noteBetween,
  textBesideNote,
  type CaretBox,
  type TextPosition,
} from "./caret.web";
import { OUTPUT_CARET_HOST_ATTRIBUTE } from "./host";

interface SelectionMove {
  alter?: "move" | "extend";
  direction: "backward" | "forward";
  granularity: "character" | "line";
}

const LINE_DOWN: SelectionMove = { direction: "forward", granularity: "line" };
const LINE_UP: SelectionMove = { direction: "backward", granularity: "line" };
const RIGHT: SelectionMove = { direction: "forward", granularity: "character" };
const LEFT: SelectionMove = { direction: "backward", granularity: "character" };

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  document.head.querySelector("#output-caret-test-css")?.remove();
});

interface RowMarkup {
  id: string;
  kind: string;
  html: string;
}

function row({ id, kind, html }: RowMarkup): string {
  return `<div data-history-row-id="${id}" data-row-kind="${kind}">${html}</div>`;
}

const PENDING_CARD_HTML = `
  <div data-paseo-markdown-ignore="true">
    <div data-testid="output-comment-pending">
      <div style="user-select: none">1</div>
      <textarea data-testid="output-comment-input" rows="1" style="font: inherit">note</textarea>
    </div>
  </div>`;

// As the web renders a list: each item a flex row, its marker beside its text.
function orderedList(...items: string[]): string {
  return items
    .map(
      (item, index) => `
      <div data-paseo-markdown-tag="li" style="display: flex; flex-direction: row">
        <div data-paseo-markdown-ignore="true" data-paseo-markdown-list-marker="true" style="width: 3ch">${index + 1}.</div>
        <div style="flex: 1">${item}</div>
      </div>`,
    )
    .join("");
}

const USER_MESSAGE = `
  <div>question here</div>
  <div data-testid="user-message-trailing-row" style="opacity: 0">
    <div data-testid="user-message-timestamp">10:42</div>
  </div>`;

// Monospace in `ch` wraps at the same characters whatever font the browser has.
const MONOSPACE = "font: 16px/20px monospace; width: 40ch";

/** Editable as the chat is while the keyboard caret is attached. */
function makeHost(root: HTMLElement): void {
  const style = document.createElement("style");
  style.id = "output-caret-test-css";
  style.textContent = HOST_CSS;
  document.head.append(style);
  root.setAttribute("contenteditable", "true");
  root.setAttribute(OUTPUT_CARET_HOST_ATTRIBUTE, "");
}

/** m1, then a user message, a tool call and a thought, then m2 and m3. */
function mountOutput(options: { m2?: string } = {}): HTMLElement {
  const root = mountTranscript(
    ["m1", paragraph("alpha line one")],
    ["m2", options.m2 ?? paragraph("beta line two")],
    ["m3", paragraph("gamma line three")],
  );
  root.style.cssText = MONOSPACE;
  makeHost(root);
  root.children[0]?.insertAdjacentHTML(
    "afterend",
    [
      row({ id: "u1", kind: "user_message", html: USER_MESSAGE }),
      row({ id: "t1", kind: "tool_call", html: "<div>tool output here</div>" }),
      row({ id: "th1", kind: "thought", html: "<div>thinking it over</div>" }),
    ].join(""),
  );
  return root;
}

function textContaining(root: HTMLElement, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.data.includes(needle)) return node;
  }
  throw new Error(`No text containing ${needle}`);
}

function selectionAt(node: Node, offset: number): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected a selection");
  selection.collapse(node, offset);
  return selection;
}

/** The focus as `row:text@offset`, readable in a failure. */
function describeFocus(selection: Selection): string {
  return describePosition(focusOf(selection));
}

function describePosition(position: TextPosition | null): string {
  if (!position) return "none";
  const rowId = rowOf(position.node)?.dataset.historyRowId ?? "outside";
  const label = position.node instanceof Text ? position.node.data : `<${position.node.nodeName}>`;
  return `${rowId}:${label}@${position.offset}`;
}

/** Moves the way the browser does on an arrow key, and returns whether the focus moved. */
function move(input: SelectionMove): boolean {
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected a selection");
  const before = describeFocus(selection);
  selection.modify(input.alter ?? "move", input.direction, input.granularity);
  return describeFocus(selection) !== before;
}

/** Every position the caret stops at until a move finds nowhere to go. */
function walk(command: SelectionMove): string[] {
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected a selection");
  const visited: string[] = [];
  for (let step = 0; step < 50; step += 1) {
    if (!move(command)) return visited;
    visited.push(describeFocus(selection));
  }
  throw new Error(`The caret was still moving after 50 steps: ${visited.slice(-3).join(", ")}`);
}

function requireBox(position: TextPosition): CaretBox {
  const box = caretBox(position);
  if (!box) throw new Error(`No caret box at ${describePosition(position)}`);
  return box;
}

describe("the keyboard caret by line", () => {
  it("walks the user's message and steps over tool calls and thinking", () => {
    const root = mountOutput();
    const selection = selectionAt(textContaining(root, "alpha"), 6);

    expect(move(LINE_DOWN)).toBe(true);
    expect(describeFocus(selection)).toBe("u1:question here@6");
    expect(move(LINE_DOWN)).toBe(true);
    expect(describeFocus(selection)).toBe("m2:block:0:beta line two@6");
    expect(move(LINE_UP)).toBe(true);
    expect(describeFocus(selection)).toBe("u1:question here@6");
  });

  it("never lands on a list marker, and walks each line of a wrapping item", () => {
    // Seven words fit on each line of the item, so its thirty words wrap onto five.
    const long = "word ".repeat(30).trim();
    const root = mountOutput({ m2: orderedList(long, "short item") });
    selectionAt(textContaining(root, "question"), 0);

    expect(walk(LINE_DOWN)).toEqual([
      ...[0, 35, 70, 105, 140].map((offset) => `m2:block:0:${long}@${offset}`),
      "m2:block:0:short item@0",
      "m3:block:0:gamma line three@0",
      // Down on the last line goes to its end, as in a text field.
      "m3:block:0:gamma line three@16",
    ]);
  });

  it("skips the user's hidden timestamp", () => {
    const root = mountOutput();
    const selection = selectionAt(textContaining(root, "question"), 3);

    expect(move(LINE_DOWN)).toBe(true);
    expect(describeFocus(selection)).toBe("m2:block:0:beta line two@3");
  });

  it("extends across skipped rows into the next text", () => {
    const root = mountOutput();
    const selection = selectionAt(textContaining(root, "question"), 0);

    expect(move({ ...LINE_DOWN, alter: "extend" })).toBe(true);
    // At the start of beta's paragraph, which the browser gives as the paragraph's own start.
    expect(describeFocus(selection)).toBe("m2:block:0:<DIV>@0");
    expect(selection.anchorNode).toBe(textContaining(root, "question"));
  });

  it("steps down past a line with a link, whose box it would otherwise bounce into", () => {
    // As the web markdown draws a link: a pressable box inside the paragraph's text.
    const link = `<div style="display: inline-flex"><a href="#" style="display: contents">
      <div role="link" style="display: flex"><span style="display: block"><span>the config</span></span></div>
    </a></div>`;
    const root = mountOutput({ m2: `${paragraph(`reads ${link} now`)}${paragraph("next line")}` });
    const selection = selectionAt(textContaining(root, "reads"), 2);

    expect(walk(LINE_DOWN).slice(0, 2)).toEqual([
      "m2:block:0:next line@2",
      "m3:block:0:gamma line three@2",
    ]);
    expect(describeFocus(selection)).toBe("m3:block:0:gamma line three@16");
  });
});

describe("the keyboard caret by character", () => {
  it("steps from one list item's text to the next without stopping on the marker", () => {
    const root = mountOutput({ m2: orderedList("apple", "pear") });
    const selection = selectionAt(textContaining(root, "apple"), 5);

    expect(move(RIGHT)).toBe(true);
    expect(describeFocus(selection)).toBe("m2:block:0:pear@0");
    expect(move(LEFT)).toBe(true);
    expect(describeFocus(selection)).toBe("m2:block:0:apple@5");
  });
});

describe("the keyboard caret at the edges", () => {
  it("does not carry on into text past the output, such as the composer's", () => {
    const root = mountOutput();
    root.insertAdjacentHTML("afterend", "<div>composer controls</div>");
    const selection = selectionAt(textContaining(root, "gamma"), 16);

    expect(move(LINE_DOWN)).toBe(false);
    expect(move(RIGHT)).toBe(false);
    expect(describeFocus(selection)).toBe("m3:block:0:gamma line three@16");
  });
});

describe("the keyboard caret and pending notes", () => {
  function mountWithNote(): HTMLElement {
    return mountOutput({ m2: `${paragraph("beta line two")}${PENDING_CARD_HTML}` });
  }

  function note(root: HTMLElement): HTMLTextAreaElement {
    const textarea = root.querySelector("textarea");
    if (!textarea) throw new Error("Expected a note");
    return textarea;
  }

  it("steps over a note's card by line, which tells where the note was", () => {
    const root = mountWithNote();
    const selection = selectionAt(textContaining(root, "beta"), 2);

    expect(move(LINE_DOWN)).toBe(true);
    expect(describeFocus(selection)).toBe("m3:block:0:gamma line three@2");
  });

  it("finds a note a line move stepped over, or would reach past the output's edge", () => {
    const root = mountWithNote();
    const beta = { node: textContaining(root, "beta"), offset: 2 };
    const gamma = { node: textContaining(root, "gamma"), offset: 2 };

    expect(noteBetween(root, { from: beta, to: gamma, direction: "forward" })).toBe(note(root));
    expect(noteBetween(root, { from: gamma, to: beta, direction: "backward" })).toBe(note(root));
    expect(noteBetween(root, { from: beta, to: null, direction: "forward" })).toBe(note(root));
    expect(noteBetween(root, { from: gamma, to: null, direction: "forward" })).toBeNull();
  });

  it("leaves a note for the text just above or below it, skipping tool calls", () => {
    const root = mountWithNote();
    const describeBeside = (direction: "backward" | "forward") =>
      describePosition(textBesideNote(root, { note: note(root), direction }));

    expect(describeBeside("backward")).toBe("m2:block:0:beta line two@13");
    expect(describeBeside("forward")).toBe("m3:block:0:gamma line three@0");
  });

  it("keeps where to leave a note for once its card is deleted", () => {
    const root = mountWithNote();
    const below = textBesideNote(root, { note: note(root), direction: "forward" });
    root.querySelector('[data-testid="output-comment-pending"]')?.remove();

    expect(describePosition(below)).toBe("m3:block:0:gamma line three@0");
  });

  // Wraps after "dddd ", so the second line starts at 20 and a typed third at 30.
  it.each([
    { offset: 3, direction: "backward", isOnEdge: true },
    { offset: 20, direction: "backward", isOnEdge: false },
    { offset: 26, direction: "backward", isOnEdge: false },
    { offset: 3, direction: "forward", isOnEdge: false },
    { offset: 26, direction: "forward", isOnEdge: false },
    { offset: 30, direction: "forward", isOnEdge: true },
    { offset: 34, direction: "forward", isOnEdge: true },
  ] as const)(
    "at $offset of a typed and wrapped note, going $direction, is on its edge line: $isOnEdge",
    ({ offset, direction, isOnEdge }) => {
      const textarea = note(mountWithNote());
      textarea.style.cssText =
        "font: inherit; width: 20ch; padding: 0; border: 0; overflow: hidden";
      textarea.value = "aaaa bbbb cccc dddd eeee ffff\ngggg";
      textarea.setSelectionRange(offset, offset);

      expect(isOnNoteEdgeLine(textarea, direction)).toBe(isOnEdge);
    },
  );
});

describe("caretBox", () => {
  it("measures the end of the text before an element edge on its own line", () => {
    const root = mountOutput();
    const text = textContaining(root, "alpha");
    const whole = document.createRange();
    whole.selectNodeContents(text);
    const textRect = whole.getBoundingClientRect();

    const atEnd = requireBox({ node: text, offset: text.length });
    expect(atEnd.top).toBeCloseTo(textRect.top, 0);
  });

  it("falls back to the node beside an element position", () => {
    const root = mountOutput({ m2: `${paragraph("beta line two")}${PENDING_CARD_HTML}` });
    const textarea = root.querySelector("textarea");
    if (!textarea) throw new Error("Expected a note");
    const position = besideNote(textarea, "backward");
    const collapsed = document.createRange();
    collapsed.setStart(position.node, position.offset);
    const noteRect = textarea.getBoundingClientRect();

    expect(collapsed.getClientRects()).toHaveLength(0);
    expect(caretBox(position)).toEqual({ top: noteRect.top, height: 20 });
  });
});

describe("caret positions", () => {
  it("finds the start and end of the latest reply", () => {
    const root = mountOutput();

    expect(describePosition(latestReplyStart(root))).toBe("m2:block:0:beta line two@0");
    expect(describePosition(latestReplyEnd(root))).toBe("m3:block:0:gamma line three@16");
  });
});

describe("rows the list hasn't rendered", () => {
  function mountRows(html: string): HTMLElement {
    const root = document.createElement("div");
    root.style.cssText = MONOSPACE;
    root.innerHTML = html;
    document.body.append(root);
    return root;
  }

  function virtualRow(index: number): string {
    return row({
      id: `r${index}`,
      kind: "assistant_message",
      html: `<div>row ${index} text</div>`,
    }).replace("<div ", `<div data-index="${index}" `);
  }

  it("tells when the next row with text is missing", () => {
    const root = mountRows([0, 1, 5].map(virtualRow).join(""));
    const focus = { node: textContaining(root, "row 1"), offset: 2 };

    expect(isRowAheadUnmounted(root, { focus, direction: "forward" })).toBe(true);
    expect(isRowAheadUnmounted(root, { focus, direction: "backward" })).toBe(false);
  });

  it("knows rows are missing past the last rendered one while they still fill the list", () => {
    const mount = (containerHeight: string) =>
      mountRows(`
        <div style="position: relative; height: ${containerHeight}">${virtualRow(0)}</div>
        ${row({ id: "tail", kind: "assistant_message", html: "<div>tail text</div>" })}`);

    const focusIn = () => ({ node: textContaining(document.body, "row 0"), offset: 2 });
    mount("400px");
    expect(isRowAheadUnmounted(document.body, { focus: focusIn(), direction: "forward" })).toBe(
      true,
    );

    document.body.replaceChildren();
    mount("auto");
    expect(isRowAheadUnmounted(document.body, { focus: focusIn(), direction: "forward" })).toBe(
      false,
    );
  });
});
