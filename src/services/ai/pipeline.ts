/**
 * Phase 3 generation pipeline: sources → reel plans → narration audio +
 * caption timing. Persistence + resume supported via reels.state
 * (ReelGenerationState, spec §19).
 *
 * Stage order (each stage fully releases its model before the next begins —
 * the strict one-model-in-RAM contract, see model-manager.ts):
 *
 *   1. Gather source text (extracted in Phase 2, persisted per source).
 *   2. LLM  (llama.rn + Qwen GGUF)   → ReelPlan[]   — model released after.
 *   3. Per reel: TTS (Kokoro)        → WAV + word timing JSON — released after.
 *
 * Rendering (video) is Phase 4+; the pipeline stops at audio_ready and says
 * so honestly. Every stage boundary persists state so a crash can resume.
 */
import { File } from 'expo-file-system';

import type { QuizQuestion as QuizQuestionType, Reel } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import {
  insertReels,
  getStudySet,
  listReelsForSet,
  listSourcesForSet,
  setReelState,
  updateStudySetStatus,
} from '@/services/storage/repositories';
import { dirs, ensureDataDirectories } from '@/services/storage/file-system';
import {
  extractSourceText,
  readExtractedText,
  writeExtractedText,
} from './ingestion';

import { runWithLlamaContext, generateReelPlansWithCtx } from './llm-qwen';
import { generateQuizQuestionsWithCtx } from './quiz-gen';
import type { ScriptProgress } from './llm-qwen';
import { synthesizeNarration } from './tts-kokoro';
import { CAPTION_TIMING_VERSION, parseCaptionTiming } from './caption-timing';
import { activeSlot } from './model-manager';
import {
  insertQuiz,
  insertQuizQuestions,
  listQuizzesForSet,
} from '@/services/storage/repositories';

export interface PipelineProgress {
  stage: 'sources' | 'llm' | 'tts' | 'done' | 'error';
  /** Human-readable line for the UI — honest, never fake. */
  message: string;
  /** 0..100, approximate by stage weights (LLM 40%, TTS 60%). */
  percent: number;
  /** Active model slot — lets the UI prove the one-model contract. */
  modelInRam: 'llm' | 'tts' | 'ocr' | null;
}

export interface PipelineRunOptions {
  onProgress?: (p: PipelineProgress) => void;
  /** Resume an interrupted run instead of starting fresh. */
  resume?: boolean;
}

/**
 * Concurrency guard: only ONE pipeline may run at a time (the model slots
 * enforce RAM exclusivity, but a queued duplicate run would still burn
 * battery re-walking every stage after the first finishes). A duplicate call
 * for the SAME set resolves immediately — the in-flight run is doing that
 * work — and for a DIFFERENT set fails fast with a clear error.
 */
let activePipelineRun: string | null = null;

/** Rough stage weights for percent reporting (LLM 40%, TTS 60%). */
const TTS_WEIGHT = 60;

export async function runGenerationPipeline(
  studySetId: string,
  options: PipelineRunOptions = {}
): Promise<void> {
  const { onProgress } = options;
  const report = (p: PipelineProgress) => onProgress?.(p);

  if (activePipelineRun === studySetId) {
    console.log(`[P3] pipeline for set ${studySetId} already running — ignoring duplicate start`);
    return;
  }
  if (activePipelineRun) {
    throw new Error(`Another generation is already running (set ${activePipelineRun}). Wait for it to finish.`);
  }
  activePipelineRun = studySetId;

  const db = await getDatabase();
  ensureDataDirectories();
  const runId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  const stageT0: Record<string, number> = {};

  const log = (msg: string, ...rest: unknown[]) =>
    console.log(`[P3:${runId}] +${((Date.now() - t0) / 1000).toFixed(2)}s ${msg}`, ...rest);
  const logStage = (name: string, msg: string) => {
    stageT0[name] = Date.now();
    log(`▶ ${name} — ${msg}`);
  };
  const logStageEnd = (name: string, extra?: string) => {
    const dt = stageT0[name] ? ((Date.now() - stageT0[name]) / 1000).toFixed(2) : '?';
    log(`✔ ${name} done in ${dt}s${extra ? ` — ${extra}` : ''}`);
  };

  log(`════ REEL PIPELINE START set=${studySetId} run=${runId} ════`);

  try {
    logStage('setup', 'loading study set + marking generating');
    const studySet = await getStudySet(db, studySetId);
    if (!studySet) throw new Error(`Study set not found: ${studySetId}`);
    log(
      `study set "${studySet.title}": ${studySet.config.reelCount} reels × ${studySet.config.reelDurationSec}s, voice=${studySet.config.voiceId}, style=${studySet.config.visualStyle}`
    );
    await updateStudySetStatus(db, studySetId, 'generating');

    // ---- Stage 1: gather source text (no models needed) ----------------
    // Cached extracted text is the source of truth. For PDF/image sources the
    // ORIGINAL file is binary — reading it raw was feeding the LLM embedded
    // font/page junk and produced garbage scripts + layout questions.
    // OCR text is cached per source under dirs.extracted, written at create
    // time; if missing (older sets) we extract here once and cache it.
    logStage('sources', 'reading cached extracted text (OCR runs only if never extracted)');
    report({ stage: 'sources', message: 'Reading study material…', percent: 0, modelInRam: null });
    const sources = await listSourcesForSet(db, studySetId);
    log(`sources: ${sources.length} file(s) [${sources.map((s) => `${s.kind}:${s.name}`).join(', ') || 'none'}]`);
    const textParts: string[] = [];
    for (const src of sources) {
      // NOTE: pasted_text rows DO have a localPath — the Create flow persists
      // the pasted content to a .txt file. Skipping them here silently emptied
      // pasted-only sets ("No study material" after 0.07s).
      if (!src.localPath) continue;
      try {
        // 1) Cached extraction (pasted/txt/docx content, or cached OCR text).
        const cached = await readExtractedText(src.id);
        if (cached) {
          log(`  source "${src.name}" CACHED extraction: ${cached.length} chars`);
          textParts.push(cached);
          continue;
        }

        // 2) Plain-text kinds: the stored file IS the text.
        if (src.kind === 'txt' || src.kind === 'pasted_text') {
          const file = new File(src.localPath);
          if (file.exists) {
            const txt = (await file.text()).trim();
            log(`  source "${src.name}" read: ${txt.length} chars`);
            textParts.push(txt);
          } else {
            log(`  source "${src.name}" MISSING on disk (${src.localPath})`);
          }
          continue;
        }

        // 3) OCR-needed kinds with no cache: extract now (OCR slot), cache it.
        if (src.kind === 'pdf' || src.kind === 'image' || src.kind === 'pptx' || src.kind === 'docx') {
          log(`  source "${src.name}" (${src.kind}) no cached extraction — extracting now (one-time)`);
          report({
            stage: 'sources',
            message: `Extracting text from ${src.name}…`,
            percent: 0,
            modelInRam: 'ocr',
          });
          const extraction = await extractSourceText(src.localPath, src.kind);
          const txt = (extraction.text ?? '').trim();
          if (txt) {
            await writeExtractedText(src.id, txt);
            log(`  source "${src.name}" extracted ${txt.length} chars — cached for future runs`);
            textParts.push(txt);
          } else {
            log(`  source "${src.name}" extraction produced no text`);
          }
          continue;
        }

        log(`  source "${src.name}" kind=${src.kind} — no extraction path, skipped`);
      } catch (err) {
        console.warn(`[pipeline] failed reading source ${src.name}`, err);
        log(`  source "${src.name}" read FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const sourceText = textParts.join('\n\n').trim();
    if (!sourceText) {
      throw new Error('No study material with extractable text for this set.');
    }
    log(
      `source text assembled: ${sourceText.length} chars, ~${sourceText.split(/\s+/).length} words (LLM prompt will clip to 12000)`
    );
    logStageEnd('sources', `${sourceText.length} chars`);

    // ---- Stage 2: LLM — plans AND quiz on ONE model load ----------------
    // Qwen is loaded once: reel plans first, then (with the KV cache cleared)
    // the quiz, grounded in the freshly written reel scripts. The old order —
    // plans → TTS → reload Qwen for the quiz — wasted a full model reload per
    // set and made the user wait through TTS before their exam existed.
    const desired = studySet.config.reelCount;
    logStage('llm', `loading Qwen3.5-0.8B Q8 GGUF once — ${desired} reel plans + quiz (one-model contract)`);
    report({ stage: 'llm', message: 'Qwen is analyzing your material…', percent: 2, modelInRam: 'llm' });
    let llmTokens = 0;

    const existingQuizzes = await listQuizzesForSet(db, studySetId);
    const desiredQuestions = studySet.config.quizQuestionCount ?? 10;
    const needQuiz = existingQuizzes.length === 0;

    // Inside this session the context is alive across both calls. Plans run
    // first; then clearCache() wipes the conversation so the quiz prompt
    // starts clean — and we feed it the REEL SCRIPTS, not raw OCR text.
    const { plans: plansFromLlm, quiz: quizFromLlm } = await runWithLlamaContext(async (ctx) => {
      const planProgress = (p: ScriptProgress) => {
        if (p.stage === 'generating' && p.tokens && p.tokens - llmTokens >= 64) {
          llmTokens = p.tokens;
          log(`  llm: ${p.tokens} tokens generated…`);
        }
        const inner = p.tokens ? ` (${p.tokens} tokens)` : '';
        report({
          stage: 'llm',
          message: `${p.stage === 'loading' ? 'Loading Qwen…' : p.stage === 'generating' ? `Writing scripts${inner}…` : 'Structuring reels…'}`,
          percent: Math.min(38, 2 + (p.tokens ?? 0) / 60),
          modelInRam: 'llm',
        });
      };
      const myPlans = await generateReelPlansWithCtx(
        ctx,
        sourceText,
        desired,
        planProgress,
        { reelDurationSec: studySet.config.reelDurationSec }
      );

      if (!needQuiz) return { plans: myPlans, quiz: null as QuizQuestionType[] | null };

      log('quiz: same resident Qwen — clearCache() then generating from reel scripts');
      report({
        stage: 'llm',
        message: 'Writing your end-of-set quiz…',
        percent: 30,
        modelInRam: 'llm',
      });
      try {
        const scriptMaterial = myPlans.map((p, i) => `Reel ${i + 1} — ${p.title}: ${p.script}`).join('\n\n');
        const quiz = await generateQuizQuestionsWithCtx(ctx, scriptMaterial, desiredQuestions, (p) => {
          if (p.stage === 'generating' && p.tokens && p.tokens - llmTokens >= 64) {
            llmTokens = p.tokens;
            log(`  quiz: ${p.tokens} tokens generated…`);
          }
        });
        return { plans: myPlans, quiz };
      } catch (quizErr) {
        // Quiz failure must NOT fail the whole pipeline — reels are still
        // generatable and the quiz can be regenerated later.
        console.error('[pipeline] quiz generation failed (non-fatal):', quizErr);
        log(`quiz FAILED (non-fatal): ${quizErr instanceof Error ? quizErr.message : String(quizErr)}`);
        return { plans: myPlans, quiz: null };
      }
    });
    let plans = plansFromLlm ?? [];
    log(`llm returned ${plans.length} plan(s):`);
    for (const [i, plan] of plans.entries()) {
      log(
        `  reel[${i}] title="${plan.title}" topic="${plan.topic}" script=${plan.script.length} chars/~${plan.script.split(/\s+/).length} words`
      );
    }
    // Top up or trim to the requested reel count.
    if (plans.length < desired) log(`llm produced fewer plans than requested — topping up ${desired - plans.length}`);
    while (plans.length < desired) {
      plans = [...plans, plans[plans.length % Math.max(1, plans.length)]];
    }
    plans = plans.slice(0, desired);
    logStageEnd('llm', `${plans.length} plans${quizFromLlm ? ` + ${quizFromLlm.length} quiz questions` : ' (quiz skipped/failed)'}`);

    // Persist the quiz now (generated in the same LLM session above).
    if (quizFromLlm) {
      const quizId = `quiz_${studySetId}_${Date.now().toString(36)}`;
      const withIds: QuizQuestionType[] = quizFromLlm.map((q, i) => ({
        ...q,
        id: `${quizId}_q${i}`,
        quizId,
        index: i,
      }));
      await insertQuiz(db, {
        id: quizId,
        studySetId,
        questionCount: withIds.length,
        createdAt: Date.now(),
      });
      await insertQuizQuestions(db, withIds);
      log(`quiz persisted: ${withIds.length} question(s) → ${quizId}`);
    }

    // Persist reel rows BEFORE TTS so a crash resumes at the right reel.
    const existing = await listReelsForSet(db, studySetId);
    const reelsByIndex = new Map(existing.map((r) => [r.index, r]));
    const reels: Reel[] = existing;
    for (let i = 0; i < plans.length; i++) {
      const current = reelsByIndex.get(i);
      if (!current) {
        const reel: Reel = {
          id: `${studySetId}-${i}-${Date.now().toString(36)}`,
          studySetId,
          index: i,
          title: plans[i].title,
          topic: plans[i].topic,
          state: 'script_ready',
          videoPath: null,
          audioPath: null,
          captionTimingPath: null,
          durationSec: null,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          watched: 0,
        };
        reels.push(reel);
      } else if (reelsByIndex.get(i)!.audioPath && reelsByIndex.get(i)!.captionTimingPath) {
        // Resume: this reel is already fully narrated — keep its stored script
        // instead of the fresh plan so reruns never rewrite finished reels.
        log(`  reel[${i}] script already narrated — keeping stored script (no regen)`);
        continue;
      }
    }
    const toInsert = reels.filter((r) => !reelsByIndex.has(r.index));
    log(
      `reel rows: ${reels.length} total, ${toInsert.length} new (${existing.length} resumed) — inserting before TTS so a crash resumes at the right reel`
    );
    for (const r of toInsert) log(`  insert reel[${r.index}] id=${r.id} title="${r.title}"`);
    if (toInsert.length > 0) await insertReels(db, toInsert);

    // ---- Stage 3: TTS per reel (Kokoro) --------------------------------
    logStage('tts', `synthesizing ${reels.length} reel(s) with Kokoro (LLM already released)`);
    for (const reel of reels) {
      const plan = plans[reel.index] ?? plans[0];
      // Resume: skip reels that already have audio + caption timing on disk.
      if (reel.audioPath && reel.captionTimingPath) {
        const audioOk = new File(reel.audioPath).exists;
        const timingOk = new File(reel.captionTimingPath).exists;
        if (audioOk && timingOk) {
          log(`  reel[${reel.index}] SKIP — audio + timing already on disk (resume)`);
          continue;
        }
        log(
          `  reel[${reel.index}] incomplete files (audio=${audioOk}, timing=${timingOk}) — resynthesizing`
        );
      }

      const reelT0 = Date.now();
      await setReelState(db, reel.id, 'audio_generating', { error: null });
      report({
        stage: 'tts',
        message: `Recording narration ${reel.index + 1}/${reels.length}…`,
        percent: 40 + Math.round((reel.index / reels.length) * TTS_WEIGHT),
        modelInRam: 'tts',
      });

      const { audioPath, timing, durationSec } = await synthesizeNarration(
        plan.script,
        studySet.config.voiceId
      );

      const timingFile = new File(dirs.captions, `${reel.id}.json`);
      timingFile.write(JSON.stringify(timing));

      await setReelState(db, reel.id, 'audio_ready', {
        audioPath,
        captionTimingPath: timingFile.uri,
        durationSec: Math.round(durationSec),
      });
      log(
        `  reel[${reel.index}] "${plan.title}" DONE in ${((Date.now() - reelT0) / 1000).toFixed(2)}s — ` +
          `${timing.words.length} words / ${durationSec.toFixed(2)}s audio → ${audioPath.split('/').pop()}, timing → ${timingFile.uri.split('/').pop()}`
      );
    }
    logStageEnd('tts', `${reels.length} reel(s)`);

    // ---- Done (rendering is Phase 4+) -----------------------------------
    await updateStudySetStatus(db, studySetId, 'ready');
    log(`════ REEL PIPELINE COMPLETE in ${((Date.now() - t0) / 1000).toFixed(2)}s — set status=ready ════`);
    report({
      stage: 'done',
      message: 'Reels and quiz ready.',
      percent: 100,
      modelInRam: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pipeline] failed', err);
    console.error(
      `[P3:${runId}] ════ PIPELINE FAILED after ${((Date.now() - t0) / 1000).toFixed(2)}s in stage '${activeSlot() ? 'in-flight' : 'unknown'}': ${message} ════`
    );
    await updateStudySetStatus(db, studySetId, 'failed').catch(() => undefined);
    report({ stage: 'error', message, percent: 0, modelInRam: activeSlot() });
    throw err;
  } finally {
    activePipelineRun = null;
  }
}

/** Load + validate a reel's caption timing file for the player (Phase 4). */
export async function loadCaptionTiming(path: string | null) {
  if (!path) return null;
  try {
    const file = new File(path);
    if (!file.exists) return null;
    return parseCaptionTiming(JSON.parse(await file.text()));
  } catch (err) {
    console.warn('[pipeline] caption timing unreadable', err);
    return null;
  }
}

// Re-export for convenience; keeps the style contract in one place.
export { CAPTION_TIMING_VERSION, parseCaptionTiming };
export type { Reel };
