import {
  createContext,
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
import { useRetainedPanelActive } from "@/components/retained-panel";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";
import { DeliveredOutputCommentCard } from "./card";
import { useOutputCommentsComposer } from "./composer-context";
import { useDeliveredTurns } from "./delivered";
import { OutputCommentHighlights } from "./highlights";
import type { QuoteAnchor } from "./fence";
import {
  findMovedCommentSource,
  locateQuote,
  replyTextOf,
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

interface OutputCommentsMessageProps {
  item: AssistantMessageItem;
  /** Done streaming, so its quotes can be looked for. */
  isComplete: boolean;
  children: ReactNode;
}

interface NumberedPendingComment {
  comment: PlacedOutputComment;
  number: number;
}

interface OutputCommentCardsProps {
  item: AssistantMessageItem;
  isComplete: boolean;
  pending: readonly NumberedPendingComment[];
  delivered: readonly DeliveredOutputComment[];
}

type CardEntry =
  | { kind: "pending"; key: string; at: number; entry: NumberedPendingComment }
  | { kind: "delivered"; key: string; at: number; comment: DeliveredOutputComment };

interface SentCommentQuote {
  comment: DeliveredOutputComment;
  /** The text of the reply holding it, as `replyPlainText` reads it. */
  replyText: string;
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
}

const EMPTY_ROW_PENDING: readonly NumberedPendingComment[] = [];
const EMPTY_ROW_DELIVERED: readonly DeliveredOutputComment[] = [];

const StreamCommentsContext = createContext<StreamComments | null>(null);

function useStreamComments(): StreamComments {
  const comments = useContext(StreamCommentsContext);
  invariant(comments, "Output comments render inside OutputCommentsLayer");
  return comments;
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
    }),
    [agentId, commentTurns, delivered, draftKey, pendingBySource, serverId, surfaceId, viewportRef],
  );
  return (
    <StreamCommentsContext.Provider value={comments}>
      <OutputCaretLayer viewportRef={viewportRef}>{children}</OutputCaretLayer>
      <OutputCommentHighlights surfaceId={surfaceId} pending={pending} delivered={delivered} />
      {composer ? <OutputCommentSelectionLayer draftKey={draftKey} composer={composer} /> : null}
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
      return { comment, replyText: replyTextOf(source) };
    }
    return null;
  }, [commentTurns, delivered, key]);
}

/**
 * The reply renders whole, as one Markdown text, and the cards of the comments on it follow it.
 * Their quotes are found in the text rather than marked in it, so a reply without comments costs
 * nothing.
 */
export function OutputCommentsMessage({ item, isComplete, children }: OutputCommentsMessageProps) {
  const { pendingBySource, delivered } = useStreamComments();
  const pending = pendingBySource.get(item.id) ?? EMPTY_ROW_PENDING;
  const sourceDelivered = delivered.get(item.id) ?? EMPTY_ROW_DELIVERED;
  const hasCards = pending.length > 0 || sourceDelivered.length > 0;
  return (
    <>
      {children}
      {hasCards ? (
        <OutputCommentCards
          item={item}
          isComplete={isComplete}
          pending={pending}
          delivered={sourceDelivered}
        />
      ) : null}
    </>
  );
}

function positionIn(replyText: string | null, anchor: QuoteAnchor): number {
  const match = replyText === null ? null : locateQuote(replyText, anchor);
  return match?.start ?? Number.POSITIVE_INFINITY;
}

/** In the order their quotes read in the reply; those it doesn't hold go last. */
function orderCards(
  replyText: string | null,
  pending: readonly NumberedPendingComment[],
  delivered: readonly DeliveredOutputComment[],
): CardEntry[] {
  const entries: CardEntry[] = [
    ...delivered.map(
      (comment): CardEntry => ({
        kind: "delivered",
        key: comment.key,
        at: positionIn(replyText, comment),
        comment,
      }),
    ),
    ...pending.map(
      (entry): CardEntry => ({
        kind: "pending",
        key: entry.comment.id,
        at: positionIn(replyText, entry.comment),
        entry,
      }),
    ),
  ];
  return entries.sort((a, b) => a.at - b.at);
}

const OutputCommentCards = memo(function OutputCommentCards({
  item,
  isComplete,
  pending,
  delivered,
}: OutputCommentCardsProps) {
  const { draftKey, serverId, agentId, surfaceId } = useStreamComments();
  const composer = useOutputCommentsComposer();
  // A streaming reply isn't read until it is done; its cards show their quotes as written.
  const replyText = useMemo(() => (isComplete ? replyTextOf(item) : null), [isComplete, item]);
  const shownPending = composer ? pending : EMPTY_ROW_PENDING;
  const cards = useMemo(
    () => orderCards(replyText, shownPending, delivered),
    [delivered, replyText, shownPending],
  );
  if (cards.length === 0) return null;
  // Marked as no part of the output: copy and find skip them.
  return (
    <View
      style={styles.container}
      dataSet={markdownCopyDataSet.ignore}
      testID="output-comment-rows"
    >
      {cards.map((card) => {
        if (card.kind === "delivered") {
          return (
            <DeliveredOutputCommentCard
              key={card.key}
              surfaceId={surfaceId}
              comment={card.comment}
              replyText={replyText}
            />
          );
        }
        return composer ? (
          <PendingOutputCommentCard
            key={card.key}
            draftKey={draftKey}
            serverId={serverId}
            agentId={agentId}
            comment={card.entry.comment}
            number={card.entry.number}
            replyText={replyText}
            composer={composer}
          />
        ) : null;
      })}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
