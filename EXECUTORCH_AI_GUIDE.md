# On-Device AI Guide (Phase 3): PaddleOCR · Kokoro TTS · Qwen LLM

How ReelLearn runs AI fully on-device. Two runtimes, one strict rule:

> **RAM CONTRACT — at most ONE AI model resident at any moment.**
> Enforced by `src/services/ai/model-manager.ts` (`runExclusive`); the
> generation screen shows a live "which model is in RAM" badge. Slower than
> co-loading, but immune to OOM kills on low-end devices.

---

## 1. Runtime map

| Stage | Model | Runtime | Files |
|---|---|---|---|
| OCR (Phase 2) | PaddleOCR PP-OCRv6 (FP32 DBNet + SVTR) | `react-native-executorch` `createPaddleOcr` | downloaded via `download()` |
| TTS (Phase 3) | Kokoro-82M v1.0 (en-us, XNNPACK FP32) | `react-native-executorch` `createKokoroTextToSpeech` | `duration_predictor_std_…pte` + `synthesizer_std_…pte` + phonemizer + `voices/<voice>.bin` |
| LLM (Phase 3) | Qwen3.5-0.8B **Q8_0 GGUF** | **`llama.rn`** (llama.cpp binding) | bundled: `models/llm/Qwen3.5-0.8B-Q8_0.gguf` → staged to `<documents>/data/models/qwen/` by `model-registry.ts` |

Why llama.rn for the LLM: the user-required model is a Q8 GGUF (true 8-bit
weights). ExecuTorch cannot load GGUF (it needs `.pte` exports, and SWM's
Qwen3.5 `.pte` is 4-bit `8da4w` at 1.41 GB). llama.rn loads the existing GGUF
directly, bundled in the app — no runtime downloads, no second model format.

---

## 2. LLM stage (llama.rn + Qwen3.5-0.8B Q8_0)

`src/services/ai/llm-qwen.ts`

- `initLlama({ model, n_ctx: 4096, n_gpu_layers: 0, use_mlock: true })` — CPU
  inference; the entire load + generate + `ctx.release()` runs inside
  `runExclusive('llm')`.
- Chat template: `ctx.getFormattedChat(messages, null, { add_generation_prompt: true })`
  reads the GGUF's embedded template (Qwen ChatML) — no manual prompt formatting.
- Prompt demands **strict JSON**: `{"reels":[{"title","topic","script"}]}`.
  `extractJson()` finds the first balanced `{…}` (fence/comment tolerant);
  `coerceReelPlans()` validates + clamps fields. Never parse free-form prose.
- `stop` sequences `</s>` / `<|im_end|>`; token streaming via the callback.

## 3. TTS stage (Kokoro) + word timestamps

`src/services/ai/tts-kokoro.ts`

The RN ExecuTorch Kokoro API yields **chunk-level data only**
(`KokoroTtsChunk.duration`); there are no word timestamps in the JS API. Word
times are constructed at generation time from Kokoro's own clock:

1. `splitIntoPhrases(script, maxWords=6)` — split narration on `.!?;,:`
   (punctuation stays attached), then group long clauses into ≤6-word chunks.
2. Synthesize phrase-by-phrase; each chunk's PCM length is the **exact**
   duration of that phrase. A fixed inter-phrase pause (`KOKORO_PAUSE_MS`,
   default 120 ms) is counted into the timeline between phrases.
3. Words inside a phrase get slices proportional to `chars+1`. Drift inside a
   1–3 s phrase stays < ~150 ms — imperceptible for karaoke captions.
4. Output: 24 kHz mono **WAV (PCM16)** via `encodeWavPcm16()` → `dirs.audio`,
   plus the caption timing JSON (below).

Resource contract: `synthesizeNarration()` runs inside `runExclusive('tts')`
and calls `tts.dispose()` in `finally` — native memory is freed **before** the
slot releases.

Model spec used: `models.textToSpeech.KOKORO.EN_US.XNNPACK_FP32`
(avoids the ~13 s one-time Core ML compile on iOS).

## 4. Caption style contract (source of truth: `src/services/ai/caption-timing.ts`)

- **ONE word at a time** — never lines, never phrases.
- Active word renders in **`palette.captionHighlight` (#FFD84D, yellow)**.
- Schema (v1): `{ version: 1, sampleRate: 24000, duration, voice,
  words: [{ text, start, end }] }` — seconds, float, relative to narration
  start. Stored per reel at `dirs.captions/<reelId>.json`; the DB column
  `reels.caption_timing_path` points at it.
- `parseCaptionTiming()` validates strictly (monotonic, non-empty, positive
  spans) — the player must never render from an invalid file.
- `wordIndexAt(timing, t, hint)` — forward-only lookup; between words (gaps)
  the player keeps the last word visible, no flicker.

## 5. Pipeline orchestration

`src/services/ai/pipeline.ts` — `runGenerationPipeline(studySetId)`:

1. **sources** — gather extracted text from storage (pasted text is persisted
   to `dirs.sources/*.txt` at save time, not just counted in the DB).
2. **llm** — `generateReelPlans()` → `ReelPlan[]` → reel rows persisted
   (`state='script_ready'`) before any TTS, so a crash resumes correctly.
3. **tts** — per reel: `synthesizeNarration()` → WAV + timing JSON →
   `state='audio_ready'` with `audioPath` / `captionTimingPath` /
   `durationSec`. Resume skips reels whose files already exist.
4. Rendering (video) is **Phase 4** — the pipeline reports honestly that it
   stops at narration.

Progress reporting carries `modelInRam: 'llm' | 'tts' | null` so the UI can
*prove* the one-model contract rather than claim it.

## 6. Dev test beds (`src/features/dev/`, DEV-only, deletable)

Wired in `src/app/(tabs)/create.tsx` under the "DEV-ONLY" comment:

- **`extraction-test.tsx`** — Phase 2 OCR pipeline (existing).
- **`llm-test.tsx`** — loads the bundled GGUF via llama.rn, generates 2 reel
  plans from a sample text, shows token streaming + the RAM slot readout;
  verifies release (a second run must succeed).
- **`tts-test.tsx`** — synthesizes a sample sentence, prints the first
  word timings, writes WAV + timing JSON, share-sheet playback. Playback
  rendering proper arrives with the Phase 4 player.

## 7. Known gotchas

- **GGUF quant**: Q8_0 ≈ 8-bit weights, ~0.85 GB on disk; expect ~1 GB+ RSS
  while loaded plus KV cache — hence the strict one-model rule.
- **ExecuTorch Kokoro chunking**: the lib partitions text itself when called
  with long text; we pre-split to keep phrase text ↔ audio alignment exact.
- **`dispose()` discipline**: every ExecuTorch runner and llama.rn context
  must be released in `finally`. The ModelManager lock makes leaks visible:
  a stuck slot blocks the next stage with `ModelSlotBusyError` (fail loud).
- **Windows/Gradle**: llama.rn ships prebuilt `.so`/`.xcframework` via its
  vendored runtime — the first `expo run:*` after install is slow but needs
  no NDK-cmake setup beyond the default Expo template.

## 8. Phase 4 — playback (4A) + MP4 export (4B)

**Split:** 4A = the reel plays live (no render); 4B = on-demand burn to MP4.
Same content, two delivery paths.

### 4A — Composited playback (shipped)

- **`src/services/media/reel-feed.ts`** — feed resolution: ready sets → reels,
  each entry = narration WAV + caption timing + background video + `playable`
  flag (audio & timing exist on disk; honest states, no fakes). Also owns
  watch bookkeeping (`markReelWatched` → `reels.watched` + denormalized set
  counters).
- **`src/features/reels/reel-player.tsx`** — the player. Background video
  muted + looping (`expo-video`, `contentFit="cover"`); narration WAV is the
  MASTER clock (`expo-audio`, 100 ms updates); captions driven by
  `wordIndexAt(timing, audioClock)` — ONE word, `palette.captionHighlight`.
  Tap toggles play/pause; `didJustFinish` → persist watched → replay chip.
- **`src/app/(tabs)/reels.tsx`** — vertical snap pager (TikTok-style) over all
  reels of ready sets; only the centered entry plays.
- **`src/app/watch/[id].tsx`** — same pager scoped to one study set (entry:
  study-set detail rows / "Watch reels" button, and the generation screen's
  "Watch reels now" action).

### 4B — MP4 export (shipped, verify on device)

- **Library: `react-native-video-pipeline`** (v0.5.1, npm) — Media3
  Transformer (Android) / AVFoundation (iOS). Hardware encode, **no FFmpeg**
  (ffmpeg-kit retired April 2025; its successor publishes no prebuilt
  binaries). Peers: `react-native-nitro-modules`, `react-native-worklets-core`;
  needs `babel-plugin-video-pipeline` + `react-native-worklets/plugin` in
  `babel.config.js`.
- **`src/services/media/reel-export.ts`** — `exportReelMp4()`: one
  `Video.render` call = background segment (`startSec` offset per reel index,
  wrapped modulo source length via `Video.info`) +
  `audio: { mode: 'replace', replaceUri: narration.wav }` + caption overlays:
  **one `Overlay.Text` per word**, `timeRange: { startSec: w.start, endSec:
  w.end }`, color `#FFD84D` — same timing JSON as the in-app player. Output:
  1080x1920@30 h264 8 Mbps → `dirs.reels`.
- **`src/features/dev/export-test.tsx`** (DEV-only) — probes + exports a ~5s
  test reel with silent WAV + synthetic timing, shares the MP4. Proves the
  three known risks: landscape→9:16 crop, WAV replace-audio, on-device RTF.

Resource note: export touches **no AI model** — safe any time, even mid-
LLM/TTS run (no ModelManager interaction).

### Post-device-test fixes (from first on-device run)

1. **Export NoClassDefFoundError** (`androidx.media3.effect.OverlaySettings$Builder`):
   the video-pipeline declares `media3-effect` with `implementation` scope, and
   the class didn't reach the app APK. Fix: pin
   `androidx.media3:media3-effect:1.5.1` (and `media3-transformer`) explicitly
   in `android/app/build.gradle` dependencies, matching the library's
   `media3Version`. Requires an `expo run:android` rebuild.
2. **Caption position**: `captionWrap.bottom` 190 → 280 (was clipped near the
   screen bottom on tall devices).
3. **Pager skip on hard flick**: FlatList props now `pagingEnabled` +
   `disableIntervalMomentum` (no `snapToInterval` duplication); active index
   settles from the offset via `settledIndex()` on both `onScrollEndDrag` and
   `onMomentumScrollEnd`. Also the tab bar is hidden on the reels tab, so the
   scroll viewport = full window = page height (mis-sized pages were the root
   cause of overshoot).
4. **Tab bar hides while watching**: `hooks/tab-bar-visibility.ts` (observable
   store) + `hooks/use-tab-bar-visibility.ts` (`useTabBarHidden()`); the
   `(tabs)` layout swaps its custom bar for `null` when hidden. Applied to the
   Reels tab and `/watch/[id]`.
5. **Reels tab = study-sets watch hub** (user request): the tab lists every
   study set with progress + a Watch button (opens `/watch/[id]`); a "Watch
   all" chip opens `/reels-feed`, the swipe-everything feed (moved off the
   tab so its viewport is the full window). Home and Library are unchanged.
   New routes require `expo start` once to regenerate typed routes.

## 9. Links

- react-native-executorch: https://github.com/software-mansion/react-native-executorch
- llama.rn: https://github.com/mybigday/llama.rn
- Kokoro-82M: https://huggingface.co/hexgrad/Kokoro-82M
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
