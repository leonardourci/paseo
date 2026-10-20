import { describe, expect, it } from "vitest";
import { splitMarkdownAtSlots } from "./split";

function split(text: string, ...slots: string[]) {
  return splitMarkdownAtSlots(text, new Set(slots));
}

describe("splitMarkdownAtSlots", () => {
  it("keeps a block without slots whole", () => {
    expect(split("Intro:\n- a\n- b")).toEqual([
      { key: "start/rest", text: "Intro:\n- a\n- b", depth: 0, slots: [] },
    ]);
  });

  it("splits after a top-level node", () => {
    expect(split("Intro:\n- a\n- b", "node:0")).toEqual([
      { key: "start/rest", text: "Intro:", depth: 0, slots: [{ key: "node:0", depth: 0 }] },
      { key: "node:0/rest", text: "- a\n- b", depth: 0, slots: [] },
    ]);
  });

  it("continues an ordered list at its next number after an item", () => {
    expect(split("1. a\n1. b\n1. c", "item:1").map((piece) => piece.text)).toEqual([
      "1. a\n1. b",
      "3. c",
    ]);
    expect(split("4. a\n5. b", "item:0").map((piece) => piece.text)).toEqual(["4. a", "5. b"]);
  });

  it("continues a nested list dedented after a nested item, then its parent list", () => {
    expect(split("- a\n  - a1\n  - a2\n- b", "item:0.0")).toEqual([
      { key: "start/rest", text: "- a\n  - a1", depth: 0, slots: [{ key: "item:0.0", depth: 1 }] },
      {
        key: "item:0.0/1",
        text: "- a2",
        depth: 1,
        slots: [],
        continues: { parent: [0], start: 1 },
      },
      { key: "item:0.0/0", text: "- b", depth: 0, slots: [] },
    ]);
    expect(split("1. a\n   1. x\n   1. y\n2. b", "item:0.0").map((piece) => piece.text)).toEqual([
      "1. a\n   1. x",
      "2. y",
      "2. b",
    ]);
  });

  it("puts every slot that ends on one line after the same piece, innermost first", () => {
    expect(split("- a\n  - a1\n- b\n\nAfter", "item:0", "item:0.0")).toEqual([
      {
        key: "start/rest",
        text: "- a\n  - a1",
        depth: 0,
        slots: [
          { key: "item:0.0", depth: 1 },
          { key: "item:0", depth: 0 },
        ],
      },
      { key: "item:0/0", text: "- b", depth: 0, slots: [] },
      { key: "item:0/rest", text: "After", depth: 0, slots: [] },
    ]);
  });

  it("numbers items as the renderer does, across sibling lists and not inside quotes", () => {
    expect(split("- a\n\n1. b\n2. c", "item:1").map((piece) => piece.text)).toEqual([
      "- a\n\n1. b",
      "2. c",
    ]);
    expect(split("> - quoted\n> - more", "item:0")).toEqual([
      { key: "start/rest", text: "> - quoted\n> - more", depth: 0, slots: [] },
    ]);
  });
});
