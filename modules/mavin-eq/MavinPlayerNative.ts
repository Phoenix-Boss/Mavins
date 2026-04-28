// mavin-eq/MavinPlayerNative.ts
// mavin-player registers as a React Native bridge module named "TrackPlayer"
// NOT an Expo module — must use NativeModules, not requireNativeModule
import { NativeModules, Platform } from "react-native";
import type { MavinPlayerNativeModule } from "./types";

const MODULE_NAME = "TrackPlayer";

let _nativeModule: MavinPlayerNativeModule | null = null;

export function getNativeModule(): MavinPlayerNativeModule {
  if (Platform.OS !== "android") {
    throw new Error("[MavinPlayer] This module is Android-only.");
  }
  if (!_nativeModule) {
    _nativeModule = NativeModules[MODULE_NAME] as MavinPlayerNativeModule;
    if (!_nativeModule) {
      console.warn(
        `[MavinPlayer] Native module "${MODULE_NAME}" not found. ` +
        "Ensure mavin-player is installed and properly linked."
      );
      return {} as MavinPlayerNativeModule; // return empty object instead of throwing
    }
  }
  return _nativeModule;
}

export function isNativeModuleAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return NativeModules[MODULE_NAME] != null;
  } catch {
    return false;
  }
}

export const getMavinPlayer = getNativeModule;
