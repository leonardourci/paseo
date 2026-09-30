import { createContext, useContext } from "react";

export const OutputCaretRowContext = createContext<string | null>(null);

/** The row holding the output caret, which the web list keeps mounted. */
export function useOutputCaretRowId(): string | null {
  return useContext(OutputCaretRowContext);
}
