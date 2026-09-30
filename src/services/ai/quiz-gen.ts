/**
 * Phase 5 quiz generation — Qwen3.5 (llama.rn), same model + RAM contract as
 * reel plans. Produces multiple-choice questions grounded in the study
 * material.
 *
 * Two entry points:
 *  - generateQuizQuestionsWithCtx: runs on a CALLER-PROVIDED llama context.
 *    The pipeline uses this right after reel-plan generation — the model is
 *    already in RAM, so we just clearCache() and ask for the quiz. No reload.
 *  - generateQuizQuestions: standalone path (own 'llm' slot + own context).
 *    Used when regenerating a quiz later without the pipeline.
 *
 * Schema contract: strict JSON {questions:[{question, options, correctIndex,
 * topic, explanation}]}. Per-question salvage/reject, mirroring the reel
 * parser's forensics so a bad model output never kills the run.
 */
import { initLlama, type LlamaContext, type TokenData } from 'llama.rn';

import type { QuizQuestion } from '@/models/types';

import { runExclusive } from './model-manager';
import { ensureModelFile } from './model-registry';

const GGUF_CONTEXT_PARAMS = {
  n_ctx: 16384,
  n_batch: 512,
  n_threads: 4,
  n_gpu_layers: 0,
  use_mlock: true,
} as const;

const SYSTEM_PROMPT = [
  'You are a study-quiz writer for short educational videos.',
  'From the study material, write multiple-choice quiz questions.',
  'Rules for each question:',
  '- question: one clear sentence, no quotes, no markdown.',
  '- options: EXACTLY 4 answer options, each a short phrase (max 8 words).',
  '- correctIndex: 0, 1, 2, or 3 — index of the correct option.',
  '- topic: 1-3 word topic tag matching the material section.',
  '- explanation: one sentence why the answer is correct.',
  '- Cover DISTINCT facts from the material; never repeat a question.',
  'CONTENT RULES (critical):',
  '- Ask ONLY about factual, educational content: concepts, definitions, processes, numbers that mean something, cause and effect.',
  '- NEVER ask about document formatting or layout: fonts, typefaces, font sizes, bold/italic styling, page numbers, headings, margins, colors of text, images, or document structure.',
  '- The material may contain OCR/layout metadata (font names, sizes, page markers) — IGNORE it completely. Those are not study content.',
  'Use ONLY the material provided. Never invent facts.',
  'Output ONLY a JSON object: {"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"topic":"...","explanation":"..."}]}',
  'No markdown fences, no commentary.',
].join('\n');

/**
 * Deterministic junk filter: questions about fonts/layout/pages slip through
 * the prompt sometimes (OCR text is full of that metadata). Anything matching
 * these patterns is dropped no matter what the model says.
 */
const JUNK_QUESTION_RE =
  /\b(font|typeface|helvetica|arial|times new roman|calibri|bold|italic|font size|pt\b|point size|page \d+|on page|margin|layout|letterhead|header font)\b/i;

function isJunkQuestion(question: string): boolean {
  return JUNK_QUESTION_RE.test(question);
}

async function loadContext(): Promise<LlamaContext> {
  const modelPath = await ensureModelFile('qwen');
  return initLlama({ model: modelPath, ...GGUF_CONTEXT_PARAMS }, () => undefined);
}

interface RawQuestion {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  topic?: unknown;
  explanation?: unknown;
}

/** Validate one raw question; return null if it fails the schema. */
function coerceQuestion(raw: RawQuestion, idx: number): QuizQuestion | null {
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim())
    : [];
  const correctIndex = typeof raw.correctIndex === 'number' ? Math.trunc(raw.correctIndex) : -1;
  const topic = typeof raw.topic === 'string' ? raw.topic.trim().slice(0, 40) : '';
  const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';

  if (!question || options.length !== 4 || correctIndex < 0 || correctIndex >= options.length) {
    console.warn(
      `[quiz-gen] question[${idx}] REJECTED: question=${question ? 'ok' : 'missing'}, options=${options.length}/4, correctIndex=${correctIndex}`
    );
    return null;
  }
  if (isJunkQuestion(question)) {
    console.warn(`[quiz-gen] question[${idx}] REJECTED as formatting junk: "${question.slice(0, 80)}"`);
    return null;
  }
  return {
    id: `q_${idx}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    quizId: '', // filled by the caller when persisted
    index: idx,
    type: 'multiple_choice',
    question: question.slice(0, 300),
    options,
    correctIndex,
    topic: topic || null,
    explanation: explanation || null,
  };
}

/**
 * Best-effort diagnostics for a failed batch: log the raw model output (first
 * ~600 chars) so the log shows exactly why parsing failed. This is the piece
 * the old code lacked — "JSON unbalanced" with zero salvage hits was
 * undiagnosable without seeing what the model actually wrote.
 */
function logBatchFailure(raw: string): void {
  const braces = (raw.match(/\{/g) || []).length;
  const closing = (raw.match(/\}/g) || []).length;
  const quotedKeys = (raw.match(/"(?:question|options|correctIndex|topic|explanation)"/g) || []).length;
  console.warn(
    `[quiz-gen] FAILED BATCH RAW (${raw.length} chars, {:${braces} }:${closing}, schema-keys:${quotedKeys}) >>> ${JSON.stringify(raw.slice(0, 600))}`
  );
}

/** Extract the first balanced JSON object from raw model output. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('quiz-gen: no JSON object in response');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
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
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('quiz-gen: unbalanced JSON in response');
}

export interface QuizGenProgress {
  stage: 'loading' | 'generating' | 'parsing' | 'done';
  tokens?: number;
}

/**
 * Generate quiz questions on a context the caller owns (model already in RAM).
 * Clears the KV cache first so reel-plan context cannot leak into questions.
 * Does NOT release the context — the caller keeps ownership.
 *
 * `material` is what the questions are grounded in. The pipeline passes the
 * REEL SCRIPTS (already distilled, junk-free narration text) rather than raw
 * OCR output — scripts are short, clean, and exactly what the user studied.
 */
export async function generateQuizQuestionsWithCtx(
  ctx: LlamaContext,
  material: string,
  count: number,
  onProgress?: (p: QuizGenProgress) => void
): Promise<QuizQuestion[]> {
  if (!material.trim()) throw new Error('quiz-gen: no source text');
  if (count <= 0) return [];

  onProgress?.({ stage: 'loading' });
  // Contamination defense: wipe the KV cache from the plans conversation so
  // the quiz prompt starts clean. Model weights stay resident — no reload.
  try {
    await ctx.clearCache(true);
    console.log('[quiz-gen] KV cache cleared — reusing resident Qwen (no reload)');
  } catch (err) {
    console.warn('[quiz-gen] clearCache failed — continuing (independent prompt anyway)', err);
  }

  const clipped = material.slice(0, 12_000);

  // BATCHED generation — one completion per BATCH_QUESTIONS questions.
  // A 0.8B model writing 10 JSON questions in one go reliably truncates
  // mid-array → "unbalanced JSON". Small batches (like the per-reel fix in
  // llm-qwen.ts) keep each completion short enough to always terminate.
  const BATCH_QUESTIONS = 5;
  const batches: { start: number; count: number }[] = [];
  for (let b = 0; b < count; b += BATCH_QUESTIONS) {
    batches.push({ start: b, count: Math.min(BATCH_QUESTIONS, count - b) });
  }
  console.log(`[quiz-gen] generating ${count} questions in ${batches.length} batch(es) of ≤${BATCH_QUESTIONS}`);

  const questions: QuizQuestion[] = [];
  let totalTokens = 0;

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    // Split the material across batches too, so batch 2 doesn't just re-ask
    // about the first script. Each batch gets a fresh window into the scripts.
    const chunkSize = Math.ceil(clipped.length / batches.length);
    const batchMaterial = batches.length === 1
      ? clipped
      : clipped.slice(bIdx * chunkSize, (bIdx + 1) * chunkSize) || clipped.slice(-chunkSize);

    const userPrompt = [
      `Write exactly ${batch.count} multiple-choice quiz questions.`,
      'Base every question ONLY on the reel scripts below — they are what the student just watched.',
      batches.length > 1
        ? `This is part ${bIdx + 1} of ${batches.length} — ask about DIFFERENT facts than any previously generated questions.`
        : '',
      '',
      'REEL SCRIPTS:',
      batchMaterial,
    ].filter(Boolean).join('\n');

    const formatted = await ctx.getFormattedChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      null,
      { add_generation_prompt: true, jinja: true, enable_thinking: false }
    );
    const finalPrompt = 'prompt' in formatted ? formatted.prompt : (formatted as { text?: string }).text ?? '';

    onProgress?.({ stage: 'loading' });
    // Fresh context per batch — same clearCache-per-reel pattern as plans.
    try {
      await ctx.clearCache(true);
    } catch {
      // best-effort
    }

    onProgress?.({ stage: 'generating' });
    let tokenCount = 0;
    const result = await ctx.completion(
      {
        prompt: finalPrompt,
        // 5 questions ≈ 5×(~80 tokens) ≈ 400 — 1000 is a safe ceiling.
        n_predict: 1000,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['</s>', '<|im_end|>'],
      },
      (data: TokenData) => {
        tokenCount++;
        if (tokenCount % 16 === 0) onProgress?.({ stage: 'generating', tokens: totalTokens + tokenCount });
      }
    );
    totalTokens += tokenCount;

    onProgress?.({ stage: 'parsing' });
    const raw = String(result.content || result.text || '')
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '')
      .trim();
    if (!raw) {
      console.warn(`[quiz-gen] batch ${bIdx + 1}/${batches.length}: empty completion — skipping`);
      continue;
    }

    const batchQuestions = parseQuizQuestions(raw, batch.count, questions.length);
    questions.push(...batchQuestions);
    console.log(`[quiz-gen] batch ${bIdx + 1}/${batches.length}: +${batchQuestions.length} question(s) (total ${questions.length}/${count})`);
  }

  if (questions.length === 0) throw new Error('quiz-gen: no usable questions in any batch');
  if (questions.length < count) {
    console.warn(`[quiz-gen] only ${questions.length}/${count} usable questions`);
  }
  onProgress?.({ stage: 'done' });
  console.log(`[quiz-gen] ${questions.length} question(s) generated (${totalTokens} tokens)`);
  return questions.slice(0, count);
}

/**
 * Parse one batch's output into questions. Tolerant of truncation: tries the
 * full JSON object first; on failure regex-salvages every COMPLETE question
 * object (this is the path the old code never reached because extractJson
 * threw on unbalanced JSON before salvage could run).
 */
function parseQuizQuestions(raw: string, count: number, existingCount: number): QuizQuestion[] {
  const out: QuizQuestion[] = [];

  const pushValid = (list: RawQuestion[]): void => {
    for (const rq of list) {
      const q = coerceQuestion(rq, existingCount + out.length);
      if (q) {
        q.index = existingCount + out.length;
        out.push(q);
      }
    }
  };

  // Path 1: the batch returned a well-formed JSON object {"questions":[…]}.
  try {
    const parsed = extractJsonObject(raw) as { questions?: unknown };
    if (Array.isArray(parsed?.questions)) {
      pushValid(parsed.questions as RawQuestion[]);
      if (out.length > 0) return out;
    }
  } catch {
    // Unbalanced/truncated — fall through to salvage (do NOT rethrow).
    console.warn('[quiz-gen] JSON unbalanced in batch — salvaging complete questions only');
  }

  // Path 2: model emitted a bare array [{…},{…}] instead of the wrapper object.
  if (out.length === 0 && /^\s*\[/.test(raw)) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        pushValid(arr as RawQuestion[]);
        if (out.length > 0) return out;
      }
    } catch {
      // fall through to salvage
    }
  }

  // Path 3 (salvage): string-aware scan for individual question objects.
  // Handles fenced output, a leading `"questions": [` wrapper, and truncation
  // of the LAST object (brace-balanced, quotes counted, never cuts inside a
  // string). Replaces the old `\{[^{}]*?"question"…\}` regex which silently
  // matched nothing when the output wasn't already clean JSON.
  if (out.length === 0) {
    for (const objText of scanQuestionObjects(raw)) {
      try {
        pushValid([JSON.parse(objText) as RawQuestion]);
      } catch {
        // skip unparseable candidate
      }
    }
  }

  if (out.length === 0) logBatchFailure(raw);
  return out;
}

/**
 * Scan text for balanced JSON objects that contain a "question" key,
 * counting string contents and escapes so braces inside strings cannot
 * desync the depth counter (the old regex's blind spot).
 */
function scanQuestionObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let sawQuestionKey = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        // Just closed a string — was it the "question" key (followed by ':')?
        const nextColon = text.slice(i + 1, i + 3).trimStart();
        if (text.slice(Math.max(0, i - 9), i) === '"question' && nextColon.startsWith(':')) sawQuestionKey = true;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      escaped = false;
    } else if (ch === '{') {
      if (depth === 0) {
        start = i;
        sawQuestionKey = false;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        if (sawQuestionKey) found.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}

/**
 * Generate `count` quiz questions from the study material, standalone.
 * Enforces the RAM contract itself: acquires the llm slot, always releases.
 */
export async function generateQuizQuestions(
  sourceText: string,
  count: number,
  onProgress?: (p: QuizGenProgress) => void
): Promise<QuizQuestion[]> {
  if (!sourceText.trim()) throw new Error('quiz-gen: no source text');
  if (count <= 0) return [];

  return runExclusive('llm', async () => {
    onProgress?.({ stage: 'loading' });
    const ctx = await loadContext();
    try {
      return await generateQuizQuestionsWithCtx(ctx, sourceText, count, onProgress);
    } finally {
      await ctx.release();
      console.log('[quiz-gen] context released — llm slot free');
    }
  });
}
