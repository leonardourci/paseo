import type { ReactNode, RefObject } from "react";
import type { StreamViewportHandle } from "@/agent-stream/strategy";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { OutputCommentsComposer } from "./composer-context";
import type { QuoteAnchor } from "./fence";
import type { DeliveredOutputComments } from "./match";
import type { PendingOutputComment } from "./store";

export interface RevealQuoteInput {
  cardId: string;
  anchor: QuoteAnchor;
}

export interface OutputCommentHighlightsProps {
  surfaceId: string;
  pending: readonly PendingOutputComment[];
  delivered: DeliveredOutputComments;
}

export interface OutputCommentSelectionLayerProps {
  draftKey: string;
  composer: OutputCommentsComposer;
  viewportRef: RefObject<StreamViewportHandle | null>;
}

export interface OutputCommentPlacementProps {
  anchor: QuoteAnchor;
  order: number;
  replyText: string;
  isComplete: boolean;
  children: ReactNode;
}

export interface UseNoteImagesInput {
  inputRef: RefObject<EditingTextInputHandle | null>;
  draftKey: string;
  commentId: string;
  composer: Pick<OutputCommentsComposer, "attachImage" | "removeImage">;
}
