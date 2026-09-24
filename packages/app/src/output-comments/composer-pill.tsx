import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { MessageSquare } from "lucide-react-native";
import { getReviewSubtitle } from "@/attachments/attachment-pill-content";
import { AttachmentFrame, AttachmentLabel } from "@/components/attachment-pill";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedMessageSquare = withUnistyles(MessageSquare);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const pillIcon = <ThemedMessageSquare size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />;

interface OutputCommentsComposerPillProps {
  count: number;
}

export function OutputCommentsComposerPill({ count }: OutputCommentsComposerPillProps) {
  const { t } = useTranslation();
  return (
    <AttachmentFrame testID="composer-output-comments-pill">
      <AttachmentLabel
        icon={pillIcon}
        title={t("outputComments.composerTitle")}
        subtitle={getReviewSubtitle(count, t)}
      />
    </AttachmentFrame>
  );
}
