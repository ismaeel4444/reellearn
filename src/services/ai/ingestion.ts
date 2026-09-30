/**
 * Phase 2 ingestion: extract readable text from imported sources.
 *
 * TXT/MD  → read directly from app storage.
 * DOCX    → OOXML unzip (fflate) + <w:t> run concatenation.
 * PDF     → honest unsupported note (layout-aware extraction + Qwen context
 *           wiring lands with the Phase 3 pipeline; see strings.phaseNote).
 * Image   → OCR arrives with the on-device runtime (det model is bundled);
 *           sources are stored now so the pipeline can process them later.
 * Pasted  → stored as kind 'pasted_text'.
 *
 * Everything runs on-device; no network calls (spec §9, §30).
 */
import { unzipSync, strFromU8 } from 'fflate';
import { File } from 'expo-file-system';

import type { SourceKind } from '@/models/types';
import { dirs } from '@/services/storage/file-system';
import { renderPdfPages, safeDeletePages } from './pdf-pages';
import { ocrPages } from './ocr';
import type { OcrProgress } from './ocr';

/**
 * Cached extracted-text storage, keyed per source id (dirs.extracted).
 * OCR is far too expensive to run twice: every PDF/image extraction result is
 * persisted once and reused by every pipeline run, resume, and quiz regen.
 */
export function extractedTextPath(sourceId: string): string {
  return `${dirs.extracted.uri}/${sourceId}.txt`;
}

export function hasExtractedText(sourceId: string): boolean {
  try {
    return new File(extractedTextPath(sourceId)).exists;
  } catch {
    return false;
  }
}

export async function readExtractedText(sourceId: string): Promise<string | null> {
  try {
    const file = new File(extractedTextPath(sourceId));
    if (!file.exists) return null;
    const txt = (await file.text()).trim();
    return txt || null;
  } catch {
    return null;
  }
}

export function writeExtractedText(sourceId: string, text: string): void {
  new File(dirs.extracted, `${sourceId}.txt`).write(text);
}

/** Remove a source's cached extraction (called when the source is deleted). */
export function deleteExtractedText(sourceId: string): void {
  try {
    const file = new File(extractedTextPath(sourceId));
    if (file.exists) file.delete();
  } catch (err) {
    console.warn('[ingest] deleteExtractedText failed', err);
  }
}

/** Copy a cached extraction when a source is reused for a new study set. */
export async function copyExtractedText(fromSourceId: string, toSourceId: string): Promise<boolean> {
  try {
    const existing = await readExtractedText(fromSourceId);
    if (!existing) return false;
    writeExtractedText(toSourceId, existing);
    return true;
  } catch (err) {
    console.warn('[ingest] copyExtractedText failed', err);
    return false;
  }
}

export interface ExtractionResult {
  /** Number of extracted text characters (null when extraction is pending/unsupported). */
  chars: number | null;
  /** Plain-text content when extraction succeeded; null otherwise. */
  text: string | null;
  /** Human-readable status for UI badges. */
  status: 'extracted' | 'pending' | 'unsupported';
}

const TEXT_READ_LIMIT = 2_000_000; // 2 MB safety cap for text files.

/** Entry point used by the Create flow after a source lands in storage. */
export async function extractSourceText(
  localPath: string | null,
  kind: SourceKind,
  pastedText?: string,
  onProgress?: (progress: OcrProgress) => void
): Promise<ExtractionResult> {
  if (kind === 'pasted_text') {
    const text = (pastedText ?? '').trim();
    return text.length > 0
      ? { chars: text.length, text, status: 'extracted' }
      : { chars: null, text: null, status: 'pending' };
  }

  if (!localPath) {
    return { chars: null, text: null, status: 'pending' };
  }

  try {
    switch (kind) {
      case 'txt': {
        const file = new File(localPath);
        if (!file.exists) return pending();
        const raw = await file.text();
        const text = cleanText(raw.slice(0, TEXT_READ_LIMIT));
        return ok(text);
      }
      case 'docx':
        return await extractDocx(localPath);
      case 'doc':
        // Legacy binary .doc needs a different parser; treat as pending.
        return pending();
      case 'pdf': {
        // PDFs go through OCR by design (spec: PaddleOCR is bundled for
        // scanned notes and image-heavy pages): rasterize pages, then the
        // ONNX pipeline reads them (det → crop → rec).
        const { pages, pendingRuntime } = await renderPdfPages(localPath);
        if (pages.length > 0) {
          try {
            return await ocrPages(pages, onProgress);
          } finally {
            safeDeletePages(pages);
          }
        }
        if (pendingRuntime) {
          return {
            chars: null,
            text: null,
            status: 'pending',
          };
        }
        return pending();
      }
      case 'image': {
        // OCR (det → crop → rec) via the on-device ONNX runtime.
        try {
          return await ocrPages([localPath], onProgress);
        } finally {
          // ocrPages copies into temp buffers; never delete the stored source.
        }
      }
      default:
        return pending();
    }
  } catch (err) {
    console.warn('[ingest] extraction failed', kind, err);
    return { chars: null, text: null, status: 'pending' };
  }
}

// --- DOCX ---------------------------------------------------------------------

/**
 * Minimal OOXML text extraction: unzip, read word/document.xml, concatenate
 * <w:t> runs, treating paragraph boundaries as newlines. No external native
 * dependency — runs on the JS thread (files are bounded by TEXT_READ_LIMIT).
 */
async function extractDocx(localPath: string): Promise<ExtractionResult> {
  const file = new File(localPath);
  if (!file.exists) return pending();

  const res = await fetch(localPath);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, {
    filter: (f) => f.name === 'word/document.xml',
  });
  const xml = files['word/document.xml'];
  if (!xml) return pending();

  const document = strFromU8(xml);
  const text = docxXmlToText(document);
  return text.length > 0 ? ok(text) : pending();
}

/** Concatenate <w:t> content; <w:p> boundaries become newlines, tabs stay tabs. */
export function docxXmlToText(xml: string): string {
  let out = '';
  const tagRe = /<\/?w:(p|tab|br)\b[^>]*>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    if (match[0].startsWith('<w:t')) {
      out += decodeXmlEntities(match[2] ?? '');
    } else if (match[0].startsWith('</w:p')) {
      out += '\n';
    } else if (match[0].startsWith('<w:tab')) {
      out += '\t';
    } else if (match[0].startsWith('<w:br')) {
      out += '\n';
    }
  }
  return cleanText(out);
}

// --- helpers --------------------------------------------------------------------

function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function ok(text: string): ExtractionResult {
  return { chars: text.length, text, status: 'extracted' };
}

function pending(): ExtractionResult {
  return { chars: null, text: null, status: 'pending' };
}
