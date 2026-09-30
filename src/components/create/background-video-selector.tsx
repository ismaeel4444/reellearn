import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';

import { palette } from '@/theme/palette';
import type { BackgroundVideo } from '@/models/types';

export interface BackgroundVideoSelectorProps {
  videos: BackgroundVideo[];
  selectedId: string;
  onSelect: (videoId: string) => void;
}

/**
 * Shows registered background videos (spec §22). The SELECTED video plays a
 * muted, looping live preview in its card so the user sees exactly what the
 * reels' gameplay background will look like; unselected cards stay static.
 */
export function BackgroundVideoSelector({ videos, selectedId, onSelect }: BackgroundVideoSelectorProps) {
  if (videos.length === 0) {
    return (
      <AppText variant="caption" color="secondary">
        No background videos registered yet.
      </AppText>
    );
  }

  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {videos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          selected={video.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function VideoCard({
  video,
  selected,
  onSelect,
}: {
  video: BackgroundVideo;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  // Live preview player only for the selected card (one player at a time —
  // avoids N decoders on the Create screen).
  const player = useVideoPlayer(
    selected && video.localPath ? { uri: video.localPath } : null,
    (p) => {
      p.loop = true;
      p.muted = true;
    }
  );
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (selected) {
      player.play();
    } else {
      player.pause();
    }
    return () => {
      mounted.current = false;
    };
  }, [selected, player]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`Background video ${video.name}`}
      onPress={() => onSelect(video.id)}
      style={({ pressed }) => [
        styles.item,
        selected && styles.itemSelected,
        pressed && { opacity: 0.85 },
      ]}>
      <View style={[styles.preview, selected && styles.previewSelected]}>
        {selected && video.localPath ? (
          <VideoView
            player={player}
            contentFit="cover"
            nativeControls={false}
            style={StyleSheet.absoluteFill}
            accessibilityLabel={`${video.name} preview`}
          />
        ) : (
          <AppIcon
            name="movie"
            size={26}
            color={selected ? palette.primary : palette.textSecondary}
          />
        )}
      </View>
      <View style={styles.checkWrap}>
        {selected ? <AppIcon name="check" size={14} color={palette.white} /> : null}
      </View>
      <AppText variant="caption" numberOfLines={1} style={styles.name}>
        {video.name}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: {
    width: 104,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 8,
    gap: 6,
  },
  itemSelected: { borderColor: palette.primary, backgroundColor: 'rgba(124, 92, 255, 0.10)' },
  preview: {
    width: '100%',
    height: 62,
    borderRadius: 10,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewSelected: {
    backgroundColor: 'rgba(124, 92, 255, 0.15)',
  },
  checkWrap: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { width: '100%', textAlign: 'center' },
});
