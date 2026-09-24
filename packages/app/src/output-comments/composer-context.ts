import { createContext, useContext } from "react";

export interface OutputCommentsComposer {
  /** Tells this pane's cards from another pane's showing the same agent. */
  surfaceId: string;
  insertQuote: (quote: string) => void;
}

export function outputCommentCardId(surfaceId: string, key: string): string {
  return `output-comment-card-${surfaceId}-${key}`;
}

export const OutputCommentsComposerContext = createContext<OutputCommentsComposer | null>(null);

export function useOutputCommentsComposer(): OutputCommentsComposer | null {
  return useContext(OutputCommentsComposerContext);
}
