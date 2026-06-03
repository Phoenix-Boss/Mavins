const { withSettingsGradle } = require('@expo/config-plugins');

module.exports = function withNewPlayer(config) {
  return withSettingsGradle(config, (config) => {
    const injection = `
// NewPlayer vendored local module
include ':new-player'
project(':new-player').projectDir = new File(rootProject.projectDir, '../node_modules/mavin-player/android/new-player')
`;
    if (!config.modResults.contents.includes(':new-player')) {
      config.modResults.contents += injection;
    }
    return config;
  });
};