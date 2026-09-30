import { File } from 'expo-file-system';

import type { BackgroundVideo, Reel, StudySet } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import {
  listBackgroundVideos,
  listReelsForSet,
  listStudySets,
  setReelWatched,
  touchStudySetProgress,
} from '@/services/storage/repositories';
import { loadCaptionTiming } from '@/services/ai/pipeline';
import type { CaptionTiming } from '@/services/ai/caption-timing';

/**
 * Phase 4A reel feed (spec §21 Reels tab + §20 watch flow).
 *
 * The feed is a vertical swipe of playable reels. Each entry resolves the
 * three things the player needs:
 *   • narration WAV path      (reels.audio_path — Phase 3 output)
 *   • caption timing JSON     (reels.caption_timing_path — karaoke clock)
 *   • background video path   (background_videos.local_path — seeded asset)
 *
 * Only reels whose audio + timing actually exist on disk are watchable;
 * everything else is reported honestly (no fake states).
 */

export interface ReelFeedEntry {
  reel: Reel;
  studySet: StudySet;
  background: BackgroundVideo | null;
  timing: CaptionTiming | null;
  /** audio + timing exist and validated — the reel is playable. */
  playable: boolean;
}

const log = (...args: unknown[]) => console.log('[feed]', ...args);

/** One playable reel + everything the player needs, or a reason it is not. */
async function resolveEntry(reel: Reel, studySet: StudySet, bg: BackgroundVideo | null): Promise<ReelFeedEntry> {
  let playable = false;
  let timing: CaptionTiming | null = null;

  if (reel.audioPath && reel.captionTimingPath) {
    const audioOk = new File(reel.audioPath).exists;
    timing = await loadCaptionTiming(reel.captionTimingPath);
    playable = audioOk && timing !== null;
    if (!playable) {
      log(`reel ${reel.id} not playable (audio=${audioOk}, timing=${timing !== null})`);
    }
  }
  return { reel, studySet, background: bg, timing, playable };
}

/**
 * Build the full feed: ready sets first (newest updated), reels in order.
 * Unplayable reels are included (greyed in the UI) so the user sees what's
 * incomplete rather than a mysteriously short feed.
 */
export async function loadReelFeed(): Promise<ReelFeedEntry[]> {
  const db = await getDatabase();
  const [sets, backgrounds] = await Promise.all([listStudySets(db), listBackgroundVideos(db)]);
  const bgById = new Map(backgrounds.map((b) => [b.id, b]));

  const readySets = sets.filter((s) => s.status === 'ready' || s.status === 'generating');
  const entries: ReelFeedEntry[] = [];
  for (const set of readySets) {
    const bg = bgById.get(set.config.backgroundVideoId) ?? backgrounds[0] ?? null;
    const reels = await listReelsForSet(db, set.id);
    for (const reel of reels) {
      entries.push(await resolveEntry(reel, set, bg));
    }
  }
  log(`feed built: ${entries.length} reel(s) from ${readySets.length} set(s), ${entries.filter((e) => e.playable).length} playable`);
  return entries;
}

/** All reels of one study set, in order (play-from-set entry point). */
export async function loadSetReels(studySetId: string): Promise<ReelFeedEntry[]> {
  const db = await getDatabase();
  const set = (await listStudySets(db)).find((s) => s.id === studySetId);
  if (!set) return [];
  const backgrounds = await listBackgroundVideos(db);
  const bg = backgrounds.find((b) => b.id === set.config.backgroundVideoId) ?? backgrounds[0] ?? null;
  const reels = await listReelsForSet(db, studySetId);
  const entries: ReelFeedEntry[] = [];
  for (const reel of reels) {
    entries.push(await resolveEntry(reel, set, bg));
  }
  log(`set feed "${set.title}": ${entries.length} reel(s), ${entries.filter((e) => e.playable).length} playable`);
  return entries;
}

/**
 * Watch bookkeeping (spec §20): persist watched=1, denormalized counters on
 * the study set. Called when a reel's narration finishes playing through.
 */
export async function markReelWatched(reelId: string, studySetId: string): Promise<void> {
  const db = await getDatabase();
  await setReelWatched(db, reelId, true);
  await touchStudySetProgress(db, studySetId);
  log(`reel ${reelId} marked watched (set ${studySetId} counters refreshed)`);
}
