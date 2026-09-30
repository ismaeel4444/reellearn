import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackgroundVideo,
  type Quiz,
  type QuizQuestion,
  type QuizResult,
  type Reel,
  type ReelGenerationState,
  type Source,
  type StudySet,
  type StudySetConfig,
  type WeakTopic,
} from '@/models/types';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  quizFromRow,
  quizResultFromRow,
  reelFromRow,
  sourceFromRow,
  studySetFromRow,
  weakTopicFromRow,
} from './mappers';

// --- helpers -----------------------------------------------------------------

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Study sets ---------------------------------------------------------------

export async function insertStudySet(db: SQLiteDatabase, studySet: StudySet): Promise<void> {
  await db.runAsync(
    `INSERT INTO study_sets
      (id, title, status, created_at, updated_at, last_studied_at, quiz_score_percent,
       reel_count_actual, reels_watched, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      studySet.id,
      studySet.title,
      studySet.status,
      studySet.createdAt,
      studySet.updatedAt,
      studySet.lastStudiedAt,
      studySet.quizScorePercent,
      studySet.reelCountActual,
      studySet.reelsWatched,
      JSON.stringify(studySet.config),
    ]
  );
}

export async function listStudySets(db: SQLiteDatabase): Promise<StudySet[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM study_sets ORDER BY updated_at DESC'
  );
  return rows.map(studySetFromRow);
}

export async function getStudySet(db: SQLiteDatabase, id: string): Promise<StudySet | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM study_sets WHERE id = ?',
    [id]
  );
  return row ? studySetFromRow(row) : null;
}

export async function updateStudySetStatus(
  db: SQLiteDatabase,
  id: string,
  status: StudySet['status']
): Promise<void> {
  await db.runAsync('UPDATE study_sets SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    Date.now(),
    id,
  ]);
}

export async function touchStudySetProgress(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  await db.runAsync(
    `UPDATE study_sets SET
       last_studied_at = ?,
       reels_watched = (SELECT COUNT(*) FROM reels WHERE study_set_id = ? AND watched = 1),
       reel_count_actual = (SELECT COUNT(*) FROM reels WHERE study_set_id = ?),
       updated_at = ?
     WHERE id = ?`,
    [Date.now(), id, id, Date.now(), id]
  );
}

export async function deleteStudySet(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM study_sets WHERE id = ?', [id]);
}

export function makeStudySet(
  title: string,
  config: StudySetConfig,
  now = Date.now()
): StudySet {
  return {
    id: newId(),
    title,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    lastStudiedAt: null,
    quizScorePercent: null,
    reelCountActual: 0,
    reelsWatched: 0,
    config,
  };
}

// --- Sources ------------------------------------------------------------------

export async function insertSource(db: SQLiteDatabase, source: Source): Promise<void> {
  await db.runAsync(
    `INSERT INTO sources (id, study_set_id, kind, name, local_path, size_bytes, created_at, extracted_text_chars)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      source.id,
      source.studySetId,
      source.kind,
      source.name,
      source.localPath,
      source.sizeBytes,
      source.createdAt,
      source.extractedTextChars,
    ]
  );
}

export async function listSourcesForSet(db: SQLiteDatabase, studySetId: string): Promise<Source[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM sources WHERE study_set_id = ? ORDER BY created_at ASC',
    [studySetId]
  );
  return rows.map(sourceFromRow);
}

export async function listAllSources(db: SQLiteDatabase): Promise<Source[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM sources ORDER BY created_at DESC'
  );
  return rows.map(sourceFromRow);
}

/**
 * Delete one source row by id. Returns the deleted row (path/kind included)
 * so the caller can clean up files, or null when the row was already gone.
 * NOTE: sources are per study set (study_set_id FK) — this does NOT cascade
 * to the study set; it only removes the source itself.
 */
export async function deleteSource(
  db: SQLiteDatabase,
  sourceId: string
): Promise<Source | null> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM sources WHERE id = ?',
    [sourceId]
  );
  if (rows.length === 0) return null;
  const source = sourceFromRow(rows[0]);
  await db.runAsync('DELETE FROM sources WHERE id = ?', [sourceId]);
  return source;
}

/**
 * How many OTHER study sets reference the exact same stored file path.
 * Used before file deletion so a shared file (imported once, reused via
 * "From library" into several sets) is only removed from disk when the
 * last reference goes away.
 */
export async function countOtherSourcesUsingPath(
  db: SQLiteDatabase,
  sourceId: string,
  localPath: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) as n FROM sources WHERE id != ? AND local_path = ?',
    [sourceId, localPath]
  );
  return row?.n ?? 0;
}

/** Persist the Phase 2 extraction outcome for a stored source. */
export async function updateSourceExtraction(
  db: SQLiteDatabase,
  sourceId: string,
  extractedTextChars: number | null
): Promise<void> {
  await db.runAsync(
    'UPDATE sources SET extracted_text_chars = ? WHERE id = ?',
    [extractedTextChars, sourceId]
  );
}

export function makeSource(
  studySetId: string,
  kind: Source['kind'],
  name: string,
  localPath: string | null,
  sizeBytes: number | null
): Source {
  return {
    id: newId(),
    studySetId,
    kind,
    name,
    localPath,
    sizeBytes,
    createdAt: Date.now(),
    extractedTextChars: null,
  };
}

// --- Reels --------------------------------------------------------------------

export async function insertReels(db: SQLiteDatabase, reels: Reel[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const reel of reels) {
      await db.runAsync(
        `INSERT INTO reels
          (id, study_set_id, [index], title, topic, state, video_path, audio_path,
           caption_timing_path, duration_sec, error, created_at, updated_at, watched)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reel.id,
          reel.studySetId,
          reel.index,
          reel.title,
          reel.topic,
          reel.state,
          reel.videoPath,
          reel.audioPath,
          reel.captionTimingPath,
          reel.durationSec,
          reel.error,
          reel.createdAt,
          reel.updatedAt,
          reel.watched,
        ]
      );
    }
  });
}

export async function listReelsForSet(db: SQLiteDatabase, studySetId: string): Promise<Reel[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM reels WHERE study_set_id = ? ORDER BY [index] ASC',
    [studySetId]
  );
  return rows.map(reelFromRow);
}

export async function setReelState(
  db: SQLiteDatabase,
  reelId: string,
  state: ReelGenerationState,
  patch: Partial<Pick<Reel, 'videoPath' | 'audioPath' | 'captionTimingPath' | 'error' | 'durationSec'>> = {}
): Promise<void> {
  await db.runAsync(
    `UPDATE reels SET state = ?, updated_at = ?,
       video_path = COALESCE(?, video_path),
       audio_path = COALESCE(?, audio_path),
       caption_timing_path = COALESCE(?, caption_timing_path),
       duration_sec = COALESCE(?, duration_sec),
       error = ?
     WHERE id = ?`,
    [state, Date.now(), patch.videoPath ?? null, patch.audioPath ?? null,
     patch.captionTimingPath ?? null, patch.durationSec ?? null, patch.error ?? null, reelId]
  );
}

export async function setReelWatched(db: SQLiteDatabase, reelId: string, watched: boolean): Promise<void> {
  await db.runAsync('UPDATE reels SET watched = ? WHERE id = ?', [watched ? 1 : 0, reelId]);
}

// --- Quizzes ------------------------------------------------------------------

export async function insertQuiz(db: SQLiteDatabase, quiz: Quiz): Promise<void> {
  await db.runAsync(
    'INSERT INTO quizzes (id, study_set_id, question_count, created_at) VALUES (?, ?, ?, ?)',
    [quiz.id, quiz.studySetId, quiz.questionCount, quiz.createdAt]
  );
}

export async function insertQuizQuestions(
  db: SQLiteDatabase,
  questions: QuizQuestion[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const q of questions) {
      await db.runAsync(
        `INSERT INTO quiz_questions (id, quiz_id, [index], type, question, options_json, correct_index, topic, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [q.id, q.quizId, q.index, q.type, q.question, JSON.stringify(q.options), q.correctIndex, q.topic, q.explanation]
      );
    }
  });
}

export async function listQuizzesForSet(db: SQLiteDatabase, studySetId: string): Promise<Quiz[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM quizzes WHERE study_set_id = ? ORDER BY created_at DESC',
    [studySetId]
  );
  return rows.map(quizFromRow);
}

export async function listQuizQuestions(db: SQLiteDatabase, quizId: string): Promise<QuizQuestion[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY [index] ASC',
    [quizId]
  );
  return rows.map((row) => {
    const r = row as Record<string, string | number | null>;
    return {
      id: String(r.id),
      quizId: String(r.quiz_id),
      index: Number(r.index),
      type: (r.type as QuizQuestion['type']) ?? 'multiple_choice',
      question: String(r.question),
      options: JSON.parse(String(r.options_json ?? '[]')) as string[],
      correctIndex: Number(r.correct_index),
      topic: (r.topic as string | null) ?? null,
      explanation: (r.explanation as string | null) ?? null,
    };
  });
}

export async function insertQuizResult(db: SQLiteDatabase, result: QuizResult): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO quiz_results (id, study_set_id, quiz_id, score_percent, correct_count, total_count, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [result.id, result.studySetId, result.quizId, result.scorePercent, result.correctCount, result.totalCount, result.completedAt]
    );
    await db.runAsync(
      'UPDATE study_sets SET quiz_score_percent = ?, updated_at = ? WHERE id = ?',
      [result.scorePercent, Date.now(), result.studySetId]
    );
  });
}

export async function listQuizResultsForSet(
  db: SQLiteDatabase,
  studySetId: string
): Promise<QuizResult[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM quiz_results WHERE study_set_id = ? ORDER BY completed_at DESC',
    [studySetId]
  );
  return rows.map(quizResultFromRow);
}

export async function listAllQuizResults(db: SQLiteDatabase): Promise<QuizResult[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT qr.*, ss.title as set_title FROM quiz_results qr JOIN study_sets ss ON ss.id = qr.study_set_id ORDER BY qr.completed_at DESC'
  );
  return rows.map(quizResultFromRow);
}

// --- Weak topics (spec §24) -----------------------------------------------------

export async function upsertWeakTopic(
  db: SQLiteDatabase,
  topic: Omit<WeakTopic, 'id'>
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; incorrect_count: number; total_count: number }>(
    'SELECT id, incorrect_count, total_count FROM weak_topics WHERE study_set_id = ? AND topic = ?',
    [topic.studySetId, topic.topic]
  );
  if (existing) {
    await db.runAsync(
      `UPDATE weak_topics SET
         mastery = ?, incorrect_count = ?, total_count = ?, last_seen_at = ?
       WHERE id = ?`,
      [topic.mastery, topic.incorrectCount, topic.totalCount, topic.lastSeenAt, existing.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO weak_topics (id, study_set_id, topic, mastery, incorrect_count, total_count, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), topic.studySetId, topic.topic, topic.mastery, topic.incorrectCount, topic.totalCount, topic.lastSeenAt]
    );
  }
}

export async function listWeakTopics(db: SQLiteDatabase, studySetId: string): Promise<WeakTopic[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM weak_topics WHERE study_set_id = ? ORDER BY incorrect_count DESC',
    [studySetId]
  );
  return rows.map(weakTopicFromRow);
}

// --- Background videos (spec §22) ------------------------------------------------

export async function listBackgroundVideos(db: SQLiteDatabase): Promise<BackgroundVideo[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    local_path: string;
    duration_sec: number | null;
    category: string;
    added_at: number;
  }>('SELECT * FROM background_videos ORDER BY added_at ASC');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    localPath: row.local_path,
    durationSec: row.duration_sec,
    category: row.category,
    addedAt: row.added_at,
  }));
}

export async function upsertBackgroundVideo(db: SQLiteDatabase, video: BackgroundVideo): Promise<void> {
  await db.runAsync(
    `INSERT INTO background_videos (id, name, local_path, duration_sec, category, added_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, local_path = excluded.local_path`,
    [video.id, video.name, video.localPath, video.durationSec, video.category, video.addedAt]
  );
}

// --- Settings ---------------------------------------------------------------------

export async function getSettings(db: SQLiteDatabase): Promise<AppSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings'
  );
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

export async function saveSetting(db: SQLiteDatabase, key: keyof AppSettings, value: unknown): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  );
}
