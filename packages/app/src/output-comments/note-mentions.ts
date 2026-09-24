import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import type {
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import {
  AUTOCOMPLETE_POPOVER_SELECTOR,
  type AutocompletePopover,
} from "@/components/ui/autocomplete-popover";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useAgentAutocomplete } from "@/hooks/use-agent-autocomplete";
import { caretAfterFileMentionReplacement } from "@/utils/file-mention-autocomplete";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";

const CARET_AT_END = Number.MAX_SAFE_INTEGER;

type NoteKeyPressEventData = TextInputKeyPressEventData &
  Parameters<typeof isImeComposingKeyboardEvent>[0];

interface UseNoteMentionsInput {
  serverId: string;
  agentId: string;
  note: string;
  inputRef: RefObject<EditingTextInputHandle | null>;
  onChangeText: (text: string) => void;
}

interface NoteMentions {
  popover: Omit<ComponentProps<typeof AutocompletePopover>, "anchorRef">;
  onKeyPress: (event: NativeSyntheticEvent<NoteKeyPressEventData>) => boolean;
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  onFocusChange: (focused: boolean) => void;
}

export function useNoteMentions({
  serverId,
  agentId,
  note,
  inputRef,
  onChangeText,
}: UseNoteMentionsInput): NoteMentions {
  const [cursor, setCursor] = useState(CARET_AT_END);
  const cursorRef = useRef(CARET_AT_END);
  const [focused, setFocused] = useState(false);
  const [dismissedNote, setDismissedNote] = useState<string | null>(null);

  const moveCursor = useCallback((position: number) => {
    cursorRef.current = position;
    setCursor(position);
  }, []);
  const setUserInput = useCallback(
    (next: string) => {
      const input = inputRef.current;
      if (!input) return;
      const caret = caretAfterFileMentionReplacement({
        previousText: input.getText(),
        cursorIndex: cursorRef.current,
        nextText: next,
      });
      input.replaceText(next, { start: caret, end: caret });
      onChangeText(next);
      moveCursor(caret);
    },
    [inputRef, moveCursor, onChangeText],
  );
  const focusInput = useCallback(() => inputRef.current?.focus(), [inputRef]);
  const autocomplete = useAgentAutocomplete({
    userInput: note,
    cursorIndex: Math.min(cursor, note.length),
    setUserInput,
    serverId,
    agentId,
    onAutocompleteApplied: focusInput,
    inlineOnly: true,
  });
  const visible = focused && autocomplete.isVisible && dismissedNote !== note;

  const snapshot = useCallback(() => {
    const text = inputRef.current?.getText() ?? note;
    const position = Math.min(cursorRef.current, text.length);
    return { text, selection: { start: position, end: position } };
  }, [inputRef, note]);

  const selectOption = autocomplete.onSelectOption;
  const onSelect = useCallback(
    (option: AutocompleteOption) => selectOption(option, snapshot()),
    [selectOption, snapshot],
  );

  const autocompleteKeyPress = autocomplete.onKeyPress;
  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<NoteKeyPressEventData>) => {
      if (!visible || isImeComposingKeyboardEvent(event.nativeEvent)) return false;
      if (event.nativeEvent.key === "Escape") {
        event.preventDefault();
        setDismissedNote(note);
        return true;
      }
      return autocompleteKeyPress({
        key: event.nativeEvent.key,
        preventDefault: () => event.preventDefault(),
        input: snapshot(),
      });
    },
    [autocompleteKeyPress, note, snapshot, visible],
  );

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
      moveCursor(event.nativeEvent.selection.start),
    [moveCursor],
  );

  useEffect(() => {
    if (!isWeb || !visible) return;
    const keepFocus = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(AUTOCOMPLETE_POPOVER_SELECTOR)) {
        event.preventDefault();
      }
    };
    document.addEventListener("mousedown", keepFocus, true);
    return () => document.removeEventListener("mousedown", keepFocus, true);
  }, [visible]);

  return {
    popover: {
      visible,
      options: autocomplete.options,
      selectedIndex: autocomplete.selectedIndex,
      onSelect,
      isLoading: autocomplete.isLoading,
      errorMessage: autocomplete.errorMessage,
      loadingText: autocomplete.loadingText,
      emptyText: autocomplete.emptyText,
    },
    onKeyPress,
    onSelectionChange,
    onFocusChange: setFocused,
  };
}
