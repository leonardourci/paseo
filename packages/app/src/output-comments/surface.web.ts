import type { CSSProperties } from "react";
import { CHAT_SCROLL_SELECTOR } from "@/assistant-selection-copy/content.web";

export const SURFACE_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

/** The nearest ancestor holding a chat, so lookups stay in this pane when another shows it too. */
export function surfaceRootOf(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current && !current.querySelector(CHAT_SCROLL_SELECTOR)) current = current.parentElement;
  return current;
}
