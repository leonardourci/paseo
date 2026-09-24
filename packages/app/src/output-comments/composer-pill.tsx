import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { MessageSquare } from "lucide-react-native";
import { getReviewSubtitle } from "@/attachments/attachment-pill-content";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedMessageSquare = withUnistyles(MessageSquare);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const pillIcon = <ThemedMessageSquare size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />;

interface OutputCommentsComposerPillProps {
  count: number;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
}

export function OutputCommentsComposerPill({
  count,
  disabled,
  onOpen,
  onRemove,
}: OutputCommentsComposerPillProps) {
  const { t } = useTranslation();
  const handleRemove = useCallback(async () => {
    // A single comment goes without asking, as its card's ✕ does.
    const isConfirmed =
      count === 1 ||
      (await confirmDialog({
        title: t("outputComments.removeAllTitle", { count }),
        message: t("outputComments.removeAllMessage"),
        confirmLabel: t("outputComments.removeAllConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }));
    if (isConfirmed) onRemove();
  }, [count, onRemove, t]);
  return (
    <AttachmentPill
      onOpen={onOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={t("outputComments.show")}
      removeAccessibilityLabel={t("outputComments.removeAll")}
      disabled={disabled}
      testID="composer-output-comments-pill"
    >
      <AttachmentLabel
        icon={pillIcon}
        title={t("outputComments.composerTitle")}
        subtitle={getReviewSubtitle(count, t)}
      />
    </AttachmentPill>
  );
}
