import type { QuoteAnchor } from "./fence";
import { useOutputCommentFocusStore, useOutputCommentsStore } from "./store";

interface FocusingNoteInput {
  draftKey: string;
  surfaceId: string;
  isCardRowRendered: (anchor: QuoteAnchor) => boolean;
}

function noteAfterKey(note: string, key: string): string | null {
  if (key === "Enter") return `${note}\n`;
  if (key === "Backspace") return Array.from(note).slice(0, -1).join("");
  return key.length === 1 ? `${note}${key}` : null;
}

/**
 * Input can outrun a new note taking focus; it goes into the note, as it would have once focused.
 * A card whose row isn't rendered can't take focus, so its note stops waiting and the input goes
 * where it was aimed. Returns the edited comment's id, or null when the input isn't the note's.
 */
function editFocusingNote(
  { draftKey, surfaceId, isCardRowRendered }: FocusingNoteInput,
  edit: (note: string) => string | null,
): string | null {
  const { focus, clearFocus } = useOutputCommentFocusStore.getState();
  const { drafts, updateNote } = useOutputCommentsStore.getState();
  if (focus?.surfaceId !== surfaceId) return null;
  const comment = drafts[draftKey]?.find((candidate) => candidate.id === focus.id);
  if (!comment) return null;
  if (!isCardRowRendered(comment)) {
    clearFocus(focus);
    return null;
  }
  const note = edit(comment.note);
  if (note === null) return null;
  updateNote({ draftKey, id: comment.id, note });
  return comment.id;
}

/** False when the key edits no text or the note isn't waiting for focus. */
export function typeIntoFocusingNote(input: FocusingNoteInput, key: string): boolean {
  return editFocusingNote(input, (note) => noteAfterKey(note, key)) !== null;
}

/** The comment the pasted text joined, so pasted images can join it too. */
export function pasteIntoFocusingNote(input: FocusingNoteInput, text: string): string | null {
  return editFocusingNote(input, (note) => `${note}${text}`);
}
