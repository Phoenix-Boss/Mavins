// app.config.js
//
// ARCHITECTURE: Android-only, master-slave video/audio playback via expo-video.
// expo-audio is intentionally EXCLUDED — the master player (expo-video, never muted)
// owns all audio output. Including expo-audio alongside expo-video causes AudioFocus
// conflicts that interrupt playback (the "start → stop → start" loop).
//
// BACKGROUND PLAYBACK: Handled entirely by expo-video (supportsBackgroundPlayback: true)
// + expo-media-control for the lock screen notification. No expo-audio needed.
//
// FIXES APPLIED:
//   1. Removed expo-audio plugin — conflicts with expo-video AudioFocus ownership
//   2. expo-video: supportsBackgroundPlayback + supportsPictureInPicture retained
//   3. expo-media-control: lock screen controls + notification channel configured
//   4. foregroundServiceTypes includes mediaPlayback (required for background audio on Android 14+)
//   5. WAKE_LOCK permission retained — prevents CPU sleep during background playback
//   6. Removed duplicate/redundant FOREGROUND_SERVICE_SPECIAL_USE + FOREGROUND_SERVICE_DATA_SYNC
//      (dataSync foreground service type is for file sync, not media — kept only mediaPlayback)
//   7. extraProguardRules cleaned up — pawns + firebase entries retained, added expo-video keep rule
//   8. newArchEnabled: true retained — required for expo-video's Fabric VideoView
//   9. withExcludeDependencies plugin excludes com.google.firebase:protolite-well-known-types —
//      conflicts with protobuf-javalite:4.33.5 (duplicate com.google.protobuf.DescriptorProtos).
//      NOTE: expo-build-properties does NOT support an "excludes" field — a custom plugin is
//      required to inject `configurations.all { exclude ... }` into app/build.gradle.

const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");
const withExcludeDependencies = require("./plugins/withExcludeDependencies");

module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "wicemi90311",
  slug: "wicemi9031",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "e053d760-bfb2-464f-b169-7a76ebfa3247",
    },
  },

  // Android-only — no iOS targets
  platforms: ["android"],
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: IS_DEV ? "mavins-player-dev" : "mavins-player",
  userInterfaceStyle: "automatic",

  // New Architecture required for expo-video Fabric VideoView
  newArchEnabled: true,

  android: {
    softwareKeyboardLayoutMode: "pan",
    permissions: [
      // Storage — local music library
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.MANAGE_EXTERNAL_STORAGE",
      // Network
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      // Playback — background audio requires WAKE_LOCK + FOREGROUND_SERVICE_MEDIA_PLAYBACK
      "android.permission.WAKE_LOCK",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      // Boot — restore last track on device restart
      "android.permission.RECEIVE_BOOT_COMPLETED",
      // Audio routing
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
    googleServicesFile: IS_DEV
      ? "./google-services-dev.json"
      : "./google-services.json",
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
            scheme: IS_DEV ? "mavins-player-dev" : "mavins-player",
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
    // ── Custom build plugins ────────────────────────────────────────────────
    withAbiSplit,
    withIconXml,

    // ── Dependency conflict resolution ──────────────────────────────────────
    // protolite-well-known-types:18.0.1 (pulled in by react-native-firebase)
    // duplicates classes already in protobuf-javalite:4.33.5, causing:
    //   "Duplicate class com.google.protobuf.DescriptorProtos found in
    //    protobuf-javalite-4.33.5 and protolite-well-known-types-18.0.1"
    // The fix injects `configurations.all { exclude ... }` into app/build.gradle.
    [
      withExcludeDependencies,
      {
        excludes: [
          { group: "com.google.firebase", module: "protolite-well-known-types" },
        ],
      },
    ],

    // ── Core Expo plugins ───────────────────────────────────────────────────
    "expo-router",
    "expo-font",

    // ── Notifications ───────────────────────────────────────────────────────
    [
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#D4AF37",
      },
    ],

    // ── Lock screen / notification media controls ───────────────────────────
    // expo-media-control provides the Android media notification and lock screen
    // buttons. It does NOT play audio — expo-video owns all playback.
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

    // ── Video playback (master + slave players) ─────────────────────────────
    // This is the ONLY audio/video engine. expo-audio is intentionally omitted.
    // supportsBackgroundPlayback: true → keeps the ExoPlayer foreground service
    //   alive when the app is backgrounded (required for Android 8+).
    // supportsPictureInPicture: true → enables PiP for the slave (video) player.
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],

    // ── Edge-to-edge display ────────────────────────────────────────────────
    "react-native-edge-to-edge",

    // ── Splash screen ───────────────────────────────────────────────────────
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#000",
      },
    ],

    // ── Build properties ────────────────────────────────────────────────────
    [
      "expo-build-properties",
      {
        android: {
          extraProguardRules:
            // Pawns SDK — bundled as local AAR in modules/pawns/android/libs/
            "-keep class com.pawns.sdk.** { *; }\n" +
            "-dontwarn com.pawns.sdk.**\n" +
            // Firebase
            "-keep class com.google.firebase.** { *; }\n" +
            "-keep class com.google.android.gms.** { *; }\n" +
            // ExoPlayer / expo-video — prevent R8 from stripping media3 internals
            "-keep class androidx.media3.** { *; }\n" +
            "-dontwarn androidx.media3.**\n",
          // mediaPlayback is the correct foreground service type for audio/video
          // streaming. dataSync and specialUse are unrelated to media playback
          // and were removed to avoid unnecessary permission scrutiny on Play Store.
          foregroundServiceTypes: [
            "mediaPlayback",
          ],
        },
      },
    ],

    // ── Firebase ────────────────────────────────────────────────────────────
    // Auto-configures from google-services.json / google-services-dev.json
    "@react-native-firebase/app",
  ],

  experiments: {
    typedRoutes: true,
  },

  // Local native modules (mavin-engine, pawns, etc.)
  autolinking: {
    modulesPaths: ["./modules"],
  },
};