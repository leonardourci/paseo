import { findRenderedQuote } from "@/agent-stream/chat-find/ranges.web";
import type { QuoteAnchor } from "./fence";
import { pickOccurrence, quotePlainText } from "./match";
import { findReplies } from "./selection.web";

interface QuoteRangeInput {
  root: HTMLElement;
  anchor: QuoteAnchor;
}

/** The quote's text in its rendered, complete reply, or null while that reply lacks it. */
export function rangeForQuote({ root, anchor }: QuoteRangeInput): Range | null {
  const quote = quotePlainText(anchor);
  for (const reply of findReplies(root, anchor.sourceItemId)) {
    const { text, matches } = findRenderedQuote(reply, quote);
    const match = matches[pickOccurrence(text, matches, anchor)];
    if (match) return match.range;
  }
  return null;
}
