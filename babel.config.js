module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-video-pipeline: build-time check that drawFrame callbacks
      // carry the 'worklet' directive (compose path). We only use native
      // overlay paths today, but the plugin is required by the package.
      'babel-plugin-video-pipeline',
      'react-native-worklets/plugin',
    ],
  };
};
