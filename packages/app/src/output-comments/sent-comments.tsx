import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { getReviewSubtitle } from "@/attachments/attachment-pill-content";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { QuoteLine, cardStyles } from "./card";
import type { ParsedOutputComment } from "./fence";
import { deliveredCommentKey, quotePlainText } from "./match";
import { useSentCommentBlockText, useStreamViewportRef } from "./stream";

interface SentOutputCommentsProps {
  itemId: string;
  comments: readonly ParsedOutputComment[];
  /** Owned by the message, whose bubble widens while open. */
  isExpanded: boolean;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SentOutputComments({
  itemId,
  comments,
  isExpanded,
  onToggle,
  style,
}: SentOutputCommentsProps) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);
  const viewportRef = useStreamViewportRef();
  const containerRef = useRef<View>(null);
  const restoreTogglePosition = useRef<(() => void) | null>(null);
  // The comments open downward from the toggle, whether or not the chat is following output.
  const handleToggle = useCallback(() => {
    const container = containerRef.current;
    if (isWeb && container instanceof HTMLElement) {
      restoreTogglePosition.current = viewportRef.current?.holdElementPosition?.(container) ?? null;
    }
    onToggle();
  }, [onToggle, viewportRef]);
  useLayoutEffect(() => {
    restoreTogglePosition.current?.();
    restoreTogglePosition.current = null;
  }, [isExpanded]);
  return (
    <View
      ref={containerRef}
      style={[styles.container, style]}
      testID="user-message-output-comments"
    >
      <Button
        variant="ghost"
        size="xs"
        leftIcon={isExpanded ? ChevronDown : ChevronRight}
        onPress={handleToggle}
        accessibilityLabel={isExpanded ? t("outputComments.hide") : t("outputComments.show")}
        accessibilityState={accessibilityState}
        style={styles.toggle}
        testID="user-message-output-comments-toggle"
      >
        {getReviewSubtitle(comments.length, t)}
      </Button>
      {isExpanded
        ? comments.map((comment) => (
            <SentCommentCard key={comment.position} itemId={itemId} comment={comment} />
          ))
        : null}
    </View>
  );
}

interface SentCommentCardProps {
  itemId: string;
  comment: ParsedOutputComment;
}

function SentCommentCard({ itemId, comment }: SentCommentCardProps) {
  const blockText = useSentCommentBlockText(deliveredCommentKey(itemId, comment.position));
  return (
    <View style={[cardStyles.card, cardStyles.delivered]}>
      {blockText === null ? (
        <PlainQuoteLine comment={comment} />
      ) : (
        <QuoteLine blockText={blockText} anchor={comment} />
      )}
      <Text style={cardStyles.note}>{comment.note}</Text>
    </View>
  );
}

function PlainQuoteLine({ comment }: Pick<SentCommentCardProps, "comment">) {
  const quote = useMemo(() => quotePlainText(comment), [comment]);
  if (!quote) return null;
  return (
    <Text numberOfLines={1} ellipsizeMode="tail" style={cardStyles.quoteLine}>
      {quote}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  // Right-aligned so it stays under the cursor when the bubble widens on expand.
  toggle: {
    alignSelf: "flex-end",
  },
}));
