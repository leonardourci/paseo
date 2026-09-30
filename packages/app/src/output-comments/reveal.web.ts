import { CHAT_SCROLL_SELECTOR } from "@/assistant-selection-copy/content.web";
import { rangesForQuote } from "./ranges.web";
import type { RevealQuoteInput } from "./types";

/** False when the card is in history the list hasn't rendered, so there is nothing to show. */
export function revealOutputCommentCard(cardId: string): boolean {
  const card = document.getElementById(cardId);
  card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return card !== null;
}

/** Scrolls to the quote itself: its block can be taller than the chat, so centring that misses it. */
export function revealOutputCommentQuote({ cardId, anchor, blocks }: RevealQuoteInput): void {
  const scroller = document.getElementById(cardId)?.closest<HTMLElement>(CHAT_SCROLL_SELECTOR);
  const range = scroller ? rangesForQuote({ root: scroller, anchor, blocks })[0] : undefined;
  if (!scroller || !range) return;
  const quote = range.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const isInView = quote.top >= view.top && quote.bottom <= view.bottom;
  if (isInView) return;
  const top = quote.top - view.top - (view.height - quote.height) / 2;
  scroller.scrollBy({ top, behavior: "smooth" });
}
