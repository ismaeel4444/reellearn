import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View, Alert } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SafeLinearGradient } from '@/components/ui/safe-linear-gradient';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { strings } from '@/i18n/strings';
import type { Reel, Source, StudySet } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import {
  deleteStudySet,
  listReelsForSet,
  listSourcesForSet,
  getStudySet,
} from '@/services/storage/repositories';
import { safeDelete } from '@/services/storage/file-system';
import { deleteExtractedText } from '@/services/ai/ingestion';
import { palette } from '@/theme/palette';

function formatDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function StudySetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [studySet, setStudySet] = useState<StudySet | null>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!id) return;
        const db = await getDatabase();
        setStudySet(await getStudySet(db, id));
        setReels(await listReelsForSet(db, id));
        setSources(await listSourcesForSet(db, id));
      })();
    }, [id])
  );

  if (!studySet) {
    return (
      <Screen>
        <AppText variant="bodySmall" color="secondary">
          Loading…
        </AppText>
      </Screen>
    );
  }

  const statusLabel =
    studySet.status === 'draft'
      ? strings.studySet.statusDraft
      : studySet.status === 'ready'
        ? strings.studySet.statusReady
        : studySet.status === 'failed'
          ? strings.studySet.statusFailed
          : strings.studySet.statusGenerating;

  const percent =
    studySet.reelCountActual > 0
      ? Math.round((studySet.reelsWatched / studySet.reelCountActual) * 100)
      : 0;

  const confirmDelete = () => {
    Alert.alert(
      strings.common.delete,
      `Delete “${studySet.title}” and its generated data?`,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.common.delete,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const db = await getDatabase();
              for (const reel of reels) {
                safeDelete(reel.videoPath);
                safeDelete(reel.audioPath);
              }
              for (const src of sources) {
                safeDelete(src.localPath);
                deleteExtractedText(src.id);
              }
              await deleteStudySet(db, studySet.id);
              router.back();
            })();
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <AppIcon name="chevron_left" size={22} color={palette.text} />
        </Pressable>
        <AppText variant="heading" numberOfLines={1} style={styles.headerTitle}>
          {studySet.title}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.common.delete}
          hitSlop={8}
          onPress={confirmDelete}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <AppIcon name="delete" size={19} color={palette.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <AppText variant="caption" color="tertiary">
              Status
            </AppText>
            <AppText size={14} weight="700" color={studySet.status === 'ready' ? 'accent' : 'default'}>
              {statusLabel.replace(/ —.*$/, '')}
            </AppText>
          </View>
          <View style={styles.stat}>
            <AppText variant="caption" color="tertiary">
              Reels
            </AppText>
            <AppText size={14} weight="700">
              {studySet.reelCountActual}
            </AppText>
          </View>
          <View style={styles.stat}>
            <AppText variant="caption" color="tertiary">
              Watched
            </AppText>
            <AppText size={14} weight="700" color="accent">
              {percent}%
            </AppText>
          </View>
        </View>
        <ProgressBar
          percent={percent}
          height={6}
          color={palette.accent}
          trackColor={palette.border}
          accessibilityLabel={`${studySet.title} progress ${percent} percent`}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title={strings.studySet.reelsTab} />
        {reels.length === 0 ? (
          <EmptyState
            icon="movie"
            title={strings.studySet.noQuizYet.replace(/Quiz.*/, 'No reels yet')}
            body={strings.studySet.phaseNote}
          />
        ) : (
          <View style={styles.list}>
            {reels.map((reel) => {
              const done = reel.state === 'audio_ready' || reel.state === 'completed';
              const playable = done && reel.audioPath != null;
              return (
                <Pressable
                  key={reel.id}
                  style={styles.reelRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${reel.title ?? `reel ${reel.index + 1}`}`}
                  disabled={!playable}
                  onPress={() => router.push(`/watch/${studySet.id}`)}>
                  <View style={styles.reelThumb}>
                    <SafeLinearGradient
                      colors={[palette.gradientFrom, palette.gradientTo]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <AppIcon name="play_arrow" size={18} color={palette.white} />
                  </View>
                  <View style={styles.reelBody}>
                    <AppText size={15} weight="600" numberOfLines={1}>
                      {reel.title ?? `Reel ${reel.index + 1}`}
                    </AppText>
                    <AppText variant="caption" color="tertiary">
                      {formatDuration(reel.durationSec ?? studySet.config.reelDurationSec)} ·{' '}
                      {reel.topic ?? 'Script pending'}
                    </AppText>
                  </View>
                  {done ? (
                    <View style={styles.doneBadge}>
                      <AppIcon name={playable ? 'play_arrow' : 'check'} size={13} color={palette.accent} />
                      <AppText variant="caption" color="accent" weight="700">
                        {playable ? 'Play' : 'Done'}
                      </AppText>
                    </View>
                  ) : (
                    <View style={styles.pendingBadge}>
                      <AppText variant="caption" color="tertiary" weight="600">
                        {reel.state.replace(/_/g, ' ')}
                      </AppText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {sources.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={strings.studySet.sourcesTab} />
          <View style={styles.list}>
            {sources.map((src) => (
              <View key={src.id} style={styles.sourceRow}>
                <AppIcon
                  name={src.kind === 'image' ? 'image' : 'description'}
                  size={16}
                  color={palette.blue}
                />
                <View style={styles.sourceTextWrap}>
                  <AppText variant="bodySmall" numberOfLines={1}>
                    {src.name}
                  </AppText>
                  <AppText variant="caption" color={src.extractedTextChars != null ? 'accent' : 'tertiary'} weight={src.extractedTextChars != null ? '600' : '500'}>
                    {src.extractedTextChars != null
                      ? `${src.extractedTextChars.toLocaleString()} chars extracted`
                      : 'Text extraction pending (Phase 3)'}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {studySet.status === 'ready' ? (
          <>
            <AppButton
              label="Watch reels"
              onPress={() => router.push(`/watch/${studySet.id}`)}
              icon="play_circle"
              variant="secondary"
              fullWidth
              size="lg"
            />
            <AppButton
              label={studySet.quizScorePercent != null ? `Retake exam (${studySet.quizScorePercent}%)` : 'Take exam'}
              onPress={() => router.push(`/quiz/${studySet.id}`)}
              icon="quiz"
              variant="secondary"
              fullWidth
              size="lg"
            />
          </>
        ) : null}
        <AppButton
          label={studySet.status === 'ready' ? 'Regenerate' : strings.studySet.startGeneration}
          onPress={() => router.push(`/generation/${studySet.id}`)}
          icon="auto_awesome"
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  statsCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, gap: 3 },
  section: { marginTop: 24, gap: 10 },
  list: { gap: 10 },
  reelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 12,
  },
  reelThumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  reelBody: { flex: 1, gap: 2 },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 229, 183, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  pendingBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  sourceTextWrap: { flex: 1, gap: 1 },
  rowText: { flex: 1 },
  actions: { gap: 10, marginTop: 28 },
});
