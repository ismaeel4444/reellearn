/**
 * All user-facing strings in one module so UI localization can be added later
 * without touching business logic (spec §35).
 */
export const strings = {
  appName: 'ReelLearn',
  tagline: 'Turn your study material\ninto short, engaging reels.',

  tabs: {
    home: 'Home',
    create: 'Create',
    reels: 'Reels',
    library: 'Library',
  },

  home: {
    createCtaTitle: 'Create Study Set',
    createCtaSubtitle: 'Upload a file, paste text, or add images',
    studySetsHeader: 'Your Study Sets',
    seeAll: 'See all →',
    reelsWatchedLabel: 'Reels watched',
    quizLabel: 'Quiz',
    continueLabel: 'Continue',
    promoTitle: 'Smarter Learning',
    promoBody: 'Short videos. Better memory. Powered by AI.',
    emptyTitle: 'No study sets yet',
    emptyBody: 'Turn your notes, slides, or PDFs into short learning reels. Create your first study set to get started.',
  },

  create: {
    title: 'Create Study Set',
    subtitle: 'Configure a new set — generation runs fully on-device.',
    sourceSection: 'Source material',
    sourceSubtitle: 'Text extraction runs locally; OCR is used only as a fallback.',
    pickFile: 'Choose file',
    pasteText: 'Paste text',
    addImage: 'Add image',
    supportedHint: 'PDF, DOC, DOCX, TXT, images, pasted text',
    phaseNote: 'Text extraction runs fully on-device: TXT and DOCX directly, PDFs and images via on-device OCR (PaddleOCR).',
    titleFieldLabel: 'Study set title',
    titlePlaceholder: 'e.g. Biology — Cell Division',
    reelsSection: 'Reels',
    reelsSubtitle: 'How many reels should be generated?',
    durationSection: 'Reel duration',
    voiceSection: 'Narration voice',
    voiceSubtitle: 'Kokoro runs fully offline on your device.',
    backgroundSection: 'Background video',
    backgroundSubtitle: 'Plays behind captions in every reel.',
    quizSection: 'Quiz questions',
    quizSubtitle: 'Generated on-device after watching.',
    generate: 'Save study set',
    generateDraftNote: 'The generation pipeline (Qwen → Kokoro → renderer) is implemented in later phases.',
    errors: {
      noSource: 'Add a source file, image, or pasted text first.',
      noTitle: 'Give your study set a title.',
    },
  },

  reels: {
    title: 'Reels',
    emptyTitle: 'No reels yet',
    emptyBody: 'Create a study set and generate reels — they will show up here as a swipeable learning feed.',
    quizAfterSet: 'Take quiz',
  },

  library: {
    title: 'Library',
    studySetsSection: 'Study sets',
    sourcesSection: 'Imported sources',
    quizzesSection: 'Completed quizzes',
    emptySets: 'No study sets match your search.',
    emptySources: 'Sources you import appear here.',
    emptyQuizzes: 'Quizzes appear here after you take one.',
  },

  studySet: {
    reelsTab: 'Reels',
    sourcesTab: 'Sources',
    statusDraft: 'Draft — ready to generate',
    statusGenerating: 'Generating…',
    statusReady: 'Ready to watch',
    statusFailed: 'Generation failed',
    startGeneration: 'Start generation',
    phaseNote: 'Generation pipeline arrives in Phase 3–5. Configuration and sources are kept.',
    takeQuiz: 'Take quiz',
    noQuizYet: 'Quiz unlocks after generation completes.',
  },

  common: {
    cancel: 'Cancel',
    save: 'Save',
    retry: 'Retry',
    delete: 'Delete',
    custom: 'Custom',
    sec: 'sec',
    errorTitle: 'Something went wrong',
    comingSoon: 'Coming in a later phase',
    notAvailableTitle: 'Not available yet',
    notAvailableBody: 'This step of the on-device pipeline is implemented in an upcoming phase. Your configuration is saved.',
  },

  errors: {
    modelMissing: 'Required AI model is missing',
    generationFailed: 'Generation failed',
    unsupportedFile: 'Unsupported file type',
    storageUnavailable: 'Local storage unavailable',
  },
} as const;
