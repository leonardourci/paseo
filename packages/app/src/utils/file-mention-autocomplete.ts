export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function formatQuotedFileMentionPath(relativePath: string): string {
  const safePath = relativePath.replace(/"/g, '\\"');
  return `"${safePath}"`;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatQuotedFileMentionPath(input.relativePath)}${after}`;
}

interface CaretAfterFileMentionReplacementInput {
  previousText: string;
  cursorIndex: number;
  nextText: string;
}

/** Right after the inserted path: the replacement keeps everything after the cursor. */
export function caretAfterFileMentionReplacement(
  input: CaretAfterFileMentionReplacementInput,
): number {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.previousText.length));
  return input.nextText.length - (input.previousText.length - clampedCursor);
}
