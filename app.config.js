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
    // NOTE: Honeygain API key is NOT stored here.
    // It lives only in components/HoneygainConsentGate.tsx (or a gitignored secrets file).
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
        // Handles taps on the lock screen / notification media card.
        // Android re-launches or resumes the app with this intent when the
        // user taps the media notification card.
        action: "android.intent.action.MAIN",
        category: ["android.intent.category.LAUNCHER"],
      },
      {
        // Custom scheme so Linking.getInitialURL() / addEventListener can
        // detect that the app was opened from the media notification.
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
};