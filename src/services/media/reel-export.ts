import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { Video, Overlay } from 'react-native-video-pipeline';
import type { TextOverlay } from 'react-native-video-pipeline';
import type { CaptionTiming } from '@/services/ai/caption-timing';
import { dirs, ensureDataDirectories, uniqueName } from '@/services/storage/file-system';
import { palette } from '@/theme/palette';

/**
 * Phase 4B — burn a reel to MP4 (spec §20 "export / save").
 *
 * Uses react-native-video-pipeline (Media3 Transformer on Android,
 * AVFoundation on iOS — hardware encode, no FFmpeg):
 *
 *   • clip:    a `durationSec`-long segment of the background gameplay video,
 *              offset per reel index so consecutive reels show different
 *              footage (wrapping modulo the source length via Video.info)
 *   • audio:   { mode: 'replace', replaceUri: narration.wav } — gameplay
 *              audio out, Kokoro narration in
 *   • caption: ONE word at a time, palette.captionHighlight yellow,
 *              Overlay.Text per word with { startSec, endSec } timeRange —
 *              n overlays, each visible only during its word's window
 *              (same timing JSON the in-app player uses, one source of truth)
 *
 * Resource contract: no AI model is touched — this runs any time, even while
 * the LLM slot is busy (no ModelManager interaction).
 */

export interface ExportProgress {
  phase: 'probing' | 'rendering' | 'done';
  /** 0..1 render progress when reported by the pipeline. */
  fraction?: number;
}

export interface ExportResult {
  /** file:// URI of the rendered MP4 (in dirs.reels). */
  videoPath: string;
  durationSec: number;
  /** true if the MP4 was saved to the device gallery. */
  savedToGallery: boolean;
}

/** Output canvas: vertical short-form, 30 fps, 8 Mbps H.264. */
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const BITRATE = 8_000_000;

/** Caption placement (normalized anchor slot in the lower third). */
const CAPTION_FONT_SIZE = 92;

const log = (...args: unknown[]) => console.log('[export]', ...args);

/**
 * Export one reel to a burned MP4.
 * @param segmentOffsetSec where in the background video this reel's footage
 *        starts — pass reel.index * something for variety across a set.
 */
export async function exportReelMp4(
  opts: {
    reelId: string;
    reelTitle: string;
    reelIndex: number;
    audioPath: string;
    timing: CaptionTiming;
    backgroundPath: string;
    /** Offset into the background video; defaulted from reelIndex below. */
    segmentOffsetSec?: number;
    onProgress?: (p: ExportProgress) => void;
  }
): Promise<ExportResult> {
  const { reelId, reelTitle, reelIndex, audioPath, timing, backgroundPath } = opts;
  const onProgress = opts.onProgress;
  const t0 = Date.now();

  ensureDataDirectories();

  // ---- Probe background length so segments wrap --------------------------------
  onProgress?.({ phase: 'probing' });
  const info = await Video.info(backgroundPath);
  const bgDuration = info.durationSec ?? 0;
  log(`background "${backgroundPath.split('/').pop()}" — ${info.width}x${info.height}, ${bgDuration.toFixed(1)}s`);

  const narrationSec = Math.max(timing.duration, 0.5);
  let startSec = opts.segmentOffsetSec ?? (reelIndex * 12.5) % Math.max(bgDuration - narrationSec, 0.1);
  if (bgDuration > 0 && startSec + narrationSec > bgDuration) startSec = 0;
  log(`clip segment: start=${startSec.toFixed(1)}s len=${narrationSec.toFixed(1)}s`);

  // ---- Captions: one Overlay.Text per word, visible only in its window ----------
  const overlays: TextOverlay[] = timing.words.map((w) =>
    Overlay.Text({
      text: w.text,
      style: {
        fontSize: CAPTION_FONT_SIZE,
        color: palette.captionHighlight,
        weight: 'bold',
        align: 'center',
      },
      anchor: { x: 0.5, y: 0.78 }, // lower third, centered
      timeRange: { startSec: w.start, endSec: w.end },
    })
  );
  log(`captions: ${overlays.length} word overlay(s) — one visible at a time, #${palette.captionHighlight}`);

  // ---- Render -----------------------------------------------------------------
  const outName = uniqueName(`reel_${reelIndex + 1}`, 'mp4');
  const outPath = new File(dirs.reels, outName).uri;

  onProgress?.({ phase: 'rendering' });
  log(`render starting → ${outName} (${OUT_W}x${OUT_H}@${FPS}, ${(BITRATE / 1e6).toFixed(0)} Mbps, audio=replace)`);
  await Video.render({
    clips: [{ uri: backgroundPath, startSec, durationSec: narrationSec }],
    overlays,
    audio: { mode: 'replace', replaceUri: audioPath },
    output: { path: outPath, width: OUT_W, height: OUT_H, fps: FPS, bitrate: BITRATE, codec: 'h264' },
  }, {
    onProgress: (p) => {
      const fraction = p.nbFrames ? p.framesCompleted / p.nbFrames : undefined;
      onProgress?.({ phase: 'rendering', fraction });
    },
  });

  const file = new File(outPath);
  if (!file.exists) throw new Error(`Export failed: output missing at ${outPath}`);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`DONE in ${dur}s — ${(file.size / 1024 / 1024).toFixed(1)} MB → ${outPath}`);

  // ---- Save straight to the gallery ----------------------------------------------
  // expo-media-library 57 removed createAssetAsync from the main entry (it
  // throws at runtime); the class API `Asset.create()` is the replacement.
  let savedToGallery = false;
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (perm.granted) {
      const asset = await MediaLibrary.Asset.create(outPath);
      savedToGallery = true;
      log(`saved to gallery (asset ${asset.id})`);
    } else {
      log('gallery permission denied — MP4 stays in app storage only');
    }
  } catch (err) {
    console.warn('[export] gallery save failed (MP4 still on disk):', err);
  }

  onProgress?.({ phase: 'done' });
  return { videoPath: outPath, durationSec: narrationSec, savedToGallery };
}
