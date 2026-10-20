import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet } from "react-native-unistyles";
import { colorWithAlpha } from "@/utils/color";
import { outputCommentCardId } from "./composer-context";
import {
  quotePlainText,
  quoteSnippet,
  type DeliveredOutputComment,
  type LocatedQuote,
} from "./match";
import { revealOutputCommentQuote } from "./reveal";
import { useOutputCommentFocusStore } from "./store";
import { HIGHLIGHT_ALPHA } from "./tint";

interface QuoteLineProps {
  /**
   * The reply's text, as `replyPlainText` reads it, to show the quote in. Null while the reply is
   * not loaded or still streaming: the quote shows as written.
   */
  replyText: string | null;
  anchor: LocatedQuote;
}

interface DeliveredOutputCommentCardProps {
  surfaceId: string;
  comment: DeliveredOutputComment;
  replyText: string | null;
}

/** The quote as written; a quote the reply no longer holds says so, instead of standing on other words. */
function PlainQuoteLine({
  anchor,
  isUnresolved,
}: Pick<QuoteLineProps, "anchor"> & { isUnresolved: boolean }) {
  const { t } = useTranslation();
  const quote = useMemo(() => quotePlainText(anchor), [anchor]);
  if (!quote) return null;
  return (
    <Text
      selectable={false}
      numberOfLines={1}
      ellipsizeMode="tail"
      style={cardStyles.quoteLine}
      testID={isUnresolved ? "output-comment-unresolved" : undefined}
    >
      {isUnresolved ? t("outputComments.unresolved", { quote }) : quote}
    </Text>
  );
}

export function QuoteLine({ replyText, anchor }: QuoteLineProps) {
  const snippet = useMemo(
    () => (replyText === null ? null : quoteSnippet(replyText, anchor)),
    [anchor, replyText],
  );
  if (!snippet) return <PlainQuoteLine anchor={anchor} isUnresolved={replyText !== null} />;
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
  replyText,
}: DeliveredOutputCommentCardProps) {
  const { t } = useTranslation();
  const setActiveKey = useOutputCommentFocusStore((state) => state.setActiveKey);
  const isActive = useOutputCommentFocusStore((state) => state.activeKey === comment.key);
  const cardId = outputCommentCardId(surfaceId, comment.key);
  const handlePress = useCallback(() => {
    setActiveKey(comment.key);
    revealOutputCommentQuote({ cardId, anchor: comment });
  }, [cardId, comment, setActiveKey]);
  return (
    <PressHighlight
      nativeID={cardId}
      onPress={handlePress}
      role="button"
      accessibilityLabel={t("outputComments.sentLabel")}
      style={[cardStyles.card, cardStyles.delivered, isActive && cardStyles.active]}
      testID="output-comment-delivered"
    >
      <QuoteLine replyText={replyText} anchor={comment} />
      <Text selectable={false} style={cardStyles.note}>
        {comment.note}
      </Text>
    </PressHighlight>
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
