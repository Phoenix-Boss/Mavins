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

const BUILD_MARKER = '// [withNewPlayer] compose compiler classpath';

module.exports = function withNewPlayer(config) {
  config = withSettingsGradle(config, (config) => {
    if (!config.modResults.contents.includes(SETTINGS_MARKER)) {
      config.modResults.contents += SETTINGS_INJECTION;
    }
    return config;
  });

  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(BUILD_MARKER)) {
      return config;
    }

    const contents = config.modResults.contents;
    const buildscriptIndex = contents.indexOf('buildscript {');
    if (buildscriptIndex === -1) return config;

    const depsIndex = contents.indexOf('dependencies {', buildscriptIndex);
    if (depsIndex === -1) return config;

    let depth = 0;
    let closeIndex = -1;
    for (let i = depsIndex; i < contents.length; i++) {
      if (contents[i] === '{') depth++;
      else if (contents[i] === '}') {
        depth--;
        if (depth === 0) { closeIndex = i; break; }
      }
    }

    if (closeIndex === -1) return config;

    const injection = `        ${BUILD_MARKER}
        classpath('org.jetbrains.kotlin.plugin.compose:org.jetbrains.kotlin.plugin.compose.gradle.plugin:2.1.20')
`;
    config.modResults.contents =
      contents.slice(0, closeIndex) +
      injection +
      contents.slice(closeIndex);

    return config;
  });

  return config;
};