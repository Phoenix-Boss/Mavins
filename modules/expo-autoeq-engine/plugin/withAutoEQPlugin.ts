/**
 * withAutoEQPlugin.ts — expo-autoeq-engine
 *
 * Expo config plugin for expo-autoeq-engine.
 *
 * The Kotlin AutoEQModule is a local Expo module in modules/expo-autoeq-engine.
 * Expo's module auto-discovery (expo-module.config.json) handles registration
 * automatically — no manual AndroidManifest or build.gradle changes needed.
 *
 * This plugin is kept as a clean hook for future additions, such as:
 *   - Adding RECORD_AUDIO or MODIFY_AUDIO_SETTINGS permissions if needed.
 *   - Injecting audiofx ProGuard rules to prevent minification from stripping
 *     DynamicsProcessing reflection.
 */

import { ConfigPlugin, withAndroidManifest } from "@expo/config-plugins";

const withAutoEQPlugin: ConfigPlugin = (config) => {
  // ── Android: ensure MODIFY_AUDIO_SETTINGS permission is declared ────────────
  // DynamicsProcessing requires this permission to attach to an audio session
  // owned by another app component (e.g. TrackPlayer's service).
  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults;
    const permissions: Array<{ $: { "android:name": string } }> =
      manifest.manifest["uses-permission"] ?? [];

    const AUDIO_PERM = "android.permission.MODIFY_AUDIO_SETTINGS";
    const alreadyDeclared = permissions.some(
      (p) => p.$["android:name"] === AUDIO_PERM
    );

    if (!alreadyDeclared) {
      permissions.push({ $: { "android:name": AUDIO_PERM } });
      manifest.manifest["uses-permission"] = permissions;
    }

    return manifestConfig;
  });

  return config;
};

export default withAutoEQPlugin;
