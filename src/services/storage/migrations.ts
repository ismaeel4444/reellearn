import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Forward-only migrations (spec §28). Append new entries; never edit old ones.
 */
const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS study_sets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_studied_at INTEGER,
    quiz_score_percent INTEGER,
    reel_count_actual INTEGER NOT NULL DEFAULT 0,
    reels_watched INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    local_path TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL,
    extracted_text_chars INTEGER
  );

  CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    [index] INTEGER NOT NULL,
    title TEXT,
    topic TEXT,
    state TEXT NOT NULL DEFAULT 'pending',
    video_path TEXT,
    audio_path TEXT,
    caption_timing_path TEXT,
    duration_sec INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    watched INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_reels_set ON reels(study_set_id, [index]);

  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    question_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quiz_questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    [index] INTEGER NOT NULL,
    type TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    topic TEXT,
    explanation TEXT
  );

  CREATE TABLE IF NOT EXISTS quiz_answers (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    selected_index INTEGER,
    correct INTEGER NOT NULL DEFAULT 0,
    topic TEXT
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id TEXT PRIMARY KEY,
    study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    score_percent INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    total_count INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weak_topics (
    id TEXT PRIMARY KEY,
    study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    mastery TEXT NOT NULL DEFAULT 'unseen',
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS background_videos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    local_path TEXT NOT NULL,
    duration_sec INTEGER,
    category TEXT NOT NULL DEFAULT 'gameplay',
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = await db.getFirstAsync<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_migrations'
  );
  const currentVersion = row?.version ?? 0;

  for (let v = currentVersion; v < MIGRATIONS.length; v++) {
    const version = v + 1;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[v]);
      await txn.runAsync('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        version,
        Date.now(),
      ]);
    });
  }
}
