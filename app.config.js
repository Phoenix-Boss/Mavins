// app.config.js
const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");
module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "mexexiy-1",
  slug: "mexexiy",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "403f8812-42f9-4386-9930-c647c6002b5c",
    },
  },
  platforms: ["android"],
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: IS_DEV ? "mavins-player-dev" : "mavins-player",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  android: {
    softwareKeyboardLayoutMode: "pan",
    permissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.MANAGE_EXTERNAL_STORAGE",
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.WAKE_LOCK",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      // Required by DynamicsProcessing (mavin-eq) to attach to the
      // TrackPlayer audio session. Without this the EQ silently does nothing.
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ],
    usesCleartextTraffic: true,
    icon: "./assets/images/icon.png",
    package: IS_DEV ? "com.mavins.player.dev" : "com.mavins.player",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon-foreground.png",
      backgroundImage: "./assets/images/adaptive-icon-background.png",
      monochromeImage: "./assets/images/adaptive-icon-monochrome.png",
    },
    backgroundColor: "#000",
    edgeToEdgeEnabled: true,
    versionCode: 1,
    intentFilters: [
      {
        action: "android.intent.action.MAIN",
        category: ["android.intent.category.LAUNCHER"],
      },
      {
        action: "android.intent.action.VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "mavins-player",
            host: "player",
            pathPrefix: "/open",
          },
        ],
        category: [
          "android.intent.category.DEFAULT",
          "android.intent.category.BROWSABLE",
        ],
      },
    ],
  },
  plugins: [
    withAbiSplit,
    withIconXml,
    "expo-router",
    "expo-font",
    [
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#000",
      },
    ],
    "react-native-edge-to-edge",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#000",
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          extraProguardRules:
            "-keep class com.honeygain.hgsdk.** { *; }\n" +
            "-dontwarn com.honeygain.hgsdk.**\n",
          foregroundServiceTypes: [
            "dataSync",
            "mediaPlayback",
            "specialUse",
          ],
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  // ── Local native modules ───────────────────────────────────────────────────
  // Tells expo-modules-autolinking to scan ./modules/ directly.
  // This is how mavin-engine and mavin-eq (expo-autoeq-engine) are discovered
  // without relying on node_modules symlinks, which fail on Windows.
  autolinking: {
    nativeModulesDir: "./modules",
  },
};