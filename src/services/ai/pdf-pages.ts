/**
 * PDF ingestion (Phase 2): rasterize PDF pages to images so the OCR pipeline
 * can read them. This is the path that makes PaddleOCR useful for PDFs —
 * scanned notes and image-heavy pages have no text layer to parse.
 *
 * react-native-pdf-thumbnail is a native module: requiring it at module scope
 * in a dev client that predates the package crashes the app (same failure
 * mode as gradients), so it is resolved defensively and the caller receives
 * an honest 'pending' result until the dev client is rebuilt.
 */
import { Directory, File } from 'expo-file-system';

import { dirs, ensureDataDirectories, uniqueName } from '@/services/storage/file-system';

interface PdfThumbnailStatic {
  generate(filePath: string, page: number, quality?: number): Promise<{ uri: string; width: number; height: number }>;
  generateAllPages(filePath: string, quality?: number): Promise<{ uri: string; width: number; height: number }[]>;
}

let cached: PdfThumbnailStatic | null | undefined;

function pdfThumbnail(): PdfThumbnailStatic | null {
  if (cached !== undefined) return cached;
  try {
    const mod = require('react-native-pdf-thumbnail');
    cached = (mod?.default ?? mod) as PdfThumbnailStatic;
  } catch {
    cached = null; // Native module not in this binary yet.
  }
  return cached;
}

export interface PdfPageResult {
  /** Rasterized page image paths (file:// URIs), in page order. */
  pages: string[];
  /** True when the native rasterizer is unavailable (needs dev-client rebuild). */
  pendingRuntime: boolean;
}

/**
 * Render every page of a stored PDF into data/pages/ as JPEG images.
 * Kept to a bounded page count so a 300-page PDF cannot stall ingestion.
 */
export async function renderPdfPages(
  pdfPath: string,
  maxPages = 20,
  quality = 90
): Promise<PdfPageResult> {
  const PdfThumbnail = pdfThumbnail();
  if (!PdfThumbnail) {
    return { pages: [], pendingRuntime: true };
  }

  ensureDataDirectories();
  const results = await PdfThumbnail.generateAllPages(pdfPath, quality);

  const pages: string[] = [];
  const tempDir = new Directory(dirs.pages);
  if (!tempDir.exists) tempDir.create({ idempotent: true });

  for (const page of results.slice(0, maxPages)) {
    if (!page.uri.startsWith('file://')) continue;
    // Move into our owned storage so lifecycle follows the source file.
    const dest = new File(dirs.pages, uniqueName('pdf-page', 'jpg'));
    try {
      new File(page.uri).copy(dest);
      pages.push(dest.uri);
    } catch {
      // Keep the original URI if the move fails; OCR only needs a readable path.
      pages.push(page.uri);
    }
  }

  return { pages, pendingRuntime: false };
}

/** Delete rasterized pages that belong to a removed source. */
export function safeDeletePages(paths: string[]): void {
  for (const p of paths) {
    try {
      const f = new File(p);
      if (f.exists) f.delete();
    } catch {
      // best-effort
    }
  }
}
