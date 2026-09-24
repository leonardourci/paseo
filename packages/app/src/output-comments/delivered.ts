import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import type { StreamItem } from "@/types/stream";
import {
  EMPTY_DELIVERED_COMMENTS,
  resolveDeliveredOutputComments,
  throughLastCommentTurn,
  type DeliveredOutputComments,
} from "./match";

interface DeliveredTurns {
  /** The items through the last turn with comments, which holds every output they target. */
  items: readonly StreamItem[];
  delivered: DeliveredOutputComments;
}

const EMPTY_TURNS: DeliveredTurns = { items: [], delivered: EMPTY_DELIVERED_COMMENTS };

export function useDeliveredTurns(items: readonly StreamItem[]): DeliveredTurns {
  const resolved = useRef(EMPTY_TURNS);
  return useMemo(() => {
    // Sent comments target earlier output, so the streaming head can't move them.
    const turns = throughLastCommentTurn(items);
    if (!shallow(resolved.current.items, turns)) {
      resolved.current = { items: turns, delivered: resolveDeliveredOutputComments(turns) };
    }
    return resolved.current;
  }, [items]);
}
