const { withSettingsGradle } = require('@expo/config-plugins');

module.exports = function withJitpack(config) {
  return withSettingsGradle(config, (config) => {
    if (!config.modResults.contents.includes('jitpack.io')) {
      config.modResults.contents += `
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven { url 'https://jitpack.io' }
    }
}
`;
    }
    return config;
  });
};