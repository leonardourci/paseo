import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { colorWithAlpha } from "@/utils/color";
import { outputCommentCardId } from "./composer-context";
import type { QuoteAnchor } from "./fence";
import { quoteSnippet, type DeliveredOutputComment } from "./match";
import { revealOutputCommentQuote } from "./reveal";
import { useOutputCommentFocusStore } from "./store";
import { HIGHLIGHT_ALPHA } from "./tint";

interface QuoteLineProps {
  blockText: string;
  anchor: Pick<QuoteAnchor, "quote" | "occurrence" | "isCode">;
}

interface DeliveredOutputCommentCardProps {
  surfaceId: string;
  comment: DeliveredOutputComment;
  blockText: string;
}

export function QuoteLine({ blockText, anchor }: QuoteLineProps) {
  const snippet = useMemo(() => quoteSnippet(blockText, anchor), [anchor, blockText]);
  if (snippet.match.length === 0) return null;
  return (
    <Text selectable={false} numberOfLines={1} ellipsizeMode="tail" style={cardStyles.quoteLine}>
      {snippet.before}
      <Text style={cardStyles.quoteMatch}>{snippet.match}</Text>
      {snippet.after}
    </Text>
  );
}

export function DeliveredOutputCommentCard({
  surfaceId,
  comment,
  blockText,
}: DeliveredOutputCommentCardProps) {
  const { t } = useTranslation();
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const isActive = useOutputCommentFocusStore((state) => state.activeKey === comment.key);
  const cardId = outputCommentCardId(surfaceId, comment.key);
  const handlePress = useCallback(() => {
    setActiveKey(comment.key);
    revealOutputCommentQuote(cardId, comment);
  }, [cardId, comment, setActiveKey]);
  return (
    <Pressable
      nativeID={cardId}
      onPress={handlePress}
      role="button"
      accessibilityLabel={t("outputComments.sentLabel")}
      style={[cardStyles.card, cardStyles.delivered, isActive && cardStyles.active]}
      testID="output-comment-delivered"
    >
      <QuoteLine blockText={blockText} anchor={comment} />
      <Text selectable={false} style={cardStyles.note}>
        {comment.note}
      </Text>
    </Pressable>
  );
}

export const cardStyles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderLeftWidth: theme.borderWidth[2],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  delivered: {
    borderLeftColor: theme.colors.surface4,
  },
  active: {
    borderColor: theme.colors.accent,
    borderLeftColor: theme.colors.accent,
    backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.delivered),
  },
  quoteLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  quoteMatch: {
    backgroundColor: colorWithAlpha(theme.colors.accent, HIGHLIGHT_ALPHA.pending),
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.content,
    lineHeight: Math.round(theme.fontSize.content * 1.4),
    _web: { overflowWrap: "anywhere" },
  },
}));
