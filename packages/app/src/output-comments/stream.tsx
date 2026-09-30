import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { StreamViewportHandle } from "@/agent-stream/strategy";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import {
  MarkdownSlotContext,
  type MarkdownSlot,
  type RenderMarkdownSlot,
} from "@/components/markdown/slot";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useStableEvent } from "@/hooks/use-stable-event";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { DeliveredOutputCommentCard } from "./card";
import { useOutputCommentsComposer } from "./composer-context";
import { useDeliveredTurns } from "./delivered";
import { OutputCommentHighlights } from "./highlights";
import type { QuoteAnchor } from "./fence";
import {
  findMovedCommentSource,
  listItemPaths,
  quoteEndNode,
  readTopLevelNodes,
  type DeliveredOutputComment,
  type DeliveredOutputComments,
  type TopLevelNodes,
} from "./match";
import { PendingOutputCommentCard } from "./pending-card";
import { OutputCommentSelectionLayer } from "./selection-layer";
import type { MessageBlocks, MessageBlocksOf } from "./types";
import {
  EMPTY_PENDING_COMMENTS,
  loadedComments,
  useLoadedOutputStore,
  useOutputCommentsStore,
  type PendingOutputComment,
  type PlacedOutputComment,
} from "./store";

interface OutputCommentsLayerProps {
  serverId: string;
  agentId: string;
  items: readonly StreamItem[];
  isHistoryReady: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  children: ReactNode;
}

interface OutputCommentsBlockProps {
  sourceItemId: string;
  blockIndex: number;
  blockText: string;
  children: ReactNode;
}

interface NumberedPendingComment {
  comment: PlacedOutputComment;
  number: number;
}

interface CardGroup {
  pending: NumberedPendingComment[];
  delivered: DeliveredOutputComment[];
}

interface SlotCards extends CardGroup {
  /** The top-level node the slot is after, or holds its list item. */
  node: number;
}

interface PlacedSlot {
  slot: InnerSlot;
  node: number;
}

interface BlockCards {
  afterBlock: CardGroup;
  /** Keyed by `slotKey`. */
  afterSlots: Map<string, SlotCards>;
}

interface BlockCardsInput {
  pending: readonly NumberedPendingComment[];
  delivered: readonly DeliveredOutputComment[];
  blockText: string;
}

interface OutputCommentCardsProps {
  cards: CardGroup;
  blockText: string;
}

interface SentCommentQuote {
  comment: DeliveredOutputComment;
  /** The output block its inline card follows. */
  blockText: string;
}

interface StreamComments {
  draftKey: string;
  serverId: string;
  agentId: string;
  /** Tells this pane's cards from another pane's showing the same agent. */
  surfaceId: string;
  pendingByRow: ReadonlyMap<string, readonly NumberedPendingComment[]>;
  delivered: DeliveredOutputComments;
  /** The items the delivered comments were resolved in. */
  commentTurns: readonly StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  blocksOf: MessageBlocksOf;
}

type InnerSlot = Exclude<MarkdownSlot, { rest: number }>;

const EMPTY_ROW_PENDING: readonly NumberedPendingComment[] = [];
const EMPTY_ROW_DELIVERED: readonly DeliveredOutputComment[] = [];

const StreamCommentsContext = createContext<StreamComments | null>(null);

function useStreamComments(): StreamComments {
  const comments = useContext(StreamCommentsContext);
  invariant(comments, "Output comments render inside OutputCommentsLayer");
  return comments;
}

function rowKey(sourceItemId: string, block: number): string {
  return `${sourceItemId}:${block}`;
}

function itemKey(path: readonly number[]): string {
  return path.join(".");
}

function slotKey(slot: InnerSlot): string {
  return "item" in slot ? `item:${itemKey(slot.item)}` : `node:${slot.node}`;
}

function emptyGroup(): CardGroup {
  return { pending: [], delivered: [] };
}

/**
 * A card goes after the list item its quote ends in, else after the top-level node it ends in,
 * else after the block.
 */
function placeCards({ pending, delivered, blockText }: BlockCardsInput): BlockCards {
  const cards: BlockCards = { afterBlock: emptyGroup(), afterSlots: new Map() };
  let itemNodes: ReadonlyMap<string, number> | null = null;
  let nodes: TopLevelNodes | null = null;
  function slotFor(anchor: QuoteAnchor): PlacedSlot | null {
    if (anchor.endItem !== undefined) {
      itemNodes ??= listItemPaths(blockText);
      const itemNode = itemNodes.get(itemKey(anchor.endItem));
      // A card after an item the block doesn't have would never render.
      if (itemNode !== undefined) return { slot: { item: anchor.endItem }, node: itemNode };
    }
    nodes ??= readTopLevelNodes(blockText);
    const node = quoteEndNode(nodes, anchor);
    return node === null ? null : { slot: { node }, node };
  }
  function groupFor(anchor: QuoteAnchor): CardGroup {
    const placed = slotFor(anchor);
    if (!placed) return cards.afterBlock;
    const key = slotKey(placed.slot);
    const group = cards.afterSlots.get(key) ?? { ...emptyGroup(), node: placed.node };
    cards.afterSlots.set(key, group);
    return group;
  }
  for (const entry of pending) groupFor(entry.comment).pending.push(entry);
  for (const comment of delivered) groupFor(comment).delivered.push(comment);
  return cards;
}

/**
 * The cards at `slot`. At `rest`, those on every node the body didn't render: a message past the
 * render cap, or still being revealed. An item in a list cut short within a rendered node has none.
 */
function cardsAt(slots: ReadonlyMap<string, SlotCards>, slot: MarkdownSlot): CardGroup | null {
  if (!("rest" in slot)) return slots.get(slotKey(slot)) ?? null;
  const groups = [...slots.values()].filter((group) => group.node >= slot.rest);
  if (groups.length === 0) return null;
  const pending = groups.flatMap((group) => group.pending);
  const delivered = groups.flatMap((group) => group.delivered);
  return { pending, delivered };
}

function isSameComments(
  previous: readonly PendingOutputComment[],
  next: readonly PendingOutputComment[],
): boolean {
  return (
    previous.length === next.length &&
    next.every((comment, index) => comment.id === previous[index]?.id)
  );
}

function isAssistantMessage(item: StreamItem): item is AssistantMessageItem {
  return item.kind === "assistant_message";
}

const messageBlocks = new WeakMap<AssistantMessageItem, MessageBlocks>();

function blocksOfMessage(item: AssistantMessageItem): MessageBlocks {
  const cached = messageBlocks.get(item);
  if (cached) return cached;
  const blocks = splitMarkdownBlocks(item.text);
  messageBlocks.set(item, blocks);
  return blocks;
}

/**
 * Output without a provider message id gets a generated id, which a reload can change. A comment
 * left on it moves to the one loaded message that holds its quote the same way, if one does.
 */
function moveReloadedSources(draftKey: string, assistants: readonly AssistantMessageItem[]): void {
  const loadedIds = new Set(assistants.map((item) => item.id));
  const moved = new Map<string, string>();
  for (const comment of useOutputCommentsStore.getState().drafts[draftKey] ?? []) {
    if (loadedIds.has(comment.sourceItemId)) continue;
    const sourceItemId = findMovedCommentSource(assistants, comment);
    if (sourceItemId) moved.set(comment.id, sourceItemId);
  }
  if (moved.size > 0) {
    useOutputCommentsStore.getState().moveSources({ draftKey, sourceItemIds: moved });
  }
}

function groupByRow(
  pending: readonly PlacedOutputComment[],
): Map<string, NumberedPendingComment[]> {
  const byRow = new Map<string, NumberedPendingComment[]>();
  for (const [index, comment] of pending.entries()) {
    const key = rowKey(comment.sourceItemId, comment.endBlock);
    const row = byRow.get(key) ?? [];
    row.push({ comment, number: index + 1 });
    byRow.set(key, row);
  }
  return byRow;
}

export function OutputCommentsLayer({
  serverId,
  agentId,
  items,
  isHistoryReady,
  viewportRef,
  children,
}: OutputCommentsLayerProps) {
  const draftKey = useMemo(() => buildDraftStoreKey({ serverId, agentId }), [agentId, serverId]);
  const isPanelActive = useRetainedPanelActive();
  const composer = useOutputCommentsComposer();
  const layerId = useId();
  // The composer's own, so its requests to focus or reveal a card reach this pane's.
  const surfaceId = composer?.surfaceId ?? layerId;
  const loaded = useLoadedOutputStore((state) => state.assistantIds[draftKey]);
  const setLoaded = useLoadedOutputStore((state) => state.setLoaded);
  // Typing a note keeps the same list, so the rows don't render per keystroke. Cards read their
  // notes from the store.
  const pending = useStoreWithEqualityFn(
    useOutputCommentsStore,
    (state) => loadedComments(state.drafts[draftKey] ?? EMPTY_PENDING_COMMENTS, loaded),
    isSameComments,
  );
  const pendingByRow = useMemo(() => groupByRow(pending), [pending]);
  // A retained inactive panel holds stale items, and history that is still loading holds none.
  const canPublish = isPanelActive && isHistoryReady;
  const movedSourcesDraftKey = useRef<string | null>(null);
  useEffect(() => {
    if (!canPublish) {
      movedSourcesDraftKey.current = null;
      return;
    }
    const assistants = items.filter(isAssistantMessage);
    setLoaded(
      draftKey,
      assistants.map((item) => item.id),
    );
    // Once per load, not per streamed chunk: later output repeating a quote isn't a reload.
    if (movedSourcesDraftKey.current === draftKey) return;
    movedSourcesDraftKey.current = draftKey;
    moveReloadedSources(draftKey, assistants);
  }, [canPublish, draftKey, items, setLoaded]);
  const { items: commentTurns, delivered } = useDeliveredTurns(items);
  // Stable: the highlights would otherwise repaint on every streamed chunk.
  const blocksOf = useStableEvent((sourceItemId: string): MessageBlocks => {
    const source = items.find((item) => item.id === sourceItemId);
    return source?.kind === "assistant_message" ? blocksOfMessage(source) : [];
  });
  const comments = useMemo(
    (): StreamComments => ({
      draftKey,
      serverId,
      agentId,
      surfaceId,
      pendingByRow,
      delivered,
      commentTurns,
      viewportRef,
      blocksOf,
    }),
    [
      agentId,
      blocksOf,
      commentTurns,
      delivered,
      draftKey,
      pendingByRow,
      serverId,
      surfaceId,
      viewportRef,
    ],
  );
  return (
    <StreamCommentsContext.Provider value={comments}>
      {children}
      <OutputCommentHighlights
        surfaceId={surfaceId}
        pending={pending}
        delivered={delivered}
        blocksOf={blocksOf}
      />
      {composer ? (
        <OutputCommentSelectionLayer draftKey={draftKey} composer={composer} blocksOf={blocksOf} />
      ) : null}
    </StreamCommentsContext.Provider>
  );
}

export function useStreamViewportRef(): RefObject<StreamViewportHandle | null> {
  return useStreamComments().viewportRef;
}

/** A sent comment as found in the output, or null while that output isn't loaded or lacks it. */
export function useSentCommentQuote(key: string): SentCommentQuote | null {
  const { delivered, commentTurns } = useStreamComments();
  return useMemo(() => {
    for (const comments of delivered.values()) {
      const comment = comments.find((entry) => entry.key === key);
      if (!comment) continue;
      const source = commentTurns.find((item) => item.id === comment.sourceItemId);
      if (source?.kind !== "assistant_message") return null;
      const blockText = splitMarkdownBlocks(source.text)[comment.endBlock];
      return blockText === undefined ? null : { comment, blockText };
    }
    return null;
  }, [commentTurns, delivered, key]);
}

/**
 * Wraps the block's output so a card can follow the node or list item its quote ends in, and puts
 * the rest after it.
 */
export function OutputCommentsBlock({
  sourceItemId,
  blockIndex,
  blockText,
  children,
}: OutputCommentsBlockProps) {
  const { pendingByRow, delivered } = useStreamComments();
  const rowPending = pendingByRow.get(rowKey(sourceItemId, blockIndex)) ?? EMPTY_ROW_PENDING;
  const sourceDelivered = delivered.get(sourceItemId) ?? EMPTY_ROW_DELIVERED;
  const cards = useMemo(() => {
    const deliveredHere = sourceDelivered.filter((comment) => comment.endBlock === blockIndex);
    return placeCards({ pending: rowPending, delivered: deliveredHere, blockText });
  }, [blockIndex, blockText, rowPending, sourceDelivered]);
  // Null unless a card goes inside the block, so every other block keeps its Markdown rules.
  const renderSlot = useMemo((): RenderMarkdownSlot | null => {
    if (cards.afterSlots.size === 0) return null;
    return (slot) => {
      const group = cardsAt(cards.afterSlots, slot);
      return group ? <OutputCommentCards cards={group} blockText={blockText} /> : null;
    };
  }, [blockText, cards]);
  return (
    <>
      <MarkdownSlotContext.Provider value={renderSlot}>{children}</MarkdownSlotContext.Provider>
      <OutputCommentCards cards={cards.afterBlock} blockText={blockText} />
    </>
  );
}

function OutputCommentCards({ cards, blockText }: OutputCommentCardsProps) {
  const { draftKey, serverId, agentId, surfaceId, blocksOf } = useStreamComments();
  const composer = useOutputCommentsComposer();
  const hasPending = composer !== null && cards.pending.length > 0;
  if (!hasPending && cards.delivered.length === 0) return null;
  // Marked as no part of the output, since cards can sit inside it: copy and find skip them.
  return (
    <View
      style={styles.container}
      dataSet={markdownCopyDataSet.ignore}
      testID="output-comment-rows"
    >
      {cards.delivered.map((comment) => (
        <DeliveredOutputCommentCard
          key={comment.key}
          surfaceId={surfaceId}
          comment={comment}
          blockText={blockText}
          blocksOf={blocksOf}
        />
      ))}
      {composer
        ? cards.pending.map(({ comment, number }) => (
            <PendingOutputCommentCard
              key={comment.id}
              draftKey={draftKey}
              serverId={serverId}
              agentId={agentId}
              comment={comment}
              number={number}
              blockText={blockText}
              blocksOf={blocksOf}
              composer={composer}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
}));
