// mavin-eq/MavinPlayerNative.ts
// mavin-eq re-exports MavinPlayer from mavin-player (the native audio engine)

import { requireNativeModule, Platform } from "expo-modules-core";
import type { MavinPlayerNativeModule } from "./types";

let _nativeModule: MavinPlayerNativeModule | null = null;

/**
 * Get the MavinPlayer native module.
 * The actual native implementation lives in mavin-player (expo.modules.mavinplayer.MavinPlayerModule).
 * This module is Android-only.
 */
export function getNativeModule(): MavinPlayerNativeModule {
  if (Platform.OS !== "android") {
    throw new Error("[MavinPlayer] This module is Android-only.");
  }

  if (!_nativeModule) {
    _nativeModule = requireNativeModule<MavinPlayerNativeModule>("MavinPlayer");

    if (!_nativeModule) {
      throw new Error(
        "[MavinPlayer] Native module not found. " +
        "Ensure mavin-player is installed and properly linked. " +
        "Run: cd android && ./gradlew clean && cd .. && npx expo run:android"
      );
    }
  }

  return _nativeModule;
}

/**
 * Synchronous check if the native module is available.
 * Use this for conditional feature enabling.
 */
export function isNativeModuleAvailable(): boolean {
  if (Platform.OS !== "android") return false;

  try {
    const mod = requireNativeModule<MavinPlayerNativeModule>("MavinPlayer");
    return mod != null;
  } catch {
    return false;
  }
}

// ✅ FIX: export the module INSTANCE (or null on non-Android),
// not the getter function itself. Previously `export default getNativeModule`
// exported the function, so callers got a function object instead of the
// native module — causing "initPlayer is not a function" at runtime.
const MavinPlayerDefault: MavinPlayerNativeModule | null =
  Platform.OS === "android" ? getNativeModule() : null;

export default MavinPlayerDefault;