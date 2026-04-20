// app.config.js
const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");

module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "wocof2",
  slug: "wocof2",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "8968f586-c2de-4f2b-91ac-a08008acd380",
    },
  },
  platforms: ["android"],
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: IS_DEV ? "mavins-player-dev" : "mavins-player",
  userInterfaceStyle: "automatic",

  // ── Architecture ───────────────────────────────────────────────────────────
  // react-native-track-player 4.1.2 (stable) crashes on New Architecture due
  // to a null eventType NPE in MusicModule.addListener. The 5.x alpha that
  // claims New Arch support is itself broken (iOS can't play tracks at all).
  // Disable New Arch here until RNTP ships a stable 5.x release, then re-enable.
  // SDK 54 is the last Expo version where this opt-out is supported.
  newArchEnabled: false,

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
    "react-native-track-player",
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
  // expo-modules-autolinking v3.x uses "modulesPaths" (array), not
  // "nativeModulesDir". Scans ./modules/ directly so mavin-engine, mavin-eq,
  // and honeygain are all discovered without node_modules symlinks.
  autolinking: {
    modulesPaths: ["./modules"],
  },
};