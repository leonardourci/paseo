import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { referenceDefinitionsOf } from "./fence/mermaid/segments";

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

function throughLastDefinitionLine(markdown: string): string {
  const last = markdown.lastIndexOf("]:");
  if (last === -1) return "";
  const end = markdown.indexOf("\n", last);
  return end === -1 ? markdown : markdown.slice(0, end);
}

/**
 * The reply laid out by block, as `MarkdownBlocksContext` lays it out, or null to render it as one
 * Markdown text. A block renders on its own, so it leads with the reply's reference definitions.
 */
export function useMarkdownBlocks(
  markdown: string,
  renderMarkdown: (text: string) => ReactNode,
): ReactNode | null {
  const renderBlocks = useContext(MarkdownBlocksContext);
  const isByBlock = renderBlocks !== null;
  const blocks = useMemo(
    () => (isByBlock ? splitMarkdownBlocks(markdown) : null),
    [isByBlock, markdown],
  );
  const definitionLines = isByBlock ? throughLastDefinitionLine(markdown) : "";
  const definitions = useMemo(() => referenceDefinitionsOf(definitionLines), [definitionLines]);
  const renderBlockMarkdown = useCallback(
    (text: string) => renderMarkdown(definitions ? `${definitions}\n\n${text}` : text),
    [definitions, renderMarkdown],
  );
  return renderBlocks && blocks
    ? renderBlocks({ blocks, renderMarkdown: renderBlockMarkdown })
    : null;
}
