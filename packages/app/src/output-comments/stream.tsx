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
  ListItemSlotContext,
  type RenderAfterListItem,
} from "@/components/markdown/list-item-slot";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { DeliveredOutputCommentCard } from "./card";
import { useOutputCommentsComposer } from "./composer-context";
import { useDeliveredTurns } from "./delivered";
import { OutputCommentHighlights } from "./highlights";
import {
  findMovedCommentSource,
  listItemPaths,
  type DeliveredOutputComment,
  type DeliveredOutputComments,
} from "./match";
import { PendingOutputCommentCard } from "./pending-card";
import { OutputCommentSelectionLayer } from "./selection-layer";
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

interface BlockCards {
  afterBlock: CardGroup;
  /** Keyed by the item's path, dot-joined as in the fence. */
  afterItems: Map<string, CardGroup>;
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
}

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

function emptyGroup(): CardGroup {
  return { pending: [], delivered: [] };
}

/** A card goes after the list item its quote ends in, else after the block. */
function placeCards({ pending, delivered, blockText }: BlockCardsInput): BlockCards {
  const cards: BlockCards = { afterBlock: emptyGroup(), afterItems: new Map() };
  let itemPaths: ReadonlySet<string> | null = null;
  function groupFor(endItem: readonly number[] | undefined): CardGroup {
    if (endItem === undefined) return cards.afterBlock;
    const key = itemKey(endItem);
    itemPaths ??= listItemPaths(blockText);
    // A card after an item the block doesn't have would never render.
    if (!itemPaths.has(key)) return cards.afterBlock;
    const group = cards.afterItems.get(key) ?? emptyGroup();
    cards.afterItems.set(key, group);
    return group;
  }
  for (const entry of pending) groupFor(entry.comment.endItem).pending.push(entry);
  for (const comment of delivered) groupFor(comment.endItem).delivered.push(comment);
  return cards;
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
    }),
    [agentId, commentTurns, delivered, draftKey, pendingByRow, serverId, surfaceId, viewportRef],
  );
  return (
    <StreamCommentsContext.Provider value={comments}>
      {children}
      <OutputCommentHighlights surfaceId={surfaceId} pending={pending} delivered={delivered} />
      {composer ? <OutputCommentSelectionLayer draftKey={draftKey} composer={composer} /> : null}
    </StreamCommentsContext.Provider>
  );
}

export function useStreamViewportRef(): RefObject<StreamViewportHandle | null> {
  return useStreamComments().viewportRef;
}

/**
 * The text of the output block a sent comment's inline card follows, or null while that output
 * isn't loaded or no longer holds the quote.
 */
export function useSentCommentBlockText(key: string): string | null {
  const { delivered, commentTurns } = useStreamComments();
  return useMemo(() => {
    for (const comments of delivered.values()) {
      const comment = comments.find((entry) => entry.key === key);
      if (!comment) continue;
      const source = commentTurns.find((item) => item.id === comment.sourceItemId);
      if (source?.kind !== "assistant_message") return null;
      return splitMarkdownBlocks(source.text)[comment.endBlock] ?? null;
    }
    return null;
  }, [commentTurns, delivered, key]);
}

/** Wraps the block's output so its cards can follow list items, and puts the rest after it. */
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
  // Null unless a card follows an item, so every other block keeps its Markdown rules.
  const renderAfterListItem = useMemo((): RenderAfterListItem | null => {
    if (cards.afterItems.size === 0) return null;
    return (path) => {
      const group = cards.afterItems.get(itemKey(path));
      return group ? <OutputCommentCards cards={group} blockText={blockText} /> : null;
    };
  }, [blockText, cards]);
  return (
    <>
      <ListItemSlotContext.Provider value={renderAfterListItem}>
        {children}
      </ListItemSlotContext.Provider>
      <OutputCommentCards cards={cards.afterBlock} blockText={blockText} />
    </>
  );
}

function OutputCommentCards({ cards, blockText }: OutputCommentCardsProps) {
  const { draftKey, serverId, agentId, surfaceId } = useStreamComments();
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
