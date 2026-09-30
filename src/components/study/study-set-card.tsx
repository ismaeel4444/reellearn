import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SafeLinearGradient } from '@/components/ui/safe-linear-gradient';

import { palette } from '@/theme/palette';
import type { StudySet } from '@/models/types';

export interface StudySetCardProps {
  studySet: StudySet;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Percent of reels watched (0..100). */
  progressPercent: number;
}

/** Deterministic gradient colors derived from the set title (no assets needed). */
function thumbColors(title: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  const combos: [string, string][] = [
    ['#1E7A4C', '#0F1117'], // biology-ish green
    ['#5A3FE0', '#0F1117'], // physics-ish purple
    ['#1B5FA8', '#0F1117'], // chemistry-ish blue
    ['#8A4FD0', '#171B26'],
    ['#0F6E8C', '#171B26'],
  ];
  return combos[Math.abs(hash) % combos.length];
}

export function StudySetCard({ studySet, onPress, onLongPress, progressPercent }: StudySetCardProps) {
  const [from, to] = thumbColors(studySet.title);
  const percent = Math.round(progressPercent);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${studySet.title}. ${studySet.reelCountActual} reels, ${percent} percent watched.`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.thumb}>
        <SafeLinearGradient
          colors={[from, to]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.thumbLetter}>{studySet.title.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.body}>
        <AppText variant="heading" size={17} numberOfLines={1}>
          {studySet.title}
        </AppText>
        <View style={styles.metaRow}>
          <AppText variant="caption">{studySet.reelCountActual} Reels</AppText>
          <View style={styles.dot} />
          <AppText variant="caption" color="secondary">
            {percent}%
          </AppText>
          {studySet.quizScorePercent != null ? (
            <>
              <View style={styles.dot} />
              <AppText variant="caption" color="accent" weight="600">
                Quiz {studySet.quizScorePercent}%
              </AppText>
            </>
          ) : null}
        </View>
        <View style={styles.progressRow}>
          <ProgressBar
            percent={progressPercent}
            color={palette.accent}
            height={6}
            trackColor={palette.border}
            accessibilityLabel={`${studySet.title} progress ${percent} percent`}
          />
          <AppText size={13} weight="700" color="secondary">
            {percent}%
          </AppText>
        </View>
      </View>
      {/* Overflow affordance, non-interactive (long-press opens actions). */}
      <View style={styles.overflowWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.overflowDot} />
        <View style={styles.overflowDot} />
        <View style={styles.overflowDot} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    gap: 14,
    alignItems: 'center',
  },
  thumb: {
    width: 62,
    height: 62,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbLetter: { color: palette.white, fontSize: 25, fontWeight: '800' },
  body: { flex: 1, gap: 7 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.textTertiary,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overflowWrap: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 12,
  },
  overflowDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: palette.textTertiary,
    opacity: 0.8,
  },
});
