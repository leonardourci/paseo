type TranscriptRow = [messageId: string, html: string];

/**
 * Assistant messages as the transcript renders them: a row per message, holding a container per
 * Markdown block. Consecutive rows of one message are its blocks, in order.
 */
export function mountTranscript(...rows: TranscriptRow[]): HTMLElement {
  const messages: { messageId: string; blocks: string[] }[] = [];
  for (const [messageId, html] of rows) {
    const last = messages.at(-1);
    if (last?.messageId === messageId) last.blocks.push(html);
    else messages.push({ messageId, blocks: [html] });
  }
  const root = document.createElement("div");
  root.innerHTML = messages
    .map(
      ({ messageId, blocks }) => `
        <div data-history-row-id="${messageId}" data-message-id="${messageId}" data-row-kind="assistant_message">
          <div data-testid="assistant-message" data-message-text="true">
            ${blocks.map((html, index) => `<div data-output-block="${index}"><div>${html}</div></div>`).join("")}
          </div>
        </div>`,
    )
    .join("");
  document.body.append(root);
  return root;
}

/** One assistant message, `m1`, with the given blocks. */
export function mountMessage(...blocks: string[]): HTMLElement {
  return mountTranscript(...blocks.map((html): TranscriptRow => ["m1", html]));
}

export function paragraph(text: string): string {
  return `<p>${text}</p>`;
}

export function inlineCode(text: string): string {
  return `<code>${text}</code>`;
}

/** A list as the Markdown renderer draws a tight one: each item's text in a span. */
export function renderedList(tag: "ul" | "ol", ...items: string[]): string {
  return `<${tag}>${items.map((html) => `<li><span>${html}</span></li>`).join("")}</${tag}>`;
}
