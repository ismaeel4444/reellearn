/**
 * On-device OCR using ExecuTorch and PaddleOCR (PP-OCRv6) via Software Mansion's
 * react-native-executorch library.
 *
 * Decodes image file URIs into 3-channel RGB ImageBuffer (HWC, RGB) and passes them
 * to ExecuTorch's createPaddleOcr engine for state-of-the-art text and math recognition.
 */
import jpeg from 'jpeg-js';
import { decode, toRGBA8 } from 'upng-js';
import { File } from 'expo-file-system';
import {
  createPaddleOcr,
  download,
  models,
} from 'react-native-executorch';
import type { ExtractionResult } from './ingestion';

export interface OcrProgress {
  stage: 'loading' | 'detecting' | 'recognizing' | 'done';
  page?: number;
  total?: number;
}

interface ImageBuffer {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: 'rgb' | 'rgba' | 'bgr' | 'bgra' | 'gray';
  readonly layout: 'hwc';
}

let ocrRunnerPromise: Promise<any> | null = null;

/** Lazily download/load PaddleOCR PP-OCRv6 model via ExecuTorch. */
async function getOcrRunner(): Promise<any> {
  if (ocrRunnerPromise) return ocrRunnerPromise;

  ocrRunnerPromise = (async () => {
    // Prefer FP32 variant of DBNet text detector over INT8.
    // INT8 quantization on DBNet flattens text detection probabilities to a narrow band (~0.4),
    // causing missed text or solid-box false positives. FP32 provides full dynamic range.
    const ocrModelSpec =
      models.ocr.PADDLE.PPOCRV6_SMALL.XNNPACK_FP32 ??
      models.ocr.PADDLE.PPOCRV6_SMALL.DEFAULT;
    const model = await download(ocrModelSpec as any);
    return await createPaddleOcr(model as any);
  })();

  try {
    return await ocrRunnerPromise;
  } catch (err) {
    ocrRunnerPromise = null;
    throw err;
  }
}

/** 2x nearest-neighbor upscale for document pages below 1000px width so DBNet can resolve small text strokes. */
function upscaleRgb2x(data: Uint8Array, width: number, height: number): { data: Uint8Array; width: number; height: number } {
  const newW = width * 2;
  const newH = height * 2;
  const out = new Uint8Array(newW * newH * 3);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 3;
    const dstRow0 = (y * 2) * newW * 3;
    const dstRow1 = (y * 2 + 1) * newW * 3;
    for (let x = 0; x < width; x++) {
      const si = srcRow + x * 3;
      const r = data[si], g = data[si + 1], b = data[si + 2];
      const di0 = dstRow0 + x * 6;
      out[di0] = r; out[di0 + 1] = g; out[di0 + 2] = b;
      out[di0 + 3] = r; out[di0 + 4] = g; out[di0 + 5] = b;
      const di1 = dstRow1 + x * 6;
      out[di1] = r; out[di1 + 1] = g; out[di1 + 2] = b;
      out[di1 + 3] = r; out[di1 + 4] = g; out[di1 + 5] = b;
    }
  }
  return { data: out, width: newW, height: newH };
}

/** Decode image URI to ImageBuffer required by ExecuTorch CV tasks. */
async function readImageBuffer(uri: string): Promise<ImageBuffer> {
  const file = new File(uri);
  if (!file.exists) throw new Error(`OCR input file not found: ${uri}`);

  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch {
    bytes = base64ToBytes(await file.base64());
  }

  try {
    // Decode JPEG into 3-channel RGB.
    const img = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      maxMemoryUsageInMB: 1024,
    });
    let minP = 255, maxP = 0, sumP = 0;
    const len = img.data.length;
    for (let i = 0; i < len; i += 3) {
      const v = img.data[i];
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
      sumP += v;
    }
    const avgP = Number((sumP / (len / 3)).toFixed(1));
    console.log(`[OCR] Decoded JPEG image: ${img.width}x${img.height} (min=${minP}, max=${maxP}, avg=${avgP})`);

    let finalData: Uint8Array = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    let finalWidth = img.width;
    let finalHeight = img.height;

    // If page resolution is small (e.g. 72 DPI PDF thumbnails: 612x792),
    // upscale 2x to 1224x1584 so DBNet detector and recognizer get sharp character contours.
    if (finalWidth < 1000) {
      const upscaled = upscaleRgb2x(finalData, finalWidth, finalHeight);
      finalData = upscaled.data;
      finalWidth = upscaled.width;
      finalHeight = upscaled.height;
      console.log(`[OCR] Upscaled low-res page 2x -> ${finalWidth}x${finalHeight}`);
    }

    return {
      data: finalData,
      width: finalWidth,
      height: finalHeight,
      format: 'rgb',
      layout: 'hwc',
    };
  } catch (jpegErr) {
    const png = decode(bytes.buffer as ArrayBuffer);
    if (!png || !(png.width > 0)) {
      throw new Error(`Unsupported image format (need JPEG or PNG): ${uri}`);
    }
    const frames = toRGBA8(png) as ArrayBuffer[];
    if (!frames || frames.length === 0) {
      throw new Error(`PNG decode produced no frame: ${uri}`);
    }
    const rgbaData = new Uint8Array(frames[0]);
    console.log(`[OCR] Decoded PNG image: ${png.width}x${png.height} (${rgbaData.length} bytes, format=rgba)`);
    return {
      data: rgbaData,
      width: png.width,
      height: png.height,
      format: 'rgba',
      layout: 'hwc',
    };
  }
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length / 4) * 3));
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | BASE64_CHARS.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Read one or more page images (file:// URIs) and return extracted text via PP-OCRv6. */
export async function ocrPages(
  pageUris: string[],
  onProgress?: (progress: OcrProgress) => void
): Promise<ExtractionResult> {
  if (pageUris.length === 0) {
    return { chars: null, text: null, status: 'pending' };
  }

  onProgress?.({ stage: 'loading' });

  try {
    const ocr = await getOcrRunner();
    const pageTexts: string[] = [];

    for (let i = 0; i < pageUris.length; i++) {
      onProgress?.({ stage: 'recognizing', page: i + 1, total: pageUris.length });
      const uri = pageUris[i];
      try {
        const imageBuffer = await readImageBuffer(uri);
        const tStart = Date.now();
        const textDetections = await ocr.recognizeCharacters(imageBuffer, {
          confidenceThreshold: 0.1,
        });
        const tElapsed = Date.now() - tStart;

        console.log(`[OCR] Page ${i + 1} (${imageBuffer.width}x${imageBuffer.height}): ${textDetections?.length ?? 0} detections in ${tElapsed}ms`);

        if (Array.isArray(textDetections) && textDetections.length > 0) {
          console.log(`[OCR] Page ${i + 1} sample text: "${textDetections[0]?.text}"`);
          const linesText = textDetections
            .map((det: any) => (typeof det === 'string' ? det : det.text ?? ''))
            .filter((t: string) => t.trim().length > 0)
            .join('\n');
          pageTexts.push(linesText);
        }
      } catch (pageErr) {
        console.warn(`[OCR] Failed ExecuTorch OCR on page ${i + 1}:`, pageErr);
      }
    }

    const text = pageTexts
      .filter((t) => t.length > 0)
      .join('\n\n')
      .trim();

    console.log('[OCR] Total extracted text length:', text.length);

    onProgress?.({ stage: 'done' });
    if (text.length === 0) {
      return { chars: null, text: null, status: 'pending' };
    }

    return { chars: text.length, text, status: 'extracted' };
  } catch (err) {
    console.warn('[OCR] ExecuTorch PaddleOCR failed:', err);
    return { chars: null, text: null, status: 'pending' };
  }
}

/** Cleanup ExecuTorch runner cache. */
export function releaseOcrSessions(): void {
  ocrRunnerPromise = null;
}
