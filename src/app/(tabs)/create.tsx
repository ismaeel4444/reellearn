import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ChipSelect } from '@/components/ui/chip-select';
import { GradientCard } from '@/components/ui/gradient-card';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { BackgroundVideoSelector } from '@/components/create/background-video-selector';
import { VoiceSelector } from '@/components/create/voice-selector';
import { strings } from '@/i18n/strings';
import type { BackgroundVideo, Source, SourceKind } from '@/models/types';
import { listAllSources, listBackgroundVideos, makeSource, makeStudySet, insertSource, insertStudySet, updateSourceExtraction } from '@/services/storage/repositories';
import { getDatabase } from '@/services/storage/database';
import {
  dirs,
  ensureDataDirectories,
  importFileToStorage,
  writeTextFile,
} from '@/services/storage/file-system';
import {
  extractSourceText,
  copyExtractedText,
  writeExtractedText,
} from '@/services/ai/ingestion';
import { defaultVoiceId } from '@/services/ai/voices';
import { palette } from '@/theme/palette';

interface PickedSource {
  uri: string;
  name: string;
  size: number | null;
  kind: SourceKind;
  /** Immediate text for pasted content. */
  pastedText?: string;
  /** Already-imported library file: reuse its stored path, skip import+OCR. */
  existingPath?: string;
  /** Extracted char count already stored for a library file. */
  existingChars?: number | null;
  /** Original source row id in the library — lets us carry over cached OCR text. */
  existingSourceId?: string;
}

const REEL_COUNT_OPTIONS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: 20, label: '20' },
];

const DURATION_OPTIONS = [
  { value: 15, label: '15 sec' },
  { value: 20, label: '20 sec' },
  { value: 30, label: '30 sec' },
  { value: 45, label: '45 sec' },
  { value: 60, label: '60 sec' },
];

const QUIZ_OPTIONS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: 20, label: '20' },
];

function kindFromName(name: string, fallback: SourceKind = 'txt'): SourceKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['ppt'].includes(ext)) return 'ppt';
  if (['pptx'].includes(ext)) return 'pptx';
  if (['doc'].includes(ext)) return 'doc';
  if (['docx'].includes(ext)) return 'docx';
  if (['txt', 'md'].includes(ext)) return 'txt';
  if (['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext)) return 'image';
  return fallback;
}

export default function CreateScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<PickedSource[]>([]);
  const [reelCount, setReelCount] = useState<number | string>(10);
  const [duration, setDuration] = useState<number | string>(30);
  const [quizCount, setQuizCount] = useState<number | string>(10);
  const [voiceId, setVoiceId] = useState(defaultVoiceId);
  const [videos, setVideos] = useState<BackgroundVideo[]>([]);
  const [backgroundVideoId, setBackgroundVideoId] = useState<string>('minecraft1');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pasteModalVisible, setPasteModalVisible] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [libraryModalVisible, setLibraryModalVisible] = useState(false);
  const [librarySources, setLibrarySources] = useState<Source[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const db = await getDatabase();
          const list = await listBackgroundVideos(db);
          setVideos(list);
          setBackgroundVideoId((current) =>
            list.some((v) => v.id === current) ? current : (list[0]?.id ?? current)
          );
        } catch (err) {
          console.error('[Create] failed to load background videos', err);
        }
      })();
    }, [])
  );

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // Import IMMEDIATELY: picker URIs point at a cache copy that the OS
      // can purge. Saving the raw uri and deferring the copy to "Generate"
      // produced NoSuchFileException at pipeline time for files picked long
      // before saving.
      ensureDataDirectories();
      const imported = importFileToStorage(asset.uri, dirs.sources, asset.name);
      setSources((prev) => [
        ...prev,
        {
          uri: asset.uri,
          name: asset.name,
          size: imported.sizeBytes ?? asset.size ?? null,
          kind: kindFromName(asset.name),
          existingPath: imported.path, // already in app storage — save() skips re-import
        },
      ]);
      setError(null);
    } catch (err) {
      console.error('[Create] document picker failed', err);
      setError(strings.errors.unsupportedFile);
    }
  };

  const pickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // Same cache-purge defense as pickDocument: copy into app storage now.
      ensureDataDirectories();
      const imported = importFileToStorage(asset.uri, dirs.sources, asset.name);
      setSources((prev) => [
        ...prev,
        {
          uri: asset.uri,
          name: asset.name,
          size: imported.sizeBytes ?? asset.size ?? null,
          kind: 'image',
          existingPath: imported.path,
        },
      ]);
      setError(null);
    } catch (err) {
      console.error('[Create] image picker failed', err);
      setError(strings.errors.unsupportedFile);
    }
  };

  /** Open the picker over files already imported by ANY study set. */
  const openLibraryPicker = async () => {
    try {
      const db = await getDatabase();
      const all = await listAllSources(db);
      setLibrarySources(all);
      setLibraryModalVisible(true);
    } catch (err) {
      console.error('[Create] failed to load library sources', err);
      setError(strings.errors.storageUnavailable);
    }
  };

  const addLibrarySource = (src: Source) => {
    setSources((prev) =>
      prev.some((p) => p.existingPath === src.localPath)
        ? prev
        : [
            ...prev,
            {
              uri: src.localPath ?? `library://${src.id}`,
              name: src.name,
              size: src.sizeBytes,
              kind: src.kind === 'pasted_text' ? 'txt' : src.kind,
              existingPath: src.localPath ?? undefined,
              existingChars: src.extractedTextChars,
              existingSourceId: src.id,
            },
          ]
    );
    setLibraryModalVisible(false);
    setError(null);
  };

  const confirmPaste = () => {
    const text = pastedText.trim();
    if (!text) return;
    const firstLine = text.split('\n')[0].trim();
    setSources((prev) => [
      ...prev,
      {
        uri: `pasted://${Date.now()}`,
        name: firstLine.length > 0 ? firstLine.slice(0, 40) : 'Pasted text',
        size: text.length,
        kind: 'pasted_text',
        pastedText: text,
      },
    ]);
    setPastedText('');
    setPasteModalVisible(false);
    setError(null);
  };

  const save = async () => {
    if (sources.length === 0) {
      setError(strings.create.errors.noSource);
      return;
    }
    if (!title.trim()) {
      setError(strings.create.errors.noTitle);
      return;
    }
    setSaving(true);
    try {
      const db = await getDatabase();
      ensureDataDirectories();
      const studySet = makeStudySet(title.trim(), {
        reelCount: Number(reelCount) || 10,
        reelDurationSec: Number(duration) || 30,
        quizQuestionCount: Number(quizCount) || 10,
        voiceId,
        backgroundVideoId,
        visualStyle: 'gameplay_captions',
      });
      await insertStudySet(db, studySet);
      for (const src of sources) {
        // Already-in-storage file (picked this session, reused from library):
        // just register it — no copy, no OCR.
        if (src.existingPath) {
          const existing = makeSource(studySet.id, src.kind, src.name, src.existingPath, src.size);
          await insertSource(db, existing);
          if (src.existingChars != null) {
            await updateSourceExtraction(db, existing.id, src.existingChars);
          }
          // Carry over the cached OCR text so the pipeline never re-extracts.
          if (src.existingSourceId) {
            await copyExtractedText(src.existingSourceId, existing.id);
          }
          continue;
        }

        // Fresh source: pasted text is persisted to a .txt file; picked files
        // (shouldn't happen anymore — pickers import immediately) are copied.
        const imported =
          src.kind === 'pasted_text'
            ? writeTextFile(dirs.sources, src.name, src.pastedText ?? '')
            : importFileToStorage(src.uri, dirs.sources, src.name);

        const source = makeSource(
          studySet.id,
          src.kind,
          src.name,
          imported.path,
          imported.sizeBytes
        );
        await insertSource(db, source);

        // Phase 2: extract readable text immediately, persist the result AND
        // cache the full text (dirs.extracted) so OCR never runs twice.
        const extraction = await extractSourceText(
          imported.path,
          src.kind,
          src.pastedText
        );
        await updateSourceExtraction(db, source.id, extraction.chars);
        if (extraction.text) {
          writeExtractedText(source.id, extraction.text);
        }
      }
      // Go STRAIGHT to this set's generation progress page — the pipeline
      // auto-starts there (no manual "Start generation" tap, no Library detour).
      router.replace(`/generation/${studySet.id}`);
    } catch (err) {
      console.error('[Create] save failed', err);
      setError(strings.errors.storageUnavailable);
    } finally {
      setSaving(false);
    }
  };

  const estimatedReels = Number(reelCount) || 10;

  return (
    <Screen>
      <AppText variant="sectionTitle">{strings.create.title}</AppText>
      <AppText variant="body" color="secondary" style={styles.subtitle}>
        Turn your study material into short, engaging reels.
      </AppText>

      <View style={styles.section}>
        <SectionHeader title={strings.create.sourceSection} />
        <AppText variant="bodySmall" color="secondary" style={styles.sectionHint}>
          {strings.create.sourceSubtitle}
        </AppText>
        <View style={styles.sourceCards}>
          <InputCard
            icon="upload_file"
            title={strings.create.pickFile}
            subtitle="Choose a PDF or text document"
            onPress={() => void pickDocument()}
          />
          <InputCard
            icon="text_snippet"
            title={strings.create.pasteText}
            subtitle="Paste your study material"
            onPress={() => setPasteModalVisible(true)}
          />
          <InputCard
            icon="menu_book"
            title="From library"
            subtitle="Reuse a file you imported before (no re-OCR)"
            onPress={() => void openLibraryPicker()}
          />
          <InputCard
            icon="image"
            title={strings.create.addImage}
            subtitle="Use photos of notes or pages"
            onPress={() => void pickImage()}
          />
        </View>
        <AppText variant="caption" color="tertiary">
          PDF, DOC, DOCX, TXT, images, pasted text
        </AppText>
        {sources.length > 0 ? (
          <View style={styles.sourceList}>
            {sources.map((src, i) => (
              <View key={`${src.uri}-${i}`} style={styles.sourceRow}>
                <AppIcon name={src.kind === 'image' ? 'image' : 'description'} size={16} color={palette.primary} />
                <View style={styles.sourceTextWrap}>
                  <AppText variant="bodySmall" numberOfLines={1}>
                    {src.name}
                  </AppText>
                  <AppText variant="caption" color="tertiary">
                    {src.kind === 'pasted_text'
                      ? `${src.pastedText?.length ?? 0} chars · pasted`
                      : src.kind.toUpperCase()}
                  </AppText>
                </View>
                <Pressable
                  accessibilityLabel={`Remove ${src.name}`}
                  onPress={() => setSources((prev) => prev.filter((_, idx) => idx !== i))}>
                  <AppIcon name="close" size={16} color={palette.textTertiary} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <AppText variant="caption" color="tertiary" style={styles.phaseNote}>
          TXT, DOCX and pasted text are extracted instantly. PDFs and images
          are read via on-device OCR (PaddleOCR).
        </AppText>
      </View>

      <View style={styles.section}>
        <SectionHeader title={strings.create.titleFieldLabel} />
        <TextInput
          accessibilityLabel={strings.create.titleFieldLabel}
          style={styles.titleInput}
          placeholder={strings.create.titlePlaceholder}
          placeholderTextColor={palette.textTertiary}
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />
      </View>

      <View style={styles.section}>
        <ChipSelect
          label={strings.create.reelsSection}
          options={REEL_COUNT_OPTIONS}
          selected={reelCount}
          onSelect={setReelCount}
          allowCustom
          customPlaceholder={strings.common.custom}
        />
      </View>

      <View style={styles.section}>
        <ChipSelect
          label={strings.create.durationSection}
          options={DURATION_OPTIONS}
          selected={duration}
          onSelect={setDuration}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title={strings.create.voiceSection} />
        <AppText variant="bodySmall" color="secondary" style={styles.sectionHint}>
          {strings.create.voiceSubtitle}
        </AppText>
        <VoiceSelector selectedId={voiceId} onSelect={setVoiceId} />
      </View>

      <View style={styles.section}>
        <SectionHeader title={strings.create.backgroundSection} />
        <AppText variant="bodySmall" color="secondary" style={styles.sectionHint}>
          {strings.create.backgroundSubtitle}
        </AppText>
        <BackgroundVideoSelector videos={videos} selectedId={backgroundVideoId} onSelect={setBackgroundVideoId} />
      </View>

      <View style={styles.section}>
        <ChipSelect
          label={strings.create.quizSection}
          options={QUIZ_OPTIONS}
          selected={quizCount}
          onSelect={setQuizCount}
          allowCustom
          customPlaceholder={strings.common.custom}
        />
        <AppText variant="caption" color="tertiary" style={styles.sectionHint}>
          {strings.create.quizSubtitle}
        </AppText>
      </View>

      {/* Study-set preview + primary CTA */}
      <GradientCard
        colors={[palette.gradientPromoFrom, palette.gradientPromoTo]}
        radius={20}
        style={styles.previewCard}>
        <View style={styles.previewInner}>
          <AppText variant="heading" size={16} numberOfLines={1}>
            {title.trim() || strings.create.titlePlaceholder}
          </AppText>
          <View style={styles.previewMeta}>
            <View style={styles.previewMetaItem}>
              <AppIcon name="movie" size={15} color={palette.primary} />
              <AppText variant="caption" color="secondary">
                {estimatedReels} reels
              </AppText>
            </View>
            <View style={styles.previewMetaItem}>
              <AppIcon name="quiz" size={15} color={palette.accent} />
              <AppText variant="caption" color="secondary">
                {Number(quizCount) || 10} quiz questions
              </AppText>
            </View>
            <View style={styles.previewMetaItem}>
              <AppIcon name="schedule" size={15} color={palette.blue} />
              <AppText variant="caption" color="secondary">
                {Number(duration) || 30} sec each
              </AppText>
            </View>
          </View>
          {sources.length > 0 ? (
            <View style={styles.previewMetaItem}>
              <AppIcon name="description" size={15} color={palette.textSecondary} />
              <AppText variant="caption" color="secondary" numberOfLines={1} style={styles.previewSourceName}>
                {sources.length === 1 ? sources[0].name : `${sources.length} sources added`}
              </AppText>
            </View>
          ) : null}
        </View>
      </GradientCard>

      {error ? (
        <View style={styles.errorWrap}>
          <AppText variant="bodySmall" color="danger">
            {error}
          </AppText>
        </View>
      ) : null}

      <AppButton
        label="Generate Reels"
        onPress={() => void save()}
        loading={saving}
        fullWidth
        size="lg"
        icon="auto_awesome"
        trailingIcon="arrow_forward"
      />
      <AppText variant="caption" color="tertiary" style={styles.phaseNote}>
        {strings.create.generateDraftNote}
      </AppText>

      {/* Paste text modal */}
      <Modal
        visible={pasteModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPasteModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setPasteModalVisible(false)}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
              <AppIcon name="close" size={20} color={palette.text} />
            </Pressable>
            <AppText variant="heading" size={18}>
              Paste text
            </AppText>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <TextInput
            accessibilityLabel="Study material text"
            style={styles.pasteInput}
            placeholder="Paste your study material here…"
            placeholderTextColor={palette.textTertiary}
            value={pastedText}
            onChangeText={setPastedText}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.modalFooter}>
            <AppText variant="caption" color="tertiary">
              {pastedText.trim().length} characters
            </AppText>
            <AppButton
              label="Add text"
              onPress={confirmPaste}
              disabled={pastedText.trim().length === 0}
              icon="check"
            />
          </View>
        </View>
      </Modal>

      {/* Library file picker — files already imported by any study set */}
      <Modal
        visible={libraryModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLibraryModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setLibraryModalVisible(false)}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
              <AppIcon name="close" size={20} color={palette.text} />
            </Pressable>
            <AppText variant="heading" size={18}>
              Library files
            </AppText>
            <View style={styles.modalHeaderSpacer} />
          </View>
          {librarySources.length === 0 ? (
            <View style={styles.libEmpty}>
              <AppText variant="body" color="secondary">
                No imported files yet — pick a document or image first.
              </AppText>
            </View>
          ) : (
            <View style={styles.libList}>
              {librarySources.map((src) => (
                <Pressable
                  key={src.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${src.name}`}
                  onPress={() => addLibrarySource(src)}
                  style={({ pressed }) => [styles.libRow, pressed && { opacity: 0.8 }]}>
                  <AppIcon
                    name={src.kind === 'image' ? 'image' : 'description'}
                    size={16}
                    color={palette.primary}
                  />
                  <View style={styles.sourceTextWrap}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {src.name}
                    </AppText>
                    <AppText variant="caption" color="tertiary">
                      {src.extractedTextChars != null
                        ? `${src.extractedTextChars.toLocaleString()} chars extracted`
                        : 'not extracted'}
                    </AppText>
                  </View>
                  <AppIcon name="add" size={18} color={palette.accent} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </Modal>
    </Screen>
  );
}

function InputCard({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: AppIconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.inputCard,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}>
      <View style={styles.inputIconWrap}>
        <AppIcon name={icon} size={21} color={palette.primary} />
      </View>
      <View style={styles.inputTextWrap}>
        <AppText size={15} weight="700">
          {title}
        </AppText>
        <AppText variant="caption" color="secondary" numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: 4, marginBottom: 24 },
  section: { marginBottom: 24, gap: 10 },
  sectionHint: { marginTop: -4 },
  sourceCards: { gap: 10 },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 14,
  },
  inputIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputTextWrap: { flex: 1, gap: 2 },
  sourceList: { gap: 8, marginTop: 4 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sourceTextWrap: { flex: 1, gap: 1 },
  titleInput: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    color: palette.text,
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  previewCard: { marginBottom: 14 },
  previewInner: { padding: 16, gap: 10 },
  previewMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  previewMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewSourceName: { flexShrink: 1 },
  errorWrap: { marginBottom: 12 },
  phaseNote: { marginTop: 10, textAlign: 'center' },
  modalRoot: {
    flex: 1,
    backgroundColor: palette.background,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalHeaderSpacer: { width: 42 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteInput: {
    flex: 1,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 16,
    color: palette.text,
    fontSize: 15,
    padding: 16,
    textAlignVertical: 'top',
  },
  modalFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  libEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  libList: { gap: 10 },
  libRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
});
