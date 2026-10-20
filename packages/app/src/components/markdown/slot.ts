import { createContext, type ReactNode } from "react";

export interface MarkdownBlocksInput {
  /** The reply's Markdown blocks, as `splitMarkdownBlocks` splits what is revealed of it. */
  blocks: readonly string[];
  /** Renders a piece of Markdown as the reply renders its text. */
  renderMarkdown: (text: string) => ReactNode;
}

/**
 * Lays out a reply's blocks with what goes between and inside them. Null renders the reply as one
 * Markdown text.
 */
export type RenderMarkdownBlocks = (input: MarkdownBlocksInput) => ReactNode;

export const MarkdownBlocksContext = createContext<RenderMarkdownBlocks | null>(null);
