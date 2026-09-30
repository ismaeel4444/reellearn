import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { StudySetCard } from '@/components/study/study-set-card';
import { strings } from '@/i18n/strings';
import type { QuizResult, Source, StudySet } from '@/models/types';
import { getDatabase } from '@/services/storage/database';
import {
  countOtherSourcesUsingPath,
  deleteSource,
  listAllQuizResults,
  listAllSources,
  listStudySets,
} from '@/services/storage/repositories';
import { safeDelete } from '@/services/storage/file-system';
import { deleteExtractedText } from '@/services/ai/ingestion';
import { palette } from '@/theme/palette';

const FILTERS = ['All', 'Recent', 'Drafts', 'Ready'] as const;
type Filter = (typeof FILTERS)[number];

export default function LibraryScreen() {
  const router = useRouter();
  const [studySets, setStudySets] = useState<StudySet[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const db = await getDatabase();
          setStudySets(await listStudySets(db));
          setSources(await listAllSources(db));
          setQuizResults(await listAllQuizResults(db));
        } catch (err) {
          console.error('[Library] failed to load', err);
        }
      })();
    }, [])
  );

  const confirmDeleteSource = (src: Source) => {
    Alert.alert(
      strings.common.delete,
      `Remove "${src.name}" from your library? The study material file will be deleted.`,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.common.delete,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const db = await getDatabase();
                const removed = await deleteSource(db, src.id);
                if (!removed) return;
                // Only remove the stored file when no other study set's source
                // row points at the same path ("From library" reuse).
                if (removed.localPath) {
                  const others = await countOtherSourcesUsingPath(db, removed.id, removed.localPath);
                  if (others === 0) {
                    safeDelete(removed.localPath);
                  }
                }
                // Cached OCR extraction is keyed per source id — always gone.
                deleteExtractedText(removed.id);
                // Refresh the list.
                setSources(await listAllSources(db));
              } catch (err) {
                console.error('[Library] failed to delete source', err);
              }
            })();
          },
        },
      ]
    );
  };

  const filteredSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return studySets.filter((set) => {
      if (q && !set.title.toLowerCase().includes(q)) return false;
      if (filter === 'Drafts') return set.status === 'draft';
      if (filter === 'Ready') return set.status === 'ready';
      return true;
    });
  }, [studySets, query, filter]);

  const isEmptyLibrary =
    studySets.length === 0 && sources.length === 0 && quizResults.length === 0;

  if (isEmptyLibrary) {
    return (
      <Screen>
        <AppText variant="sectionTitle">{strings.library.title}</AppText>
        <EmptyState
          icon="menu_book"
          title={strings.home.emptyTitle}
          body="Create your first study set and turn your notes into reels."
          actionLabel={strings.home.createCtaTitle}
          onAction={() => router.navigate('/(tabs)/create')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="sectionTitle">{strings.library.title}</AppText>

      <View style={styles.searchWrap}>
        <AppIcon name="text_snippet" size={17} color={palette.textTertiary} />
        <TextInput
          accessibilityLabel="Search your study sets"
          style={styles.searchInput}
          placeholder="Search your study sets"
          placeholderTextColor={palette.textTertiary}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable accessibilityLabel="Clear search" onPress={() => setQuery('')}>
            <AppIcon name="close" size={16} color={palette.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const selected = filter === f;
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(f)}
              style={({ pressed }) => [
                styles.filterChip,
                selected && styles.filterChipSelected,
                pressed && { opacity: 0.8 },
              ]}>
              <AppText
                size={13}
                weight={selected ? '700' : '500'}
                color={selected ? 'default' : 'secondary'}>
                {f}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {filteredSets.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={strings.library.studySetsSection} />
          <View style={styles.list}>
            {filteredSets.map((set) => {
              const progress =
                set.reelCountActual > 0
                  ? (set.reelsWatched / set.reelCountActual) * 100
                  : 0;
              return (
                <StudySetCard
                  key={set.id}
                  studySet={set}
                  progressPercent={progress}
                  onPress={() => router.push(`/study-set/${set.id}`)}
                />
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <SectionHeader title={strings.library.studySetsSection} />
          <AppText variant="bodySmall" color="tertiary">
            {strings.library.emptySets}
          </AppText>
        </View>
      )}

      {sources.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={strings.library.sourcesSection} />
          <View style={styles.list}>
            {sources.slice(0, 5).map((src) => (
              <View key={src.id} style={styles.row}>
                <View style={[styles.rowIcon, styles.rowIconBlue]}>
                  <AppIcon
                    name={src.kind === 'image' ? 'image' : 'description'}
                    size={16}
                    color={palette.blue}
                  />
                </View>
                <AppText variant="bodySmall" numberOfLines={1} style={styles.rowText}>
                  {src.name}
                </AppText>
                <AppText variant="caption" color="tertiary">
                  {src.sizeBytes != null ? `${Math.max(1, Math.round(src.sizeBytes / 1024))} KB` : ''}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${src.name}`}
                  hitSlop={8}
                  onPress={() => confirmDeleteSource(src)}
                  style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
                  <AppIcon name="delete" size={18} color={palette.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {quizResults.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={strings.library.quizzesSection} />
          <View style={styles.list}>
            {quizResults.slice(0, 5).map((result) => (
              <View key={result.id} style={styles.row}>
                <View style={[styles.rowIcon, styles.rowIconTeal]}>
                  <AppIcon name="quiz" size={16} color={palette.accent} />
                </View>
                <AppText variant="bodySmall" style={styles.rowText}>
                  Quiz score
                </AppText>
                <AppText variant="bodySmall" weight="700" color="accent">
                  {result.scorePercent}%
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 16,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    color: palette.text,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: 'rgba(124, 92, 255, 0.16)',
    borderColor: palette.primary,
  },
  section: { marginTop: 24, gap: 10 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconBlue: { backgroundColor: 'rgba(74, 144, 255, 0.12)' },
  rowIconTeal: { backgroundColor: 'rgba(0, 229, 183, 0.10)' },
  rowText: { flex: 1 },
});
