// mavin-eq/MavinPlayerNative.ts
import { TurboModuleRegistry, Platform } from "react-native";
import type { MavinPlayerNativeModule } from "./types";

const MODULE_NAME = "TrackPlayer";
let _nativeModule: MavinPlayerNativeModule | null = null;

export function getNativeModule(): MavinPlayerNativeModule {
  if (Platform.OS !== "android") {
    throw new Error("[MavinPlayer] This module is Android-only.");
  }
  if (!_nativeModule) {
    try {
      _nativeModule = TurboModuleRegistry.getEnforcing<any>(MODULE_NAME) as MavinPlayerNativeModule;
    } catch {
      console.warn(
        `[MavinPlayer] Native module "${MODULE_NAME}" not found. ` +
        "Ensure mavin-player is installed and properly linked."
      );
      return {} as MavinPlayerNativeModule;
    }
  }
  return _nativeModule;
}

export function isNativeModuleAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return TurboModuleRegistry.get<any>(MODULE_NAME) != null;
  } catch {
    return false;
  }
}

export const getMavinPlayer = getNativeModule;