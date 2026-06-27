// app.config.js
const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");

module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "licige24821",
  slug: "licige2482",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "ff9d3099-4364-4fb1-b6b9-587726f4c7e9",
    },
  },
  platforms: ["android"],
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: IS_DEV ? "mavins-player-dev" : "soundwave",
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
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.ACCESSIBILITY_SERVICE",
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
    googleServicesFile: "./google-services.json",
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
            scheme: "soundwave",
            host: "play",
            pathPrefix: "/",
          },
        ],
        category: [
          "android.intent.category.DEFAULT",
          "android.intent.category.BROWSABLE",
        ],
      },
      {
        action: "android.intent.action.VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "mavins.vercel.app",
            pathPrefix: "/share",
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
        color: "#D4AF37",
      },
    ],

    [
      "expo-media-control",
      {
        enableBackgroundAudio: true,
        audioSessionCategory: "playback",
        android: {
          notificationChannelName: "Mavins Player Playback",
          notificationChannelDescription:
            "Shows current track and playback controls",
          notificationColor: "#D4AF37",
        },
      },
    ],

    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
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
            "-keep class com.pawns.sdk.** { *; }\n" +
            "-dontwarn com.pawns.sdk.**\n" +
            // Keep expo-pilot classes
            "-keep class expo.modules.pilot.** { *; }\n" +
            "-dontwarn expo.modules.pilot.**\n",
          foregroundServiceTypes: ["dataSync", "mediaPlayback", "specialUse"],
        },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  autolinking: {
    modulesPaths: ["./modules"],
  },
};