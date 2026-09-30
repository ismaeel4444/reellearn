import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { strings } from '@/i18n/strings';
import type { QuizQuestion } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import { insertQuizResult, listQuizQuestions } from '@/services/storage/repositories';
import { palette } from '@/theme/palette';

/**
 * End-of-set exam (Phase 5). Loads the study set's generated quiz from the
 * DB, walks the user through every question with instant per-question
 * feedback, then persists a QuizResult (score rolls into the set + Library).
 */

type Phase = 'loading' | 'running' | 'done' | 'missing';

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [quizId, setQuizId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const db = await getDatabase();
          const { listQuizzesForSet } = await import('@/services/storage/repositories');
          const quizzes = await listQuizzesForSet(db, id ?? '');
          const latest = quizzes[0];
          if (!latest) {
            if (!cancelled) setPhase('missing');
            return;
          }
          const qs = await listQuizQuestions(db, latest.id);
          if (qs.length === 0) {
            if (!cancelled) setPhase('missing');
            return;
          }
          if (!cancelled) {
            setQuizId(latest.id);
            setQuestions(qs);
            setPhase('running');
          }
        } catch (err) {
          console.error('[quiz] failed to load', err);
          if (!cancelled) setPhase('missing');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id])
  );

  const q = questions[current];
  const isLast = current === questions.length - 1;

  const finish = async (finalCorrect: number) => {
    setPhase('done');
    if (!quizId || !id) return;
    try {
      const db = await getDatabase();
      await insertQuizResult(db, {
        id: `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        studySetId: id,
        quizId,
        scorePercent: Math.round((finalCorrect / questions.length) * 100),
        correctCount: finalCorrect,
        totalCount: questions.length,
        completedAt: Date.now(),
      });
    } catch (err) {
      console.error('[quiz] failed to save result', err);
    }
  };

  const checkAndAdvance = () => {
    if (selected == null || !q) return;
    if (!checked) {
      setChecked(true);
      if (selected === q.correctIndex) setCorrectCount((c) => c + 1);
      return;
    }
    // Advance or finish (+1 if the last question was answered correctly).
    const wasCorrect = selected === q.correctIndex;
    if (isLast) {
      void finish(correctCount + (wasCorrect ? 1 : 0));
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setChecked(false);
    }
  };

  if (phase === 'loading') {
    return (
      <Screen>
        <EmptyState icon="quiz" title="Loading quiz…" body="" />
      </Screen>
    );
  }

  if (phase === 'missing') {
    return (
      <Screen>
        <View style={styles.headerRow}>
          <AppButton label="" onPress={() => router.back()} variant="ghost" icon="chevron_left" />
          <AppText variant="heading" style={styles.headerTitle}>
            {strings.reels.quizAfterSet}
          </AppText>
          <View style={styles.headerSpacer} />
        </View>
        <EmptyState
          icon="quiz"
          title="No quiz yet"
          body="The exam for this study set hasn't been generated yet — (re)run generation to create it."
        />
      </Screen>
    );
  }

  if (phase === 'done') {
    const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    return (
      <Screen>
        <View style={styles.doneWrap}>
          <AppIcon
            name={pct >= 80 ? 'check_circle' : 'quiz'}
            size={56}
            color={pct >= 80 ? palette.accent : pct >= 50 ? palette.primary : palette.textTertiary}
          />
          <AppText variant="display" style={styles.doneScore}>
            {pct}%
          </AppText>
          <AppText variant="body" color="secondary">
            {correctCount} of {questions.length} correct
          </AppText>
          <AppText variant="bodySmall" color="tertiary" style={styles.doneHint}>
            {pct >= 80
              ? 'Excellent — this set is solid.'
              : pct >= 50
                ? 'Good. Re-watch the reels on topics you missed.'
                : 'Watch the reels once more, then retake the exam.'}
          </AppText>
          <AppButton label="Back to set" onPress={() => router.back()} fullWidth size="lg" />
        </View>
      </Screen>
    );
  }

  // phase === 'running'
  const answerState = checked && selected != null ? (selected === q.correctIndex ? 'correct' : 'incorrect') : 'idle';

  return (
    <Screen>
      <View style={styles.headerRow}>
        <AppButton label="" onPress={() => router.back()} variant="ghost" icon="chevron_left" />
        <AppText variant="heading" style={styles.headerTitle}>
          {strings.reels.quizAfterSet}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.quizCard}>
        <View style={styles.progressRow}>
          <AppText variant="caption" color="secondary" weight="600">
            Question {current + 1} of {questions.length}
          </AppText>
          <View style={styles.progressTrack}>
            <ProgressBar
              percent={Math.round(((current + (checked ? 1 : 0)) / questions.length) * 100)}
              color={palette.primary}
              trackColor={palette.border}
              height={6}
            />
          </View>
        </View>

        {q.topic ? (
          <AppText variant="caption" color="primary" weight="700" style={styles.kicker}>
            {q.topic}
          </AppText>
        ) : null}
        <AppText variant="heading" size={19}>
          {q.question}
        </AppText>

        <View style={styles.options}>
          {q.options.map((option, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === i;
            const showCorrect = checked && i === q.correctIndex;
            const showIncorrect = checked && isSelected && i !== q.correctIndex;

            const optionStyle: object[] = [styles.option];
            if (showCorrect) optionStyle.push(styles.optionCorrect);
            else if (showIncorrect) optionStyle.push(styles.optionIncorrect);
            else if (isSelected) optionStyle.push(styles.optionSelected);

            const letterStyle: object[] = [styles.optionLetter];
            if (showCorrect) letterStyle.push(styles.optionLetterCorrect);
            else if (isSelected && !checked) letterStyle.push(styles.optionLetterSelected);

            return (
              <Pressable
                key={`${current}-${i}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Answer ${letter}: ${option}`}
                onPress={() => {
                  if (!checked) setSelected(i);
                }}
                style={({ pressed }) => [optionStyle, pressed && { opacity: 0.85 }]}>
                <View style={letterStyle}>
                  <AppText size={13} weight="700" color={isSelected && !checked ? 'default' : 'secondary'}>
                    {letter}
                  </AppText>
                </View>
                <AppText size={15} weight="500" style={styles.optionText}>
                  {option}
                </AppText>
                {showCorrect ? <AppIcon name="check" size={18} color={palette.accent} /> : null}
                {showIncorrect ? <AppIcon name="close" size={18} color={palette.danger} /> : null}
              </Pressable>
            );
          })}
        </View>

        <AppButton
          label={
            !checked
              ? 'Check answer'
              : answerState === 'correct'
                ? isLast
                  ? 'See result'
                  : 'Correct — next question'
                : isLast
                  ? 'See result'
                  : 'Next question'
          }
          onPress={checkAndAdvance}
          disabled={selected == null && !checked}
          fullWidth
          size="lg"
        />
        {checked && answerState === 'incorrect' ? (
          <AppText variant="bodySmall" color="secondary" style={styles.explanation}>
            The correct answer is “{q.options[q.correctIndex]}”.
            {q.explanation ? ` ${q.explanation}` : ''}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  quizCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTrack: { flex: 1 },
  kicker: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
  },
  options: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  optionSelected: {
    borderColor: palette.primary,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
  },
  optionCorrect: {
    borderColor: palette.accent,
    backgroundColor: 'rgba(0, 229, 183, 0.10)',
  },
  optionIncorrect: {
    borderColor: 'rgba(255, 92, 122, 0.55)',
    backgroundColor: 'rgba(255, 92, 122, 0.08)',
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterSelected: {
    borderColor: palette.primary,
    backgroundColor: palette.primary,
  },
  optionLetterCorrect: {
    borderColor: palette.accent,
    backgroundColor: 'rgba(0, 229, 183, 0.15)',
  },
  optionText: { flex: 1 },
  explanation: { marginTop: -4 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  doneScore: { marginTop: 8 },
  doneHint: { textAlign: 'center', marginBottom: 16 },
});
