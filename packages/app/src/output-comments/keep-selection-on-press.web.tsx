import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useOutputCommentsComposer } from "./composer-context";

interface KeepSelectionOnPressProps {
  children: ReactNode;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

function keepFocusAndSelection(event: MouseEvent<HTMLDivElement>): void {
  event.preventDefault();
}

/**
 * In a composer with output to comment on, pressing what it wraps leaves focus and the output's
 * selection where they are, so dictation starting from it can aim at a focused note or the
 * selected text.
 */
export function KeepSelectionOnPress({ children }: KeepSelectionOnPressProps) {
  const hasOutputComments = useOutputCommentsComposer() !== null;
  if (!hasOutputComments) return children;
  return (
    <div onMouseDown={keepFocusAndSelection} style={DISPLAY_CONTENTS}>
      {children}
    </div>
  );
}
