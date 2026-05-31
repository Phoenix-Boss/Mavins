// plugins/withExcludeDependencies.js
//
// Injects a `configurations.all { exclude ... }` block into android/app/build.gradle.
// This is needed because expo-build-properties does not support dependency exclusions.
//
// EAS managed workflow generates android/ on the build server — this plugin is the
// only way to modify app/build.gradle without committing an android/ folder.

const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ excludes: Array<{ group: string, module?: string }> }} options
 */
const withExcludeDependencies = (config, { excludes = [] } = {}) => {
  return withAppBuildGradle(config, (mod) => {
    if (!excludes.length) return mod;

    const exclusionLines = excludes
      .map(({ group, module: moduleName }) =>
        moduleName
          ? `    exclude group: "${group}", module: "${moduleName}"`
          : `    exclude group: "${group}"`
      )
      .join("\n");

    const exclusionBlock = `\nconfigurations.all {\n${exclusionLines}\n}\n`;

    let contents = mod.modResults.contents;

    // Avoid double-injection on repeated prebuild runs
    if (contents.includes("configurations.all")) {
      return mod;
    }

    // Insert before the `android {` block
    mod.modResults.contents = contents.replace(
      /^(android\s*\{)/m,
      `${exclusionBlock}$1`
    );

    return mod;
  });
};

module.exports = withExcludeDependencies;