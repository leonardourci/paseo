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
