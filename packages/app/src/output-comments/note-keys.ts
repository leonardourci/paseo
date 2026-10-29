import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { isEditingSurface } from "@/output-caret/host";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { isDictatingIntoNote, type FocusedNote } from "./dictation";
import type { QuoteAnchor } from "./fence";
import {
  findComment,
  useOutputCommentFocusStore,
  useOutputCommentsStore,
  type PendingOutputComment,
} from "./store";

interface FocusingNoteInput {
  draftKey: string;
  surfaceId: string;
  isCardRowRendered: (anchor: QuoteAnchor) => boolean;
}

const enabledSurfaces = new Map<string, FocusingNoteInput>();

/** Input aimed at the output, not at a field or an overlay. */
export function isOutputEvent(event: Event): boolean {
  return (
    !event.defaultPrevented && !hasActiveWebOverlay() && !isEditingSurface(document.activeElement)
  );
}

export function isOutputKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || isImeComposingKeyboardEvent(event)) {
    return false;
  }
  return isOutputEvent(event);
}

function noteAfterKey(note: string, key: string): string | null {
  if (key === "Enter") return `${note}\n`;
  if (key === "Backspace") return Array.from(note).slice(0, -1).join("");
  return key.length === 1 ? `${note}${key}` : null;
}

/**
 * Input can outrun a new note taking focus, or its card is offscreen; it goes into the note, as it
 * would have once focused, unless a dictation is filling a note. A card whose row isn't rendered
 * can't take focus, so its note stops waiting and the input goes where it was aimed.
 */
function focusingComment({
  draftKey,
  surfaceId,
  isCardRowRendered,
}: FocusingNoteInput): PendingOutputComment | null {
  const { focus, clearFocus } = useOutputCommentFocusStore.getState();
  if (focus?.surfaceId !== surfaceId || isDictatingIntoNote()) return null;
  const comment = findComment(useOutputCommentsStore.getState().drafts, { draftKey, id: focus.id });
  if (!comment) return null;
  if (!isCardRowRendered(comment)) {
    clearFocus(focus);
    return null;
  }
  return comment;
}

/** Returns the edited comment's id, or null when the input isn't the note's. */
function editFocusingNote(
  input: FocusingNoteInput,
  edit: (note: string) => string | null,
): string | null {
  const comment = focusingComment(input);
  if (!comment) return null;
  const note = edit(comment.note);
  if (note === null) return null;
  useOutputCommentsStore.getState().updateNote({ draftKey: input.draftKey, id: comment.id, note });
  return comment.id;
}

/**
 * While a surface is enabled, its waiting note takes keys before the global shortcuts. Ending that
 * stops the note waiting.
 */
export function enableFocusingNotes(input: FocusingNoteInput): () => void {
  enabledSurfaces.set(input.surfaceId, input);
  return () => {
    if (enabledSurfaces.get(input.surfaceId) === input) enabledSurfaces.delete(input.surfaceId);
    const { focus, clearFocus } = useOutputCommentFocusStore.getState();
    if (focus?.surfaceId === input.surfaceId) clearFocus(focus);
  };
}

/** Whether an enabled surface's waiting note takes the key, so a global shortcut must not. */
export function isFocusingNoteKey(event: KeyboardEvent): boolean {
  const focus = useOutputCommentFocusStore.getState().focus;
  const input = focus ? enabledSurfaces.get(focus.surfaceId) : undefined;
  if (!input || !isOutputKey(event) || !focusingComment(input)) return false;
  return event.key === "Escape" || noteAfterKey("", event.key) !== null;
}

/** The waiting note, with its caret at the end, as dictation reads a focused note. */
export function readFocusingNote(input: FocusingNoteInput): FocusedNote | null {
  const comment = focusingComment(input);
  if (!comment) return null;
  return { id: comment.id, range: { start: comment.note.length, end: comment.note.length } };
}

/** False when the key edits no text or the note isn't waiting for focus. Escape stops the wait. */
export function typeIntoFocusingNote(input: FocusingNoteInput, key: string): boolean {
  if (key !== "Escape") return editFocusingNote(input, (note) => noteAfterKey(note, key)) !== null;
  const comment = focusingComment(input);
  if (!comment) return false;
  useOutputCommentFocusStore.getState().clearFocus({ surfaceId: input.surfaceId, id: comment.id });
  return true;
}

/** The comment the pasted text joined, so pasted images can join it too. */
export function pasteIntoFocusingNote(input: FocusingNoteInput, text: string): string | null {
  return editFocusingNote(input, (note) => `${note}${text}`);
}
