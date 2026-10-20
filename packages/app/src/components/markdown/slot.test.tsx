/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { parseMarkdown } from "react-native-enriched-markdown/src/web/parseMarkdown";
import type { ASTNode } from "react-native-enriched-markdown/src/web/types";
import { describe, expect, it } from "vitest";
import { MarkdownBlocksContext, type RenderMarkdownBlocks, useMarkdownBlocks } from "./slot";

const REPLY = "See [docs][1].\n\nMore text.\n\n[1]: https://x.test/docs";

const laidOut: { blocks: readonly string[]; rendered: string[] } = { blocks: [], rendered: [] };

const renderBlocks: RenderMarkdownBlocks = ({ blocks, renderMarkdown }) => {
  laidOut.blocks = blocks;
  laidOut.rendered = blocks.map((block) => renderMarkdown(block) as string);
  return laidOut.rendered.join("|");
};

function ByBlock({ children }: { children: ReactNode }) {
  return (
    <MarkdownBlocksContext.Provider value={renderBlocks}>{children}</MarkdownBlocksContext.Provider>
  );
}

function asText(text: string): string {
  return text;
}

function renderByBlock(markdown: string) {
  renderHook(() => useMarkdownBlocks(markdown, asText), { wrapper: ByBlock });
  return laidOut;
}

async function linkUrls(markdown: string): Promise<unknown[]> {
  const urls: unknown[] = [];
  const collect = (node: ASTNode) => {
    if (node.type === "Link") urls.push(node.attributes?.url);
    node.children?.forEach(collect);
  };
  collect(await parseMarkdown(markdown, { hardSoftBreaks: true, latexMath: false }));
  return urls;
}

describe("useMarkdownBlocks", () => {
  it("renders the reply as one text without a block layout", () => {
    const { result } = renderHook(() => useMarkdownBlocks(REPLY, asText));
    expect(result.current).toBeNull();
  });

  it("resolves a reference whose definition sits in a later block", async () => {
    const { blocks, rendered } = renderByBlock(REPLY);
    expect(blocks[0]).toBe("See [docs][1].");
    expect(await linkUrls(blocks[0]!)).toEqual([]);
    expect(await linkUrls(rendered[0]!)).toEqual(["https://x.test/docs"]);
  });

  it("hands blocks over unchanged when the reply defines no references", () => {
    const { blocks, rendered } = renderByBlock("One [link](https://x.test).\n\nTwo.");
    expect(rendered).toEqual(blocks);
  });
});
