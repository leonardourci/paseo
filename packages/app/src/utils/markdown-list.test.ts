import { describe, expect, it } from "vitest";
import {
  getMarkdownListItemPath,
  getMarkdownListMarker,
  getMarkdownListSpacing,
} from "./markdown-list";

describe("getMarkdownListMarker", () => {
  it("returns a bullet marker for unordered list items", () => {
    expect(getMarkdownListMarker({ index: 0 }, [{ type: "bullet_list" }])).toEqual({
      isOrdered: false,
      marker: "•",
    });
  });

  it("returns numbered markers for ordered list items", () => {
    expect(getMarkdownListMarker({ index: 1, markup: "." }, [{ type: "ordered_list" }])).toEqual({
      isOrdered: true,
      marker: "2.",
    });
  });

  it("respects ordered list start attribute", () => {
    expect(
      getMarkdownListMarker({ index: 2, markup: ")" }, [
        { type: "ordered_list", attributes: { start: "5" } },
      ]),
    ).toEqual({
      isOrdered: true,
      marker: "7)",
    });
  });

  it("prefers the nearest list ancestor in nested lists", () => {
    expect(
      getMarkdownListMarker({ index: 0, markup: "." }, [
        { type: "ordered_list" },
        { type: "bullet_list" },
      ]),
    ).toEqual({
      isOrdered: true,
      marker: "1.",
    });
  });
});

describe("getMarkdownListSpacing", () => {
  it("keeps top-level list spacing as a section boundary", () => {
    const paragraph = { type: "paragraph" };
    const list = { type: "bullet_list" };
    const body = { type: "body", children: [list, paragraph] };

    expect(getMarkdownListSpacing(list, [body])).toEqual({
      marginTop: 4,
      marginBottom: 16,
    });
  });

  it("does not add bottom spacing after a list at the end of a markdown block", () => {
    const list = { type: "bullet_list" };
    const body = { type: "body", children: [list] };

    expect(getMarkdownListSpacing(list, [body])).toEqual({
      marginTop: 4,
      marginBottom: 0,
    });
  });

  it("uses a smaller gap between adjacent top-level lists", () => {
    const list = { type: "bullet_list" };
    const body = { type: "body", children: [list, { type: "ordered_list" }] };

    expect(getMarkdownListSpacing(list, [body])).toEqual({
      marginTop: 4,
      marginBottom: 8,
    });
  });

  it("does not add section spacing after a nested list", () => {
    expect(
      getMarkdownListSpacing({ type: "bullet_list" }, [
        { type: "list_item" },
        { type: "bullet_list" },
        { type: "body" },
      ]),
    ).toEqual({
      marginTop: 4,
      marginBottom: 0,
    });
  });
});

describe("getMarkdownListItemPath", () => {
  const nestedFirst = { type: "list_item" };
  const nestedSecond = { type: "list_item" };
  const nested = { type: "bullet_list", children: [nestedFirst, nestedSecond] };
  const first = { type: "list_item" };
  const second = { type: "list_item", children: [{ type: "paragraph" }, nested] };
  const list = { type: "bullet_list", children: [first, second] };
  const nextListItem = { type: "list_item" };
  const nextList = { type: "ordered_list", children: [nextListItem] };
  const quotedItem = { type: "list_item" };
  const quotedList = { type: "bullet_list", children: [quotedItem] };
  const quote = { type: "blockquote", children: [quotedList] };
  const body = { type: "body", children: [{ type: "paragraph" }, list, nextList, quote] };

  it.each([
    {
      name: "indexes a top-level item among its list's items",
      item: second,
      ancestors: [list, body],
      path: [1],
    },
    {
      name: "indexes a nested item within the item it nests in",
      item: nestedSecond,
      ancestors: [nested, second, list, body],
      path: [1, 1],
    },
    {
      name: "counts on across sibling lists in the same block",
      item: nextListItem,
      ancestors: [nextList, body],
      path: [2],
    },
    {
      name: "gives no path inside a blockquote",
      item: quotedItem,
      ancestors: [quotedList, quote, body],
      path: null,
    },
  ])("$name", ({ item, ancestors, path }) => {
    expect(getMarkdownListItemPath(item, ancestors)).toEqual(path);
  });
});
