const { withAppBuildGradle } = require("expo/config-plugins");

const withAbiSplit = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      config.modResults.contents = addAbiSplit(config.modResults.contents);
    }
    return config;
  });
};

function addAbiSplit(buildGradle) {
  const abiSplitBlock = `    splits {
        abi {
            enable true
            reset()
            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
            universalApk true
        }
    }`;

  if (buildGradle.includes(abiSplitBlock)) {
    return buildGradle;
  }

  return buildGradle.replace(
    /android\s*{/,
    `android {\n${abiSplitBlock}`
  );
}

// ✅ SINGLE module.exports
module.exports = withAbiSplit;
