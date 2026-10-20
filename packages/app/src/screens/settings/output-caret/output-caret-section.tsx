import { useCallback, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import {
  MAX_OUTPUT_CARET_LINES,
  MIN_OUTPUT_CARET_LINES,
  parseClampedInteger,
  useAppSettings,
} from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useIsOutputCaretAvailable } from "@/output-caret/layer";
import { settingsStyles } from "@/styles/settings";
import { formatShortcut } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

interface OutputCaretLinesRowProps {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (lines: number) => void;
}

function OutputCaretLinesRow({ label, hint, value, disabled, onChange }: OutputCaretLinesRowProps) {
  const inputRef = useRef<EditingTextInputHandle>(null);

  // The input is uncontrolled: it shows the saved count, whatever was typed.
  useEffect(() => {
    inputRef.current?.replaceText(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const typed = input.getText().replace(/[^\d]/g, "");
    const bounds = { min: MIN_OUTPUT_CARET_LINES, max: MAX_OUTPUT_CARET_LINES };
    const next = parseClampedInteger(typed, bounds) ?? value;
    input.replaceText(String(next));
    if (next !== value) onChange(next);
  }, [onChange, value]);

  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, disabled && styles.disabledRow]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <TextInput
        ref={inputRef}
        editable={!disabled}
        aria-disabled={disabled}
        initialValue={String(value)}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        inputMode="numeric"
        selectTextOnFocus
        style={styles.numberInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

function OutputCaretSettings() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleEnabledChange = useCallback(
    (outputCaretEnabled: boolean) => void updateSettings({ outputCaretEnabled }),
    [updateSettings],
  );
  const handleLinesAboveChange = useCallback(
    (outputCaretLinesAbove: number) => void updateSettings({ outputCaretLinesAbove }),
    [updateSettings],
  );
  const handleLinesBelowChange = useCallback(
    (outputCaretLinesBelow: number) => void updateSettings({ outputCaretLinesBelow }),
    [updateSettings],
  );
  const focusComposerKeys = useShortcutKeys("focus-message-input");
  return (
    <SettingsSection title={t("settings.general.outputCaret.sectionTitle")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.outputCaret.title")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.outputCaret.description")}
            </Text>
            {focusComposerKeys ? (
              <Text style={settingsStyles.rowHint}>
                {t("settings.general.outputCaret.shortcutHint", {
                  shortcut: formatShortcut(focusComposerKeys[0], getShortcutOs()),
                })}
              </Text>
            ) : null}
            {settings.outputCaretEnabled ? null : (
              <Text style={settingsStyles.rowHint}>
                {t("settings.general.outputCaret.linesDisabledHint")}
              </Text>
            )}
          </View>
          <Switch
            value={settings.outputCaretEnabled}
            onValueChange={handleEnabledChange}
            accessibilityLabel={t("settings.general.outputCaret.title")}
          />
        </View>
        <OutputCaretLinesRow
          label={t("settings.general.outputCaret.linesAbove.label")}
          hint={t("settings.general.outputCaret.linesAbove.description")}
          value={settings.outputCaretLinesAbove}
          disabled={!settings.outputCaretEnabled}
          onChange={handleLinesAboveChange}
        />
        <OutputCaretLinesRow
          label={t("settings.general.outputCaret.linesBelow.label")}
          hint={t("settings.general.outputCaret.linesBelow.description")}
          value={settings.outputCaretLinesBelow}
          disabled={!settings.outputCaretEnabled}
          onChange={handleLinesBelowChange}
        />
      </View>
    </SettingsSection>
  );
}

export function OutputCaretSection() {
  const isAvailable = useIsOutputCaretAvailable();
  return isAvailable ? <OutputCaretSettings /> : null;
}

const styles = StyleSheet.create((theme) => ({
  disabledRow: {
    opacity: theme.opacity[50],
  },
  numberInput: {
    width: 112,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "right",
  },
}));
