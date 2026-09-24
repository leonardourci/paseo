import { describe, expect, it } from "vitest";
import {
  BADGE_SIZE,
  groupPiles,
  layOutPile,
  pileWidth,
  type BadgePile,
  type TextBadge,
} from "./badge-piles";

function badge(number: number, left: number, top = 100): TextBadge {
  return { key: `c${number}`, number, top, left };
}

function summary(piles: readonly BadgePile[]): [number, number, number[]][] {
  return piles
    .map((pile): [number, number, number[]] => [
      pile.left,
      pile.top,
      pile.badges.map(({ number }) => number),
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** [number, left, zIndex] per badge, in number order. */
function layout(input: Parameters<typeof layOutPile>[0]) {
  return layOutPile(input).map(({ badge: { number }, left, zIndex }) => [number, left, zIndex]);
}

describe("groupPiles", () => {
  it.each([
    {
      name: "piles nested quotes' badges at the leftmost anchor, in number order",
      badges: [badge(2, 50), badge(3, 50), badge(1, 64, 101)],
      piles: [[50, 100, [1, 2, 3]]],
    },
    {
      name: "leaves badges alone that are apart or on other lines",
      badges: [badge(1, 50), badge(2, 68), badge(3, 50, 120)],
      piles: [
        [50, 100, [1]],
        [50, 120, [3]],
        [68, 100, [2]],
      ],
    },
    {
      name: "keeps badges 40px apart on one line in piles of their own, whatever their numbers",
      badges: [badge(2, 50), badge(3, 90), badge(1, 130)],
      piles: [
        [50, 100, [2]],
        [90, 100, [3]],
        [130, 100, [1]],
      ],
    },
    {
      name: "piles badges 5px apart",
      badges: [badge(1, 50), badge(2, 55)],
      piles: [[50, 100, [1, 2]]],
    },
    {
      name: "piles a chain of badges each overlapping the next",
      badges: [badge(3, 0), badge(1, 12), badge(2, 24)],
      piles: [[0, 100, [1, 2, 3]]],
    },
    {
      name: "keeps a far badge out of a pile whose lower number lies right of a higher one",
      badges: [badge(3, 0), badge(1, 10), badge(2, 45)],
      piles: [
        [0, 100, [1, 3]],
        [45, 100, [2]],
      ],
    },
    {
      name: "keeps a lower number far right of a higher one in a pile of its own",
      badges: [badge(1, 100), badge(2, 20)],
      piles: [
        [20, 100, [2]],
        [100, 100, [1]],
      ],
    },
    {
      name: "leaves a badge just clear of a pile on its own",
      badges: [badge(1, 50), badge(2, 52), badge(3, 52 + BADGE_SIZE)],
      piles: [
        [50, 100, [1, 2]],
        [52 + BADGE_SIZE, 100, [3]],
      ],
    },
  ])("$name", ({ badges, piles }) => {
    expect(summary(groupPiles(badges))).toEqual(piles);
  });
});

describe("layOutPile", () => {
  const badges = [badge(1, 0), badge(2, 0), badge(3, 0)];

  it("stacks a collapsed pile right from the top badge, the rest under it in number order", () => {
    expect(layout({ badges, activeKey: null, isSpread: false })).toEqual([
      [1, 3, 2],
      [2, 6, 1],
      [3, 0, 3],
    ]);
  });

  it("keeps the highest number on top when the active comment is elsewhere", () => {
    expect(layout({ badges, activeKey: "elsewhere", isSpread: false })).toEqual(
      layout({ badges, activeKey: null, isSpread: false }),
    );
  });

  it("stacks the active comment on top of a collapsed pile", () => {
    expect(layout({ badges, activeKey: "c2", isSpread: false })).toEqual([
      [1, 3, 2],
      [2, 0, 3],
      [3, 6, 1],
    ]);
  });

  it("spreads a pile left to right in number order", () => {
    expect(
      layout({ badges, activeKey: "c1", isSpread: true }).map(([number, left]) => [number, left]),
    ).toEqual([
      [1, 0],
      [2, 18],
      [3, 36],
    ]);
  });

  it("draws a single badge on its anchor either way", () => {
    expect(layout({ badges: [badge(4, 0)], activeKey: null, isSpread: false })).toEqual([
      [4, 0, 1],
    ]);
    expect(layout({ badges: [badge(4, 0)], activeKey: null, isSpread: true })).toEqual([[4, 0, 1]]);
  });
});

describe("pileWidth", () => {
  it("peeks sideways when collapsed and widens further when spread", () => {
    expect(pileWidth({ count: 3, isSpread: false })).toBe(BADGE_SIZE + 6);
    expect(pileWidth({ count: 3, isSpread: true })).toBe(BADGE_SIZE + 36);
    expect(pileWidth({ count: 1, isSpread: true })).toBe(BADGE_SIZE);
  });
});
