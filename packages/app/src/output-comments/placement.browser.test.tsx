import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { OutputCommentPlacement } from "./placement.web";
import type { QuoteAnchor } from "./fence";
import { mountMessage, paragraph, renderedList } from "./test-transcript";

const roots: Root[] = [];
const anchor: QuoteAnchor = { sourceItemId: "m1", quote: "target", occurrence: 0, isCode: false };

const laterAnchor = { ...anchor, occurrence: 1 };

afterEach(async () => {
  await act(() => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
});

function cardRoot(transcript: HTMLElement): Root {
  transcript.dataset.testid = "agent-chat-scroll";
  const marker = document.createElement("div");
  transcript.querySelector("[data-history-row-id]")!.append(marker);
  const root = createRoot(marker);
  roots.push(root);
  return root;
}

it("places a card after its quoted paragraph while retaining the renderer's text nodes", async () => {
  const transcript = mountMessage(paragraph("first target"), paragraph("following paragraph"));
  const original = transcript.querySelector("p")!;
  const text = original.firstChild;
  const root = cardRoot(transcript);
  await act(() =>
    root.render(
      <OutputCommentPlacement
        anchor={anchor}
        order={0}
        isComplete={true}
        replyText="first target\n\nfollowing paragraph"
      >
        <textarea defaultValue="a note" />
      </OutputCommentPlacement>,
    ),
  );
  expect(original.nextElementSibling?.querySelector("textarea")?.value).toBe("a note");
  expect(original.firstChild).toBe(text);
  expect(original.nextElementSibling?.nextElementSibling?.textContent).toBe("following paragraph");
  await act(() => root.unmount());
  roots.pop();
  expect(original.nextElementSibling?.textContent).toBe("following paragraph");
});

it("adds an earlier card without remounting or blurring the existing note", async () => {
  const transcript = mountMessage(paragraph("first target then target"));
  const root = cardRoot(transcript);
  await act(() =>
    root.render(
      <OutputCommentPlacement
        key="later"
        anchor={laterAnchor}
        order={0}
        isComplete={true}
        replyText="first target then target"
      >
        <textarea aria-label="later" defaultValue="keep this" />
      </OutputCommentPlacement>,
    ),
  );
  const input = transcript.querySelector("textarea")!;
  input.focus();
  input.setSelectionRange(2, 4);
  await act(() =>
    root.render(
      <>
        <OutputCommentPlacement
          key="earlier"
          anchor={anchor}
          order={0}
          isComplete={true}
          replyText="first target then target"
        >
          <textarea aria-label="earlier" />
        </OutputCommentPlacement>
        <OutputCommentPlacement
          key="later"
          anchor={laterAnchor}
          order={1}
          isComplete={true}
          replyText="first target then target"
        >
          <textarea aria-label="later" defaultValue="keep this" />
        </OutputCommentPlacement>
      </>,
    ),
  );
  expect(
    Array.from(transcript.querySelectorAll("textarea"), (element) =>
      element.getAttribute("aria-label"),
    ),
  ).toEqual(["earlier", "later"]);
  expect(document.activeElement).toBe(input);
  expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(["keep this", 2, 4]);
});

it("keeps a list item's card inside the item, ahead of the following item", async () => {
  const transcript = mountMessage(renderedList("ul", "first target", "next item"));
  const root = cardRoot(transcript);
  await act(() =>
    root.render(
      <OutputCommentPlacement
        anchor={anchor}
        order={0}
        isComplete={true}
        replyText="- first target\n- next item"
      >
        <textarea defaultValue="list note" />
      </OutputCommentPlacement>,
    ),
  );
  expect(transcript.querySelector("textarea")?.closest("li")).toBe(transcript.querySelector("li"));
  expect(transcript.querySelector("ul")?.children.length).toBe(2);
});

it("moves the same card to a changed reply's matching block", async () => {
  const transcript = mountMessage(paragraph("first target"), paragraph("second"));
  const root = cardRoot(transcript);
  await act(() =>
    root.render(
      <OutputCommentPlacement
        anchor={anchor}
        order={0}
        isComplete={true}
        replyText="first target\nsecond"
      >
        <textarea defaultValue="preserved" />
      </OutputCommentPlacement>,
    ),
  );
  const input = transcript.querySelector("textarea")!;
  const paragraphs = transcript.querySelectorAll("p");
  paragraphs[0]!.textContent = "first";
  paragraphs[1]!.textContent = "second target";
  await act(() =>
    root.render(
      <OutputCommentPlacement
        anchor={anchor}
        order={0}
        isComplete={true}
        replyText="first\nsecond target"
      >
        <textarea defaultValue="preserved" />
      </OutputCommentPlacement>,
    ),
  );
  expect(paragraphs[1]!.nextElementSibling?.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("preserved");
});

it("places a card by its quote once the reply's Markdown finishes parsing", async () => {
  const transcript = mountMessage('<div aria-busy="true"></div>');
  const markdown = transcript.querySelector("[aria-busy]")!;
  const root = cardRoot(transcript);
  await act(() =>
    root.render(
      <OutputCommentPlacement
        anchor={anchor}
        order={0}
        isComplete={true}
        replyText="first target\n\nfollowing paragraph"
      >
        <textarea defaultValue="a note" />
      </OutputCommentPlacement>,
    ),
  );
  markdown.innerHTML = paragraph("first target") + paragraph("following paragraph");
  markdown.setAttribute("aria-busy", "false");
  await act(() => new Promise((resolve) => setTimeout(resolve)));
  const [quoted, following] = markdown.querySelectorAll("p");
  expect(quoted?.nextElementSibling?.querySelector("textarea")?.value).toBe("a note");
  expect(quoted?.nextElementSibling?.nextElementSibling).toBe(following);
});
