import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { OutputCommentBadge } from "./badge";
import { QuoteLine, cardStyles } from "./card";
import { outputCommentCardId } from "./composer-context";
import { revealOutputCommentQuote } from "./reveal";
import {
  isFocusing,
  isSendable,
  useOutputCommentFocusStore,
  useOutputCommentsStore,
  type PendingOutputComment,
  type PlacedOutputComment,
} from "./store";

interface PendingOutputCommentCardProps {
  draftKey: string;
  surfaceId: string;
  comment: PlacedOutputComment;
  number: number;
  blockText: string;
}

const NoteInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function findComment(
  drafts: Record<string, PendingOutputComment[]>,
  draftKey: string,
  id: string,
): PendingOutputComment | undefined {
  return drafts[draftKey]?.find((candidate) => candidate.id === id);
}

export function PendingOutputCommentCard({
  draftKey,
  surfaceId,
  comment,
  number,
  blockText,
}: PendingOutputCommentCardProps) {
  const { t } = useTranslation();
  const { id } = comment;
  const cardId = outputCommentCardId(surfaceId, id);
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const shouldFocus = useOutputCommentFocusStore((state) =>
    isFocusing(state.focus, { surfaceId, id }),
  );
  const clearFocus = useOutputCommentFocusStore((state) => state.clearFocus);
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const isActive = useOutputCommentFocusStore((state) => state.activeKey === id);
  const updateNote = useOutputCommentsStore((state) => state.updateNote);
  const deleteComment = useOutputCommentsStore((state) => state.deleteComment);
  const note = useOutputCommentsStore(
    (state) => findComment(state.drafts, draftKey, id)?.note ?? "",
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!shouldFocus || !input) return;
    const current = findComment(useOutputCommentsStore.getState().drafts, draftKey, id);
    const text = current?.note ?? input.getText();
    input.focus();
    input.replaceText(text, { start: text.length, end: text.length });
    clearFocus({ surfaceId, id });
  }, [clearFocus, draftKey, id, shouldFocus, surfaceId]);

  const handleChangeText = useCallback(
    (text: string) => updateNote({ draftKey, id, note: text }),
    [draftKey, id, updateNote],
  );
  const handleRemove = useCallback(
    () => deleteComment({ draftKey, id }),
    [deleteComment, draftKey, id],
  );
  // Read the store: the blur may come from an input that is already unmounting.
  const dropIfEmpty = useCallback(() => {
    const current = findComment(useOutputCommentsStore.getState().drafts, draftKey, id);
    if (current && !isSendable(current)) handleRemove();
  }, [draftKey, handleRemove, id]);
  const handleBlur = useCallback(() => {
    // Switching apps blurs the note too; keep it for the return.
    if (isWeb && !document.hasFocus()) return;
    dropIfEmpty();
  }, [dropIfEmpty]);
  const handleKeyPress = useCallback((event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (event.nativeEvent.key === "Escape") inputRef.current?.blur();
  }, []);
  const handleFocus = useCallback(() => setActiveKey(id), [id, setActiveKey]);
  const handlePress = useCallback(() => {
    setActiveKey(id);
    revealOutputCommentQuote(cardId, comment);
  }, [cardId, comment, id, setActiveKey]);

  return (
    <Pressable
      nativeID={cardId}
      onPress={handlePress}
      role="group"
      accessibilityLabel={t("outputComments.label", { number })}
      style={[cardStyles.card, styles.card, isActive && cardStyles.active]}
      testID="output-comment-pending"
    >
      <QuoteLine blockText={blockText} anchor={comment} />
      <View style={styles.row}>
        <OutputCommentBadge number={number} isHighlighted={isActive} />
        <NoteInput
          ref={inputRef}
          multiline
          initialValue={note}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyPress={handleKeyPress}
          placeholder={t("outputComments.placeholder")}
          accessibilityLabel={t("outputComments.inputLabel")}
          style={styles.noteInput}
          testID="output-comment-input"
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={X}
          onPress={handleRemove}
          accessibilityLabel={t("outputComments.remove")}
          testID="output-comment-remove"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderLeftColor: theme.colors.accent,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  noteInput: {
    flex: 1,
    minWidth: 0,
    padding: theme.spacing[0],
    borderWidth: theme.borderWidth[0],
    backgroundColor: "transparent",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    lineHeight: Math.round(theme.fontSize.content * 1.4),
    // One line tall for a one-line note, growing as it wraps. Chromium only; elsewhere the
    // textarea keeps its default rows and scrolls.
    _web: {
      fieldSizing: "content",
      outlineStyle: "none",
    },
  },
}));
