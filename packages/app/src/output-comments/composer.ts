import { useCallback, useMemo } from "react";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { outputCommentCardId, useOutputCommentsComposer } from "./composer-context";
import { revealOutputCommentCard } from "./reveal";
import {
  heldImageIds,
  imageAttachmentIds,
  placeQueuedText,
  prepareOutgoingText,
  restoreOutgoingText,
  sendableComments,
  withCommentImages,
} from "./send";
import {
  EMPTY_PENDING_COMMENTS,
  useLoadedOutputStore,
  useOutputCommentFocusStore,
  useOutputCommentsStore,
  type PendingOutputComment,
} from "./store";

interface AgentText {
  serverId: string;
  agentId: string;
  text: string;
  lastOutputId?: string;
}

interface RestoreOutputCommentsInput extends AgentText {
  attachments: readonly ComposerAttachment[];
}

interface OutgoingMessage {
  text: string;
  lastOutputId: string | undefined;
  markSent: () => void;
}

interface UseComposerOutputCommentsInput {
  serverId: string;
  agentId: string;
  attachments: UserComposerAttachment[];
}

interface ComposerOutputComments {
  count: number;
  prepare: (text: string, attachments: ComposerAttachment[]) => OutgoingMessage;
  /** What goes out with `text`: images only comments staying pending use stay behind. */
  withoutHeldImages: (
    text: string,
    attachments: UserComposerAttachment[],
  ) => UserComposerAttachment[];
  /** `attachments`, plus the draft's images pending comments use, for whatever clears the draft. */
  keepCommentImages: (attachments: UserComposerAttachment[]) => UserComposerAttachment[];
  openFirst: () => void;
  /** Held comments stay. */
  removeSendable: () => void;
}

function pendingIn(draftKey: string): readonly PendingOutputComment[] {
  return useOutputCommentsStore.getState().drafts[draftKey] ?? EMPTY_PENDING_COMMENTS;
}

function agentStreamItems(serverId: string, agentId: string): StreamItem[] {
  const session = useSessionStore.getState().sessions[serverId];
  return [
    ...(session?.agentStreamTail.get(agentId) ?? []),
    ...(session?.agentStreamHead.get(agentId) ?? []),
  ];
}

/** Puts a message's comments back into the pending ones and returns the text without them. */
export function restoreOutputComments({
  serverId,
  agentId,
  text,
  lastOutputId,
  attachments,
}: RestoreOutputCommentsInput): string {
  const restored = restoreOutgoingText({
    items: agentStreamItems(serverId, agentId),
    text,
    lastOutputId,
    imageIds: imageAttachmentIds(attachments),
  });
  if (restored.comments.length > 0) {
    useOutputCommentsStore.getState().restoreComments({
      draftKey: buildDraftStoreKey({ serverId, agentId }),
      comments: restored.comments,
    });
  }
  return restored.text;
}

export function placeQueuedOutputComments({
  serverId,
  agentId,
  text,
  lastOutputId,
}: AgentText): string {
  return placeQueuedText({ items: agentStreamItems(serverId, agentId), text, lastOutputId });
}

export function useComposerOutputComments({
  serverId,
  agentId,
  attachments,
}: UseComposerOutputCommentsInput): ComposerOutputComments {
  const draftKey = useMemo(() => buildDraftStoreKey({ serverId, agentId }), [agentId, serverId]);
  const draftImageIds = useMemo(() => imageAttachmentIds(attachments), [attachments]);
  const loaded = useLoadedOutputStore((state) => state.assistantIds[draftKey]);
  // A count rather than the list, so typing a note doesn't render the composer.
  const count = useOutputCommentsStore(
    (state) =>
      sendableComments({
        pending: state.drafts[draftKey] ?? EMPTY_PENDING_COMMENTS,
        imageIds: draftImageIds,
        loaded,
      }).length,
  );
  const removeSent = useOutputCommentsStore((state) => state.removeSent);
  const deleteComments = useOutputCommentsStore((state) => state.deleteComments);
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const focusNote = useOutputCommentFocusStore((state) => state.focusNote);
  const composer = useOutputCommentsComposer();
  const readSendable = useCallback(
    () =>
      sendableComments({
        pending: pendingIn(draftKey),
        imageIds: draftImageIds,
        loaded: useLoadedOutputStore.getState().assistantIds[draftKey],
      }),
    [draftImageIds, draftKey],
  );
  // Only an agent's composer has the provider, and only an agent's output takes comments.
  const surfaceId = composer?.surfaceId;
  const openFirst = useCallback(() => {
    const first = readSendable()[0];
    if (!first || surfaceId === undefined) return;
    setActiveKey(first.id);
    // A card in history the list hasn't rendered would take focus whenever it next renders.
    if (revealOutputCommentCard(outputCommentCardId(surfaceId, first.id))) {
      focusNote({ surfaceId, id: first.id });
    }
  }, [focusNote, readSendable, setActiveKey, surfaceId]);
  const removeImage = composer?.removeImage;
  const removeSendable = useCallback(() => {
    const ids = readSendable().map((comment) => comment.id);
    for (const imageId of deleteComments({ draftKey, ids })) removeImage?.(imageId);
  }, [deleteComments, draftKey, readSendable, removeImage]);
  const prepare = useCallback(
    (text: string, outgoingAttachments: ComposerAttachment[]): OutgoingMessage => {
      const prepared = prepareOutgoingText({
        text,
        pending: pendingIn(draftKey),
        imageIds: imageAttachmentIds(outgoingAttachments),
        loaded: useLoadedOutputStore.getState().assistantIds[draftKey],
      });
      const markSent = () => {
        if (prepared.sent.length > 0) removeSent({ draftKey, comments: prepared.sent });
      };
      return { text: prepared.text, lastOutputId: prepared.lastOutputId, markSent };
    },
    [draftKey, removeSent],
  );
  const withoutHeldImages = useCallback(
    (text: string, outgoingAttachments: UserComposerAttachment[]) => {
      const held = new Set(
        heldImageIds({
          text,
          pending: pendingIn(draftKey),
          loaded: useLoadedOutputStore.getState().assistantIds[draftKey],
        }),
      );
      return outgoingAttachments.filter(
        (attachment) => attachment.kind !== "image" || !held.has(attachment.metadata.id),
      );
    },
    [draftKey],
  );
  const keepCommentImages = useCallback(
    (next: UserComposerAttachment[]) =>
      withCommentImages({ attachments: next, draft: attachments, pending: pendingIn(draftKey) }),
    [attachments, draftKey],
  );
  return { count, prepare, withoutHeldImages, keepCommentImages, openFirst, removeSendable };
}
