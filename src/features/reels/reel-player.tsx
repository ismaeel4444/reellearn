import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useEventListener, useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { wordIndexAt } from '@/services/ai/caption-timing';
import { markReelWatched, type ReelFeedEntry } from '@/services/media/reel-feed';
import { exportReelMp4 } from '@/services/media/reel-export';
import { palette } from '@/theme/palette';

/**
 * Phase 4A reel player (spec §20 watch flow + §7 caption style).
 *
 * Composition happens at PLAY TIME — no video is rendered:
 *   • background: the study set's gameplay video, muted, looping (expo-video)
 *   • narration:  the reel's Kokoro WAV (expo-audio) — the MASTER clock
 *   • captions:   ONE word at a time from CaptionTiming, active word in
 *                 palette.captionHighlight (#FFD84D yellow), positioned low.
 *
 * Audio drives everything: play/pause audio and the video follows. The video
 * loops independently — gameplay backgrounds are ambience, not sync targets.
 *
 * Watched tracking: when narration finishes (didJustFinish), the reel is
 * persisted watched and `onFinished` fires so the pager can auto-advance.
 */

let audioModeConfigured = false;
async function ensureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
    });
    audioModeConfigured = true;
  } catch (err) {
    console.warn('[player] setAudioModeAsync failed', err);
  }
}

export interface ReelPlayerProps {
  entry: ReelFeedEntry;
  /** Only the centered reel plays; neighbors stay paused. */
  active: boolean;
  /** Narration finished → persist watched. */
  onWatched?: (entry: ReelFeedEntry) => void;
}

export function ReelPlayer({ entry, active, onWatched }: ReelPlayerProps) {
  const { reel, studySet, background, timing } = entry;

  const video = useVideoPlayer(background ? { uri: background.localPath } : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.volume = 0;
  });

  const audio = useAudioPlayer(reel.audioPath ?? null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(audio);

  // Reactive video time is NOT needed (ambience); only listen for errors.
  useEventListener(video, 'statusChange', (payload) => {
    if (payload.status === 'error') {
      console.warn(`[player] background video error: ${payload.error?.message ?? 'unknown'}`);
    }
  });

  const [finished, setFinished] = useState(false);
  /** Explicit user pause — the autoplay effect must respect it, or any
   *  re-run of that effect (active/finished change) resumes playback. */
  const [userPaused, setUserPaused] = useState(false);
  const wordHint = useRef(0);
  const watchedRef = useRef(false);
  const [wordIdx, setWordIdx] = useState(-1);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'done'>('idle');
  const [exportPct, setExportPct] = useState(0);

  const paused = status.isLoaded && !status.playing;

  useEffect(() => {
    if (active) void ensureAudioMode();
  }, [active]);

  // Active ↔ play/pause: audio is the master clock, video follows.
  // A manual pause (userPaused) always wins over autoplay.
  useEffect(() => {
    if (!active) {
      audio.pause();
      video.pause();
      return;
    }
    if (!finished && !userPaused) {
      audio.play();
      video.play();
    } else {
      audio.pause();
      video.pause();
    }
  }, [active, finished, userPaused, audio, video]);

  // Scrolling onto a reel autoplays it — clear any stale manual pause.
  useEffect(() => {
    if (active) setUserPaused(false);
  }, [active]);

  // Karaoke caption index from the audio clock (forward-only hint).
  useEffect(() => {
    if (!timing || !status.isLoaded) return;
    const t = status.currentTime;
    const idx = wordIndexAt(timing, t, wordHint.current);
    wordHint.current = Math.max(0, idx);
    if (idx !== wordIdx) setWordIdx(idx);
  }, [status.currentTime, status.isLoaded, timing, wordIdx]);

  // Narration finished → mark watched once, offer replay / auto-advance.
  useEffect(() => {
    if (status.didJustFinish && !watchedRef.current) {
      watchedRef.current = true;
      setFinished(true);
      video.pause();
      console.log(
        `[player] reel ${reel.id} finished (${(status.duration || timing?.duration || 0).toFixed(1)}s) — marking watched`
      );
      void markReelWatched(reel.id, reel.studySetId).then(() => onWatched?.(entry));
    }
  }, [status.didJustFinish, status.duration, timing, video, reel, entry, onWatched]);

  const replay = () => {
    watchedRef.current = false;
    setFinished(false);
    wordHint.current = 0;
    setWordIdx(-1);
    void audio.seekTo(0).then(() => audio.play());
    video.play();
  };

  const exportToGallery = async () => {
    if (!entry.playable || !reel.audioPath || !timing || exportState === 'working') return;
    setExportState('working');
    setExportPct(0);
    try {
      const result = await exportReelMp4({
        reelId: reel.id,
        reelTitle: reel.title ?? `Reel ${reel.index + 1}`,
        reelIndex: reel.index,
        audioPath: reel.audioPath,
        timing,
        backgroundPath: background?.localPath ?? '',
        onProgress: (p) => {
          if (p.fraction !== undefined) setExportPct(Math.round(p.fraction * 100));
        },
      });
      setExportState('done');
      Alert.alert(
        'Exported',
        result.savedToGallery
          ? `Saved to your gallery.`
          : 'Rendered, but the gallery save was skipped (permission denied).'
      );
    } catch (err) {
      setExportState('idle');
      console.error('[player] export failed', err);
      Alert.alert('Export failed', String((err as Error).message ?? err));
    }
  };

  const togglePlay = () => {
    if (finished) {
      replay();
      return;
    }
    // Derive from our own state, NOT status.playing (the audio status events
    // can lag ~100ms behind — reading them made rapid taps unreliable).
    if (userPaused) {
      setUserPaused(false);
      audio.play();
      video.play();
    } else {
      setUserPaused(true);
      audio.pause();
      video.pause();
    }
  };

  const activeWord = timing && wordIdx >= 0 ? timing.words[wordIdx] : undefined;
  const progress =
    status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  return (
    <Pressable style={styles.fill} accessibilityRole="button" accessibilityLabel={`Play reel ${reel.title ?? reel.index + 1}`} onPress={togglePlay}>
      {/* Background gameplay video — muted, loops, fills 9:16 */}
      {background ? (
        <VideoView
          player={video}
          contentFit="cover"
          nativeControls={false}
          style={styles.fill}
          accessibilityLabel="Background gameplay video"
        />
      ) : (
        <View style={[styles.fill, styles.noBg]}>
          <AppIcon name="videocam_off" size={28} color={palette.textTertiary} />
        </View>
      )}

      {/* Legibility scrim under captions */}
      <View style={styles.scrim} pointerEvents="none" />

      {/* Top overlay: export button only (number/set chips removed) */}
      <View style={styles.topRow}>
        <View style={{ flex: 1 }} />
        {entry.playable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export reel to gallery"
            disabled={exportState === 'working'}
            onPress={() => void exportToGallery()}
            style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.8 }]}>
            <AppIcon
              name={exportState === 'done' ? 'check' : 'file_download'}
              size={18}
              color={palette.captionHighlight}
            />
            {exportState === 'working' ? (
              <AppText variant="caption" weight="700" style={styles.chipText}>
                {exportPct}%
              </AppText>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {/* Loading state */}
      {!status.isLoaded && !finished ? (
        <View style={styles.centerBadge} pointerEvents="none">
          <ActivityIndicator color={palette.captionHighlight} />
        </View>
      ) : null}

      {/* THE caption — one word at a time, yellow when active (spec §7) */}
      {activeWord && !userPaused ? (
        <View style={styles.captionWrap} pointerEvents="none">
          <AppText style={[styles.captionWord, { color: palette.captionHighlight }]}>
            {activeWord.text}
          </AppText>
        </View>
      ) : null}

      {/* Play/pause indicator — big center icon shown while paused */}
      {!finished && status.isLoaded && userPaused ? (
        <View style={styles.centerBadge} pointerEvents="none">
          <View style={styles.playBadge}>
            <AppIcon name="play_arrow" size={34} color={palette.captionHighlight} />
          </View>
        </View>
      ) : null}

      {/* Replay affordance */}
      {finished ? (
        <View style={styles.centerBadge} pointerEvents="none">
          <View style={styles.replayChip}>
            <AppIcon name="replay" size={20} color={palette.captionHighlight} />
            <AppText variant="caption" weight="600" style={styles.chipText}>
              Tap to replay
            </AppText>
          </View>
        </View>
      ) : null}

      {/* Progress + narration clock — only while paused (user request) */}
      {paused && !finished ? (
        <View style={styles.bottomRow} pointerEvents="none">
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <AppText variant="caption" color="secondary" style={styles.chipText}>
            {reel.topic ?? reel.title ?? ''}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const ABS = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  fill: { ...ABS, backgroundColor: palette.black },
  noBg: { alignItems: 'center', justifyContent: 'center' },
  scrim: {
    ...ABS,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  topRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 54,
    pointerEvents: 'box-none',
  },
  chipText: { color: palette.text },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 17, 23, 0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  centerBadge: {
    ...ABS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 17, 23, 0.72)',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  playBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(15, 17, 23, 0.72)',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 280,
    alignItems: 'center',
    overflow: 'visible', // never clip the caption glyphs
    zIndex: 10,
  },
  captionWord: {
    fontSize: 38,
    lineHeight: 48, // explicit lineHeight — Android clips large text without it
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false, // Android default padding clips ascenders/descenders
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  bottomRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: palette.captionHighlight },
});
