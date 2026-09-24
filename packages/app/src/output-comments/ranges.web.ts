import { findMessageRows, findRenderedMatches } from "@/agent-stream/chat-find/ranges.web";
import type { QuoteAnchor } from "./fence";
import { quotePieces } from "./match";
import { blockIndexOfRow } from "./selection.web";

export function rangesForQuote(root: HTMLElement, anchor: QuoteAnchor): Range[] {
  const rowsByBlock = new Map<number, HTMLElement>();
  for (const row of findMessageRows(root, anchor.sourceItemId)) {
    const block = blockIndexOfRow(row);
    if (block !== null) rowsByBlock.set(block, row);
  }
  const ranges: Range[] = [];
  for (const [offset, piece] of quotePieces(anchor).entries()) {
    const row = rowsByBlock.get(anchor.startBlock + offset);
    if (!row) continue;
    const matches = findRenderedMatches(row, piece, { mode: "quote" });
    const occurrence = offset === 0 ? anchor.occurrence : 0;
    const match = matches[occurrence] ?? matches[0];
    if (match) ranges.push(match);
  }
  return ranges;
}
