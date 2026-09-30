import { Directory, File, Paths } from 'expo-file-system';

/**
 * Owns the on-device directory layout (spec §29):
 *
 *   <documents>/
 *     data/
 *       study-sets/ sources/ audio/ reels/ temp/ backgrounds/
 *
 * Uses real platform app-storage paths (never bundled project paths).
 */
export const dataDir = new Directory(Paths.document, 'data');

export const dirs = {
  studySets: new Directory(dataDir, 'study-sets'),
  sources: new Directory(dataDir, 'sources'),
  /** Rasterized PDF pages awaiting OCR (Phase 2 ingestion path). */
  pages: new Directory(dataDir, 'pages'),
  /** Cached extracted text per source (OCR is expensive — never run twice). */
  extracted: new Directory(dataDir, 'extracted'),
  audio: new Directory(dataDir, 'audio'),
  /** Word-level caption timing JSON (Phase 3), one file per reel. */
  captions: new Directory(dataDir, 'captions'),
  reels: new Directory(dataDir, 'reels'),
  temp: new Directory(dataDir, 'temp'),
  backgrounds: new Directory(dataDir, 'backgrounds'),
  models: new Directory(dataDir, 'models'),
} as const;

/** Ensure the whole data directory tree exists. Safe to call repeatedly. */
export function ensureDataDirectories(): void {
  if (!dataDir.exists) {
    dataDir.create({ intermediates: true, idempotent: true });
  }
  for (const dir of Object.values(dirs)) {
    if (!dir.exists) {
      dir.create({ idempotent: true });
    }
  }
}

export function uniqueName(base: string, extension: string): string {
  const safeBase = base.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60) || 'file';
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = extension ? `.${extension.replace(/^\./, '')}` : '';
  return `${safeBase}_${stamp}${rand}${ext}`;
}

/** Copy a picked file into app storage; returns the destination path. */
export function importFileToStorage(
  sourceUri: string,
  folder: Directory,
  originalName: string
): { path: string; sizeBytes: number | null } {
  const src = new File(sourceUri);
  const ext = originalName.includes('.') ? originalName.split('.').pop() ?? '' : '';
  const dest = new File(folder, uniqueName(originalName.replace(/\.[^.]+$/, ''), ext));
  src.copy(dest);
  return { path: dest.uri, sizeBytes: dest.exists ? dest.size : null };
}

/** Persist in-memory text (e.g. pasted study notes) into app storage. */
export function writeTextFile(
  folder: Directory,
  originalName: string,
  text: string
): { path: string; sizeBytes: number | null } {
  const dest = new File(folder, uniqueName(originalName.replace(/\.[^.]+$/, ''), 'txt'));
  dest.write(text);
  return { path: dest.uri, sizeBytes: dest.exists ? dest.size : null };
}

export function safeDelete(path: string | null | undefined): void {
  if (!path) return;
  try {
    const file = new File(path);
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup; never throw from cleanup helpers.
  }
}

export { Directory, File, Paths };
