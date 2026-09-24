import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { usePaneFocus } from "@/panels/pane-context";
import { ICON_SIZE } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { colorWithAlpha } from "@/utils/color";
import { OutputCommentBadge } from "./badge";
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

interface TextBadge {
  key: string;
  number: number;
  top: number;
  left: number;
}

interface TextBadgeButtonProps {
  surfaceId: string;
  badge: TextBadge;
  isActive: boolean;
}

const BADGE_SIZE = ICON_SIZE.md;
const EMPTY_BADGES: readonly TextBadge[] = [];
const TEXT_BADGE_TEST_ID = "output-comment-text-badge";
const KEEPS_ACTIVE = [
  '[data-testid="output-comment-pending"]',
  '[data-testid="output-comment-delivered"]',
  `[data-testid="${TEXT_BADGE_TEST_ID}"]`,
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

/** A badge at the end of each pending quote, where the quote is in the chat. */
function placeBadges(layer: HTMLElement, ends: readonly QuoteEnd[]): TextBadge[] {
  const host = layer.getBoundingClientRect();
  const badges: TextBadge[] = [];
  for (const { comment, range } of ends) {
    if (comment.number === null) continue;
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    if (!rect) continue;
    const top = rect.top - host.top - BADGE_SIZE / 2;
    const left = rect.right - host.left;
    const fitsInHost =
      top >= 0 && left >= 0 && top + BADGE_SIZE <= host.height && left + BADGE_SIZE <= host.width;
    if (fitsInHost) badges.push({ key: comment.key, number: comment.number, top, left });
  }
  return badges;
}

function TextBadgeButton({ surfaceId, badge, isActive }: TextBadgeButtonProps) {
  const { t } = useTranslation();
  const { key } = badge;
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const focusNote = useOutputCommentFocusStore((state) => state.focusNote);
  const handlePress = useCallback(() => {
    setActiveKey(key);
    if (revealOutputCommentCard(outputCommentCardId(surfaceId, key))) {
      focusNote({ surfaceId, id: key });
    }
  }, [focusNote, key, setActiveKey, surfaceId]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("outputComments.label", { number: badge.number })}
      style={[styles.textBadge, inlineUnistylesStyle({ top: badge.top, left: badge.left })]}
      testID={TEXT_BADGE_TEST_ID}
    >
      <OutputCommentBadge number={badge.number} isHighlighted={isActive} />
    </Pressable>
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
  const [badges, setBadges] = useState(EMPTY_BADGES);
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
      setBadges(EMPTY_BADGES);
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
      setBadges(placeBadges(layer, ends));
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
      {badges.map((badge) => (
        <TextBadgeButton
          key={badge.key}
          surfaceId={surfaceId}
          badge={badge}
          isActive={badge.key === activeKey}
        />
      ))}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  active: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.active) },
  pending: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.pending) },
  delivered: { backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.delivered) },
  textBadge: { position: "absolute", pointerEvents: "auto" },
}));
