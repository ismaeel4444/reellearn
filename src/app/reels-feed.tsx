import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Dimensions, FlatList, NativeSyntheticEvent, NativeScrollEvent, StyleSheet, View } from 'react-native';

import { useTabBarHidden } from '@/hooks/use-tab-bar-visibility';

import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { ReelPlayer } from '@/features/reels/reel-player';
import type { ReelFeedEntry } from '@/services/media/reel-feed';
import { loadReelFeed } from '@/services/media/reel-feed';
import { palette } from '@/theme/palette';

/**
 * Full reel feed (route /reels-feed, entry: Reels tab "Watch all").
 * Vertical full-screen pager of playable reels across every ready study set —
 * the TikTok-style learning feed. Only the centered entry is active (plays);
 * neighbors show their first frame paused. Tab bar is hidden here.
 */

const SCREEN_H = Dimensions.get('window').height;

/**
 * Compute the settled page index from the scroll offset. The FlatList always
 * ends exactly on a page boundary (pagingEnabled), so rounding the offset
 * against the page size is exact — even for a hard flick that skipped pages.
 */
function settledIndex(y: number): number {
  return Math.max(0, Math.round(y / SCREEN_H));
}

export default function ReelsFeedScreen() {
  const [entries, setEntries] = useState<ReelFeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const { focusReelId } = useLocalSearchParams<{ focusReelId?: string }>();

  // Full-bleed video feed: hide the bottom tab bar while this screen is shown.
  useTabBarHidden();

  // One swipe = one page: settle index from the offset after drag AND after
  // momentum, so a hard flick can never leave the player on the wrong reel.
  const onScrollEnd = useCallback(
    ({ nativeEvent: { contentOffset } }: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActiveIndex(settledIndex(contentOffset.y));
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const feed = await loadReelFeed();
          if (cancelled) return;
          setEntries(feed);
          // Optional deep link: focus a specific reel (e.g. from study set).
          if (focusReelId) {
            const idx = feed.findIndex((e) => e.reel.id === focusReelId);
            if (idx >= 0) setActiveIndex(idx);
          }
        } catch (err) {
          console.error('[ReelsFeed] failed to load feed', err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [focusReelId])
  );

  const playableCount = useMemo(() => entries.filter((e) => e.playable).length, [entries]);

  // Pause everything when the screen loses focus (navigating away).
  useEffect(() => {
    return () => setActiveIndex(-1);
  }, []);

  if (!loading && playableCount === 0) {
    return (
      <Screen>
        <EmptyState
          icon="play_circle"
          title="No reels yet"
          body="Generate reels from a study set first — they will appear here as a swipeable learning feed."
          actionLabel="Create a study set"
          onAction={undefined}
        />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.reel.id}
        renderItem={({ item, index }) => (
          <View style={{ height: SCREEN_H }}>
            {item.playable ? (
              <ReelPlayer
                entry={item}
                active={index === activeIndex}
                onWatched={(watched) => {
                  console.log(
                    `[ReelsFeed] reel ${watched.reel.id} watched — ${watched.studySet.title}`
                  );
                }}
              />
            ) : (
              <View style={styles.unplayable}>
                <AppText variant="bodySmall" color="tertiary">
                  {item.reel.title ?? `Reel ${item.reel.index + 1}`} — narration not ready
                </AppText>
              </View>
            )}
          </View>
        )}
        pagingEnabled
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  unplayable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    padding: 32,
  },
});
