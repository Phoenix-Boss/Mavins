const { withSettingsGradle } = require('@expo/config-plugins');

module.exports = function withJitpack(config) {
  return withSettingsGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes('jitpack.io')) {
      return config;
    }

    if (contents.includes('dependencyResolutionManagement')) {
      contents = contents.replace(
        /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/,
        "$1\n        maven { url 'https://jitpack.io' }"
      );
    } else {
      contents += `
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

    config.modResults.contents = contents;
    return config;
  });
};