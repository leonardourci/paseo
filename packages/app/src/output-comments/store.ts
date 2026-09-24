import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { generateMessageId } from "@/types/stream";
import type { QuoteAnchor } from "./fence";

/** Where a comment points, which never changes after it is made. */
export interface PlacedOutputComment extends QuoteAnchor {
  id: string;
}

export interface PendingOutputComment extends PlacedOutputComment {
  note: string;
}

interface NewOutputComment extends QuoteAnchor {
  draftKey: string;
}

interface CommentRef {
  draftKey: string;
  id: string;
}

interface NoteUpdate extends CommentRef {
  note: string;
}

export type SentOutputComment = Pick<PendingOutputComment, "id" | "note">;

interface SentComments {
  draftKey: string;
  comments: readonly SentOutputComment[];
}

interface RestoredComments {
  draftKey: string;
  comments: readonly PendingOutputComment[];
}

interface MovedSources {
  draftKey: string;
  /** Each moved comment's id, with the id its output has now. */
  sourceItemIds: ReadonlyMap<string, string>;
}

type PendingDrafts = Record<string, PendingOutputComment[]>;

interface PersistedOutputComments {
  drafts: PendingDrafts;
}

interface OutputCommentsStore {
  drafts: PendingDrafts;
  addComment: (target: NewOutputComment, note: string) => string;
  updateNote: (update: NoteUpdate) => void;
  deleteComment: (ref: CommentRef) => void;
  removeSent: (sent: SentComments) => void;
  restoreComments: (restored: RestoredComments) => void;
  moveSources: (moved: MovedSources) => void;
  clearDraft: (draftKey: string) => void;
}

interface LoadedOutputStore {
  /**
   * Per draft, the ids of the assistant messages its stream has loaded, in stream order; absent
   * until a stream shows that agent.
   */
  assistantIds: Record<string, readonly string[]>;
  setLoaded: (draftKey: string, assistantIds: readonly string[]) => void;
}

interface ExpandedSentCommentsStore {
  itemIds: ReadonlySet<string>;
  toggle: (itemId: string) => void;
}

/** A pending comment's note in one pane, since two panes can show the same agent. */
interface NoteFocus {
  surfaceId: string;
  id: string;
}

interface OutputCommentFocusStore {
  /** The note that takes focus once its card renders. */
  focus: NoteFocus | null;
  /** The comment, pending or delivered, whose card and quote stand out. */
  activeKey: string | null;
  focusNote: (focus: NoteFocus) => void;
  clearFocus: (focus: NoteFocus) => void;
  setActiveKey: (key: string | null) => void;
}

export const EMPTY_PENDING_COMMENTS: readonly PendingOutputComment[] = [];

const STORE_VERSION = 1;

const PendingOutputCommentSchema: z.ZodType<PendingOutputComment> = z.strictObject({
  id: z.string(),
  sourceItemId: z.string(),
  startBlock: z.number().int().nonnegative(),
  endBlock: z.number().int().nonnegative(),
  quote: z.string(),
  occurrence: z.number().int().nonnegative(),
  isCode: z.boolean(),
  note: z.string(),
});

const PersistedOutputCommentsSchema: z.ZodType<PersistedOutputComments> = z.strictObject({
  drafts: z.record(z.string(), z.array(PendingOutputCommentSchema)),
});

function withDraft(
  drafts: PendingDrafts,
  draftKey: string,
  comments: PendingOutputComment[],
): PendingDrafts {
  const { [draftKey]: _replaced, ...others } = drafts;
  return comments.length > 0 ? { ...others, [draftKey]: comments } : others;
}

function withComment(
  state: OutputCommentsStore,
  { draftKey, id }: CommentRef,
  update: (comment: PendingOutputComment) => PendingOutputComment,
): Partial<OutputCommentsStore> {
  const existing = state.drafts[draftKey] ?? [];
  const index = existing.findIndex((comment) => comment.id === id);
  const current = existing[index];
  if (!current) return state;
  const next = [...existing];
  next[index] = update(current);
  return { drafts: withDraft(state.drafts, draftKey, next) };
}

function indexOfSameText(pending: readonly PendingOutputComment[], target: QuoteAnchor): number {
  const quote = target.quote.trim();
  return pending.findIndex(
    (comment) =>
      comment.sourceItemId === target.sourceItemId &&
      comment.startBlock === target.startBlock &&
      comment.occurrence === target.occurrence &&
      comment.quote.trim() === quote,
  );
}

function joinNotes(first: string, second: string): string {
  if (second.length === 0) return first;
  return first.length > 0 ? `${first}\n${second}` : second;
}

export const useOutputCommentsStore = create<OutputCommentsStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      addComment: ({ draftKey, ...target }, note) => {
        const { drafts } = get();
        const pending = drafts[draftKey] ?? EMPTY_PENDING_COMMENTS;
        const index = indexOfSameText(pending, target);
        const same = pending[index];
        if (same) {
          const next = [...pending];
          next[index] = { ...same, note: joinNotes(same.note, note) };
          set({ drafts: withDraft(drafts, draftKey, next) });
          return same.id;
        }
        const comment: PendingOutputComment = { ...target, id: generateMessageId(), note };
        set({ drafts: withDraft(drafts, draftKey, [...pending, comment]) });
        return comment.id;
      },
      updateNote: ({ note, ...ref }) =>
        set((state) => withComment(state, ref, (comment) => ({ ...comment, note }))),
      deleteComment: ({ draftKey, id }) =>
        set((state) => {
          const pending = state.drafts[draftKey] ?? [];
          const remaining = pending.filter((comment) => comment.id !== id);
          return { drafts: withDraft(state.drafts, draftKey, remaining) };
        }),
      removeSent: ({ draftKey, comments }) =>
        set((state) => {
          const sentNotes = new Map(comments.map((comment) => [comment.id, comment.note]));
          // A note edited while its message was in flight stays for the next one.
          const remaining = (state.drafts[draftKey] ?? []).filter(
            (comment) => sentNotes.get(comment.id) !== comment.note,
          );
          return { drafts: withDraft(state.drafts, draftKey, remaining) };
        }),
      // A comment made on the same text while the message was queued joins the restored one.
      restoreComments: ({ draftKey, comments }) =>
        set((state) => {
          const next = [...(state.drafts[draftKey] ?? [])];
          for (const restored of comments) {
            const index = indexOfSameText(next, restored);
            const same = next[index];
            if (!same) {
              next.push(restored);
              continue;
            }
            next[index] = { ...same, note: joinNotes(same.note, restored.note) };
          }
          return { drafts: withDraft(state.drafts, draftKey, next) };
        }),
      moveSources: ({ draftKey, sourceItemIds }) =>
        set((state) => {
          const next = [...(state.drafts[draftKey] ?? [])];
          for (const [index, comment] of next.entries()) {
            const sourceItemId = sourceItemIds.get(comment.id);
            if (sourceItemId) next[index] = { ...comment, sourceItemId };
          }
          return { drafts: withDraft(state.drafts, draftKey, next) };
        }),
      clearDraft: (draftKey) =>
        set((state) =>
          state.drafts[draftKey] ? { drafts: withDraft(state.drafts, draftKey, []) } : state,
        ),
    }),
    {
      name: "@paseo:output-comments",
      version: STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedOutputCommentsSchema),
      partialize: (state): PersistedOutputComments => ({ drafts: state.drafts }),
    },
  ),
);

/** Kept apart from the comments so that streaming output never writes their storage. */
export const useLoadedOutputStore = create<LoadedOutputStore>()((set, get) => ({
  assistantIds: {},
  setLoaded: (draftKey, assistantIds) => {
    if (!shallow(get().assistantIds[draftKey], assistantIds)) {
      set((state) => ({ assistantIds: { ...state.assistantIds, [draftKey]: assistantIds } }));
    }
  },
}));

export function isFocusing(focus: NoteFocus | null, note: NoteFocus): boolean {
  return focus?.id === note.id && focus.surfaceId === note.surfaceId;
}

export const useOutputCommentFocusStore = create<OutputCommentFocusStore>()((set) => ({
  focus: null,
  activeKey: null,
  focusNote: (focus) => set({ focus }),
  clearFocus: (note) => set((state) => (isFocusing(state.focus, note) ? { focus: null } : state)),
  setActiveKey: (key) => set((state) => (state.activeKey === key ? state : { activeKey: key })),
}));

/** Outside the message, so a row the list remounts reopens as it was left. */
export const useExpandedSentCommentsStore = create<ExpandedSentCommentsStore>()((set) => ({
  itemIds: new Set(),
  toggle: (itemId) =>
    set((state) => {
      const itemIds = new Set(state.itemIds);
      if (!itemIds.delete(itemId)) itemIds.add(itemId);
      return { itemIds };
    }),
}));

/**
 * A comment on output that isn't loaded is held: not shown, numbered or sent. With no output
 * loaded yet, all count. A comment's number is its position in this list.
 */
export function loadedComments(
  pending: readonly PendingOutputComment[],
  loaded: readonly string[] | undefined,
): PendingOutputComment[] {
  return pending.filter((comment) => loaded === undefined || loaded.includes(comment.sourceItemId));
}

export function isSendable(comment: PendingOutputComment): boolean {
  return comment.note.trim().length > 0;
}
