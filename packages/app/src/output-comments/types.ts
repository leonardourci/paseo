import type { RefObject } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { OutputCommentsComposer } from "./composer-context";
import type { QuoteAnchor } from "./fence";
import type { DeliveredOutputComments } from "./match";
import type { PendingOutputComment } from "./store";

/** A message's Markdown blocks, which tell what the rows the list hasn't rendered hold. */
export type MessageBlocks = readonly string[];

export type MessageBlocksOf = (sourceItemId: string) => MessageBlocks;

export interface RevealQuoteInput {
  cardId: string;
  anchor: QuoteAnchor;
  blocks: MessageBlocks;
}

export interface OutputCommentHighlightsProps {
  surfaceId: string;
  pending: readonly PendingOutputComment[];
  delivered: DeliveredOutputComments;
  blocksOf: MessageBlocksOf;
}

export interface OutputCommentSelectionLayerProps {
  draftKey: string;
  composer: OutputCommentsComposer;
  blocksOf: MessageBlocksOf;
}

export interface UseNoteImagesInput {
  inputRef: RefObject<EditingTextInputHandle | null>;
  draftKey: string;
  commentId: string;
  composer: Pick<OutputCommentsComposer, "attachImage" | "removeImage">;
}
