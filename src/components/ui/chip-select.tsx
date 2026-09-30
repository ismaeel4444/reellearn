import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from './app-icon';
import { AppText } from './app-text';

import { palette } from '@/theme/palette';

export interface ChipOption {
  value: number | string;
  label: string;
}

export interface ChipSelectProps {
  label: string;
  options: ChipOption[];
  selected: number | string | null;
  onSelect: (value: number | string) => void;
  allowCustom?: boolean;
  customPlaceholder?: string;
  multiLineHint?: string;
  accessibilityHint?: string;
}

/** Horizontal chip selector used across the Create screen. */
export function ChipSelect({
  label,
  options,
  selected,
  onSelect,
  allowCustom = false,
  customPlaceholder,
  multiLineHint,
  accessibilityHint,
}: ChipSelectProps) {
  const isCustomSelected =
    allowCustom &&
    selected !== null &&
    !options.some((o) => String(o.value) === String(selected));

  return (
    <View style={styles.container}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.row}>
        {options.map((option) => {
          const isSelected = String(option.value) === String(selected) && !isCustomSelected;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityHint={accessibilityHint}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => [
                styles.chip,
                isSelected && styles.chipSelected,
                pressed && { opacity: 0.85 },
              ]}>
              <AppText
                size={14}
                weight={isSelected ? '700' : '500'}
                color={isSelected ? 'default' : 'secondary'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
        {allowCustom ? (
          <View style={[styles.chip, styles.customChip, isCustomSelected && styles.chipSelected]}>
            <TextInput
              accessibilityLabel={`${label}: custom value`}
              style={styles.customInput}
              placeholder={customPlaceholder ?? 'Custom'}
              placeholderTextColor={palette.textTertiary}
              keyboardType="number-pad"
              onChangeText={(text) => {
                const n = parseInt(text, 10);
                if (!Number.isNaN(n) && n > 0) onSelect(n);
              }}
            />
            {isCustomSelected ? (
              <AppIcon name="check" size={14} color={palette.accent} />
            ) : null}
          </View>
        ) : null}
      </View>
      {multiLineHint ? (
        <AppText variant="caption" style={styles.hint}>
          {multiLineHint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
  },
  chipSelected: {
    backgroundColor: 'rgba(124, 92, 255, 0.16)',
    borderColor: palette.primary,
  },
  customChip: { paddingHorizontal: 10 },
  customInput: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 52,
    padding: 0,
  },
  hint: { marginTop: 2 },
});
