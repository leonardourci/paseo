import type { RefObject } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { OutputCommentsComposer } from "./composer-context";
import type { DeliveredOutputComments } from "./match";
import type { PendingOutputComment } from "./store";

export interface OutputCommentHighlightsProps {
  surfaceId: string;
  pending: readonly PendingOutputComment[];
  delivered: DeliveredOutputComments;
}

export interface OutputCommentSelectionLayerProps {
  draftKey: string;
  composer: OutputCommentsComposer;
}

export interface UseNoteImagesInput {
  inputRef: RefObject<EditingTextInputHandle | null>;
  draftKey: string;
  commentId: string;
  composer: Pick<OutputCommentsComposer, "attachImage" | "removeImage">;
}
