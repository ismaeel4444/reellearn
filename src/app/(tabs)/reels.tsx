import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { palette } from '@/theme/palette';
import type { StudySet } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import { listStudySets } from '@/services/storage/repositories';

/**
 * Reels tab (user request): a study-sets list with a Watch button per set.
 * Each card opens the full-screen per-set pager (/watch/[id]); a header
 * action opens the swipe-all feed (/reels-feed) across every set. Sets
 * without playable reels say so instead of dead-ending.
 */
export default function ReelsScreen() {
  const router = useRouter();
  const [sets, setSets] = useState<StudySet[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const db = await getDatabase();
          setSets(await listStudySets(db));
        } catch (err) {
          console.error('[ReelsTab] failed to load sets', err);
        } finally {
          setLoaded(true);
        }
      })();
    }, [])
  );

  const watchable = sets.filter((s) => s.reelCountActual > 0);
  const inProgress = sets.filter(
    (s) => s.reelCountActual === 0 && (s.status === 'generating' || s.status === 'draft')
  );

  return (
    <Screen>
      <View style={styles.titleRow}>
        <AppText variant="sectionTitle">Reels</AppText>
        {watchable.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Watch all reels"
            onPress={() => router.push('/reels-feed')}
            style={({ pressed }) => [styles.allChip, pressed && { opacity: 0.8 }]}>
            <AppIcon name="play_circle" size={16} color={palette.primary} />
            <AppText variant="caption" weight="700" color="primary">
              Watch all
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText variant="bodySmall" color="secondary" style={styles.subtitle}>
        Pick a study set and swipe through its reels.
      </AppText>

      {!loaded ? (
        <AppText variant="bodySmall" color="tertiary">
          Loading…
        </AppText>
      ) : watchable.length === 0 && inProgress.length === 0 ? (
        <EmptyState
          icon="play_circle"
          title="Nothing to watch yet"
          body="Create a study set and generate reels first — they will show up here."
          actionLabel="Create a study set"
          onAction={() => router.navigate('/(tabs)/create')}
        />
      ) : null}

      {watchable.map((set) => {
        const percent =
          set.reelCountActual > 0
            ? Math.round((set.reelsWatched / set.reelCountActual) * 100)
            : 0;
        return (
          <View key={set.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${set.title}`}
              onPress={() => router.push(`/study-set/${set.id}`)}
              style={styles.cardBody}>
              <View style={styles.thumb}>
                <AppIcon name="menu_book" size={18} color={palette.primary} />
              </View>
              <View style={styles.textWrap}>
                <AppText size={15} weight="700" numberOfLines={1}>
                  {set.title}
                </AppText>
                <AppText variant="caption" color="tertiary">
                  {set.reelCountActual} reels · {percent}% watched
                </AppText>
                <ProgressBar
                  percent={percent}
                  height={4}
                  color={palette.accent}
                  trackColor={palette.border}
                />
              </View>
            </Pressable>
            <AppButton
              label="Watch"
              icon="play_circle"
              variant="secondary"
              onPress={() => router.push(`/watch/${set.id}`)}
            />
          </View>
        );
      })}

      {inProgress.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="bodySmall" color="tertiary" weight="600">
            Still in progress
          </AppText>
          {inProgress.map((set) => (
            <Pressable
              key={set.id}
              accessibilityRole="button"
              onPress={() => router.push(`/study-set/${set.id}`)}
              style={({ pressed }) => [styles.pendingRow, pressed && { opacity: 0.8 }]}>
              <AppIcon name="schedule" size={15} color={palette.textTertiary} />
              <AppText variant="bodySmall" color="secondary" style={styles.pendingText}>
                {set.title} — {set.status === 'generating' ? 'generating reels' : 'draft'}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  allChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  subtitle: { marginTop: 2, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    padding: 12,
    marginBottom: 10,
  },
  cardBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, gap: 3 },
  section: { marginTop: 18, gap: 8 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  pendingText: { flex: 1 },
});
