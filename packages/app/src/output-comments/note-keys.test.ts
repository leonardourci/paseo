import { afterEach, describe, expect, it } from "vitest";
import { pasteIntoFocusingNote, typeIntoFocusingNote } from "./note-keys";
import { useOutputCommentFocusStore, useOutputCommentsStore } from "./store";

const DRAFT_KEY = "draft-1";
const SURFACE_ID = "surface-1";

function openComment(note: string): string {
  const id = useOutputCommentsStore.getState().addComment(
    {
      draftKey: DRAFT_KEY,
      sourceItemId: "a1",
      startBlock: 0,
      endBlock: 0,
      quote: "alpha",
      occurrence: 0,
      isCode: false,
    },
    note,
  );
  useOutputCommentFocusStore.getState().focusNote({ surfaceId: SURFACE_ID, id });
  return id;
}

function noteOf(id: string): string | undefined {
  return useOutputCommentsStore.getState().drafts[DRAFT_KEY]?.find((comment) => comment.id === id)
    ?.note;
}

function focusing({ isCardRowRendered = true, surfaceId = SURFACE_ID } = {}) {
  return { draftKey: DRAFT_KEY, surfaceId, isCardRowRendered: () => isCardRowRendered };
}

afterEach(() => {
  useOutputCommentsStore.setState({ drafts: {} });
  useOutputCommentFocusStore.setState({ focus: null, activeKey: null });
});

describe("typeIntoFocusingNote", () => {
  it.each([
    ["appends a character, space included", "hello", " ", "hello "],
    ["starts a new line on Enter", "hello", "Enter", "hello\n"],
    ["deletes the last character, keeping a surrogate pair whole", "ok 👍", "Backspace", "ok "],
    ["leaves an empty note empty on Backspace", "", "Backspace", ""],
  ])("%s", (_, note, key, expected) => {
    const id = openComment(note);

    expect(typeIntoFocusingNote(focusing(), key)).toBe(true);
    expect(noteOf(id)).toBe(expected);
    expect(useOutputCommentFocusStore.getState().focus).toEqual({ surfaceId: SURFACE_ID, id });
  });

  it("lets through a key that edits no text", () => {
    const id = openComment("hello");

    expect(typeIntoFocusingNote(focusing(), "Shift")).toBe(false);
    expect(noteOf(id)).toBe("hello");
  });

  it("lets the key through and stops waiting when the card's row isn't rendered", () => {
    const id = openComment("w");

    expect(typeIntoFocusingNote(focusing({ isCardRowRendered: false }), "h")).toBe(false);
    expect(noteOf(id)).toBe("w");
    expect(useOutputCommentFocusStore.getState().focus).toBeNull();
  });

  it("leaves a note another pane is focusing alone", () => {
    const id = openComment("w");

    expect(typeIntoFocusingNote(focusing({ surfaceId: "surface-2" }), "h")).toBe(false);
    expect(noteOf(id)).toBe("w");
    expect(useOutputCommentFocusStore.getState().focus).toEqual({ surfaceId: SURFACE_ID, id });
  });
});

describe("pasteIntoFocusingNote", () => {
  it.each([
    [
      "appends the pasted text and names the comment it joined",
      " this\nplease",
      "see this\nplease",
    ],
    ["names the comment for a paste of images alone", "", "see"],
  ])("%s", (_, pasted, expected) => {
    const id = openComment("see");

    expect(pasteIntoFocusingNote(focusing(), pasted)).toBe(id);
    expect(noteOf(id)).toBe(expected);
  });

  it("joins nothing while no note is waiting for focus", () => {
    expect(pasteIntoFocusingNote(focusing(), "text")).toBeNull();
  });
});
