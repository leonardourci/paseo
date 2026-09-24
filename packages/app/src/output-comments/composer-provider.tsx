import { useCallback, useId, useMemo, type ReactNode } from "react";
import type { ComposerTextSource } from "@/composer/text-source";
import { OutputCommentsComposerContext, type OutputCommentsComposer } from "./composer-context";
import { appendBlockquote } from "./fence";

interface OutputCommentsComposerProviderProps {
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  children: ReactNode;
}

export function OutputCommentsComposerProvider({
  textSource,
  setText,
  children,
}: OutputCommentsComposerProviderProps) {
  const surfaceId = useId();
  const insertQuote = useCallback(
    (quote: string) => setText(appendBlockquote(textSource.getSnapshot(), quote)),
    [setText, textSource],
  );
  const composer = useMemo(
    (): OutputCommentsComposer => ({ surfaceId, insertQuote }),
    [insertQuote, surfaceId],
  );
  return (
    <OutputCommentsComposerContext.Provider value={composer}>
      {children}
    </OutputCommentsComposerContext.Provider>
  );
}
