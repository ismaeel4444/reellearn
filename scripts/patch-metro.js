const fs = require('fs');
const path = require('path');

/**
 * Postinstall patches for third-party packages that fail under the current
 * toolchain or need behavior fixes. Each patch is idempotent.
 */
function patchMetroLargeAssets() {
  const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    '@expo',
    'metro-config',
    'build',
    'transform-worker',
    'metro-transform-worker.js'
  );

  if (!fs.existsSync(targetFile)) {
    console.log('[patch] metro-transform-worker.js not found, skipping.');
    return;
  }

  let content = fs.readFileSync(targetFile, 'utf8');

  // Fix V8 512MB string length error on large binary assets (e.g. AI models)
  const buggyPattern = `async function transform(config, projectRoot, filename, data, options) {
    const context = {
        config,
        projectRoot,
        options,
    };
    const sourceCode = data.toString('utf8');`;

  const fixReplacement = `async function transform(config, projectRoot, filename, data, options) {
    const context = {
        config,
        projectRoot,
        options,
    };
    if (options.type === 'asset') {
        const file = {
            filename,
            inputFileSize: data.length,
            code: '',
            type: options.type,
        };
        return transformAsset(file, context);
    }
    const sourceCode = data.toString('utf8');`;

  if (content.includes(buggyPattern)) {
    content = content.replace(buggyPattern, fixReplacement);
    // Also remove the redundant later check if still present
    const redundantCheck = `    if (options.type === 'asset') {
        const file = {
            filename,
            inputFileSize: data.length,
            code: sourceCode,
            type: options.type,
        };
        return transformAsset(file, context);
    }
`;
    content = content.replace(redundantCheck, '');

    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch] Successfully patched metro-transform-worker.js to handle large assets.');
  } else {
    console.log('[patch] Metro already patched or pattern not found.');
  }
}

/**
 * react-native-pdf-thumbnail 1.3.1 fails to compile under Kotlin 2.x
 * (RN 0.86): `bitmap.config` is a nullable Bitmap.Config? but
 * Bitmap.createBitmap requires a non-null config.
 */
function patchPdfThumbnailKotlin() {
  const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-pdf-thumbnail',
    'android',
    'src',
    'main',
    'java',
    'org',
    'songsterq',
    'pdfthumbnail',
    'PdfThumbnailModule.kt'
  );

  if (!fs.existsSync(targetFile)) {
    console.log('[patch] PdfThumbnailModule.kt not found, skipping.');
    return;
  }

  const content = fs.readFileSync(targetFile, 'utf8');
  const buggy = 'val bitmapWhiteBG = Bitmap.createBitmap(bitmap.width, bitmap.height, bitmap.config)';
  const fixed = 'val bitmapWhiteBG = Bitmap.createBitmap(bitmap.width, bitmap.height, bitmap.config ?: Bitmap.Config.ARGB_8888)';

  if (content.includes(buggy)) {
    fs.writeFileSync(targetFile, content.replace(buggy, fixed), 'utf8');
    console.log('[patch] Patched PdfThumbnailModule.kt for Kotlin null-safety.');
  } else {
    console.log('[patch] PdfThumbnailModule.kt already patched or pattern not found.');
  }
}

/**
 * react-native-pdf-thumbnail declares Gradle namespace `com.pdfthumbnail`
 * while its classes live in `org.songsterq.pdfthumbnail`, so Expo
 * autolinking generates an import for a class that does not exist
 * (PackageList.java: cannot find symbol PdfThumbnailPackage).
 */
function patchPdfThumbnailNamespace() {
  const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-pdf-thumbnail',
    'android',
    'build.gradle'
  );

  if (!fs.existsSync(targetFile)) {
    console.log('[patch] pdf-thumbnail build.gradle not found, skipping.');
    return;
  }

  const content = fs.readFileSync(targetFile, 'utf8');
  if (content.includes('namespace "com.pdfthumbnail"')) {
    fs.writeFileSync(
      targetFile,
      content.replace('namespace "com.pdfthumbnail"', 'namespace "org.songsterq.pdfthumbnail"'),
      'utf8'
    );
    console.log('[patch] Fixed pdf-thumbnail Gradle namespace for autolinking.');
  } else {
    console.log('[patch] pdf-thumbnail namespace already patched or pattern not found.');
  }
}
function patchExecuTorchSha256() {
  const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-executorch',
    'scripts',
    'download-libs.js'
  );

  if (!fs.existsSync(targetFile)) return;

  const content = fs.readFileSync(targetFile, 'utf8');
  const buggy = 'const result = execSync(`sha256sum "${filePath}" || shasum -a 256 "${filePath}"`);\n  return result.toString().split(\' \')[0].trim();';
  const fixed = 'const crypto = require(\'crypto\');\n  const fileBuffer = fs.readFileSync(filePath);\n  return crypto.createHash(\'sha256\').update(fileBuffer).digest(\'hex\').trim();';

  if (content.includes(buggy)) {
    fs.writeFileSync(targetFile, content.replace(buggy, fixed), 'utf8');
    console.log('[patch] Fixed download-libs.js sha256 for Windows.');
  }
}

/**
 * react-native-video-pipeline 0.5.1 is compiled against media3 1.5.1, where
 * `OverlaySettings` (media3-effect) existed. expo-video (SDK 57) pins media3
 * 1.9.0, which RENAMED it to `StaticOverlaySettings` (same builder API). With
 * media3 1.9.0 on the classpath the pipeline crashes with
 * NoClassDefFoundError: OverlaySettings$Builder at export time. Rename the
 * usages so the library compiles against expo-video's media3.
 */
function patchVideoPipelineOverlaySettings() {
  const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-video-pipeline',
    'android',
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'videopipeline',
    'TransformerRunner.kt'
  );

  if (!fs.existsSync(targetFile)) {
    console.log('[patch] TransformerRunner.kt not found, skipping.');
    return;
  }

  let content = fs.readFileSync(targetFile, 'utf8');
  if (!content.includes('androidx.media3.effect.OverlaySettings')) {
    console.log('[patch] video-pipeline already patched (no OverlaySettings import).');
    return;
  }
  content = content.replace(
    'import androidx.media3.effect.OverlaySettings',
    'import androidx.media3.effect.StaticOverlaySettings'
  );
  content = content.split('OverlaySettings').join('StaticOverlaySettings');
  // restore the override method name (unchanged in media3 1.9)
  content = content.replace(/fun getStaticOverlaySettings\(/g, 'fun getOverlaySettings(');
  // guard against the naive-split double-prefix on re-runs
  content = content.split('StaticStaticOverlaySettings').join('StaticOverlaySettings');
  // media3 1.6+ moved VideoCompositorSettings from transformer -> common
  content = content.replace(
    'import androidx.media3.effect.VideoCompositorSettings
',
    'import androidx.media3.common.VideoCompositorSettings\n'
  );
  // OverlayShaderProgram caps each OverlayEffect at 15 SDR overlays; chunk
  // textureOverlays into groups of <=15 (long caption tracks use one overlay
  // per word and blow past the limit otherwise).
  content = content.replace(
    '      val textureOverlays = spec.overlays.map { buildOverlay(it, canvasW, canvasH) }\n' +
      '      effects.add(OverlayEffect(ArrayList<TextureOverlay>(textureOverlays)))',
    '      val textureOverlays = spec.overlays.map { buildOverlay(it, canvasW, canvasH) }\n' +
      '      // OverlayShaderProgram caps each OverlayEffect at 15 SDR overlays; chunk\n' +
      "      // so long caption tracks (one overlay per word) don't exceed the limit.\n" +
      '      textureOverlays.chunked(15).forEach { chunk ->\n' +
      '        effects.add(OverlayEffect(ArrayList<TextureOverlay>(chunk)))\n' +
      '      }'
  );
  content = content.replace(
    '    val textureOverlays = overlays.map { buildOverlay(it, w, h) }\n' +
    '    return Effects(emptyList(), listOf(OverlayEffect(ArrayList<TextureOverlay>(textureOverlays))))',
    '    val textureOverlays = overlays.map { buildOverlay(it, w, h) }\n' +
    '    // Chunk to respect the 15-overlays-per-OverlayEffect limit (see above).\n' +
    '    val overlayEffects = textureOverlays.chunked(15).map { chunk -> OverlayEffect(ArrayList<TextureOverlay>(chunk)) }\n' +
    '    return Effects(emptyList(), overlayEffects)'
  );
  fs.writeFileSync(targetFile, content, 'utf8');

  // Align the library's own compile classpath with expo-video's media3.
  const gradleFile = path.join(__dirname, '..', 'node_modules', 'react-native-video-pipeline', 'android', 'build.gradle');
  if (fs.existsSync(gradleFile)) {
    let gradle = fs.readFileSync(gradleFile, 'utf8');
    const before = 'def media3Version = getExtOrDefault("media3Version", "1.5.1")';
    const after = 'def media3Version = getExtOrDefault("media3Version", "1.9.0")';
    if (gradle.includes(before)) {
      fs.writeFileSync(gradleFile, gradle.replace(before, after), 'utf8');
      console.log('[patch] video-pipeline media3Version default -> 1.9.0.');
    }
  }
  console.log('[patch] Patched video-pipeline: StaticOverlaySettings + overlay chunking (media3 1.9).');
}

patchMetroLargeAssets();
patchPdfThumbnailKotlin();
patchPdfThumbnailNamespace();
patchExecuTorchSha256();
patchVideoPipelineOverlaySettings();
