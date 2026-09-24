import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, describe, expect, it } from "vitest";
import type { QuoteAnchor } from "./fence";
import { prepareOutgoingText } from "./send";
import {
  isSendable,
  loadedComments,
  useLoadedOutputStore,
  useOutputCommentFocusStore,
  useOutputCommentsStore,
} from "./store";

const DRAFT_KEY = "draft-1";
const FIRST: QuoteAnchor = {
  sourceItemId: "a1",
  startBlock: 0,
  endBlock: 0,
  quote: "alpha",
  occurrence: 0,
  isCode: false,
};
const SECOND: QuoteAnchor = {
  sourceItemId: "a1",
  startBlock: 2,
  endBlock: 2,
  quote: "beta",
  occurrence: 0,
  isCode: false,
};

function addComment(target: QuoteAnchor, note: string): string {
  return useOutputCommentsStore.getState().addComment({ ...target, draftKey: DRAFT_KEY }, note);
}

function pendingComments() {
  return useOutputCommentsStore.getState().drafts[DRAFT_KEY] ?? [];
}

afterEach(() => {
  useOutputCommentsStore.setState({ drafts: {} });
  useLoadedOutputStore.setState({ assistantIds: {} });
  useOutputCommentFocusStore.setState({ focus: null, activeKey: null });
});

describe("useOutputCommentsStore", () => {
  it("adds a comment holding the typed key", () => {
    const id = addComment(FIRST, "w");
    expect(pendingComments()).toEqual([{ ...FIRST, id, note: "w", imageIds: [] }]);
  });

  it("appends to the pending comment on the same text instead of adding one", () => {
    const first = addComment(FIRST, "why");
    const again = addComment({ ...FIRST, quote: " alpha\n" }, "h");
    expect(again).toBe(first);
    expect(pendingComments()).toEqual([{ ...FIRST, id: first, note: "why\nh", imageIds: [] }]);
  });

  it("leaves the joined comment's note as it is when there is nothing to add", () => {
    const first = addComment(FIRST, "why");
    expect(addComment(FIRST, "")).toBe(first);
    expect(pendingComments()).toEqual([{ ...FIRST, id: first, note: "why", imageIds: [] }]);
  });

  it.each([
    ["a different quote", { ...FIRST, quote: "alphabet" }],
    ["the same quote in another output", { ...FIRST, sourceItemId: "a2" }],
    ["the same quote in another paragraph", { ...FIRST, startBlock: 1, endBlock: 1 }],
    ["the same quote repeated in the same paragraph", { ...FIRST, occurrence: 1 }],
  ])("adds a second comment for %s", (_, other: QuoteAnchor) => {
    const first = addComment(FIRST, "one");
    const second = addComment(other, "two");
    expect(pendingComments()).toEqual([
      { ...FIRST, id: first, note: "one", imageIds: [] },
      { ...other, id: second, note: "two", imageIds: [] },
    ]);
    expect(addComment(other, "more")).toBe(second);
  });

  it("writes each change to the note in place", () => {
    const first = addComment(FIRST, "w");
    const second = addComment(SECOND, "");
    useOutputCommentsStore.getState().updateNote({ draftKey: DRAFT_KEY, id: first, note: "why?" });
    expect(pendingComments()).toEqual([
      { ...FIRST, id: first, note: "why?", imageIds: [] },
      { ...SECOND, id: second, note: "", imageIds: [] },
    ]);
  });

  it.each([
    [
      "a note",
      (id: string) =>
        useOutputCommentsStore.getState().updateNote({ draftKey: DRAFT_KEY, id, note: "late" }),
    ],
    [
      "an image",
      (id: string) =>
        useOutputCommentsStore.getState().linkImage({ draftKey: DRAFT_KEY, id, imageId: "img-1" }),
    ],
  ])("ignores %s for a comment that is gone", (_, write) => {
    addComment(SECOND, "kept");
    const gone = addComment(FIRST, "gone");
    useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: [gone] });
    const drafts = useOutputCommentsStore.getState().drafts;
    write(gone);
    expect(useOutputCommentsStore.getState().drafts).toBe(drafts);
  });

  it("deletes one comment and drops the draft with its last one", () => {
    const first = addComment(FIRST, "first");
    const second = addComment(SECOND, "second");
    useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: [first] });
    expect(pendingComments().map((comment) => comment.id)).toEqual([second]);
    useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: [second] });
    expect(useOutputCommentsStore.getState().drafts).toEqual({});
  });

  it("links an image only to a comment that is still pending", () => {
    const first = addComment(FIRST, "");
    const { linkImage, deleteComments } = useOutputCommentsStore.getState();
    expect(linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-1" })).toBe(true);
    deleteComments({ draftKey: DRAFT_KEY, ids: [first] });
    expect(linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-2" })).toBe(false);
  });

  it("adds an image id once and removes it", () => {
    const first = addComment(FIRST, "");
    const { linkImage, unlinkImage } = useOutputCommentsStore.getState();
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-1" });
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-2" });
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-1" });
    expect(pendingComments()[0]?.imageIds).toEqual(["img-1", "img-2"]);
    unlinkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-1" });
    expect(pendingComments()[0]?.imageIds).toEqual(["img-2"]);
  });

  it("deleting a comment returns the image ids no other comment uses", () => {
    const first = addComment(FIRST, "one");
    const second = addComment(SECOND, "two");
    const { linkImage } = useOutputCommentsStore.getState();
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "mine" });
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "shared" });
    linkImage({ draftKey: DRAFT_KEY, id: second, imageId: "shared" });
    expect(
      useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: [first] }),
    ).toEqual(["mine"]);
    expect(
      useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: [second] }),
    ).toEqual(["shared"]);
    expect(
      useOutputCommentsStore.getState().deleteComments({ draftKey: DRAFT_KEY, ids: ["gone"] }),
    ).toEqual([]);
  });

  it("deleting several comments keeps the others and the images they still use", () => {
    const first = addComment(FIRST, "one");
    const second = addComment(SECOND, "two");
    const kept = addComment({ ...FIRST, sourceItemId: "a2" }, "three");
    const { linkImage } = useOutputCommentsStore.getState();
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "first-only" });
    linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "both-deleted" });
    linkImage({ draftKey: DRAFT_KEY, id: second, imageId: "both-deleted" });
    linkImage({ draftKey: DRAFT_KEY, id: second, imageId: "shared-with-kept" });
    linkImage({ draftKey: DRAFT_KEY, id: kept, imageId: "shared-with-kept" });

    expect(
      useOutputCommentsStore
        .getState()
        .deleteComments({ draftKey: DRAFT_KEY, ids: [first, second, "gone"] }),
    ).toEqual(["first-only", "both-deleted"]);
    expect(pendingComments().map((comment) => comment.id)).toEqual([kept]);
  });

  it("counts a blank note with an image still in the draft as content", () => {
    const first = addComment(FIRST, "  ");
    useOutputCommentsStore
      .getState()
      .linkImage({ draftKey: DRAFT_KEY, id: first, imageId: "img-1" });
    const comment = pendingComments()[0];
    if (!comment) throw new Error("comment missing");
    expect(isSendable(comment, ["img-1"])).toBe(true);
    expect(isSendable(comment, ["other"])).toBe(false);
    expect(isSendable({ ...comment, note: "why?" }, [])).toBe(true);
  });

  it("keeps a sent comment whose note changed while its message was in flight", () => {
    const first = addComment(FIRST, "one");
    const second = addComment(SECOND, "two");
    useOutputCommentsStore.getState().updateNote({ draftKey: DRAFT_KEY, id: second, note: "two!" });
    useOutputCommentsStore.getState().removeSent({
      draftKey: DRAFT_KEY,
      comments: [
        { id: first, note: "one" },
        { id: second, note: "two" },
      ],
    });
    expect(pendingComments().map((comment) => comment.note)).toEqual(["two!"]);
  });

  it("numbers the comments on loaded output 1..N, skipping held ones", () => {
    const held = addComment({ ...FIRST, sourceItemId: "older" }, "held");
    const first = addComment(FIRST, "one");
    const second = addComment(SECOND, "two");
    function numbered(loaded: readonly string[] | undefined) {
      return loadedComments(pendingComments(), loaded).map(({ id }, index) => [index + 1, id]);
    }
    expect(numbered(["a1"])).toEqual([
      [1, first],
      [2, second],
    ]);
    expect(numbered(undefined)).toEqual([
      [1, held],
      [2, first],
      [3, second],
    ]);
  });

  it("a send clears only the comments it sent, so held ones survive it", () => {
    addComment(FIRST, "one");
    const held = addComment({ ...SECOND, sourceItemId: "older" }, "two");
    const { drafts, removeSent } = useOutputCommentsStore.getState();
    const prepared = prepareOutgoingText({
      text: "",
      pending: drafts[DRAFT_KEY] ?? [],
      imageIds: [],
      loaded: ["a1"],
    });
    removeSent({ draftKey: DRAFT_KEY, comments: prepared.sent });
    expect(pendingComments().map((comment) => comment.id)).toEqual([held]);
  });

  it("keeps the published output when the same messages come again", () => {
    const { setLoaded } = useLoadedOutputStore.getState();
    setLoaded(DRAFT_KEY, ["a1", "a2"]);
    const published = useLoadedOutputStore.getState().assistantIds;
    setLoaded(DRAFT_KEY, ["a1", "a2"]);
    expect(useLoadedOutputStore.getState().assistantIds).toBe(published);
    setLoaded(DRAFT_KEY, ["a2", "a1"]);
    expect(useLoadedOutputStore.getState().assistantIds[DRAFT_KEY]).toEqual(["a2", "a1"]);
  });

  it("puts restored comments back, joining one on the same text as a pending comment", () => {
    const pending = addComment(FIRST, "later");
    useOutputCommentsStore
      .getState()
      .linkImage({ draftKey: DRAFT_KEY, id: pending, imageId: "img-1" });
    useOutputCommentsStore.getState().restoreComments({
      draftKey: DRAFT_KEY,
      comments: [
        { ...FIRST, quote: "alpha ", id: "restored", note: "queued", imageIds: ["img-1", "img-2"] },
        { ...SECOND, id: "other", note: "two", imageIds: [] },
      ],
    });
    expect(pendingComments()).toEqual([
      { ...FIRST, id: pending, note: "later\nqueued", imageIds: ["img-1", "img-2"] },
      { ...SECOND, id: "other", note: "two", imageIds: [] },
    ]);
  });

  it("points comments at the ids their output has now", () => {
    const first = addComment(FIRST, "one");
    const second = addComment(SECOND, "two");
    useOutputCommentsStore
      .getState()
      .moveSources({ draftKey: DRAFT_KEY, sourceItemIds: new Map([[second, "a1-reloaded"]]) });
    expect(pendingComments().map(({ id, sourceItemId }) => [id, sourceItemId])).toEqual([
      [first, "a1"],
      [second, "a1-reloaded"],
    ]);
  });

  it("clears one draft's comments and leaves the others", () => {
    addComment(FIRST, "one");
    const other = useOutputCommentsStore
      .getState()
      .addComment({ ...SECOND, draftKey: "draft-2" }, "two");
    useOutputCommentsStore.getState().clearDraft(DRAFT_KEY);
    expect(useOutputCommentsStore.getState().drafts).toEqual({
      "draft-2": [{ ...SECOND, id: other, note: "two", imageIds: [] }],
    });
  });
});

describe("useOutputCommentFocusStore", () => {
  it("clears the focus request only for the comment that took it", () => {
    const { focusNote, clearFocus } = useOutputCommentFocusStore.getState();
    const first = { surfaceId: "s1", id: "c1" };
    const second = { surfaceId: "s1", id: "c2" };
    focusNote(first);
    focusNote(second);
    clearFocus(first);
    expect(useOutputCommentFocusStore.getState().focus).toEqual(second);
    clearFocus({ ...second, surfaceId: "s2" });
    expect(useOutputCommentFocusStore.getState().focus).toEqual(second);
    clearFocus(second);
    expect(useOutputCommentFocusStore.getState().focus).toBeNull();
  });
});

describe("useOutputCommentsStore persistence", () => {
  const STORAGE_NAME = "@paseo:output-comments";

  it("brings the pending comments back after a reload", async () => {
    const inItem: QuoteAnchor = { ...FIRST, endItem: [1, 0] };
    const id = addComment(inItem, "why?");
    useOutputCommentsStore.getState().linkImage({ draftKey: DRAFT_KEY, id, imageId: "img-1" });
    const saved = await AsyncStorage.getItem(STORAGE_NAME);
    if (saved === null) throw new Error("Expected the store to be saved");
    expect(Object.keys(JSON.parse(saved).state)).toEqual(["drafts"]);

    useOutputCommentsStore.setState({ drafts: {} });
    await AsyncStorage.setItem(STORAGE_NAME, saved);
    await useOutputCommentsStore.persist.rehydrate();

    expect(pendingComments()).toEqual([{ ...inItem, id, note: "why?", imageIds: ["img-1"] }]);
  });

  it("loads comments saved before they recorded images or a list item", async () => {
    const saved = JSON.stringify({
      state: { drafts: { [DRAFT_KEY]: [{ ...FIRST, id: "c1", note: "why?" }] } },
      version: 1,
    });
    await AsyncStorage.setItem(STORAGE_NAME, saved);
    await useOutputCommentsStore.persist.rehydrate();

    expect(pendingComments()).toEqual([{ ...FIRST, id: "c1", note: "why?", imageIds: [] }]);
    expect(await AsyncStorage.getItem(STORAGE_NAME)).toBe(saved);
  });

  it("leaves the saved comments alone while streaming output is published", async () => {
    addComment(FIRST, "why?");
    await AsyncStorage.setItem(STORAGE_NAME, "untouched");
    useLoadedOutputStore.getState().setLoaded(DRAFT_KEY, ["a1"]);
    useLoadedOutputStore.getState().setLoaded(DRAFT_KEY, ["a1", "a2"]);
    expect(await AsyncStorage.getItem(STORAGE_NAME)).toBe("untouched");
  });

  it("removes a saved value that is invalid", async () => {
    const invalid = JSON.stringify({
      state: { drafts: { [DRAFT_KEY]: [{ id: "c1", note: "no anchor" }] } },
      version: 1,
    });
    await AsyncStorage.setItem(STORAGE_NAME, invalid);
    await useOutputCommentsStore.persist.rehydrate();

    expect(await AsyncStorage.getItem(STORAGE_NAME)).toBeNull();
  });
});
