/**
 * withNewPlayer.js
 *
 * Expo config plugin that:
 * 1. Injects ':new-player' into the EAS-generated settings.gradle
 * 2. Injects the Kotlin Compose Compiler plugin classpath into root build.gradle
 *    (required for Kotlin 2.0+ when compose is enabled in a subproject)
 */

const { withSettingsGradle, withProjectBuildGradle } = require('@expo/config-plugins');

const SETTINGS_MARKER = '// [withNewPlayer] vendored local subproject';
const SETTINGS_INJECTION = `
${SETTINGS_MARKER}
include ':new-player'
project(':new-player').projectDir = new File(
    rootProject.projectDir,
    '../modules/mavin-player/android/new-player'
)
`;

const BUILD_MARKER = '// [withNewPlayer] compose compiler plugin';
const BUILD_INJECTION = `
${BUILD_MARKER}
        classpath('org.jetbrains.kotlin:kotlin-compose-compiler-plugin-embeddable:2.1.20')
`;

module.exports = function withNewPlayer(config) {
  // 1. Inject :new-player into settings.gradle
  config = withSettingsGradle(config, (config) => {
    if (!config.modResults.contents.includes(SETTINGS_MARKER)) {
      config.modResults.contents += SETTINGS_INJECTION;
    }
    return config;
  });

  // 2. Inject compose compiler classpath into root build.gradle
  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(BUILD_MARKER)) {
      return config;
    }
    // Insert after the last classpath line in the buildscript dependencies block
    config.modResults.contents = config.modResults.contents.replace(
      "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
      "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n" + BUILD_INJECTION
    );
    return config;
  });

  return config;
};