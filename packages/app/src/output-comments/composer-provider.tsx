import { useCallback, useId, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { deleteAttachments } from "@/attachments/service";
import type { UserComposerAttachment } from "@/attachments/types";
import { removeComposerAttachmentAtIndex } from "@/composer/actions";
import type { AgentInputDraft } from "@/composer/draft/input-draft";
import type { ComposerTextSource } from "@/composer/text-source";
import { useToast } from "@/contexts/toast-context";
import {
  filesToImageAttachments,
  type ClipboardImageFile,
} from "@/utils/image-attachments-from-files";
import { OutputCommentsComposerContext, type OutputCommentsComposer } from "./composer-context";
import { appendBlockquote } from "./fence";
import { attachedImages } from "./send";

interface OutputCommentsComposerProviderProps {
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  attachments: AgentInputDraft["attachments"];
  setAttachments: AgentInputDraft["setAttachments"];
  children: ReactNode;
}

export function OutputCommentsComposerProvider({
  textSource,
  setText,
  attachments,
  setAttachments,
  children,
}: OutputCommentsComposerProviderProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const surfaceId = useId();
  const insertQuote = useCallback(
    (quote: string) => setText(appendBlockquote(textSource.getSnapshot(), quote)),
    [setText, textSource],
  );
  const attachImage = useCallback(
    async (image: ClipboardImageFile) => {
      const [metadata] = await filesToImageAttachments([image]);
      if (!metadata) {
        toast.error(t("outputComments.attachImageFailed"));
        return null;
      }
      const attachment: UserComposerAttachment = { kind: "image", metadata };
      setAttachments((current) => [...current, attachment]);
      return metadata.id;
    },
    [setAttachments, t, toast],
  );
  const removeImage = useCallback(
    (id: string) =>
      setAttachments((current) => {
        const index = current.findIndex(
          (attachment) => attachment.kind === "image" && attachment.metadata.id === id,
        );
        return removeComposerAttachmentAtIndex({ attachments: current, index, deleteAttachments });
      }),
    [setAttachments],
  );
  const images = useMemo(() => attachedImages(attachments), [attachments]);
  const composer = useMemo(
    (): OutputCommentsComposer => ({ surfaceId, insertQuote, attachImage, removeImage, images }),
    [attachImage, images, insertQuote, removeImage, surfaceId],
  );
  return (
    <OutputCommentsComposerContext.Provider value={composer}>
      {children}
    </OutputCommentsComposerContext.Provider>
  );
}
