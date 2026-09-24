export interface QuoteAnchor {
  sourceItemId: string;
  startBlock: number;
  endBlock: number;
  /** Markdown source, not rendered text. */
  quote: string;
  /** 0-based index among case-sensitive occurrences of the quote's first block text. */
  occurrence: number;
  /** Selected inside code, so the quote is code, not Markdown. */
  isCode: boolean;
}

export interface OutputComment extends Pick<
  QuoteAnchor,
  "quote" | "startBlock" | "occurrence" | "isCode"
> {
  note: string;
  /**
   * Which assistant message the quote came from, counted back from the user turn carrying the
   * comment: 1 is the last assistant message before it. Tool calls, thoughts and user turns
   * don't count. Absent when the output wasn't loaded.
   */
  messageOrdinal?: number;
}

export interface ParsedOutputComment extends OutputComment {
  position: number;
}

interface ParsedOutputComments {
  comments: ParsedOutputComment[];
  rest: string;
}

const FENCE_INFO = "paseo-comment";
// Six digits at most, so no number parses to Infinity.
const FENCE_OPENING = new RegExp(
  `^(\`{3,})${FENCE_INFO}[ \\t]+block=(\\d{1,6})(?:[ \\t]+occ=(\\d{1,6}))?(?:[ \\t]+msg=([1-9]\\d{0,5}))?(?:[ \\t]+(code))?[ \\t]*$`,
);

function quoteLines(markdown: string): string[] {
  return markdown.split("\n").map((line) => (line ? `> ${line}` : ">"));
}

/** One backtick longer than any run inside, so quoted code fences survive. */
function fenceFor(body: string): string {
  let longest = 2;
  for (const run of body.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return "`".repeat(longest + 1);
}

function serializeComment(comment: OutputComment): string {
  const body = [...quoteLines(comment.quote), "", comment.note.trim()].join("\n");
  const fence = fenceFor(body);
  const occurrence = comment.occurrence > 0 ? ` occ=${comment.occurrence}` : "";
  const ordinal = comment.messageOrdinal === undefined ? "" : ` msg=${comment.messageOrdinal}`;
  const code = comment.isCode ? " code" : "";
  return `${fence}${FENCE_INFO} block=${comment.startBlock}${occurrence}${ordinal}${code}\n${body}\n${fence}`;
}

/**
 * Fences go after the text, so the message still opens with what the user typed. A code block the
 * text leaves open is closed first, or the fences would read as its code.
 */
export function withOutputComments(text: string, comments: readonly OutputComment[]): string {
  if (comments.length === 0) return text;
  const fences = comments.map(serializeComment).join("\n\n");
  const openFence = text.split(/\r?\n/).reduce<string | null>(userFenceAfter, null);
  const closed = openFence === null ? text : `${text}\n${openFence}`;
  return closed ? `${closed}\n\n${fences}` : fences;
}

function findClosing(lines: readonly string[], from: number, fence: string): number {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim() === fence) return index;
  }
  return -1;
}

interface FencedComment {
  comment: OutputComment;
  closing: number;
}

function readFence(lines: readonly string[], opening: number): FencedComment | null {
  const header = FENCE_OPENING.exec(lines[opening]);
  if (!header) return null;
  const fence = header[1];
  const closing = findClosing(lines, opening + 1, fence);
  if (closing === -1) return null;
  const body = lines.slice(opening + 1, closing);
  let split = 0;
  while (split < body.length && body[split].startsWith(">")) split += 1;
  const note = body.slice(split).join("\n").trim();
  if (split === 0 || !note) return null;
  const quote = body
    .slice(0, split)
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n");
  const startBlock = Number(header[2]);
  const occurrence = Number(header[3] ?? "0");
  const ordinal = header[4];
  const isCode = header[5] !== undefined;
  const comment: OutputComment = { quote, note, startBlock, occurrence, isCode };
  if (ordinal !== undefined) comment.messageOrdinal = Number(ordinal);
  return { comment, closing };
}

const USER_FENCE_OPENING = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const USER_FENCE_CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Like CommonMark: only a run of the same character, at least as long, closes a fence. */
function closesFence(line: string, opening: string): boolean {
  const run = USER_FENCE_CLOSING.exec(line)?.[1];
  return run !== undefined && run[0] === opening[0] && run.length >= opening.length;
}

/** The user's code fence open after `line`, given the one open before it. */
function userFenceAfter(open: string | null, line: string): string | null {
  if (open !== null) return closesFence(line, open) ? null : open;
  return USER_FENCE_OPENING.exec(line)?.[1] ?? null;
}

function nextFilledLine(lines: readonly string[], after: number): number {
  let index = after + 1;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  return index;
}

/**
 * Reads the comment fences at the top level of the message. They usually close it, but a resumed
 * session can put attachment text after them. A fence inside the user's own code block is text.
 */
export function parseOutputComments(text: string): ParsedOutputComments {
  const lines = text.split(/\r?\n/);
  const lineStarts = [0, ...Array.from(text.matchAll(/\n/g), (match) => match.index + 1)];
  const comments: ParsedOutputComment[] = [];
  let rest = "";
  let restFrom = 0;
  let userFence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fenced = userFence === null ? readFence(lines, index) : null;
    if (fenced) {
      comments.push({ ...fenced.comment, position: comments.length });
      // Cut the fence and the blank lines after it, so the text around it keeps one separator.
      const next = nextFilledLine(lines, fenced.closing);
      rest += text.slice(restFrom, lineStarts[index]);
      restFrom = lineStarts[next] ?? text.length;
      index = next - 1;
      continue;
    }
    userFence = userFenceAfter(userFence, lines[index]);
  }
  if (comments.length === 0) return { comments: [], rest: text };
  // Cut from the original, so the typed text comes back byte for byte, line endings and all.
  return { comments, rest: (rest + text.slice(restFrom)).trimEnd() };
}

export function appendBlockquote(text: string, quote: string): string {
  const block = quoteLines(quote.trim()).join("\n");
  const base = text.trimEnd();
  return base ? `${base}\n\n${block}\n\n` : `${block}\n\n`;
}
