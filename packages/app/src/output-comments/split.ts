import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";

const parser = createAssistantMarkdownParser();
const ITEM_NUMBER = /^(\s*)\d{1,9}(?=[.)])/;

/** A piece of a block's Markdown that renders as its own text, so cards can follow it. */
export interface MarkdownPiece {
  /** Stays the same while cards before it come and go, so its text and cards don't remount. */
  key: string;
  text: string;
  /**
   * The list nesting the piece continues, its lines dedented to it: what follows a card after a
   * nested item. The view indents it as the list would.
   */
  depth: number;
  /** The slots whose cards follow the piece, innermost first. */
  slots: PieceSlot[];
  /**
   * For a piece that continues a nested list: the path of the item the list is in, and the index
   * its first item has there, so a selection in it reads the item path the source has.
   */
  continues?: { parent: number[]; start: number };
}

export interface PieceSlot {
  key: string;
  /** The list nesting of the slot's cards: the cards after an item sit where its list does. */
  depth: number;
}

interface OpenList {
  end: number;
  indent: number;
  isOrdered: boolean;
  /** The number the list's next item takes. */
  next: number;
}

interface Cut {
  line: number;
  slots: PieceSlot[];
  /** The lists still open after the cut, outermost first. */
  lists: OpenList[];
  /** The path of the deepest item the cut follows. */
  path: number[];
}

function indentOf(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

interface CutReader {
  lines: string[];
  slots: ReadonlySet<string>;
  cuts: Map<number, Cut>;
  /** Items seen so far per open container: the block, then each open item or blockquote. */
  counts: number[];
  path: number[];
  lists: OpenList[];
  quoteDepth: number;
  node: number;
}

type MarkdownToken = ReturnType<typeof parser.parse>[number];

function cutAt(reader: CutReader, line: number, key: string): void {
  const slot = { key, depth: Math.max(0, reader.lists.length - 1) };
  const cut = reader.cuts.get(line) ?? { line, slots: [], lists: [], path: [] };
  cut.slots.push(slot);
  // The deepest item's lists: those that end at the cut leave nothing to continue.
  if (reader.lists.length > cut.lists.length) {
    cut.lists = structuredClone(reader.lists);
    cut.path = [...reader.path];
  }
  reader.cuts.set(line, cut);
}

function openList(reader: CutReader, token: MarkdownToken): void {
  reader.lists.push({
    end: token.map?.[1] ?? reader.lines.length,
    indent: indentOf(reader.lines[token.map?.[0] ?? 0] ?? ""),
    isOrdered: token.type === "ordered_list_open",
    next: Number(token.attrGet("start") ?? 1),
  });
}

function openItem(reader: CutReader, token: MarkdownToken): void {
  const container = reader.counts.length - 1;
  reader.path.push(reader.counts[container]!);
  reader.counts[container]! += 1;
  reader.counts.push(0);
  const list = reader.lists.at(-1);
  if (list) list.next += 1;
  const key = `item:${reader.path.join(".")}`;
  if (reader.quoteDepth === 0 && reader.slots.has(key) && token.map) {
    cutAt(reader, token.map[1], key);
  }
}

const TOKEN_READERS: Record<string, (reader: CutReader, token: MarkdownToken) => void> = {
  bullet_list_open: openList,
  ordered_list_open: openList,
  bullet_list_close: (reader) => void reader.lists.pop(),
  ordered_list_close: (reader) => void reader.lists.pop(),
  list_item_open: openItem,
  list_item_close: (reader) => {
    reader.path.pop();
    reader.counts.pop();
  },
  blockquote_open: (reader) => {
    reader.quoteDepth += 1;
    reader.counts.push(0);
  },
  blockquote_close: (reader) => {
    reader.quoteDepth -= 1;
    reader.counts.pop();
  },
};

/** Where each slot's node or list item ends, numbered as `listItemPaths` and `readTopLevelNodes` number them. */
function readCuts(blockText: string, slots: ReadonlySet<string>): Map<number, Cut> {
  const reader: CutReader = {
    lines: blockText.split("\n"),
    slots,
    cuts: new Map(),
    counts: [0],
    path: [],
    lists: [],
    quoteDepth: 0,
    node: -1,
  };
  for (const token of parser.parse(blockText, {})) {
    if (token.level === 0 && token.nesting !== -1) {
      reader.node += 1;
      const key = `node:${reader.node}`;
      if (slots.has(key) && token.map) cutAt(reader, token.map[1], key);
    }
    TOKEN_READERS[token.type]?.(reader, token);
  }
  return reader.cuts;
}

function dedent(lines: readonly string[], indent: number): string[] {
  return lines.map((line) => line.slice(Math.min(indent, indentOf(line))));
}

/** The continuation of an ordered list starts at its next number, whatever its source wrote. */
function renumber(lines: string[], list: OpenList): string[] {
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (!list.isOrdered || first === -1 || !ITEM_NUMBER.test(lines[first]!)) return lines;
  const next = [...lines];
  next[first] = lines[first]!.replace(ITEM_NUMBER, `$1${list.next}`);
  return next;
}

/**
 * Splits a block's Markdown after the top-level nodes (`node:N`) and list items (`item:2.0`) in
 * `slots`, so each slot's cards can follow its piece. What follows a nested item continues its
 * lists: a piece per open list, dedented to it.
 */
export function splitMarkdownAtSlots(
  blockText: string,
  slots: ReadonlySet<string>,
): MarkdownPiece[] {
  if (slots.size === 0) return [{ key: "start/rest", text: blockText, depth: 0, slots: [] }];
  const lines = blockText.split("\n");
  const cuts = [...readCuts(blockText, slots).values()].sort((a, b) => a.line - b.line);
  const pieces: MarkdownPiece[] = [];
  let from = 0;
  let open: OpenList[] = [];
  let openPath: number[] = [];
  let fromKey = "start";
  function push(at: number, to: number, depth: number, list?: OpenList): void {
    let chunk = lines.slice(at, to);
    if (list) chunk = renumber(dedent(chunk, list.indent), list);
    const text = chunk.join("\n").replace(/^\n+|\n+$/g, "");
    if (!text.trim()) return;
    const continues =
      depth > 0 ? { parent: openPath.slice(0, depth), start: openPath[depth]! + 1 } : undefined;
    // Each open list's continuation by its depth, then what follows the lists.
    const key = `${fromKey}/${list ? depth : "rest"}`;
    pieces.push(
      continues ? { key, text, depth, slots: [], continues } : { key, text, depth, slots: [] },
    );
  }
  for (const cut of [...cuts, null]) {
    const to = cut?.line ?? lines.length;
    let at = from;
    // Innermost first: the rest of each open list, then what follows the outermost.
    for (let depth = open.length - 1; depth >= 0 && at < to; depth -= 1) {
      const list = open[depth]!;
      const end = Math.min(list.end, to);
      push(at, end, depth, list);
      at = end;
    }
    push(at, to, 0);
    const last = pieces.at(-1);
    if (cut && last) last.slots.push(...cut.slots.toReversed());
    from = to;
    open = cut?.lists ?? [];
    openPath = cut?.path ?? [];
    fromKey = cut?.slots[0]?.key ?? fromKey;
  }
  return pieces;
}
