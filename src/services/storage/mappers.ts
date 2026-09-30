import {
  type Quiz,
  type QuizAnswer,
  type QuizResult,
  type Reel,
  type ReelGenerationState,
  type Source,
  type SourceKind,
  type StudySet,
  type StudySetConfig,
  type StudySetStatus,
  type WeakTopic,
} from '@/models/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

// --- Row mappers (DB snake_case <-> domain camelCase) ------------------------

export function studySetFromRow(row: AnyRow): StudySet {
  return {
    id: row.id,
    title: row.title,
    status: row.status as StudySetStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStudiedAt: row.last_studied_at,
    quizScorePercent: row.quiz_score_percent,
    reelCountActual: row.reel_count_actual,
    reelsWatched: row.reels_watched,
    config: JSON.parse(row.config_json) as StudySetConfig,
  };
}

export function sourceFromRow(row: AnyRow): Source {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    kind: row.kind as SourceKind,
    name: row.name,
    localPath: row.local_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    extractedTextChars: row.extracted_text_chars,
  };
}

export function reelFromRow(row: AnyRow): Reel {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    index: row.index,
    title: row.title,
    topic: row.topic,
    state: row.state as ReelGenerationState,
    videoPath: row.video_path,
    audioPath: row.audio_path,
    captionTimingPath: row.caption_timing_path,
    durationSec: row.duration_sec,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    watched: row.watched === 1 ? 1 : 0,
  };
}

export function quizFromRow(row: AnyRow): Quiz {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    questionCount: row.question_count,
    createdAt: row.created_at,
  };
}

export function quizResultFromRow(row: AnyRow): QuizResult {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    quizId: row.quiz_id,
    scorePercent: row.score_percent,
    correctCount: row.correct_count,
    totalCount: row.total_count,
    completedAt: row.completed_at,
  };
}

export function weakTopicFromRow(row: AnyRow): WeakTopic {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    topic: row.topic,
    mastery: row.mastery,
    incorrectCount: row.incorrect_count,
    totalCount: row.total_count,
    lastSeenAt: row.last_seen_at,
  };
}

export function quizAnswerFromRow(row: AnyRow): QuizAnswer {
  return {
    id: row.id,
    quizId: row.quiz_id,
    questionId: row.question_id,
    selectedIndex: row.selected_index,
    correct: row.correct === 1 ? 1 : 0,
    topic: row.topic,
  };
}
