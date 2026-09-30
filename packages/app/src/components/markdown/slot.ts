import { createContext, type ReactNode } from "react";

/**
 * A place in a block's Markdown: after its top-level node `node`, counted as the body's children,
 * after the list item at `item`, the path from `getMarkdownListItemPath`, or after the body's last
 * child for top-level nodes from `rest` on, which the body didn't render.
 */
export type MarkdownSlot = { node: number } | { item: readonly number[] } | { rest: number };

export type RenderMarkdownSlot = (slot: MarkdownSlot) => ReactNode;

export const MarkdownSlotContext = createContext<RenderMarkdownSlot | null>(null);
