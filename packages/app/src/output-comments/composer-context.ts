import { createContext, useContext } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import type { ClipboardImageFile } from "@/utils/image-attachments-from-files";

export interface OutputCommentsComposer {
  /** Tells this pane's cards from another pane's showing the same agent. */
  surfaceId: string;
  insertQuote: (quote: string) => void;
  attachImage: (image: ClipboardImageFile) => Promise<string | null>;
  removeImage: (id: string) => void;
  images: readonly AttachmentMetadata[];
}

export function outputCommentCardId(surfaceId: string, key: string): string {
  return `output-comment-card-${surfaceId}-${key}`;
}

export const OutputCommentsComposerContext = createContext<OutputCommentsComposer | null>(null);

export function useOutputCommentsComposer(): OutputCommentsComposer | null {
  return useContext(OutputCommentsComposerContext);
}
