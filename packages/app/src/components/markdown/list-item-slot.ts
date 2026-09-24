import { createContext, type ReactNode } from "react";

/** What goes right after a list item, given its path from `getMarkdownListItemPath`. */
export type RenderAfterListItem = (path: readonly number[]) => ReactNode;

export const ListItemSlotContext = createContext<RenderAfterListItem | null>(null);
