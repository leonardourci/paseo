import type { ReactNode, RefObject } from "react";
import type { StreamViewportHandle } from "@/agent-stream/strategy";

export interface OutputCaretLayerProps {
  viewportRef: RefObject<StreamViewportHandle | null>;
  children: ReactNode;
}
