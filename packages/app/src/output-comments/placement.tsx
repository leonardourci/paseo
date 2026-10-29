import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { OutputCommentPlacementProps } from "./types";

export function OutputCommentPlacement({ children }: OutputCommentPlacementProps) {
  return children;
}

export function focusCommentInput(input: EditingTextInputHandle): boolean {
  input.focus();
  return true;
}
