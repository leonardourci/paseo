import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import type { AttachmentMetadata } from "@/attachments/types";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { AttachmentPill, AttachmentThumbnail } from "@/components/attachment-pill";
import { AutocompletePopover } from "@/components/ui/autocomplete-popover";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { OutputCommentBadge } from "./badge";
import { QuoteLine, cardStyles } from "./card";
import { outputCommentCardId, type OutputCommentsComposer } from "./composer-context";
import { useNoteImages } from "./note-images";
import { useNoteMentions } from "./note-mentions";
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
  serverId: string;
  agentId: string;
  comment: PlacedOutputComment;
  number: number;
  blockText: string;
  composer: OutputCommentsComposer;
}

interface NoteImagesProps {
  images: readonly AttachmentMetadata[];
  onRemove: (id: string) => void;
}

interface NoteImageProps {
  image: AttachmentMetadata;
  onOpen: (image: AttachmentMetadata) => void;
  onRemove: (id: string) => void;
}

const NoteInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const NO_IMAGE_IDS: readonly string[] = [];

function findComment(
  drafts: Record<string, PendingOutputComment[]>,
  draftKey: string,
  id: string,
): PendingOutputComment | undefined {
  return drafts[draftKey]?.find((candidate) => candidate.id === id);
}

function NoteImage({ image, onOpen, onRemove }: NoteImageProps) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpen(image), [image, onOpen]);
  const handleRemove = useCallback(() => onRemove(image.id), [image.id, onRemove]);
  return (
    <AttachmentPill
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={t("composer.attachments.openImage")}
      removeAccessibilityLabel={t("composer.attachments.removeImage")}
      testID="output-comment-image"
    >
      <AttachmentThumbnail metadata={image} />
    </AttachmentPill>
  );
}

function NoteImages({ images, onRemove }: NoteImagesProps) {
  const [lightbox, setLightbox] = useState<ImageLightboxSource | null>(null);
  const handleOpen = useCallback(
    (image: AttachmentMetadata) => setLightbox({ type: "attachment", metadata: image }),
    [],
  );
  const handleClose = useCallback(() => setLightbox(null), []);
  if (images.length === 0) return null;
  return (
    <View style={styles.images} testID="output-comment-images">
      {images.map((image) => (
        <NoteImage key={image.id} image={image} onOpen={handleOpen} onRemove={onRemove} />
      ))}
      <AttachmentLightbox source={lightbox} onClose={handleClose} />
    </View>
  );
}

export function PendingOutputCommentCard({
  draftKey,
  serverId,
  agentId,
  comment,
  number,
  blockText,
  composer,
}: PendingOutputCommentCardProps) {
  const { t } = useTranslation();
  const { id } = comment;
  const { surfaceId, images: draftImages, removeImage: removeDraftImage } = composer;
  const cardId = outputCommentCardId(surfaceId, id);
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const cardRef = useRef<View>(null);
  const shouldFocus = useOutputCommentFocusStore((state) =>
    isFocusing(state.focus, { surfaceId, id }),
  );
  const clearFocus = useOutputCommentFocusStore((state) => state.clearFocus);
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const isActive = useOutputCommentFocusStore((state) => state.activeKey === id);
  const updateNote = useOutputCommentsStore((state) => state.updateNote);
  const deleteComments = useOutputCommentsStore((state) => state.deleteComments);
  const unlinkImage = useOutputCommentsStore((state) => state.unlinkImage);
  const stored = useOutputCommentsStore((state) => findComment(state.drafts, draftKey, id));
  const note = stored?.note ?? "";
  const imageIds = stored?.imageIds ?? NO_IMAGE_IDS;
  const images = useMemo(
    () => draftImages.filter((image) => imageIds.includes(image.id)),
    [imageIds, draftImages],
  );
  const draftImageIds = useMemo(() => draftImages.map((image) => image.id), [draftImages]);

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
  const mentions = useNoteMentions({
    serverId,
    agentId,
    note,
    inputRef,
    onChangeText: handleChangeText,
  });
  const { onFocusChange: setMentionsFocused, onKeyPress: handleMentionsKeyPress } = mentions;
  const handleRemove = useCallback(() => {
    for (const imageId of deleteComments({ draftKey, ids: [id] })) removeDraftImage(imageId);
  }, [deleteComments, draftKey, id, removeDraftImage]);
  // Read the store: the blur may come from an input that is already unmounting.
  const dropIfEmpty = useCallback(() => {
    const current = findComment(useOutputCommentsStore.getState().drafts, draftKey, id);
    if (current && !isSendable(current, draftImageIds)) handleRemove();
  }, [draftImageIds, draftKey, handleRemove, id]);
  const handleBlur = useCallback(() => {
    setMentionsFocused(false);
    // Switching apps, say to grab a screenshot, blurs the note too; keep it for the return.
    if (isWeb && !document.hasFocus()) return;
    dropIfEmpty();
  }, [dropIfEmpty, setMentionsFocused]);
  // The ✕ blurs the note first, while the image still counted, so re-check here.
  const handleRemoveImage = useCallback(
    (imageId: string) => {
      unlinkImage({ draftKey, id, imageId });
      removeDraftImage(imageId);
      dropIfEmpty();
    },
    [draftKey, dropIfEmpty, id, removeDraftImage, unlinkImage],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (handleMentionsKeyPress(event)) return;
      if (event.nativeEvent.key === "Escape") inputRef.current?.blur();
    },
    [handleMentionsKeyPress],
  );
  useNoteImages({ inputRef, draftKey, commentId: id, composer });
  const handleFocus = useCallback(() => {
    setMentionsFocused(true);
    setActiveKey(id);
  }, [id, setActiveKey, setMentionsFocused]);
  const handlePress = useCallback(() => {
    setActiveKey(id);
    revealOutputCommentQuote(cardId, comment);
  }, [cardId, comment, id, setActiveKey]);

  return (
    <Pressable
      ref={cardRef}
      nativeID={cardId}
      onPress={handlePress}
      role="group"
      accessibilityLabel={t("outputComments.label", { number })}
      style={[cardStyles.card, styles.card, isActive && cardStyles.active]}
      testID="output-comment-pending"
    >
      <AutocompletePopover {...mentions.popover} anchorRef={cardRef} />
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
          onSelectionChange={mentions.onSelectionChange}
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
      <NoteImages images={images} onRemove={handleRemoveImage} />
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
  images: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
