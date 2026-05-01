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

  console.log('[DEBUG] __turboModuleProxy:', !!(global as any).__turboModuleProxy);
  console.log('[DEBUG] RN$Bridgeless:', !!(global as any)['RN$Bridgeless']);
  console.log('[DEBUG] ALL NativeModules count:', Object.keys(NativeModules).length);
  console.log('[DEBUG] NativeModules keys with player/track/music:', 
    Object.keys(NativeModules).filter(k => 
      k.toLowerCase().includes('track') || 
      k.toLowerCase().includes('music') || 
      k.toLowerCase().includes('mavin') || 
      k.toLowerCase().includes('player')
    )
  );

  const mod = NativeModules[MODULE_NAME];
  
  if (!mod) {
    console.warn(`[MavinPlayer] Native module "${MODULE_NAME}" not found.`);
    return silentProxy;
  }

  return mod as MavinPlayerNativeModule;
}

export function isNativeModuleAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  return !!NativeModules[MODULE_NAME];
}

export const getMavinPlayer = getNativeModule;