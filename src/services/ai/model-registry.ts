import { Asset } from 'expo-asset';
import { Directory, File } from 'expo-file-system';

import { dirs } from '@/services/storage/file-system';

/**
 * Registry of locally provided AI models (spec §9, §10, §16, §30).
 *
 * Models are bundled via metro asset `require()` calls and are MANUALLY
 * provided by the developer. This module never downloads anything.
 *
 * Native runtimes (llama.rn, Executorch/ONNX for TTS & OCR) need real filesystem paths,
 * so bundled assets are copied into app storage once and reused.
 */
export const bundledModels = {
  qwen: {
    id: 'qwen3.5-0.8b-q8',
    label: 'Qwen3.5-0.8B (Q8_0 GGUF)',
    fileName: 'Qwen3.5-0.8B-Q8_0.gguf',
    required: true,
    source: require('../../../models/llm/Qwen3.5-0.8B-Q8_0.gguf'),
  },
  kokoroModel: {
    id: 'kokoro-82m-q8f16',
    label: 'Kokoro-82M v1.0 ONNX (q8f16)',
    fileName: 'model_q8f16.onnx',
    required: true,
    source: require('../../../models/tts/model_q8f16.onnx'),
  },
  kokoroVoices: {
    id: 'kokoro-voices-v1',
    label: 'Kokoro voice pack (af.bin)',
    fileName: 'af.bin',
    required: true,
    source: require('../../../models/tts/af.bin'),
  },
  ocrRecognition: {
    id: 'paddle-ocrv5-mobile-rec',
    label: 'PaddleOCR latin_PP-OCRv5_mobile_rec',
    fileName: 'inference.onnx',
    required: false,
    source: require('../../../models/ocr/inference.onnx'),
  },
  ocrDetection: {
    id: 'paddle-ocrv5-mobile-det',
    label: 'PaddleOCR PP-OCRv5 mobile det',
    fileName: 'ppocrv5_det.onnx',
    required: false,
    source: require('../../../models/ocr/ppocrv5_det.onnx'),
  },
  ocrDict: {
    id: 'paddle-ocrv5-rec-dict',
    label: 'PaddleOCR character dictionary (inference.yml)',
    fileName: 'inference.yml',
    required: false,
    source: require('../../../models/ocr/inference (1).yml'),
  },
} as const;

export type BundledModelKey = keyof typeof bundledModels;

/** Model files staged under <documents>/data/models/<subdir>/<fileName>. */
export function modelDestPath(key: BundledModelKey): string {
  const subdir =
    key === 'qwen'
      ? 'qwen'
      : key === 'kokoroModel' || key === 'kokoroVoices'
        ? 'kokoro'
        : 'paddleocr';
  const dir = new Directory(dirs.models, subdir);
  return new File(dir, bundledModels[key].fileName).uri;
}

/**
 * Resolve a bundled model to a real on-device file path. Copies the metro
 * asset into app storage on first use; subsequent calls are a no-op when the
 * copy already matches the expected size.
 */
export async function ensureModelFile(key: BundledModelKey): Promise<string> {
  const entry = bundledModels[key];
  const [asset] = await Asset.loadAsync(entry.source);
  if (!asset) {
    throw new Error(`Bundled model asset failed to resolve: ${entry.label}`);
  }
  await asset.downloadAsync();

  const dest = new File(modelDestPath(key));
  const expectedSize = (asset as unknown as { size?: number | null }).size ?? null;
  const alreadyStaged = dest.exists && expectedSize != null && dest.size === expectedSize;
  if (alreadyStaged) {
    return dest.uri;
  }

  const parent = new Directory(dest.uri.replace(/\/[^/]+$/, ''));
  if (!parent.exists) {
    parent.create({ intermediates: true, idempotent: true });
  }

  // asset.uri can be a metro http:// or asset:/// URI (dev builds, unbundled
  // assets) — expo-file-system File operations require a real file:// path.
  // In that case download the bytes into app storage instead of copying.
  const srcUri = asset.localUri ?? asset.uri;
  console.log(
    `[models] staging ${entry.label}: src=${srcUri.split('?')[0]} (${srcUri.split(':')[0]}://), dest=${dest.uri}, expectedSize=${expectedSize ?? 'unknown'}`
  );
  try {
    if (srcUri.startsWith('file://')) {
      const src = new File(srcUri);
      if (!src.exists) {
        throw new Error(`Bundled model asset is not readable: ${entry.label} (src missing at ${srcUri})`);
      }
      console.log(`[models] copying ${entry.label}: ${src.size} bytes → ${dest.uri}`);
      await src.copy(dest, { overwrite: true });
    } else {
      // idempotent: overwrite any partial file left by an earlier failed run
      await File.downloadFileAsync(asset.uri, dest, { idempotent: true });
    }
  } catch (err) {
    console.error(`[models] staging FAILED for ${entry.label}:`, err);
    throw new Error(
      `Failed to stage bundled model asset: ${entry.label} — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!dest.exists) {
    throw new Error(
      `Failed to stage bundled model asset: ${entry.label} — destination missing after copy/download at ${dest.uri}`
  );
  }
  console.log(`[models] staged ${entry.label}: ${dest.size} bytes at ${dest.uri}`);
  if (expectedSize != null && dest.size !== expectedSize) {
    console.error(`[models] SIZE MISMATCH for ${entry.label}: expected ${expectedSize}, on disk ${dest.size} — file is truncated/corrupt, deleting so it re-stages next run`);
    dest.delete();
    throw new Error(`Staged model size mismatch for ${entry.label}: expected ${expectedSize} bytes, got ${dest.size} — rerun to re-stage`);
  }
  return dest.uri;
}

function bundledModelsKeys(id: string): BundledModelKey {
  return (Object.keys(bundledModels) as BundledModelKey[]).find(
    (k) => bundledModels[k].id === id
  ) as BundledModelKey;
}

export class ModelMissingError extends Error {
  constructor(modelLabel: string) {
    super(`Required AI model is missing or failed to load: ${modelLabel}`);
    this.name = 'ModelMissingError';
  }
}
