const BLOCKS = ["p", "pre", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"]
  .map((tag) => `[data-paseo-markdown-tag="${tag}"]`)
  .join(",");
const IGNORED =
  '[data-paseo-markdown-ignore="true"], [aria-hidden="true"], button, [role="button"], svg, script, style';

/** The rows of one message, in reading order. Each is one Markdown block. */
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
function textGroups(row: HTMLElement, isQuote: boolean): Iterable<TextPoint[]> {
  const groups = new Map<Element, TextPoint[]>();
  for (const content of row.querySelectorAll<HTMLElement>('[data-message-text="true"]')) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof Text) || node.parentElement?.closest(IGNORED)) continue;
      const block = node.parentElement?.closest(BLOCKS) ?? content;
      const group = isQuote ? content : block;
      const points = groups.get(group) ?? [];
      points.push({ node, block, start: 0, end: 0 });
      groups.set(group, points);
    }
  }
  return groups.values();
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
  for (const points of textGroups(row, isQuote)) {
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
