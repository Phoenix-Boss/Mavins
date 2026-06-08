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
// FIREBASE: Intentionally removed. Will be re-integrated once the website is live
// so that a single Firebase project controls push notifications for both the web
// app and this Android app from one place. Removing it now also eliminates the
// protobuf duplicate-class build error (protobuf-javalite vs protolite-well-known-types)
// and the runtime LatLng ClassNotFoundException that came from excluding that artifact.
//
// TO RE-ADD FIREBASE LATER:
//   1. Add back @react-native-firebase/app and @react-native-firebase/firestore to package.json
//   2. Drop google-services.json / google-services-dev.json back into the project root
//   3. Restore the "@react-native-firebase/app" plugin entry at the bottom of plugins[]
//   4. Restore withExcludeDependencies with forceVersions: { "com.google.protobuf": "3.25.5" }
//   5. Restore googleServicesFile under android: {}
//   6. Replace any firestore() calls in the codebase with the modular Firebase v9+ API
//
// NEWPLAYER: JitPack dependency removed — NewPlayer is now vendored as a local
// Android subproject at modules/mavin-player/android/new-player. The config
// plugin ./plugins/withNewPlayer injects the include into the EAS-generated
// settings.gradle at build time so no manual settings.gradle edits are needed.

const IS_DEV = process.env.APP_VARIANT === "development";
const packageJson = require("./package.json");
const withAbiSplit = require("./plugins/withAbiSplit");
const withIconXml = require("./plugins/withIconXml");
const withNewPlayer = require("./plugins/withNewPlayer"); // ← vendored NewPlayer

module.exports = {
  name: IS_DEV ? "Mavins Player (Dev)" : "Mavins Player",
  owner: "besifo52561",
  slug: "besifo5256",
  version: packageJson.version,
  extra: {
    eas: {
      projectId: "027e908f-a940-42c8-afc1-23241d20fe2b",
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
    // googleServicesFile intentionally removed — Firebase not active
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
    withNewPlayer,      // ← injects ':new-player' into EAS settings.gradle

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
            // ExoPlayer / expo-video — prevent R8 from stripping media3 internals
            "-keep class androidx.media3.** { *; }\n" +
            "-dontwarn androidx.media3.**\n" +
            // NewPlayer — vendored local subproject
            "-keep class net.newpipe.newplayer.** { *; }\n" +
            "-dontwarn net.newpipe.newplayer.**\n",
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
    // REMOVED — will be re-added once the website is live.
    // Both web and Android will share one Firebase project for unified
    // push notification management. See re-add checklist at top of file.
  ],

  experiments: {
    typedRoutes: true,
  },

  // Local native modules (mavin-engine, pawns, etc.)
  autolinking: {
    modulesPaths: ["./modules"],
  },
};