import { ICON_SIZE, SPACING } from "@/styles/theme";

export interface TextBadge {
  key: string;
  number: number;
  top: number;
  left: number;
}

export interface BadgePile {
  key: string;
  top: number;
  left: number;
  badges: TextBadge[];
}

export interface PlacedBadge {
  badge: TextBadge;
  left: number;
  zIndex: number;
}

interface PileLayoutInput {
  badges: readonly TextBadge[];
  activeKey: string | null;
  isSpread: boolean;
}

interface PileWidthInput {
  count: number;
  isSpread: boolean;
}

interface Run {
  leftmost: TextBadge;
  rightmost: TextBadge;
  badges: TextBadge[];
}

export const BADGE_SIZE = ICON_SIZE.md;
const BADGE_STEP = BADGE_SIZE + SPACING[0.5];
const PILE_PEEK = 3;
const SAME_LINE_PX = 3;

function overlaps(run: Run, anchor: TextBadge): boolean {
  const isSameLine = Math.abs(anchor.top - run.rightmost.top) <= SAME_LINE_PX;
  return isSameLine && anchor.left - run.rightmost.left < BADGE_SIZE;
}

export function groupPiles(anchors: readonly TextBadge[]): BadgePile[] {
  const runs: Run[] = [];
  for (const anchor of [...anchors].sort((a, b) => a.left - b.left)) {
    const run = runs.find((candidate) => overlaps(candidate, anchor));
    if (run) {
      run.badges.push(anchor);
      run.rightmost = anchor;
    } else {
      runs.push({ leftmost: anchor, rightmost: anchor, badges: [anchor] });
    }
  }
  return runs.map(({ leftmost, badges }) => {
    const byNumber = [...badges].sort((a, b) => a.number - b.number);
    return { key: byNumber[0].key, top: leftmost.top, left: leftmost.left, badges: byNumber };
  });
}

function topIndex(badges: readonly TextBadge[], activeKey: string | null): number {
  const active = badges.findIndex((badge) => badge.key === activeKey);
  return active === -1 ? badges.length - 1 : active;
}

function depthOf(index: number, top: number): number {
  if (index === top) return 0;
  if (index < top) return index + 1;
  return index;
}

export function layOutPile({ badges, activeKey, isSpread }: PileLayoutInput): PlacedBadge[] {
  const top = topIndex(badges, activeKey);
  return badges.map((badge, index) => {
    const depth = depthOf(index, top);
    const left = isSpread ? index * BADGE_STEP : depth * PILE_PEEK;
    return { badge, left, zIndex: badges.length - depth };
  });
}

export function pileWidth({ count, isSpread }: PileWidthInput): number {
  const step = isSpread ? BADGE_STEP : PILE_PEEK;
  return BADGE_SIZE + Math.max(0, count - 1) * step;
}
