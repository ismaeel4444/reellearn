const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Local AI models + background videos are bundled assets (manually provided,
// never downloaded at runtime). Register their extensions so `require()` works.
config.resolver.assetExts.push('gguf', 'onnx', 'bin', 'yml');

module.exports = config;
