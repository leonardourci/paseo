import { useEffect } from "react";
import { resolveRasterImageMimeType } from "@/attachments/file-types";
import {
  collectImageFilesFromClipboardData,
  type ClipboardImageFile,
} from "@/utils/image-attachments-from-files";
import { useOutputCommentsStore } from "./store";
import type { UseNoteImagesInput } from "./types";

interface AttachNoteImageInput extends Omit<UseNoteImagesInput, "inputRef"> {
  image: ClipboardImageFile;
}

/** A dropped file can arrive with no type, so its name decides too. */
function droppedImageFiles(dataTransfer: DataTransfer | null): ClipboardImageFile[] {
  return Array.from(dataTransfer?.files ?? []).flatMap((file) => {
    const mimeType = resolveRasterImageMimeType({ mimeType: file.type, path: file.name });
    return mimeType ? [{ file, mimeType }] : [];
  });
}

/** Storing takes a moment; a comment deleted meanwhile takes its image out of the composer. */
export async function attachNoteImage({
  draftKey,
  commentId,
  image,
  composer,
}: AttachNoteImageInput): Promise<void> {
  const imageId = await composer.attachImage(image);
  if (!imageId) return;
  const isLinked = useOutputCommentsStore
    .getState()
    .linkImage({ draftKey, id: commentId, imageId });
  if (!isLinked) composer.removeImage(imageId);
}

export function useNoteImages({
  inputRef,
  draftKey,
  commentId,
  composer,
}: UseNoteImagesInput): void {
  useEffect(() => {
    const element = inputRef.current?.getNativeRef();
    if (!(element instanceof HTMLTextAreaElement)) return;
    const attachAll = (event: Event, images: readonly ClipboardImageFile[]) => {
      if (images.length === 0) return;
      event.preventDefault();
      for (const image of images) void attachNoteImage({ draftKey, commentId, image, composer });
    };
    const handlePaste = (event: ClipboardEvent) =>
      attachAll(event, collectImageFilesFromClipboardData(event.clipboardData));
    const handleDrop = (event: DragEvent) =>
      attachAll(event, droppedImageFiles(event.dataTransfer));

    element.addEventListener("paste", handlePaste);
    element.addEventListener("drop", handleDrop);
    return () => {
      element.removeEventListener("paste", handlePaste);
      element.removeEventListener("drop", handleDrop);
    };
  }, [commentId, composer, draftKey, inputRef]);
}
