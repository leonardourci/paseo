const BLOCKS = ["p", "pre", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"]
  .flatMap((tag) => [tag, `[data-paseo-markdown-tag="${tag}"]`])
  .join(",");
const IGNORED =
  '[data-paseo-markdown-ignore="true"], [aria-hidden="true"], button, [role="button"], svg, script, style';

/** Rendered rows carrying a source message identity, in reading order. */
export function findMessageRows(root: HTMLElement | null, messageId: string): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`),
  );
}

/** Occurrences in one message, ordered by row and then by position inside the row. */
export function findMessageMatches(
  root: HTMLElement | null,
  messageId: string,
  query: string,
): Range[] {
  return findMessageRows(root, messageId).flatMap((row) => findRenderedMatches(row, query));
}

interface RenderedMatchOptions {
  /**
   * "quote" counts occurrences the way an output comment's quote does in its Markdown: matching
   * case, reading the row as one text with its blocks (list items, table cells) joined by a space,
   * and finding occurrences that start inside the one before, as in "aa" twice in "aaa".
   */
  mode?: "find" | "quote";
}

interface TextPoint {
  node: Text;
  block: Element;
  start: number;
  end: number;
}

/** The row's text nodes, grouped into the texts a match may run across. */
function renderedTextGroups(row: HTMLElement, isQuote: boolean): TextPoint[][] {
  const groups: TextPoint[][] = [];
  // A plugin renderer owns the DOM of the message it replaced and sets no markers, so the
  // whole row is searched and each div (a React Native View or Text) bounds a match.
  const pluginRow = row.dataset.pluginRow === "true";
  const blocks = pluginRow ? `${BLOCKS},div` : BLOCKS;
  const contents = pluginRow
    ? [row]
    : row.querySelectorAll<HTMLElement>('[data-message-text="true"]');
  for (const content of contents) {
    let group: { block: Element; points: TextPoint[] } | undefined;
    // A quote reads the whole content as one text.
    const contentPoints: TextPoint[] = [];
    const walker = document.createTreeWalker(
      content,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node instanceof Element) {
        // Even an empty nested block separates the text before and after it.
        if (node.matches(blocks)) group = undefined;
        continue;
      }
      if (!(node instanceof Text) || node.parentElement?.closest(IGNORED)) continue;
      if (
        pluginRow &&
        !node.parentElement?.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        continue;
      const block = node.parentElement?.closest(blocks) ?? content;
      const point = { node, block, start: 0, end: 0 };
      if (isQuote) {
        contentPoints.push(point);
        continue;
      }
      if (group?.block !== block) {
        group = { block, points: [] };
        groups.push(group.points);
      }
      group.points.push(point);
    }
    if (contentPoints.length > 0) groups.push(contentPoints);
  }
  return groups;
}

/** Local offsets belong to the DOM that supplied the text, never to a host parser. */
export function findRenderedMatches(
  row: HTMLElement,
  query: string,
  { mode = "find" }: RenderedMatchOptions = {},
): Range[] {
  if (!query.trim()) return [];
  const isQuote = mode === "quote";
  const pattern = query
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const flags = isQuote ? "gu" : "giu";
  const ranges: Range[] = [];
  for (const points of renderedTextGroups(row, isQuote)) {
    let text = "";
    let block: Element | null = null;
    for (const point of points) {
      if (block && point.block !== block) text += " ";
      block = point.block;
      point.start = text.length;
      text += point.node.data;
      point.end = text.length;
    }
    const regex = new RegExp(pattern, flags);
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      if (isQuote) regex.lastIndex = match.index + 1;
      const start = points.find((point) => point.start <= match.index && point.end > match.index);
      const endOffset = match.index + match[0].length;
      const end = points.find((point) => point.start < endOffset && point.end >= endOffset);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, match.index - start.start);
      range.setEnd(end.node, endOffset - end.start);
      ranges.push(range);
    }
  }
  return ranges;
}
