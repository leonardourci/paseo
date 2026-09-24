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
