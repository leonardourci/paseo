import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface OutputCommentBadgeProps {
  number: number;
  isHighlighted: boolean;
}

export function OutputCommentBadge({ number, isHighlighted }: OutputCommentBadgeProps) {
  return (
    <View style={[styles.badge, isHighlighted && styles.highlighted]}>
      <Text selectable={false} style={styles.text}>
        {number}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    minWidth: theme.iconSize.md,
    height: theme.iconSize.md,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  highlighted: {
    borderColor: theme.colors.foreground,
  },
  text: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.iconSize.md,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.accentForeground,
  },
}));
