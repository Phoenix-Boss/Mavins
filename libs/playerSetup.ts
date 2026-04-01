// libs/playerSetup.ts
//
// Singleton bootstrap for MavinPlayer.
// Import setupPlayerGlobal from here — never from app/_layout.tsx.
// Layout files are route modules; importing from them breaks Fast Refresh
// and causes "is not a function" errors at runtime.

import { Platform } from "react-native";
import { getNativeModule } from "@/modules/mavin-eq/MavinPlayerNative";
import type { MavinPlayerNativeModule } from "@/modules/mavin-eq/types";

let playerSetupPromise: Promise<boolean> | null = null;
let isPlayerReady = false;
let playerModule: MavinPlayerNativeModule | null = null;

export async function setupPlayerGlobal(): Promise<boolean> {
  if (isPlayerReady) return true;
  if (playerSetupPromise) return playerSetupPromise;

  playerSetupPromise = (async () => {
    try {
      if (Platform.OS !== "android") {
        // MavinPlayer is Android-only. Wire up an iOS player here when needed.
        console.log("[MavinPlayer] iOS — skipping player init");
        isPlayerReady = true;
        return true;
      }

      // ✅ FIX: getNativeModule() returns the actual native module instance
      playerModule = getNativeModule();

      if (!playerModule) {
        throw new Error("MavinPlayer native module not available");
      }

      // Verify the module has the required methods
      if (typeof playerModule.initPlayer !== "function") {
        throw new Error(
          "MavinPlayer.initPlayer is not a function. " +
          "Ensure mavin-player is properly linked. " +
          "Run: cd android && ./gradlew clean && cd .. && npx expo run:android"
        );
      }

      await playerModule.initPlayer();
      console.log(
        "✅ MavinPlayer: initPlayer complete — ExoPlayer + DSP chain ready"
      );

      // Monitor native errors globally
      playerModule.addListener("onError", (e: { code: string; message: string }) => {
        console.error("[MavinPlayer] Error:", e.code, e.message);
      });

      // Optional: Listen to other events for debugging
      playerModule.addListener("onPlaybackStateChanged", (state) => {
        console.log("[MavinPlayer] Playback state:", state);
      });

      playerModule.addListener("onTrackChanged", (event) => {
        console.log("[MavinPlayer] Track changed:", event.index);
      });

      isPlayerReady = true;
      return true;
    } catch (error) {
      console.error("❌ MavinPlayer setup failed:", error);
      playerSetupPromise = null; // allow retry
      return false;
    }
  })();

  return playerSetupPromise;
}

// Helper function to get the player module instance
export function getPlayerModule(): MavinPlayerNativeModule | null {
  if (!isPlayerReady) {
    console.warn("[MavinPlayer] Player not ready yet. Call setupPlayerGlobal() first.");
    return null;
  }
  return playerModule;
}

// Helper to check if player is ready
export function isPlayerReadyGlobal(): boolean {
  return isPlayerReady;
}

// Clean up player when app is destroyed
export async function releasePlayerGlobal(): Promise<void> {
  if (playerModule && isPlayerReady) {
    try {
      await playerModule.release();
      console.log("[MavinPlayer] Released player resources");
    } catch (error) {
      console.error("[MavinPlayer] Error releasing player:", error);
    }
  }
  playerModule = null;
  isPlayerReady = false;
  playerSetupPromise = null;
}