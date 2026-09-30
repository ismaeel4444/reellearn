import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { runGenerationPipeline, type PipelineProgress } from '@/services/ai/pipeline';
import { getDatabase } from '@/services/storage/database';
import { getStudySet, listReelsForSet } from '@/services/storage/repositories';
import type { StudySet } from '@/models/types';
import { palette } from '@/theme/palette';

const STAGES = [
  { key: 'sources', label: 'Reading material' },
  { key: 'llm', label: 'Understanding topics' },
  { key: 'tts', label: 'Generating narration' },
  { key: 'done', label: 'Ready' },
] as const;

/**
 * Phase 3 generation screen. Runs the real pipeline (Qwen → Kokoro) with
 * honest progress: the stage shown is the stage running, the percent tracks
 * real stage weights, and "Model in RAM" proves the one-model contract
 * (never two AI models resident at once).
 *
 * Video rendering is Phase 4 — when narration completes, this screen says so.
 */
export default function GenerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [studySet, setStudySet] = useState<StudySet | null>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'sources',
    message: '',
    percent: 0,
    modelInRam: null,
  });
  const [error, setError] = useState<string | null>(null);
  const runSeq = useRef(0);
  /** Auto-start guard: the pipeline kicks off once per mount. */
  const autoStarted = useRef(false);

  useEffect(() => {
    void (async () => {
      if (!id) return;
      const db = await getDatabase();
      setStudySet(await getStudySet(db, id));
    })();
  }, [id]);

  // AUTO-START: arriving here from the Create flow means "generate now" —
  // no manual tap. Fresh sets (no reels yet) start immediately.
  useEffect(() => {
    if (!id || autoStarted.current) return;
    autoStarted.current = true;
    void (async () => {
      const db = await getDatabase();
      const reels = await listReelsForSet(db, id);
      if (reels.length === 0) void start();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const start = async () => {
    if (!id || phase === 'working') return;
    const seq = ++runSeq.current;
    setPhase('working');
    setError(null);
    setProgress({ stage: 'sources', message: 'Starting…', percent: 0, modelInRam: null });
    try {
      await runGenerationPipeline(id, { onProgress: (p) => {
        if (seq !== runSeq.current) return;
        setProgress(p);
        } });
      if (seq !== runSeq.current) return;
      setPhase('done');
    } catch (err) {
      if (seq !== runSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const activeStageIndex = STAGES.findIndex((s) => s.key === progress.stage);
  const lastDoneIndex =
    progress.stage === 'done' ? STAGES.length - 1 : activeStageIndex < 0 ? -1 : activeStageIndex - 1;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <AppButton
          label=""
          onPress={() => {
            // Create used router.replace() to get here, so history may be
            // empty — fall back to Home instead of an unhandled GO_BACK.
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)');
          }}
          variant="ghost"
          icon="chevron_left"
        />
        <AppText variant="heading" style={styles.headerTitle}>
          Generating reels
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.stagesCard}>
        {STAGES.map((stage, i) => {
          const isActive =
            phase === 'working' &&
            (progress.stage === stage.key ||
              (stage.key === 'llm' && progress.stage === 'llm') ||
              (stage.key === 'tts' && progress.stage === 'tts'));
          const isDone = phase === 'done' || (phase === 'working' && i <= lastDoneIndex);
          const dotStyle = isActive
            ? styles.stageDotActive
            : isDone
              ? styles.stageDotDone
              : styles.stageDotPending;
          return (
            <View key={stage.key} style={styles.stageRow}>
              <View style={[styles.stageDot, dotStyle]}>
                <AppIcon
                  name={isDone && !isActive ? 'check' : 'auto_awesome'}
                  size={13}
                  color={isActive || isDone ? palette.primary : palette.textTertiary}
                />
              </View>
              <AppText
                size={14}
                weight={isActive ? '600' : '500'}
                color={isActive ? 'default' : isDone ? 'secondary' : 'tertiary'}>
                {stage.label}
              </AppText>
              {isActive && progress.modelInRam ? (
                <View style={styles.ramBadge}>
                  <AppText variant="caption" color="secondary">
                    {progress.modelInRam.toUpperCase()} in RAM
                  </AppText>
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={styles.progressWrap}>
          <ProgressBar
            percent={phase === 'done' ? 100 : progress.percent}
            color={phase === 'error' ? palette.danger : palette.primary}
            trackColor={palette.border}
            height={6}
          />
          <AppText variant="caption" color="tertiary">
            {phase === 'done' ? 100 : Math.round(progress.percent)}%
          </AppText>
        </View>
        {phase === 'working' || phase === 'done' ? (
          <AppText
            variant="caption"
            color={phase === 'done' ? 'accent' : 'secondary'}
            numberOfLines={2}>
            {progress.message}
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" color="danger" numberOfLines={4}>
            {error}
          </AppText>
        ) : null}
      </View>

      {phase === 'idle' || phase === 'error' ? (
        <View style={styles.actionsRow}>
          <AppButton
            label={phase === 'error' ? 'Retry generation' : 'Start generation'}
            onPress={() => void start()}
            icon="play_arrow"
          />
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.actionsRow}>
          <AppButton
            label="Watch reels now"
            onPress={() => router.push(`/watch/${id}`)}
            icon="play_circle"
            fullWidth
            size="lg"
          />
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.doneCard}>
          <AppIcon name="check_circle" size={18} color={palette.accent} />
          <AppText variant="bodySmall" color="secondary">
            Narration and caption timing are ready for {studySet?.config.reelCount ?? '—'} reels.
          </AppText>
        </View>
      ) : null}

      {studySet ? (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <AppIcon name="movie" size={15} color={palette.primary} />
            <AppText variant="bodySmall" color="secondary">
              {studySet.config.reelCount} reels × {studySet.config.reelDurationSec} sec
            </AppText>
          </View>
          <View style={styles.summaryRow}>
            <AppIcon name="psychology" size={15} color={palette.accent} />
            <AppText variant="bodySmall" color="secondary">
              Qwen3.5 (llama.rn) · Kokoro (ExecuTorch) — one model in RAM at a time
            </AppText>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  stagesCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stageDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageDotActive: {
    borderWidth: 2,
    borderColor: palette.primary,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
  },
  stageDotDone: {
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: 'rgba(0, 229, 183, 0.12)',
  },
  stageDotPending: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: 'transparent',
  },
  ramBadge: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  actionsRow: { marginTop: 16 },
  doneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(0, 229, 183, 0.06)',
  },
  summaryCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginTop: 16,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
