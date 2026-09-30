import { useEffect, useMemo, useState } from "react";
import { appendTranscript } from "@/composer/input/state";
import type { DictationStatus } from "@/hooks/use-dictation.shared";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useOutputCommentsComposer } from "./composer-context";
import {
  findComment,
  isSendable,
  useOutputCommentFocusStore,
  useOutputCommentsStore,
} from "./store";

interface NoteRange {
  start: number;
  end: number;
}

export interface FocusedNote {
  id: string;
  range: NoteRange;
}

/** What a pane's output offers dictation. Only the web's selection layer provides one. */
interface DictationSurface {
  draftKey: string;
  focusedNote: () => FocusedNote | null;
  /** Comments on the output's selection as typing over it does; null without a selection. */
  startCommentOnSelection: () => string | null;
  /**
   * Whether a transcript may take focus to its note: this pane has focus, in a window that has it,
   * and no field is being typed in.
   */
  canFocusNote: () => boolean;
}

interface CommentTarget {
  surfaceId: string;
  draftKey: string;
  id: string;
}

interface TranscriptInsert {
  note: string;
  text: string;
  range: NoteRange;
}

interface InsertedTranscript {
  note: string;
  caret: number;
}

interface OutputCommentDictation {
  /** Picks where the transcript goes; a dictation under way keeps its pick. */
  begin: () => void;
  /** False when the transcript is the composer's. */
  deliver: (text: string) => boolean;
}

const surfaces = new Map<string, DictationSurface>();
const commentTargets = new Set<string>();

export function registerDictationSurface(surfaceId: string, surface: DictationSurface): () => void {
  surfaces.set(surfaceId, surface);
  return () => {
    if (surfaces.get(surfaceId) === surface) surfaces.delete(surfaceId);
  };
}

/** A note dictation is filling stays while empty, so it is there when the transcript lands. */
export function isDictationTarget(id: string): boolean {
  return commentTargets.has(id);
}

function insertTranscript({ note, text, range }: TranscriptInsert): InsertedTranscript {
  const before = appendTranscript(note.slice(0, range.start), text);
  const after = note.slice(range.end);
  const gap = after.length > 0 && !/^\s/.test(after) ? " " : "";
  return { note: `${before}${gap}${after}`, caret: before.length };
}

function pickTarget(surfaceId: string): CommentTarget | null {
  const surface = surfaces.get(surfaceId);
  if (!surface) return null;
  const id = surface.focusedNote()?.id ?? surface.startCommentOnSelection();
  return id === null ? null : { surfaceId, draftKey: surface.draftKey, id };
}

/** As a blur would: an empty note goes unless it still has focus. */
function releaseTarget(target: CommentTarget, imageIds: readonly string[]): void {
  const comment = findComment(useOutputCommentsStore.getState().drafts, target);
  const isFocused = surfaces.get(target.surfaceId)?.focusedNote()?.id === target.id;
  if (comment && !isSendable(comment, imageIds) && !isFocused) {
    useOutputCommentsStore
      .getState()
      .deleteComments({ draftKey: target.draftKey, ids: [target.id] });
  }
}

/** Where a composer's dictation goes: picked as it starts, let go once it is idle again. */
export function useOutputCommentDictation(status: DictationStatus): OutputCommentDictation {
  const composer = useOutputCommentsComposer();
  const [target, setTarget] = useState<CommentTarget | null>(null);
  // Idle straight after `begin` too, when the dictation didn't start.
  const activeTarget = status === "idle" ? null : target;
  const release = useStableEvent((released: CommentTarget) => {
    const imageIds = composer?.images.map((image) => image.id) ?? [];
    releaseTarget(released, imageIds);
  });

  useEffect(() => {
    if (!activeTarget) return;
    commentTargets.add(activeTarget.id);
    return () => {
      commentTargets.delete(activeTarget.id);
      release(activeTarget);
    };
  }, [activeTarget, release]);

  const begin = useStableEvent(() => {
    if (status === "recording" || status === "uploading") return;
    setTarget(composer ? pickTarget(composer.surfaceId) : null);
  });

  const deliver = useStableEvent((text: string): boolean => {
    if (!activeTarget) return false;
    const { surfaceId, draftKey, id } = activeTarget;
    const comment = findComment(useOutputCommentsStore.getState().drafts, activeTarget);
    // Removed while dictating: its transcript goes with it.
    if (!comment) return true;
    const surface = surfaces.get(surfaceId);
    const focused = surface?.focusedNote();
    const noteRange = focused?.id === id ? focused.range : null;
    const atEnd = { start: comment.note.length, end: comment.note.length };
    const inserted = insertTranscript({ note: comment.note, text, range: noteRange ?? atEnd });
    useOutputCommentsStore.getState().updateNote({ draftKey, id, note: inserted.note });
    if (noteRange || surface?.canFocusNote()) {
      useOutputCommentFocusStore.getState().focusNote({ surfaceId, id, caret: inserted.caret });
    }
    return true;
  });

  return useMemo(() => ({ begin, deliver }), [begin, deliver]);
}
