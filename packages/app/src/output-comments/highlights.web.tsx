import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AUTOCOMPLETE_POPOVER_SELECTOR } from "@/components/ui/autocomplete-popover";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { usePaneFocus } from "@/panels/pane-context";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { colorWithAlpha } from "@/utils/color";
import { OutputCommentBadge } from "./badge";
import {
  BADGE_SIZE,
  groupPiles,
  layOutPile,
  pileWidth,
  type BadgePile,
  type PlacedBadge,
  type TextBadge,
} from "./badge-piles";
import { outputCommentCardId } from "./composer-context";
import type { QuoteAnchor } from "./fence";
import type { DeliveredOutputComments } from "./match";
import { rangesForQuote } from "./ranges.web";
import { revealOutputCommentCard } from "./reveal";
import { useOutputCommentFocusStore, type PendingOutputComment } from "./store";
import { SURFACE_LAYER, surfaceRootOf } from "./surface.web";
import { HIGHLIGHT_ALPHA, type Tint } from "./tint";
import type { OutputCommentHighlightsProps } from "./types";

interface PaintedComment {
  key: string;
  number: number | null;
  anchor: QuoteAnchor;
}

interface QuoteEnd {
  comment: PaintedComment;
  range: Range;
}

interface PaintInput {
  root: HTMLElement;
  comments: readonly PaintedComment[];
  colorOf: (comment: PaintedComment) => string;
  prefix: string;
}

interface Painting {
  ends: QuoteEnd[];
  highlights: Map<string, Highlight>;
  css: string;
}

interface TextBadgeButtonProps {
  surfaceId: string;
  placed: PlacedBadge;
  isActive: boolean;
}

interface TextBadgePileProps {
  surfaceId: string;
  pile: BadgePile;
  activeKey: string | null;
}

const BADGE_LIFT = 2;
const EMPTY_PILES: readonly BadgePile[] = [];
const TEXT_BADGE_TEST_ID = "output-comment-text-badge";
const KEEPS_ACTIVE = [
  '[data-testid="output-comment-pending"]',
  '[data-testid="output-comment-delivered"]',
  `[data-testid="${TEXT_BADGE_TEST_ID}"]`,
  AUTOCOMPLETE_POPOVER_SELECTOR,
].join(", ");
let nextLayerId = 0;

function paintPending(pending: readonly PendingOutputComment[]): PaintedComment[] {
  return pending.map((comment, index) => ({ key: comment.id, number: index + 1, anchor: comment }));
}

function paintDelivered(delivered: DeliveredOutputComments): PaintedComment[] {
  return [...delivered.values()].flat().map((comment) => ({
    key: comment.key,
    // No badge: a delivered comment's per-turn number would clash with the pending ones.
    number: null,
    anchor: comment,
  }));
}

/** One highlight name per quote, so overlapping translucent quotes stack. */
function paintQuotes({ root, comments, colorOf, prefix }: PaintInput): Painting {
  const ends: QuoteEnd[] = [];
  const highlights = new Map<string, Highlight>();
  const rules: string[] = [];
  for (const [index, comment] of comments.entries()) {
    const ranges = rangesForQuote(root, comment.anchor);
    const last = ranges.at(-1);
    if (!last) continue;
    const name = `${prefix}-${index}`;
    ends.push({ comment, range: last });
    highlights.set(name, new Highlight(...ranges));
    rules.push(`::highlight(${name}) { background-color: ${colorOf(comment)}; }`);
  }
  return { ends, highlights, css: rules.join("\n") };
}

/** Whether a mutation changed the rows of a message with a comment, whose quotes may have moved. */
function touchesRows(record: MutationRecord, rows: string): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest(rows)) return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.some(
    (node) => node instanceof Element && (node.matches(rows) || node.querySelector(rows) !== null),
  );
}

function tintOf(comment: PaintedComment, activeKey: string | null): Tint {
  if (comment.key === activeKey) return "active";
  return comment.number === null ? "delivered" : "pending";
}

function placePiles(layer: HTMLElement, ends: readonly QuoteEnd[]): BadgePile[] {
  const host = layer.getBoundingClientRect();
  const anchors: TextBadge[] = [];
  for (const { comment, range } of ends) {
    if (comment.number === null) continue;
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    if (!rect) continue;
    anchors.push({
      key: comment.key,
      number: comment.number,
      top: rect.top - host.top - BADGE_SIZE / 2,
      left: rect.right - host.left,
    });
  }
  return groupPiles(anchors).filter((pile) => {
    const width = pileWidth({ count: pile.badges.length, isSpread: false });
    const fitsInHost =
      pile.top >= 0 &&
      pile.left >= 0 &&
      pile.top + BADGE_SIZE <= host.height &&
      pile.left + width <= host.width;
    return fitsInHost;
  });
}

/** The lift is on the inner pressable, so the hover target never moves (docs/hover.md, failure mode 2). */
function TextBadgeButton({ surfaceId, placed, isActive }: TextBadgeButtonProps) {
  const { t } = useTranslation();
  const { badge } = placed;
  const { key } = badge;
  const [isHovered, setIsHovered] = useState(false);
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const focusNote = useOutputCommentFocusStore((state) => state.focusNote);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    setActiveKey(key);
    if (revealOutputCommentCard(outputCommentCardId(surfaceId, key))) {
      focusNote({ surfaceId, id: key });
    }
  }, [focusNote, key, setActiveKey, surfaceId]);
  const isRaised = isHovered || isActive;
  const lift = isRaised ? -BADGE_LIFT : 0;
  return (
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={[
        styles.textBadge,
        inlineUnistylesStyle({ transform: [{ translateX: placed.left }], zIndex: placed.zIndex }),
      ]}
      testID={TEXT_BADGE_TEST_ID}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t("outputComments.label", { number: badge.number })}
        style={[styles.textBadgeLift, inlineUnistylesStyle({ transform: [{ translateY: lift }] })]}
      >
        <OutputCommentBadge number={badge.number} isHighlighted={isRaised} />
      </Pressable>
    </View>
  );
}

function TextBadgePile({ surfaceId, pile, activeKey }: TextBadgePileProps) {
  const [isSpread, setIsSpread] = useState(false);
  const handlePointerEnter = useCallback(() => setIsSpread(true), []);
  const handlePointerLeave = useCallback(() => setIsSpread(false), []);
  const width = pileWidth({ count: pile.badges.length, isSpread });
  const placedBadges = layOutPile({ badges: pile.badges, activeKey, isSpread });
  // A spread pile rises above its neighbours so they can't cover it or steal the hover.
  const zIndex = isSpread ? 1 : 0;
  return (
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={[
        styles.pile,
        inlineUnistylesStyle({ top: pile.top, left: pile.left, zIndex, width, height: BADGE_SIZE }),
      ]}
    >
      {placedBadges.map((placed) => (
        <TextBadgeButton
          key={placed.badge.key}
          surfaceId={surfaceId}
          placed={placed}
          isActive={placed.badge.key === activeKey}
        />
      ))}
    </View>
  );
}

export function OutputCommentHighlights({
  surfaceId,
  pending,
  delivered,
}: OutputCommentHighlightsProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLStyleElement>(null);
  const isPanelActive = useRetainedPanelActive();
  const { isInteractive } = usePaneFocus();
  const pendingComments = useMemo(() => paintPending(pending), [pending]);
  const deliveredComments = useMemo(() => paintDelivered(delivered), [delivered]);
  const comments = useMemo(
    () => [...pendingComments, ...deliveredComments],
    [deliveredComments, pendingComments],
  );
  const activeKey = useOutputCommentFocusStore((state) => state.activeKey);
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const [piles, setPiles] = useState(EMPTY_PILES);
  const [prefix] = useState(() => `paseo-output-comment-${++nextLayerId}`);

  useEffect(() => {
    if (!isPanelActive || !isInteractive) return;
    const release = () => setActiveKey(null);
    const onPointerDown = (event: PointerEvent) => {
      if (event.defaultPrevented || hasActiveWebOverlay()) return;
      const keepsActive = event.target instanceof Element && event.target.closest(KEEPS_ACTIVE);
      if (!keepsActive) release();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasActiveWebOverlay()) return;
      if (event.key === "Escape") release();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isInteractive, isPanelActive, setActiveKey]);

  useEffect(() => {
    const layer = layerRef.current;
    const sheet = sheetRef.current;
    const root = layer ? surfaceRootOf(layer) : null;
    let painted: ReadonlyMap<string, Highlight> = new Map();
    const apply = (highlights: ReadonlyMap<string, Highlight>, css: string) => {
      for (const name of painted.keys()) {
        if (!highlights.has(name)) CSS.highlights.delete(name);
      }
      for (const [name, highlight] of highlights) CSS.highlights.set(name, highlight);
      painted = highlights;
      if (sheet) sheet.textContent = css;
    };
    const clear = () => {
      apply(new Map(), "");
      setPiles(EMPTY_PILES);
    };
    const canPaint = isPanelActive && comments.length > 0;
    if (!layer || !sheet || !root || !canPaint) {
      clear();
      return clear;
    }
    const colorOf = (comment: PaintedComment) => styles[tintOf(comment, activeKey)].backgroundColor;
    const commentedIds = new Set(comments.map(({ anchor }) => anchor.sourceItemId));
    const commentedRows = [...commentedIds]
      .map((id) => `[data-message-id="${CSS.escape(id)}"]`)
      .join(", ");
    let ends: QuoteEnd[] = [];
    let areRangesStale = true;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (areRangesStale) {
        areRangesStale = false;
        const painting = paintQuotes({ root, comments, colorOf, prefix });
        apply(painting.highlights, painting.css);
        ends = painting.ends;
      }
      setPiles(placePiles(layer, ends));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    // Output streaming into other messages only moves the badges; quotes find their text again
    // only when their own message changes.
    const observer = new MutationObserver((records) => {
      const outside = records.filter((record) => !layer.contains(record.target));
      if (outside.length === 0) return;
      if (outside.some((record) => touchesRows(record, commentedRows))) areRangesStale = true;
      schedule();
    });
    const resizeObserver = new ResizeObserver(schedule);
    update();
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    resizeObserver.observe(layer);
    document.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("scroll", schedule, true);
      cancelAnimationFrame(frame);
      clear();
    };
  }, [activeKey, comments, isPanelActive, prefix]);

  return (
    <div ref={layerRef} style={SURFACE_LAYER}>
      <style ref={sheetRef} />
      {piles.map((pile) => (
        <TextBadgePile key={pile.key} surfaceId={surfaceId} pile={pile} activeKey={activeKey} />
      ))}
    </div>
  );
}

const BADGE_TRANSITION = {
  transitionProperty: "transform",
  transitionDuration: "120ms",
  transitionTimingFunction: "ease-out",
} as const;

const styles = StyleSheet.create((theme) => ({
  active: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.active) },
  pending: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.pending) },
  delivered: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.delivered) },
  // No transition on the pile: scrolling and streaming move it, and it must keep up.
  pile: { position: "absolute", pointerEvents: "auto" },
  textBadge: {
    position: "absolute",
    top: 0,
    left: 0,
    _web: BADGE_TRANSITION,
  },
  textBadgeLift: {
    _web: BADGE_TRANSITION,
  },
}));
