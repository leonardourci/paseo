import {
  createContext,
  Fragment,
  memo,
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
import { OutputCaretLayer } from "@/output-caret/layer";
import { MarkdownBlockStack } from "@/components/markdown/block-stack";
import { MarkdownBlocksContext, type RenderMarkdownBlocks } from "@/components/markdown/slot";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { isWeb } from "@/constants/platform";
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
import { splitMarkdownAtSlots, type MarkdownPiece } from "./split";
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

interface OutputCommentsMessageProps {
  sourceItemId: string;
  children: ReactNode;
}

interface OutputBlocksProps {
  sourceItemId: string;
  blocks: readonly string[];
  renderMarkdown: (text: string) => ReactNode;
  pending: readonly NumberedPendingComment[];
  delivered: readonly DeliveredOutputComment[];
}

interface OutputBlockProps {
  index: number;
  blockText: string;
  renderMarkdown: (text: string) => ReactNode;
  pending: readonly NumberedPendingComment[];
  delivered: readonly DeliveredOutputComment[];
}

interface NumberedPendingComment {
  comment: PlacedOutputComment;
  number: number;
}

interface CardGroup {
  pending: NumberedPendingComment[];
  delivered: DeliveredOutputComment[];
}

type InnerSlot = { node: number } | { item: readonly number[] };

interface BlockCards {
  afterBlock: CardGroup;
  /** Keyed by `slotKey`, as `splitMarkdownAtSlots` reads them. */
  afterSlots: Map<string, CardGroup>;
}

interface BlockCardsInput {
  pending: readonly NumberedPendingComment[];
  delivered: readonly DeliveredOutputComment[];
  blockText: string;
}

interface OutputCommentCardsProps {
  cards: CardGroup;
  blockText: string;
  /** The list nesting the cards sit at. */
  depth?: number;
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
  pendingBySource: ReadonlyMap<string, readonly NumberedPendingComment[]>;
  delivered: DeliveredOutputComments;
  /** The items the delivered comments were resolved in. */
  commentTurns: readonly StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  blocksOf: MessageBlocksOf;
}

const EMPTY_ROW_PENDING: readonly NumberedPendingComment[] = [];
const EMPTY_ROW_DELIVERED: readonly DeliveredOutputComment[] = [];

const StreamCommentsContext = createContext<StreamComments | null>(null);

function useStreamComments(): StreamComments {
  const comments = useContext(StreamCommentsContext);
  invariant(comments, "Output comments render inside OutputCommentsLayer");
  return comments;
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
  function slotFor(anchor: QuoteAnchor): InnerSlot | null {
    if (anchor.endItem !== undefined) {
      itemNodes ??= listItemPaths(blockText);
      // A card after an item the block doesn't have would never render.
      if (itemNodes.has(itemKey(anchor.endItem))) return { item: anchor.endItem };
    }
    nodes ??= readTopLevelNodes(blockText);
    const node = quoteEndNode(nodes, anchor);
    return node === null ? null : { node };
  }
  function groupFor(anchor: QuoteAnchor): CardGroup {
    const slot = slotFor(anchor);
    if (!slot) return cards.afterBlock;
    const key = slotKey(slot);
    const group = cards.afterSlots.get(key) ?? emptyGroup();
    cards.afterSlots.set(key, group);
    return group;
  }
  for (const entry of pending) groupFor(entry.comment).pending.push(entry);
  for (const comment of delivered) groupFor(comment).delivered.push(comment);
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

function groupBySource(
  pending: readonly PlacedOutputComment[],
): Map<string, NumberedPendingComment[]> {
  const bySource = new Map<string, NumberedPendingComment[]>();
  for (const [index, comment] of pending.entries()) {
    const source = bySource.get(comment.sourceItemId) ?? [];
    source.push({ comment, number: index + 1 });
    bySource.set(comment.sourceItemId, source);
  }
  return bySource;
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
  const pendingBySource = useMemo(() => groupBySource(pending), [pending]);
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
      pendingBySource,
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
      pendingBySource,
      serverId,
      surfaceId,
      viewportRef,
    ],
  );
  return (
    <StreamCommentsContext.Provider value={comments}>
      <OutputCaretLayer viewportRef={viewportRef}>{children}</OutputCaretLayer>
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
 * Renders the reply's blocks with the cards of comments on it, each after the node or list item its
 * quote ends in. Web renders every reply by block, so a selection can tell its block; native keeps
 * a reply without cards one text, which its selection needs.
 */
export function OutputCommentsMessage({ sourceItemId, children }: OutputCommentsMessageProps) {
  const { pendingBySource, delivered } = useStreamComments();
  const pending = pendingBySource.get(sourceItemId) ?? EMPTY_ROW_PENDING;
  const sourceDelivered = delivered.get(sourceItemId) ?? EMPTY_ROW_DELIVERED;
  const hasCards = pending.length > 0 || sourceDelivered.length > 0;
  const renderBlocks = useMemo((): RenderMarkdownBlocks | null => {
    if (!isWeb && !hasCards) return null;
    return ({ blocks, renderMarkdown }) => (
      <OutputBlocks
        sourceItemId={sourceItemId}
        blocks={blocks}
        renderMarkdown={renderMarkdown}
        pending={pending}
        delivered={sourceDelivered}
      />
    );
  }, [hasCards, pending, sourceDelivered, sourceItemId]);
  return (
    <MarkdownBlocksContext.Provider value={renderBlocks}>{children}</MarkdownBlocksContext.Provider>
  );
}

/**
 * Comments on blocks not rendered yet (still revealing, or past the render cap) follow the last
 * rendered block, as their own cards: their quotes are placed in their blocks once those render.
 */
function OutputBlocks({
  sourceItemId,
  blocks,
  renderMarkdown,
  pending,
  delivered,
}: OutputBlocksProps) {
  const { blocksOf } = useStreamComments();
  const byBlock = useMemo(() => {
    const groups = new Map<number, CardGroup>();
    const groupAt = (endBlock: number) => {
      const group = groups.get(endBlock) ?? emptyGroup();
      groups.set(endBlock, group);
      return group;
    };
    for (const entry of pending) groupAt(entry.comment.endBlock).pending.push(entry);
    for (const comment of delivered) groupAt(comment.endBlock).delivered.push(comment);
    return groups;
  }, [delivered, pending]);
  const unrendered = [...byBlock].filter(([endBlock]) => endBlock >= blocks.length);
  return (
    <MarkdownBlockStack>
      {blocks.map((blockText, index) => (
        <OutputBlock
          // oxlint-disable-next-line react/no-array-index-key -- a block is its index in the reply
          key={index}
          index={index}
          blockText={blockText}
          renderMarkdown={renderMarkdown}
          pending={byBlock.get(index)?.pending ?? EMPTY_ROW_PENDING}
          delivered={byBlock.get(index)?.delivered ?? EMPTY_ROW_DELIVERED}
        />
      ))}
      {unrendered.map(([endBlock, group]) => (
        <OutputCommentCards
          key={`unrendered:${endBlock}`}
          cards={group}
          blockText={blocksOf(sourceItemId)[endBlock] ?? ""}
        />
      ))}
    </MarkdownBlockStack>
  );
}

/** A nested list's continuation, indented as its list and telling selections where its items are. */
function ContinuedPiece({
  piece,
  continues,
  children,
}: {
  piece: MarkdownPiece;
  continues: NonNullable<MarkdownPiece["continues"]>;
  children: ReactNode;
}) {
  const dataSet = useMemo(
    () => ({
      [OUTPUT_ITEM_PARENT_DATASET_KEY]: continues.parent.join("."),
      [OUTPUT_ITEM_START_DATASET_KEY]: String(continues.start),
    }),
    [continues],
  );
  return (
    <View style={styles.indent(piece.depth)} dataSet={dataSet}>
      {children}
    </View>
  );
}

function slotKeysOf(piece: MarkdownPiece): string[] {
  return piece.slots.map((slot) => slot.key);
}

const OutputBlock = memo(function OutputBlock({
  index,
  blockText,
  renderMarkdown,
  pending,
  delivered,
}: OutputBlockProps) {
  const cards = useMemo(
    () => placeCards({ pending, delivered, blockText }),
    [blockText, delivered, pending],
  );
  const pieces = useMemo(
    () => splitMarkdownAtSlots(blockText, new Set(cards.afterSlots.keys())),
    [blockText, cards],
  );
  // A slot the split didn't find still shows its cards, after the block.
  const afterBlock = useMemo(() => {
    const placed = new Set(pieces.flatMap(slotKeysOf));
    const unplaced = [...cards.afterSlots].filter(([key]) => !placed.has(key));
    if (unplaced.length === 0) return cards.afterBlock;
    const groups = [cards.afterBlock, ...unplaced.map(([, group]) => group)];
    return {
      pending: groups.flatMap((group) => group.pending),
      delivered: groups.flatMap((group) => group.delivered),
    };
  }, [cards, pieces]);
  const dataSet = useMemo(() => ({ [OUTPUT_BLOCK_DATASET_KEY]: String(index) }), [index]);
  return (
    <View dataSet={dataSet}>
      <MarkdownBlockStack>
        {pieces.map((piece) => (
          <Fragment key={piece.key}>
            {piece.continues ? (
              <ContinuedPiece piece={piece} continues={piece.continues}>
                {renderMarkdown(piece.text)}
              </ContinuedPiece>
            ) : (
              renderMarkdown(piece.text)
            )}
            {piece.slots.map((slot) => {
              const group = cards.afterSlots.get(slot.key);
              return group ? (
                <OutputCommentCards
                  key={slot.key}
                  cards={group}
                  blockText={blockText}
                  depth={slot.depth}
                />
              ) : null;
            })}
          </Fragment>
        ))}
        <OutputCommentCards cards={afterBlock} blockText={blockText} />
      </MarkdownBlockStack>
    </View>
  );
});

function OutputCommentCards({ cards, blockText, depth = 0 }: OutputCommentCardsProps) {
  const { draftKey, serverId, agentId, surfaceId, blocksOf } = useStreamComments();
  const composer = useOutputCommentsComposer();
  const hasPending = composer !== null && cards.pending.length > 0;
  if (!hasPending && cards.delivered.length === 0) return null;
  // Marked as no part of the output, since cards can sit inside it: copy and find skip them.
  return (
    <View
      style={depth > 0 ? [styles.container, styles.indent(depth)] : styles.container}
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

/** `data-output-block`, the block index a reply's block container carries. */
const OUTPUT_BLOCK_DATASET_KEY = "outputBlock";
/** `data-output-item-parent` and `-start`, read by `endItemPath` in `selection.web.ts`. */
const OUTPUT_ITEM_PARENT_DATASET_KEY = "outputItemParent";
const OUTPUT_ITEM_START_DATASET_KEY = "outputItemStart";
// ponytail: the list indent of `createMarkdownStyles` (`list.marginLeft`); read it if that varies.
const LIST_INDENT = 20;

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  indent: (depth: number) => ({
    marginLeft: depth * LIST_INDENT,
  }),
}));
