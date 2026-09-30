type TranscriptRow = [messageId: string, html: string];

/** Assistant messages as the transcript renders them: one row per Markdown block, in order. */
export function mountTranscript(...rows: TranscriptRow[]): HTMLElement {
  const blocks = new Map<string, number>();
  const root = document.createElement("div");
  root.innerHTML = rows
    .map(([messageId, html]) => {
      const block = blocks.get(messageId) ?? 0;
      blocks.set(messageId, block + 1);
      return `
        <div data-history-row-id="${messageId}:block:${block}" data-message-id="${messageId}">
          <div data-testid="assistant-message">
            <div data-message-text="true">${html}</div>
          </div>
        </div>`;
    })
    .join("");
  document.body.append(root);
  return root;
}

/** One assistant message, `m1`, with a row per block. */
export function mountMessage(...blocks: string[]): HTMLElement {
  return mountTranscript(...blocks.map((html): TranscriptRow => ["m1", html]));
}

export function paragraph(text: string): string {
  return `<div data-paseo-markdown-tag="p">${text}</div>`;
}

export function inlineCode(text: string): string {
  return `<span data-paseo-markdown-tag="code">${text}</span>`;
}

/** A list as react-native-web renders a tight one: each item a marker, then its text, no paragraph. */
export function renderedList(tag: "ul" | "ol", ...items: string[]): string {
  const rendered = items.map(
    (html, index) =>
      `<div data-paseo-markdown-tag="li"><div data-paseo-markdown-ignore="true" data-paseo-markdown-list-marker="true">${tag === "ol" ? `${index + 1}.` : "•"}</div><div><div>${html}</div></div></div>`,
  );
  const start = tag === "ol" ? ' data-paseo-markdown-list-start="1"' : "";
  return `<div data-paseo-markdown-tag="${tag}"${start}>${rendered.join("")}</div>`;
}
