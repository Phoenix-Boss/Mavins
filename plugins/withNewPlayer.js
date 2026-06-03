/**
 * withNewPlayer.js
 *
 * Expo config plugin that:
 * 1. Injects ':new-player' into the EAS-generated settings.gradle
 * 2. Injects pluginManagement resolution for org.jetbrains.kotlin.plugin.compose
 *    into settings.gradle (required for Kotlin 2.0+ subprojects using Compose)
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

const PLUGIN_MGMT_MARKER = '// [withNewPlayer] compose compiler plugin resolution';
const PLUGIN_MGMT_INJECTION = `
${PLUGIN_MGMT_MARKER}
pluginManagement {
    plugins {
        id 'org.jetbrains.kotlin.plugin.compose' version '2.1.20'
    }
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
`;

module.exports = function withNewPlayer(config) {
  // 1. Inject :new-player include + pluginManagement into settings.gradle
  config = withSettingsGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Inject pluginManagement at the very top (must come before any other content)
    if (!contents.includes(PLUGIN_MGMT_MARKER)) {
      contents = PLUGIN_MGMT_INJECTION + '\n' + contents;
    }

    // Inject :new-player include at the bottom
    if (!contents.includes(SETTINGS_MARKER)) {
      contents += SETTINGS_INJECTION;
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};