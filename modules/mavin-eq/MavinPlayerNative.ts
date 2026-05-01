// mavin-eq/MavinPlayerNative.ts
import { NativeModules, Platform } from "react-native";
import type { MavinPlayerNativeModule } from "./types";

const MODULE_NAME = "TrackPlayer";

const silentProxy = new Proxy({} as MavinPlayerNativeModule, {
  get(_target, prop) {
    return () => Promise.resolve(null);
  },
});

export function getNativeModule(): MavinPlayerNativeModule {
  if (Platform.OS !== "android") {
    return silentProxy;
  }

  const mod = NativeModules[MODULE_NAME];
  
  if (!mod) {
    console.warn(
      `[MavinPlayer] Native module "${MODULE_NAME}" not found. ` +
      "Ensure mavin-player is installed and properly linked."
    );
    return silentProxy;
  }

  return mod as MavinPlayerNativeModule;
}

export function isNativeModuleAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  return !!NativeModules[MODULE_NAME];
}

export const getMavinPlayer = getNativeModule;