import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findRenderedQuote } from "@/agent-stream/chat-find/ranges.web";
import { CHAT_SCROLL_SELECTOR } from "@/assistant-selection-copy/content.web";
import { MARKDOWN_COPY_IGNORE_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { pickOccurrence, quotePlainText } from "./match";
import type { OutputCommentPlacementProps } from "./types";

const SLOT = "[data-output-comment-slot]";
const BLOCK = 'p, li, pre, table, h1, h2, h3, h4, h5, h6, [data-paseo-markdown-tag="pre"]';
const GAP = 8;

function insertAfter(block: Element, host: HTMLElement, order: number): void {
  const parent = block.parentElement;
  if (!parent) return;
  let next = block.nextSibling;
  while (next instanceof HTMLElement && next.matches(SLOT)) {
    if (next !== host && Number(next.dataset.outputCommentSlot) > order) break;
    next = next.nextSibling;
  }
  if (host.parentElement === parent && host.nextSibling === next) return;
  const input = document.activeElement;
  const start = input instanceof HTMLTextAreaElement ? input.selectionStart : 0;
  const end = input instanceof HTMLTextAreaElement ? input.selectionEnd : 0;
  const direction = input instanceof HTMLTextAreaElement ? input.selectionDirection : "none";
  if (host.isConnected && "moveBefore" in parent && typeof parent.moveBefore === "function") {
    parent.moveBefore(host, next);
  } else {
    parent.insertBefore(host, next);
  }
  if (input instanceof HTMLTextAreaElement && document.activeElement === input) {
    input.setSelectionRange(start, end, direction);
  }
}

function blockAtEnd(range: Range): Element | null {
  const node = range.endContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const table = element?.closest("table");
  if (table) return table;
  const block = element?.closest(BLOCK);
  if (block?.matches("li")) {
    let child: Node = node;
    while (child.parentNode !== block && child.parentNode) child = child.parentNode;
    return child instanceof Element ? child : block;
  }
  return block ?? null;
}

export function focusCommentInput(input: EditingTextInputHandle): boolean {
  const element = input.getNativeRef();
  if (!(element instanceof HTMLElement)) return false;
  const scroller = element.closest<HTMLElement>(CHAT_SCROLL_SELECTOR);
  if (!scroller) return false;
  const view = scroller.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const isVisible =
    view.height > 0 && box.height > 0 && box.top >= view.top && box.bottom <= view.bottom;
  if (!isVisible) return false;
  element.focus({ preventScroll: true });
  return true;
}

export function OutputCommentPlacement({
  anchor,
  order,
  replyText,
  isComplete,
  children,
}: OutputCommentPlacementProps) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.setAttribute(MARKDOWN_COPY_IGNORE_ATTRIBUTE, "true");
    element.style.marginBlock = `${GAP}px`;
    return element;
  });
  useLayoutEffect(() => {
    const marker = markerRef.current;
    const row = marker?.closest("[data-history-row-id]");
    const reply = row?.querySelector<HTMLElement>('[data-testid="assistant-message"]');
    const scroller = marker?.closest<HTMLElement>(CHAT_SCROLL_SELECTOR);
    if (!marker || !reply || !scroller) return;
    host.dataset.outputCommentSlot = String(order);
    if (!isComplete) {
      if (host.parentElement !== marker) marker.append(host);
      return;
    }
    const { text, matches } = findRenderedQuote(reply, quotePlainText(anchor));
    const match = matches[pickOccurrence(text, matches, anchor)];
    const range = match?.range ?? null;
    const block = range ? blockAtEnd(range) : null;
    if (block?.matches("li")) block.append(host);
    else if (block) insertAfter(block, host, order);
    else if (host.parentElement !== marker) marker.append(host);
  }, [anchor, host, isComplete, order, replyText]);
  useLayoutEffect(
    () => () => {
      host.remove();
    },
    [host],
  );
  return (
    <>
      <div ref={markerRef} />
      {createPortal(children, host)}
    </>
  );
}
