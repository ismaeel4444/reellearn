/**
 * Phase 3 LLM stage: Qwen3.5-0.8B (Q8_0 GGUF) via llama.rn.
 *
 * Generates per-reel narration scripts from extracted source text, plus quiz
 * questions later in the phase. Rules encoded here:
 *
 *   • RAM contract — every load runs inside runExclusive('llm'); the context
 *     is released (ctx.release()) before the lock drops.
 *   • Bundled model — the GGUF ships in the app (model-registry.ts), copied
 *     to real storage on first use; no runtime downloads, ever.
 *   • Structured output — the script prompt demands strict JSON so the
 *     pipeline never parses free-form prose.
 */
import { initLlama, type LlamaContext, type TokenData } from 'llama.rn';

import { runExclusive } from './model-manager';
import { ensureModelFile } from './model-registry';

/** Shared JSON contract for the whole generation pipeline (LLM ⇄ pipeline). */
export interface ReelPlan {
  /** Short spoken reel title, max 6 words. */
  title: string;
  /** The topic this reel teaches, 1–3 words. */
  topic: string;
  /** Narration script the TTS stage will speak. Target ≤ 90 spoken words. */
  script: string;
}

export interface ReelPlanSet {
  reels: ReelPlan[];
}

const GGUF_CONTEXT_PARAMS = {
  n_ctx: 16384,
  n_batch: 512,
  n_threads: 4,
  // CPU inference; the model is Q8_0 — GPU offload is intentionally off.
  n_gpu_layers: 0,
  use_mlock: true,
} as const;

/** Load the bundled Qwen GGUF. Caller MUST hold the 'llm' slot. */
async function loadLlamaContext(onProgress?: (p: number) => void): Promise<LlamaContext> {
  const t0 = Date.now();
  const modelPath = await ensureModelFile('qwen');
  console.log(`[LLM] GGUF staged at ${modelPath} (${((Date.now() - t0) / 1000).toFixed(2)}s) — initLlama…`);
  const t1 = Date.now();
  let ctx: LlamaContext;
  try {
    ctx = await initLlama(
      {
        model: modelPath,
        ...GGUF_CONTEXT_PARAMS,
      },
      (p: number) => {
        if (Math.round(p * 100) % 25 === 0) console.log(`[LLM] loading ${Math.round(p * 100)}%`);
        onProgress?.(p);
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LLM] initLlama FAILED — raw error: ${msg}`);
    console.error(
      `[LLM] hints: (1) file truncated/corrupt → delete the staged copy at ${modelPath} and rerun; (2) out of memory → close other apps; (3) use_mlock unsupported on this device`
    );
    throw new Error(`Failed to load model — ${msg}`);
  }
  console.log(
    `[LLM] context ready in ${((Date.now() - t1) / 1000).toFixed(2)}s — gpu=${ctx.gpu ? 'yes' : 'no (cpu)'}, threads=${GGUF_CONTEXT_PARAMS.n_threads}, n_ctx=${GGUF_CONTEXT_PARAMS.n_ctx}`
  );
  return ctx;
}

// --- Prompt -------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a study-content writer for short educational videos.',
  'You write ONE narration script for ONE short reel at a time.',
  'Rules for the reel:',
  '- title: at most 6 words, no quotes.',
  '- topic: the single topic taught, 1 to 3 words.',
  '- script: spoken narration, plain sentences, no emoji, no stage directions, no markdown.',
  '- script length: HARD LIMIT. Never exceed the per-reel character limit given in the request. A reel that exceeds it will be cut off mid-sentence — stay under it.',
  '- Cover the assigned material; never repeat facts from already-written reels if any are shown.',
  'CONTENT RULES (critical):',
  '- Teach ONLY factual, educational content: concepts, definitions, processes, cause and effect.',
  '- NEVER mention document formatting or layout in scripts: fonts, typefaces, font sizes, bold/italic styling, page numbers, margins, or document structure.',
  '- The material may contain OCR/layout metadata (font names, sizes, page markers) — IGNORE it completely. It is not study content.',
  'Teach accurately using ONLY the material provided. Never invent facts.',
  'Output ONLY a JSON object: {"title":"...","topic":"...","script":"..."}',
  'No markdown fences, no commentary.',
].join('\n');

/**
 * Speech pace estimate for script budgeting: Kokoro reads ~150 wpm ≈ 2.5
 * words/s ≈ ~14 chars/s of narration. Generous margin included so scripts
 * that run slightly hot still fit the target reel duration.
 */
export const CHARS_PER_SPEECH_SECOND = 14;

/**
 * Split source material into `chunkCount` roughly-equal chunks (split on
 * paragraph/sentence boundaries so chunks don't cut mid-thought). The
 * one-reel-per-completion flow feeds chunk i to completion i — each reel is
 * grounded in a DIFFERENT part of the material, which structurally prevents
 * repetition instead of asking the model nicely.
 */
export function chunkSourceText(text: string, chunkCount: number): string[] {
  if (chunkCount <= 1) return [text];
  const perChunk = Math.ceil(text.length / chunkCount);
  const chunks: string[] = [];
  let cursor = 0;
  for (let i = 0; i < chunkCount - 1 && cursor < text.length; i++) {
    // Aim at the target boundary, then back up to a paragraph/sentence break.
    let end = Math.min(cursor + perChunk, text.length);
    if (end < text.length) {
      const window = text.slice(cursor, end);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '));
      if (breakAt > perChunk * 0.5) end = cursor + breakAt + 1;
    }
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }
  if (cursor < text.length) chunks.push(text.slice(cursor));
  return chunks;
}

/**
 * Prompt for a SINGLE reel on a single chunk of material.
 * `previousScripts` are the already-written reels — the model is told to
 * cover a NEW aspect and never repeat them.
 */
function buildSingleReelPrompt(
  chunk: string,
  reelIndex: number,
  reelCount: number,
  charCap: number,
  previousScripts: string[]
): string {
  const parts = [
    `Write reel ${reelIndex + 1} of ${reelCount} for a study-reel series.`,
    `The narration plays for about ${Math.round(charCap / CHARS_PER_SPEECH_SECOND)} seconds — the "script" MUST be at most ${charCap} characters (~${Math.round(charCap / 14 / 2.5)} spoken words). Count before you write.`,
    '',
    "This reel's material:",
    chunk.slice(0, Math.max(2000, Math.ceil(12_000 / reelCount))),
  ];
  if (previousScripts.length > 0) {
    parts.push(
      '',
      'ALREADY-WRITTEN REELS (do NOT repeat any of these facts or phrasings — cover a NEW aspect of the material):',
      ...previousScripts.map((s, i) => `Reel ${i + 1}: ${s.slice(0, 200)}`),
    );
  }
  parts.push(
    '',
    'Output ONLY a JSON object: {"title":"...","topic":"...","script":"..."}',
    'No markdown fences, no commentary.',
  );
  return parts.join('\n');
}

// --- JSON repair -----------------------------------------------------------------

/** Best-effort raw text from a completion result (for logging). */
function raw0(result: { content?: string; text?: string; accumulated_text?: string }): string {
  return result.content || result.text || result.accumulated_text || '';
}

/**
 * Log a JSON failure with full forensics: what the model actually said,
 * where parsing broke, and the exact schema mismatch. Never swallow silently —
 * the LLM misbehaving here is THE most common Phase 3 failure mode.
 */
function logJsonFailure(phase: string, raw: string, err: unknown): void {
  console.error(`════ [LLM] JSON FAILURE (${phase}) ════`);
  console.error(`[LLM] error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`[LLM] raw output length=${raw.length} — full dump:`);
  console.error(raw || '(empty string)');
  // Point at the likely break: first non-whitespace char, fence presence,
  // and brace balance so the fix is obvious from the log alone.
  const trimmed = raw.trim();
  console.error(
    `[LLM] diagnostics: firstChar=${JSON.stringify(trimmed[0] ?? '')}, hasCodeFence=${trimmed.startsWith('\u0060\u0060\u0060')}, openBraces=${(raw.match(/\{/g) ?? []).length}, closeBraces=${(raw.match(/\}/g) ?? []).length}, openBrackets=${(raw.match(/\[/g) ?? []).length}, closeBrackets=${(raw.match(/\]/g) ?? []).length}`
  );
  if (trimmed[0] !== '{') {
    console.error(`[LLM] hint: output does not start with '{' — model likely ignored the JSON-only instruction or emitted reasoning text first`);
  }
  if ((raw.match(/\{/g) ?? []).length !== (raw.match(/\}/g) ?? []).length) {
    console.error(`[LLM] hint: unbalanced braces — output was likely truncated (raise n_predict or lower reelCount)`);
  }
  console.error(`════ end JSON FAILURE (${phase}) ════`);
}

/**
 * The model occasionally wraps JSON in fences or trails commentary. Extract
 * the first balanced JSON object; throw a readable error when impossible.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) {
    const err = new Error('LLM: no JSON object found in response');
    logJsonFailure('extractJson', text, err);
    throw err;
  }
  // Skip the fence case: if a code fence wraps the JSON, jump past it.
  const searchFrom = text.indexOf('{', start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = searchFrom; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(searchFrom, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (parseErr) {
          const err = new Error(
            `LLM: JSON.parse failed at char ${searchFrom}..${i + 1}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          );
          logJsonFailure('extractJson.parse', text, err);
          throw err;
        }
      }
    }
  }
  const err = new Error('LLM: unbalanced JSON in response (missing closing brace)');
  logJsonFailure('extractJson.balance', text, err);
  // SALVAGE: output was truncated (n_predict hit / stop mid-object). Parse the
  // complete reels individually and return what survived — the pipeline tops
  // up the remainder. Each complete {"title":…,"script":…} object is valid JSON.
  const salvage: unknown[] = [];
  const objRe = /\{[^{}]*?"title"[\s\S]*?\}/g;
  for (const m of text.slice(start).matchAll(objRe)) {
    try {
      salvage.push(JSON.parse(m[0]));
    } catch {
      // incomplete object — skip
    }
  }
  if (salvage.length > 0) {
    console.warn(`[LLM] JSON truncated — SALVAGED ${salvage.length} complete reel(s) from partial output`);
    return { reels: salvage };
  }
  throw err;
}

/** Cut a script at the last complete sentence that fits maxChars. */
function clampToSentence(script: string, maxChars: number): string {
  if (script.length <= maxChars) return script;
  const cut = script.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const result = lastStop > 40 ? cut.slice(0, lastStop + 1) : cut;
  return `${result.trimEnd()}…`.replace(/\.…$/, '…').replace(/…\./, '…');
}

// --- Public API -------------------------------------------------------------------

export interface ScriptProgress {
  stage: 'loading' | 'prompting' | 'generating' | 'parsing' | 'done';
  tokens?: number;
}

export interface GenerateOptions {
  /** Qwen3.5 reasoning toggle: false = skip the <think> block entirely (faster, cleaner JSON). */
  thinking?: boolean;
  /** Called on every streamed token with the FULL text generated so far (reasoning included). */
  onToken?: (fullText: string) => void;
}

/**
 * Run `fn` with a freshly loaded Qwen context under the 'llm' slot.
 * Loads once, hands the context to the callback, always releases — even on
 * throw. The pipeline uses this to generate reel plans AND the quiz on a
 * SINGLE model load (quiz calls ctx.clearCache() first to reset context).
 */
export async function runWithLlamaContext<T>(fn: (ctx: LlamaContext) => Promise<T>): Promise<T> {
  return runExclusive('llm', async () => {
    const ctx = await loadLlamaContext();
    try {
      return await fn(ctx);
    } finally {
      // Mandatory: free model + KV cache BEFORE the llm slot releases.
      const tRel = Date.now();
      await ctx.release();
      console.log(`[LLM] context released in ${Date.now() - tRel}ms — llm slot can now be handed to TTS`);
    }
  });
}

/**
 * Generate reel plans on a CALLER-OWNED context (no load, no release).
 * Use via runWithLlamaContext(); see generateReelPlans for the standalone path.
 *
 * STRATEGY — one completion PER REEL instead of one big JSON list:
 *  1. The source material is split into `reelCount` chunks; completion i is
 *     grounded in chunk i, so every reel covers a DIFFERENT part of the
 *     material (structural anti-repeat, not just prompt pleading).
 *  2. After each reel, the KV cache is CLEARED and the next prompt includes
 *     the previous scripts (truncated) with a do-not-repeat instruction —
 *     the model sees what's already written without the context overflowing.
 *  3. A short script budget (one reel, small n_predict) is easy for a 0.8B
 *     model to satisfy, so schema rejections and truncation are rare.
 */
export async function generateReelPlansWithCtx(
  ctx: LlamaContext,
  sourceText: string,
  reelCount: number,
  onProgress?: (p: ScriptProgress) => void,
  opts?: GenerateOptions & { reelDurationSec?: number }
): Promise<ReelPlan[]> {
  const reelDurationSec = opts?.reelDurationSec ?? 30;
  const charCap = reelDurationSec * CHARS_PER_SPEECH_SECOND;
  if (!sourceText.trim()) throw new Error('LLM: no source text to analyze');

  const chunks = chunkSourceText(sourceText.trim(), reelCount);
  const plans: ReelPlan[] = [];

  for (let i = 0; i < reelCount; i++) {
    onProgress?.({ stage: 'prompting' });
    const prompt = buildSingleReelPrompt(
      chunks[i] ?? chunks[chunks.length - 1] ?? sourceText,
      i,
      reelCount,
      charCap,
      plans.map((p) => p.script)
    );

    // Fresh context per reel: wipe the KV cache so chunk i's prompt is not
    // polluted by chunk i-1's conversation (clearCache keeps weights resident).
    try {
      await ctx.clearCache(true);
    } catch {
      // Best-effort; prompts are independent anyway.
    }

    const formatted = await ctx.getFormattedChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      null,
      {
        add_generation_prompt: true,
        jinja: true,
        enable_thinking: opts?.thinking ?? false,
      }
    );
    const finalPrompt = 'prompt' in formatted ? formatted.prompt : (formatted as any).text;

    onProgress?.({ stage: 'generating' });
    const result = await ctx.completion(
      {
        prompt: finalPrompt,
        // ONE reel ≈ charCap chars ≈ charCap/3.5 tokens. 800 is a generous
        // ceiling (~2800 chars) — way past a well-behaved reel, far below 3000.
        n_predict: 800,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['</s>', '<|im_end|>'],
      },
      (data: TokenData) => {
        opts?.onToken?.(data.token ?? '');
      }
    );

    onProgress?.({ stage: 'parsing' });
    const raw = raw0(result).trim();
    if (!raw) {
      console.warn(`[LLM] reel ${i + 1}/${reelCount}: EMPTY completion — retrying once…`);
      // One immediate retry with the same prompt; a blank completion is
      // almost always a transient sampling fluke.
      const retry = await ctx.completion(
        { prompt: finalPrompt, n_predict: 800, temperature: 0.9, top_p: 0.95, stop: ['</s>', '<|im_end|>'] },
        () => undefined
      );
      const retryRaw = raw0(retry).trim();
      if (!retryRaw) {
        console.warn(`[LLM] reel ${i + 1}/${reelCount}: retry also empty — skipping this reel`);
        continue;
      }
      const retryPlan = parseSingleReel(retryRaw, i, charCap);
      if (retryPlan) {
        plans.push(retryPlan);
        console.log(`[LLM] reel ${i + 1}/${reelCount} OK on retry — "${retryPlan.title}" (${retryPlan.script.length} chars)`);
      }
      continue;
    }

    const plan = parseSingleReel(raw, i, charCap);
    if (plan) {
      plans.push(plan);
      console.log(
        `[LLM] reel ${i + 1}/${reelCount} OK — "${plan.title}" (${plan.script.length}/${charCap} chars)`
      );
    } else {
      console.warn(`[LLM] reel ${i + 1}/${reelCount}: unusable output — skipped (will top up later)`);
    }
  }

  if (plans.length === 0) {
    throw new Error('LLM: no usable reels produced (all single-reel completions failed)');
  }
  onProgress?.({ stage: 'done' });
  console.log(`[LLM] batched generation: ${plans.length}/${reelCount} reels usable`);
  return plans;
}

/** Parse one completion's output into a single ReelPlan (schema + junk-safe). */
function parseSingleReel(raw: string, idx: number, charCap: number): ReelPlan | null {
  // Defensive: strip any reasoning block before JSON parsing.
  const jsonText = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
  try {
    const parsed = extractJson(jsonText) as Record<string, unknown>;
    const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
    const topic = typeof parsed?.topic === 'string' ? parsed.topic.trim() : '';
    const script = typeof parsed?.script === 'string' ? parsed.script.trim() : '';
    if (!title || !script) {
      console.warn(`[LLM] reel[${idx}] REJECTED by schema: title=${title ? 'ok' : 'missing'}, script=${script ? `${script.length} chars` : 'missing'}`);
      return null;
    }
    const trimmedScript = script.length > charCap ? clampToSentence(script, charCap) : script;
    if (script.length > charCap) {
      console.warn(`[LLM] reel[${idx}] script ${script.length} chars exceeds ${charCap} budget — trimmed at sentence boundary`);
    }
    return {
      title: title.slice(0, 80),
      topic: topic.slice(0, 40),
      script: trimmedScript,
    };
  } catch (err) {
    // Salvage: even if the JSON is broken, a complete title/script pair can
    // often be regexed out of partial output.
    console.warn(`[LLM] reel[${idx}] JSON parse failed — attempting salvage`, err instanceof Error ? err.message : err);
    const m = jsonText.match(/"title"\s*:\s*"([^"]+)"[\s\S]*?"script"\s*:\s*"([\s\S]*?)"\s*\}/);
    if (m) {
      const title = m[1].trim();
      const script = m[2].replace(/\\n/g, ' ').replace(/\"/g, '"').trim();
      if (title && script) {
        return {
          title: title.slice(0, 80),
          topic: '',
          script: script.length > charCap ? clampToSentence(script, charCap) : script,
        };
      }
    }
    return null;
  }
}

/**
 * Generate reel plans from extracted source text.
 * Enforces the RAM contract itself: acquires the llm slot, always releases.
 */
export async function generateReelPlans(
  sourceText: string,
  reelCount: number,
  onProgress?: (p: ScriptProgress) => void,
  opts?: GenerateOptions & { reelDurationSec?: number }
): Promise<ReelPlan[]> {
  return runWithLlamaContext((ctx) => {
    onProgress?.({ stage: 'loading' });
    return generateReelPlansWithCtx(ctx, sourceText, reelCount, onProgress, opts);
  });
}
