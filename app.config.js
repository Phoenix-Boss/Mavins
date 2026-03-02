// app.config.js
const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");

module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "pikoko1668",
  slug: "audioscape",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "b32cacc9-2e90-4b43-9c9d-108f12a8ecf6",
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
      // Existing permissions
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.MANAGE_EXTERNAL_STORAGE",
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.WAKE_LOCK",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",

      // Honeygain SDK required permissions
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
      "android.permission.RECEIVE_BOOT_COMPLETED",
    ],

    // Required for Honeygain background + boot functionality
    usesCleartextTraffic: true, // often needed for some SDK network calls (check Honeygain docs)

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

    // Critical: Enable foreground service types for Honeygain background running
    [
      "expo-build-properties",
      {
        android: {
          extraProguardRules: [
            // Optional: if you get ProGuard/R8 issues with Honeygain
            "-keep class com.honeygain.hgsdk.** { *; }",
            "-dontwarn com.honeygain.hgsdk.**",
          ],
          // Ensure foreground service types are declared
          foregroundServiceTypes: [
            "dataSync",           // common for Honeygain-like SDKs
            "mediaPlayback",      // if you already have media
            "specialUse",         // required for Honeygain background
          ],
        },
      },
    ],

    // Optional: if you want to force Honeygain-related manifest entries
    // (usually not needed if your custom module handles it)
    // [
    //   "expo-android-manifest",
    //   {
    //     manifest: {
    //       application: {
    //         service: [
    //           {
    //             name: "com.honeygain.hgsdk.HgService", // adjust if Honeygain has named service
    //             permission: "android.permission.BIND_JOB_SERVICE",
    //           },
    //         ],
    //       },
    //     },
    //   },
    // ],
  ],

  experiments: {
    typedRoutes: true,
  },
};