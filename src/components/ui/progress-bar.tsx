import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';

import { palette } from '@/theme/palette';

export interface ProgressBarProps {
  /** 0..100 */
  percent: number;
  showLabel?: boolean;
  height?: number;
  color?: string;
  trackColor?: string;
  accessibilityLabel?: string;
}

/** Rounded progress indicator; accent-colored fill like the study-set cards. */
export function ProgressBar({
  percent,
  showLabel = false,
  height = 8,
  color = palette.accent,
  trackColor = palette.surfaceHover,
  accessibilityLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View style={styles.row}>
      <View
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="progressbar"
        style={[styles.track, { height, backgroundColor: trackColor }]}>
        <View
          style={[
            styles.fill,
            { width: `${clamped}%` as const, backgroundColor: color, height },
          ]}
        />
      </View>
      {showLabel ? (
        <AppText size={13} weight="700" style={styles.label}>
          {clamped}%
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  track: { flex: 1, borderRadius: 999, overflow: 'hidden' },
  fill: { borderRadius: 999 },
  label: { color: palette.text, minWidth: 38, textAlign: 'right' },
});
