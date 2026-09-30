import { findRenderedMatches } from "@/agent-stream/chat-find/ranges.web";
import type { QuoteAnchor } from "./fence";
import { messageRowsByBlock, quotePiecesInRows } from "./selection.web";
import type { MessageBlocks } from "./types";

interface QuoteRangesInput {
  root: HTMLElement;
  anchor: QuoteAnchor;
  blocks: MessageBlocks;
}

export function rangesForQuote({ root, anchor, blocks }: QuoteRangesInput): Range[] {
  const rowsByBlock = messageRowsByBlock(root, anchor.sourceItemId);
  const ranges: Range[] = [];
  const pieces = quotePiecesInRows({ rows: rowsByBlock, anchor, blocks });
  for (const [offset, piece] of pieces.entries()) {
    const row = rowsByBlock.get(anchor.startBlock + offset);
    if (!row) continue;
    const matches = findRenderedMatches(row, piece, { mode: "quote" });
    const occurrence = offset === 0 ? anchor.occurrence : 0;
    const match = matches[occurrence] ?? matches[0];
    if (match) ranges.push(match);
  }
  return ranges;
}
