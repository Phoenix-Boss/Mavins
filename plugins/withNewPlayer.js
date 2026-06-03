const { withSettingsGradle } = require('@expo/config-plugins');

const SETTINGS_MARKER = '// [withNewPlayer] vendored local subproject';
const SETTINGS_INJECTION = `
${SETTINGS_MARKER}
include ':new-player'
project(':new-player').projectDir = new File(
    rootProject.projectDir,
    '../modules/mavin-player/android/new-player'
)
`;

const PLUGIN_MARKER = '// [withNewPlayer] compose compiler plugin resolution';

module.exports = function withNewPlayer(config) {
  config = withSettingsGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Inject into existing pluginManagement block
    if (!contents.includes(PLUGIN_MARKER)) {
      // Strategy: find "pluginManagement {" and insert a plugins block before its closing "}"
      const pmIndex = contents.indexOf('pluginManagement {');
      if (pmIndex !== -1) {
        // Find the matching closing brace
        let depth = 0;
        let closeIndex = -1;
        for (let i = pmIndex; i < contents.length; i++) {
          if (contents[i] === '{') depth++;
          else if (contents[i] === '}') {
            depth--;
            if (depth === 0) { closeIndex = i; break; }
          }
        }
        if (closeIndex !== -1) {
          const injection = `
    // [withNewPlayer] compose compiler plugin resolution
    plugins {
        id 'org.jetbrains.kotlin.plugin.compose' version '2.1.20'
    }
`;
          contents =
            contents.slice(0, closeIndex) +
            injection +
            contents.slice(closeIndex);
        }
      }
    }

    if (!contents.includes(SETTINGS_MARKER)) {
      contents += SETTINGS_INJECTION;
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};