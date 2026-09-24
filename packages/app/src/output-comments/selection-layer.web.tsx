import { useCallback, useEffect, useReducer, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MessageSquarePlus, Quote } from "lucide-react-native";
import { getAssistantBlockRowId } from "@/agent-stream/presentation";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { usePaneFocus } from "@/panels/pane-context";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { collectImageFilesFromClipboardData } from "@/utils/image-attachments-from-files";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import type { QuoteAnchor } from "./fence";
import { attachNoteImage } from "./note-images.web";
import { pasteIntoFocusingNote, typeIntoFocusingNote } from "./note-keys";
import { readCommentableSelection, type CommentableSelection } from "./selection.web";
import { useOutputCommentFocusStore, useOutputCommentsStore } from "./store";
import { SURFACE_LAYER, surfaceRootOf } from "./surface.web";
import type { OutputCommentSelectionLayerProps } from "./types";

interface ToolbarAnchor {
  top: number;
  centerX: number;
  hostWidth: number;
}

type ToolbarState =
  | { phase: "hidden" }
  | { phase: "measuring"; anchor: ToolbarAnchor }
  | { phase: "shown"; anchor: ToolbarAnchor; width: number };

type ToolbarAction =
  | { type: "hide" }
  | { type: "place"; anchor: ToolbarAnchor }
  | { type: "measure"; width: number };

const HIDDEN: ToolbarState = { phase: "hidden" };
const TOOLBAR_GAP = SPACING[1.5];
const TOOLBAR_EDGE = SPACING[2];

function toolbarReducer(state: ToolbarState, action: ToolbarAction): ToolbarState {
  switch (action.type) {
    case "hide":
      return HIDDEN;
    case "place":
      if (state.phase === "shown") return { ...state, anchor: action.anchor };
      return { phase: "measuring", anchor: action.anchor };
    case "measure":
      if (state.phase === "hidden") return state;
      return { phase: "shown", anchor: state.anchor, width: action.width };
  }
}

function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

/** Input aimed at the output, not at a field or an overlay. */
function isOutputEvent(event: Event): boolean {
  return !event.defaultPrevented && !hasActiveWebOverlay() && !isEditable(document.activeElement);
}

function isOutputKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || isImeComposingKeyboardEvent(event)) {
    return false;
  }
  return isOutputEvent(event);
}

function isTypeToCommentKey(key: string): boolean {
  return key.length === 1 && key.trim() !== "";
}

function toolbarPosition(state: Exclude<ToolbarState, { phase: "hidden" }>) {
  const width = state.phase === "shown" ? state.width : 0;
  const { anchor } = state;
  const centered = anchor.centerX - width / 2;
  const left = Math.max(TOOLBAR_EDGE, Math.min(centered, anchor.hostWidth - width - TOOLBAR_EDGE));
  // Hidden until measured, so the first frame is not drawn off-centre.
  const opacity = state.phase === "shown" ? 1 : 0;
  return inlineUnistylesStyle({ top: anchor.top, left, opacity });
}

function preventSelectionLoss(event: MouseEvent<HTMLDivElement>): void {
  event.preventDefault();
}

export function OutputCommentSelectionLayer({
  draftKey,
  composer,
}: OutputCommentSelectionLayerProps) {
  const { t } = useTranslation();
  const { isInteractive } = usePaneFocus();
  const isActive = useRetainedPanelActive();
  const isEnabled = isActive && isInteractive;
  const { surfaceId, insertQuote } = composer;
  const layerRef = useRef<HTMLDivElement>(null);
  const isShownRef = useRef(false);
  const addComment = useOutputCommentsStore((state) => state.addComment);
  const focusNote = useOutputCommentFocusStore((state) => state.focusNote);
  const [toolbar, dispatch] = useReducer(toolbarReducer, HIDDEN);

  const surfaceRoot = useCallback((): HTMLElement | null => {
    const layer = layerRef.current;
    return layer ? surfaceRootOf(layer) : null;
  }, []);

  const readSelection = useCallback((): CommentableSelection | null => {
    const root = surfaceRoot();
    return root ? readCommentableSelection(window.getSelection(), root) : null;
  }, [surfaceRoot]);

  const clear = useCallback(() => {
    isShownRef.current = false;
    dispatch({ type: "hide" });
  }, []);

  const showForSelection = useCallback(() => {
    const layer = layerRef.current;
    const selection = readSelection();
    if (!layer || !selection) {
      clear();
      return;
    }
    const host = layer.getBoundingClientRect();
    const isOutOfView = selection.rect.bottom < host.top || selection.rect.top > host.bottom;
    if (isOutOfView) {
      clear();
      return;
    }
    isShownRef.current = true;
    const anchor = {
      top: selection.rect.bottom - host.top + TOOLBAR_GAP,
      centerX: selection.rect.left + selection.rect.width / 2 - host.left,
      hostWidth: host.width,
    };
    dispatch({ type: "place", anchor });
  }, [clear, readSelection]);

  const startComment = useCallback(
    ({ rect: _rect, ...anchor }: CommentableSelection, note: string): string => {
      const id = addComment({ ...anchor, draftKey }, note);
      focusNote({ surfaceId, id });
      window.getSelection()?.removeAllRanges();
      clear();
      return id;
    },
    [addComment, clear, draftKey, focusNote, surfaceId],
  );

  useEffect(() => {
    if (!isEnabled) {
      clear();
      return;
    }
    const onPointerUp = () => requestAnimationFrame(showForSelection);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) showForSelection();
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) clear();
    };
    const focusingNote = {
      draftKey,
      surfaceId,
      isCardRowRendered: ({ sourceItemId, endBlock }: QuoteAnchor) => {
        const rowId = CSS.escape(getAssistantBlockRowId(sourceItemId, endBlock));
        return Boolean(surfaceRoot()?.querySelector(`[data-history-row-id="${rowId}"]`));
      },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOutputKey(event)) return;
      const selection = isTypeToCommentKey(event.key) ? readSelection() : null;
      if (selection) startComment(selection, event.key);
      else if (!typeIntoFocusingNote(focusingNote, event.key)) return;
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!isOutputEvent(event)) return;
      const text = event.clipboardData?.getData("text/plain").replace(/\r\n/g, "\n") ?? "";
      const images = collectImageFilesFromClipboardData(event.clipboardData);
      if (text === "" && images.length === 0) return;
      const selection = readSelection();
      const commentId = selection
        ? startComment(selection, text)
        : pasteIntoFocusingNote(focusingNote, text);
      if (commentId === null) return;
      event.preventDefault();
      for (const image of images) void attachNoteImage({ draftKey, commentId, image, composer });
    };
    // The agent's own auto-scroll while streaming fires these, so follow the selection, once a frame.
    let frame = 0;
    const onReposition = () => {
      if (frame !== 0 || !isShownRef.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        showForSelection();
      });
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    // React Native TextInput stops bubbling key events, so listen in the capture phase.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("paste", onPaste);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste", onPaste);
    };
  }, [
    clear,
    composer,
    draftKey,
    isEnabled,
    readSelection,
    showForSelection,
    startComment,
    surfaceId,
    surfaceRoot,
  ]);

  // The toolbar may still stand for an earlier selection, say after a keyboard select-all, so
  // each button reads the selection as it is now.
  const handleComment = useCallback(() => {
    const selection = readSelection();
    if (selection) startComment(selection, "");
    else clear();
  }, [clear, readSelection, startComment]);
  const handleQuote = useCallback(() => {
    const selection = readSelection();
    if (selection) {
      insertQuote(selection.quote);
      window.getSelection()?.removeAllRanges();
    }
    clear();
  }, [clear, insertQuote, readSelection]);
  const handleToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    dispatch({ type: "measure", width: event.nativeEvent.layout.width });
  }, []);

  return (
    <div ref={layerRef} style={SURFACE_LAYER} onMouseDown={preventSelectionLoss}>
      {toolbar.phase === "hidden" ? null : (
        <View
          pointerEvents="auto"
          style={[styles.toolbar, toolbarPosition(toolbar)]}
          onLayout={handleToolbarLayout}
          testID="output-comment-toolbar"
        >
          <Button
            size="xs"
            variant="ghost"
            leftIcon={MessageSquarePlus}
            onPress={handleComment}
            testID="output-comment-toolbar-comment"
          >
            {t("outputComments.toolbar.comment")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            leftIcon={Quote}
            onPress={handleQuote}
            testID="output-comment-toolbar-quote"
          >
            {t("outputComments.toolbar.quote")}
          </Button>
        </View>
      )}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    position: "absolute",
    // Above the stream's floating controls, which render after this layer.
    zIndex: 1,
    flexDirection: "row",
    gap: theme.spacing[1],
    padding: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadow.md,
  },
}));
