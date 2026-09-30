/**
 * Caption timing schema — the contract between the TTS stage and the reel
 * player/renderer (Phase 4). This is the "caption style" source of truth:
 *
 *   • ONE WORD shows at a time — never lines, never phrases.
 *   • The active word renders in the highlight color
 *     (palette.captionHighlight #FFD84D — yellow), all other styling stays
 *     with the player (font, size, position).
 *   • Word times come from Kokoro itself: each phrase chunk's exact audio
 *     duration is the clock; words inside a phrase are allocated
 *     proportional to their length (chars+1). Max drift inside a 1–3s
 *     phrase stays well under ~150 ms — imperceptible at karaoke speed.
 *   • Times are seconds, float, relative to the START of the narration
 *     audio (which begins at 0 in the rendered reel).
 *
 * Stored per reel as JSON at `reels.caption_timing_path` (DB column exists
 * since v1). Version field allows evolution without breaking old reels.
 */

export const CAPTION_TIMING_VERSION = 1 as const;

export interface CaptionWord {
  /** The word exactly as spoken — whitespace-free, punctuation attached. */
  readonly text: string;
  /** Start time in seconds (float) from narration start. */
  readonly start: number;
  /** End time in seconds (float). `end - start > 0` for every word. */
  readonly end: number;
}

export interface CaptionTiming {
  readonly version: typeof CAPTION_TIMING_VERSION;
  /** Narration sample rate — always Kokoro's 24000 Hz. */
  readonly sampleRate: 24000;
  /** Total narration duration in seconds (last word end). */
  readonly duration: number;
  /** The voice used for synthesis (e.g. 'af_heart'). */
  readonly voice: string;
  /** Flat ordered list — the player picks by binary search on `start`. */
  readonly words: readonly CaptionWord[];
}

/**
 * Validate a parsed JSON file against the schema. Returns the typed object or
 * throws with a precise reason — the player must NEVER render from an invalid
 * file (spec §30: surface the problem, don't guess).
 */
export function parseCaptionTiming(json: unknown): CaptionTiming {
  if (typeof json !== 'object' || json === null) {
    throw new Error('caption_timing.json: root is not an object');
  }
  const obj = json as Record<string, unknown>;
  if (obj.version !== CAPTION_TIMING_VERSION) {
    throw new Error(`caption_timing.json: unsupported version ${String(obj.version)}`);
  }
  if (obj.sampleRate !== 24000) {
    throw new Error(`caption_timing.json: unexpected sampleRate ${String(obj.sampleRate)}`);
  }
  if (typeof obj.duration !== 'number' || obj.duration <= 0) {
    throw new Error('caption_timing.json: duration must be a positive number');
  }
  if (typeof obj.voice !== 'string' || obj.voice.length === 0) {
    throw new Error('caption_timing.json: voice must be a non-empty string');
  }
  if (!Array.isArray(obj.words) || obj.words.length === 0) {
    throw new Error('caption_timing.json: words must be a non-empty array');
  }
  const words: CaptionWord[] = [];
  let prevEnd = 0;
  for (let i = 0; i < obj.words.length; i++) {
    const w = obj.words[i] as Record<string, unknown>;
    const text = typeof w.text === 'string' ? w.text : '';
    const start = typeof w.start === 'number' ? w.start : NaN;
    const end = typeof w.end === 'number' ? w.end : NaN;
    if (text.trim().length === 0) {
      throw new Error(`caption_timing.json: word ${i} has empty text`);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`caption_timing.json: word ${i} has invalid times (${start}..${end})`);
    }
    if (start < prevEnd - 1e-6) {
      throw new Error(`caption_timing.json: word ${i} starts before previous word ends`);
    }
    prevEnd = end;
    words.push({ text, start, end });
  }
  return {
    version: CAPTION_TIMING_VERSION,
    sampleRate: 24000,
    duration: obj.duration,
    voice: obj.voice,
    words,
  };
}

/**
 * Which word is active at time t (seconds)? Linear scan from a moving index —
 * word lists are short (a 30s reel has ~75 words) and playback is forward-only,
 * so a hint index beats binary search in practice. Returns -1 between words
 * (pause gaps): the player should keep the last word visible, not flicker.
 */
export function wordIndexAt(timing: CaptionTiming, t: number, hint = 0): number {
  const words = timing.words;
  if (t <= 0) return words.length > 0 ? 0 : -1;
  let i = Math.max(0, Math.min(hint, words.length - 1));
  while (i + 1 < words.length && words[i].end <= t) i++;
  while (i > 0 && words[i].start > t) i--;
  if (t < words[i].start) return i; // first word hasn't started; still show it
  return i;
}
