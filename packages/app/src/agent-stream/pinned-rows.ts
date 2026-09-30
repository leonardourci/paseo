import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import type { StreamItem } from "@/types/stream";

interface PinnedRowsInput {
  rows: readonly StreamItem[];
  chatFindRowIndexes: readonly number[] | null;
  caretRowId: string | null;
}

/** Chat find's rows and the output caret's row, the same array while they stay the same. */
export function usePinnedRowIndexes(input: PinnedRowsInput): readonly number[] | null {
  const { rows, chatFindRowIndexes, caretRowId } = input;
  const pinned = useRef<readonly number[] | null>(null);
  return useMemo(() => {
    const caretRowIndex = caretRowId === null ? -1 : rows.findIndex((row) => row.id === caretRowId);
    const caretRowIndexes = caretRowIndex === -1 ? [] : [caretRowIndex];
    const indexes = [...(chatFindRowIndexes ?? []), ...caretRowIndexes];
    const next = indexes.length > 0 ? indexes : null;
    if (!shallow(pinned.current, next)) pinned.current = next;
    return pinned.current;
  }, [caretRowId, chatFindRowIndexes, rows]);
}
