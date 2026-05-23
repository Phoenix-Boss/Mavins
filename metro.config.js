const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Watch local modules so Metro picks up changes without a rebuild
config.watchFolders = [
  path.resolve(__dirname, "modules/pawns"),
];

// Ensure TypeScript extensions are recognized
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  "ts",
  "tsx",
  "d.ts",
];

module.exports = config;