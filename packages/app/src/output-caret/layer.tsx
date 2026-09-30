import type { OutputCaretLayerProps } from "./types";

export function OutputCaretLayer({ children }: OutputCaretLayerProps) {
  return children;
}

export function useIsOutputCaretAvailable(): boolean {
  return false;
}
