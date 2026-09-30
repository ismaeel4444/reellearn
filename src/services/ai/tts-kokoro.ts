/**
 * Phase 3 TTS stage: Kokoro-82M via react-native-executorch.
 *
 * How word-accurate captions are produced without word timestamps (the RN
 * ExecuTorch Kokoro API yields chunk-level data only):
 *
 *   1. The narration script is split into short phrases (2–6 words, split on
 *      punctuation) BEFORE synthesis — so we always know each chunk's text.
 *   2. Each phrase is synthesized separately; the chunk's PCM length is the
 *      EXACT audio duration of that phrase (Kokoro's own clock).
 *   3. Words inside a phrase are allocated that duration proportional to
 *      their length (chars+1). Drift stays < ~150ms inside a 1–3s phrase.
 *   4. A fixed inter-phrase pause (the lib's KOKORO_PAUSE_MS) is inserted
 *      between phrases and counted in the timeline.
 *
 * Output per reel:
 *   • narration WAV (24 kHz mono PCM16) → dirs.audio
 *   • CaptionTiming JSON                → stored by caller via captionTimingPath
 *
 * Resource contract: the entire synthesis runs inside runExclusive('tts'),
 * and the Kokoro pipeline is disposed before the lock is released.
 */
import {
  createKokoroTextToSpeech,
  download,
  models,
  speech as rneSpeech,
  KOKORO_SAMPLE_RATE,
} from 'react-native-executorch';

import type { CaptionTiming, CaptionWord } from './caption-timing';
import { CAPTION_TIMING_VERSION } from './caption-timing';
import { runExclusive } from './model-manager';
import { dirs, ensureDataDirectories, uniqueName } from '@/services/storage/file-system';

export interface TtsProgress {
  stage: 'loading' | 'synthesizing' | 'writing' | 'done';
  phrase?: number;
  totalPhrases?: number;
}

export interface NarrationResult {
  /** file:// URI of the written 24 kHz mono WAV. */
  audioPath: string;
  timing: CaptionTiming;
  durationSec: number;
}

/** Inter-phrase pause: prefer the lib's own constant for en-us, else 120 ms. */
function kokoroPauseMs(): number {
  const table = (rneSpeech as unknown as { KOKORO_PAUSE_MS?: Record<string, number> })
    ?.KOKORO_PAUSE_MS;
  return table?.['en-us'] ?? 120;
}

// --- Phrase splitting ---------------------------------------------------------

/** Split text into speakable phrases of at most maxWords words. */
export function splitIntoPhrases(text: string, maxWords = 6): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // Split on sentence enders and commas, keeping the punctuation attached.
  const rawPhrases = cleaned.match(/[^.!?;,]+[.!?;,:]*/g) ?? [cleaned];
  const phrases: string[] = [];

  for (const raw of rawPhrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const words = phrase.split(' ');
    if (words.length <= maxWords) {
      phrases.push(phrase);
      continue;
    }
    // Break long clauses into word groups (no punctuation to help us).
    for (let i = 0; i < words.length; i += maxWords) {
      const group = words.slice(i, i + maxWords).join(' ').trim();
      if (group) phrases.push(group);
    }
  }
  return phrases;
}

/** Word weight: length + 1 so short words keep a speakable minimum slice. */
function wordWeight(word: string): number {
  return word.length + 1;
}

/**
 * Trim leading/trailing silence from a synthesized phrase chunk. Kokoro chunks
 * usually start with a short silent lead-in; if that silence is counted as
 * phrase time, every caption drifts late by that amount — accumulating across
 * phrases. We cut it (keeping a ~20 ms pad) so the word clock matches when
 * the voice is actually heard.
 * Returns [startIdx, endIdx) of the audible region (never empty).
 */
function audibleRegion(audio: Float32Array, sampleRate: number, threshold = 0.005): [number, number] {
  const pad = Math.round(0.02 * sampleRate); // keep 20 ms of natural attack
  let start = 0;
  let end = audio.length;
  while (start < end && Math.abs(audio[start]) < threshold) start++;
  while (end > start && Math.abs(audio[end - 1]) < threshold) end--;
  if (end - start < Math.round(0.05 * sampleRate)) {
    // Chunk is (nearly) all silent — leave it intact rather than emptying it.
    return [0, audio.length];
  }
  return [Math.max(0, start - pad), Math.min(audio.length, end + pad)];
}

/**
 * Build the per-word timeline for one phrase.
 * @param phraseStart absolute start time of the phrase (seconds)
 * @param phraseDuration exact Kokoro audio duration (seconds)
 */
export function buildPhraseWords(
  phrase: string,
  phraseStart: number,
  phraseDuration: number
): CaptionWord[] {
  const words = phrase.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || phraseDuration <= 0) return [];

  const totalWeight = words.reduce((sum, w) => sum + wordWeight(w), 0);
  const out: CaptionWord[] = [];
  let cursor = phraseStart;
  for (const word of words) {
    const dur = (wordWeight(word) / totalWeight) * phraseDuration;
    out.push({ text: word, start: round3(cursor), end: round3(cursor + dur) });
    cursor += dur;
  }
  // Nudge the last word's end to exactly close the phrase (no audible gap).
  const last = out[out.length - 1];
  if (last) {
    out[out.length - 1] = { ...last, end: round3(phraseStart + phraseDuration) };
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// --- WAV encoding ---------------------------------------------------------------

/** Encode mono Float32 PCM [-1,1] into a 16-bit RIFF/WAVE byte buffer. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

// --- Synthesis -------------------------------------------------------------------

/**
 * Synthesize a narration script into audio + caption timing.
 * MUST be called inside the tts slot (it enforces the contract itself).
 */
export async function synthesizeNarration(
  script: string,
  voice: string,
  onProgress?: (p: TtsProgress) => void,
  speed = 1.0
): Promise<NarrationResult> {
  return runExclusive('tts', async () => {
    onProgress?.({ stage: 'loading' });
    const tAll = Date.now();

    const spec = models.textToSpeech.KOKORO.EN_US.XNNPACK_FP32 ?? (models as any).textToSpeech.KOKORO.EN_US.DEFAULT;
    console.log('[TTS] loading Kokoro EN_US XNNPACK_FP32 (duration predictor + synthesizer + phonemizer + voice)…');
    const tLoad = Date.now();
    const model = await download(spec as any);
    const tts = await createKokoroTextToSpeech(model as any);
    console.log(`[TTS] Kokoro pipeline ready in ${((Date.now() - tLoad) / 1000).toFixed(2)}s, voice=${voice}, speed=${speed}`);

    try {
      const phrases = splitIntoPhrases(script);
      if (phrases.length === 0) {
        throw new Error('TTS: narration script is empty');
      }
      console.log(
        `[TTS] script: ${script.length} chars → ${phrases.length} phrase(s): ${JSON.stringify(phrases.slice(0, 5))}${phrases.length > 5 ? ' …' : ''}`
      );

      const audioParts: Float32Array[] = [];
      const words: CaptionWord[] = [];
      let totalSamples = 0;
      const pauseMs = kokoroPauseMs();

      for (let i = 0; i < phrases.length; i++) {
        if (i > 0) {
          // Inter-phrase pause counts toward the timeline.
          totalSamples += Math.round((pauseMs / 1000) * KOKORO_SAMPLE_RATE);
        }
        const phraseStartSec = totalSamples / KOKORO_SAMPLE_RATE;

        onProgress?.({ stage: 'synthesizing', phrase: i + 1, totalPhrases: phrases.length });
        const tPhrase = Date.now();
        // Guard: the runtime spec only pre-parses the voices it knows. An
        // unknown voice (e.g. old sets saved with removed ids) falls back to
        // af_heart instead of failing the whole pipeline mid-run.
        const KNOWN_VOICES = ['af_heart', 'af_river', 'af_sarah', 'am_adam', 'am_michael', 'am_santa'];
        const voiceSafe = KNOWN_VOICES.includes(voice) ? voice : 'af_heart';
        if (voiceSafe !== voice) {
          console.warn(`[TTS] voice "${voice}" unknown to the Kokoro runtime — falling back to af_heart`);
        }
        for await (const chunk of (tts as any).synthesize(phrases[i], { voice: voiceSafe, speed })) {
          const raw = chunk.audio as Float32Array;
          // Trim Kokoro's silent lead-in/out so the word clock aligns with the
          // audible speech (captions would otherwise lag and drift).
          const [a, b] = audibleRegion(raw, KOKORO_SAMPLE_RATE);
          const audio = raw.subarray(a, b);
          audioParts.push(audio);
          const phraseDur = audio.length / chunk.sampleRate;
          words.push(...buildPhraseWords(phrases[i], phraseStartSec, phraseDur));
          totalSamples += audio.length;
          console.log(
            `[TTS] phrase ${i + 1}/${phrases.length}: "${phrases[i].slice(0, 48)}" → ${phraseDur.toFixed(2)}s audio in ${((Date.now() - tPhrase) / 1000).toFixed(2)}s (RTF ${(phraseDur / Math.max((Date.now() - tPhrase) / 1000, 0.001)).toFixed(2)}x)`
          );
        }
      }
      console.log(
        `[TTS] timing built: ${words.length} words; first 3: ${JSON.stringify(words.slice(0, 3))}`
      );

      // Concatenate PCM and write the WAV file.
      onProgress?.({ stage: 'writing' });
      const pcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const part of audioParts) {
        pcm.set(part, offset);
        offset += part.length;
      }

      ensureDataDirectories();
      const { File } = await import('@/services/storage/file-system');
      const outFile = new File(dirs.audio, uniqueName('narration', 'wav'));
      const wavBytes = encodeWavPcm16(pcm, KOKORO_SAMPLE_RATE);
      outFile.write(wavBytes);
      console.log(
        `[TTS] WAV written: ${outFile.uri.split('/').pop()} — ${(wavBytes.length / 1024 / 1024).toFixed(2)} MB, ${pcm.length} samples @ ${KOKORO_SAMPLE_RATE}Hz (${(pcm.length / KOKORO_SAMPLE_RATE).toFixed(2)}s)`
      );

      const durationSec = totalSamples / KOKORO_SAMPLE_RATE;
      const timing: CaptionTiming = {
        version: CAPTION_TIMING_VERSION,
        sampleRate: KOKORO_SAMPLE_RATE as 24000,
        duration: round3(durationSec),
        voice,
        words,
      };

      onProgress?.({ stage: 'done' });
      return { audioPath: outFile.uri, timing, durationSec };
    } finally {
      // Mandatory: free native memory BEFORE the tts slot is released.
      (tts as any).dispose?.();
      console.log(
        `[TTS] Kokoro disposed — total ${((Date.now() - tAll) / 1000).toFixed(2)}s, tts slot released for the next stage`
      );
    }
  });
}
