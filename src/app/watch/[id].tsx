import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, FlatList, NativeSyntheticEvent, NativeScrollEvent, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { useTabBarHidden } from '@/hooks/use-tab-bar-visibility';
import { ReelPlayer } from '@/features/reels/reel-player';
import type { ReelFeedEntry } from '@/services/media/reel-feed';
import { loadSetReels } from '@/services/media/reel-feed';
import { palette } from '@/theme/palette';

/**
 * Watch a single study set's reels (entry: study-set detail "Watch reels").
 * Same player as the Reels tab, scoped to one set, with a back button and
 * x/y position chip.
 */

const SCREEN_H = Dimensions.get('window').height;

function settledIndex(y: number): number {
  return Math.max(0, Math.round(y / SCREEN_H));
}

export default function SetWatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [entries, setEntries] = useState<ReelFeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const loadedOnce = useRef(false);
  /** Fires once when the LAST reel finishes — offers the end-of-set exam. */
  const examOffered = useRef(false);
  const watchedIds = useRef<Set<string>>(new Set());

  // Hide the bottom tab bar while watching (full-bleed video screen).
  useTabBarHidden();

  useFocusEffect(
    useCallback(() => {
      if (loadedOnce.current) return; // don't reload on refocus mid-session
      loadedOnce.current = true;
      void (async () => {
        if (!id) return;
        try {
          const feed = await loadSetReels(id);
          setEntries(feed);
        } catch (err) {
          console.error('[SetWatch] failed to load reels', err);
        } finally {
          setLoading(false);
        }
      })();
    }, [id])
  );

  useEffect(() => {
    return () => setActiveIndex(-1); // pause on unmount/focus loss
  }, []);

  const playable = useMemo(() => entries.filter((e) => e.playable), [entries]);

  // One swipe = one page (same fix as the Reels tab pager).
  const onScrollEnd = useCallback(
    ({ nativeEvent: { contentOffset } }: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActiveIndex(settledIndex(contentOffset.y));
    },
    []
  );

  if (!loading && playable.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.headerRow}>
          <AppButtonGhost onPress={() => router.back()} />
        </View>
        <View style={styles.emptyWrap}>
          <AppText variant="bodySmall" color="secondary">
            No playable reels yet — run generation first.
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={entries.filter((e) => e.playable)}
        keyExtractor={(e) => e.reel.id}
        renderItem={({ item, index }) => (
          <View style={{ height: SCREEN_H }}>
            <ReelPlayer
              entry={item}
              active={index === activeIndex}
              onWatched={(watched) => {
                // Count UNIQUE finished reels; after the last one, offer the exam.
                watchedIds.current.add(watched.reel.id);
                const playable = entries.filter((e) => e.playable).length;
                if (
                  !examOffered.current &&
                  playable > 0 &&
                  watchedIds.current.size >= playable
                ) {
                  examOffered.current = true;
                  Alert.alert(
                    'Set complete! 🎉',
                    'You finished every reel in this set. Ready to test yourself?',
                    [
                      { text: 'Later', style: 'cancel' },
                      { text: 'Take exam', onPress: () => router.replace(`/quiz/${id}`) },
                    ]
                  );
                }
              }}
            />
          </View>
        )}
        pagingEnabled
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
      />
      <View style={styles.backBtn}>
        <AppButtonGhost onPress={() => router.back()} />
      </View>
    </View>
  );
}

/** Minimal ghost back button (avoids importing AppButton chrome over video). */
function AppButtonGhost({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={onPress}
      style={styles.ghostBtn}>
      <AppIcon name="chevron_left" size={22} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  headerRow: { paddingTop: 54, paddingHorizontal: 16 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn: { position: 'absolute', top: 50, left: 12 },
  ghostBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 17, 23, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
