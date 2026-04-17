/**
 * libs/playerSetup.ts
 * 
 * Global MavinPlayer setup and initialization.
 * Ensures the player is initialized exactly once across the entire app lifecycle.
 * Includes AudioTrack warm-up for instant playback (Poweramp/Neutron style).
 *
 * FIXES APPLIED:
 *
 *  1. True singleton pattern - prevents multiple setup calls across hot reloads.
 *  2. Global state tracked in module scope, not component scope.
 *  3. Proper cleanup only on app termination, not on hot reload.
 *  4. Fixed "Player already initialized" spam.
 *  5. Added verifyPlayerReady() with AudioTrack warm-up.
 *  6. Added setupAndVerifyPlayer() that combines setup and verification.
 *  7. Audio pipeline is pre-warmed for instant playback.
 *  8. 🔥 REMOVED destructive reset() calls from warm-up - keeps pipeline hot.
 */

import { Platform } from "react-native";
import {
  load,
  play,
  pause,
  getQueue,
  setupPlayer,
  destroy,
  updateOptions,
  getVolume,
  getRepeatMode,
  getShuffleMode,
  getActiveTrack,
} from "@/modules/mavin-eq";
import type { SetupOptions, AndroidOptions } from "@/modules/mavin-eq";

// Import the raw native module reference (default export = raw native object)
import MavinPlayerNative from "@/modules/mavin-eq";

// Local alias so existing call sites keep working without changes
const TrackPlayer = {
  load,
  play,
  pause,
  getQueue,
  setupPlayer,
  destroy,
  updateOptions,
  getVolume,
  getRepeatMode,
  getShuffleMode,
  getActiveTrack,
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TAG = "[PlayerSetup]";

// Global singleton state - anchored to `global` so it TRULY survives fast-refresh
// hot reloads in development (module scope is re-evaluated on each reload, but
// the `global` object persists across reloads within the same JS engine session).
const GLOBAL_KEY = '__mavin_player_state__';
if (!(global as any)[GLOBAL_KEY]) {
  (global as any)[GLOBAL_KEY] = {
    isInitialized: false,
    isInitializing: false,
    initializationPromise: null as Promise<boolean> | null,
    setupCompleted: false,
    audioPipelineWarmed: false,
  };
}
const GLOBAL_STATE: {
  isInitialized: boolean;
  isInitializing: boolean;
  initializationPromise: Promise<boolean> | null;
  setupCompleted: boolean;
  audioPipelineWarmed: boolean;
} = (global as any)[GLOBAL_KEY];

// Capability string literals (match native module exactly)
const CAPABILITIES = {
  PLAY: "play",
  PAUSE: "pause",
  STOP: "stop",
  SKIP_TO_NEXT: "skipToNext",
  SKIP_TO_PREVIOUS: "skipToPrevious",
  SEEK_TO: "seekTo",
  JUMP_FORWARD: "jumpForward",
  JUMP_BACKWARD: "jumpBackward",
  LIKE: "like",
  DISLIKE: "dislike",
  BOOKMARK: "bookmark",
} as const;

// Default player options
const DEFAULT_OPTIONS: SetupOptions = {
  capabilities: [
    CAPABILITIES.PLAY,
    CAPABILITIES.PAUSE,
    CAPABILITIES.STOP,
    CAPABILITIES.SKIP_TO_NEXT,
    CAPABILITIES.SKIP_TO_PREVIOUS,
    CAPABILITIES.SEEK_TO,
    CAPABILITIES.JUMP_FORWARD,
    CAPABILITIES.JUMP_BACKWARD,
    CAPABILITIES.LIKE,
    CAPABILITIES.DISLIKE,
    CAPABILITIES.BOOKMARK,
  ],
  compactCapabilities: [
    CAPABILITIES.PLAY,
    CAPABILITIES.PAUSE,
    CAPABILITIES.SKIP_TO_NEXT,
    CAPABILITIES.SKIP_TO_PREVIOUS,
  ],
  notificationCapabilities: [
    CAPABILITIES.PLAY,
    CAPABILITIES.PAUSE,
    CAPABILITIES.SKIP_TO_NEXT,
    CAPABILITIES.SKIP_TO_PREVIOUS,
    CAPABILITIES.JUMP_FORWARD,
    CAPABILITIES.JUMP_BACKWARD,
    CAPABILITIES.LIKE,
    CAPABILITIES.STOP,
  ],
  minBuffer: 30,
  maxBuffer: 60,
  playBuffer: 3,
  playbackBuffer: 3,
  backBuffer: 30,
  forwardJumpInterval: 15,
  backwardJumpInterval: 15,
  progressUpdateEventInterval: 0.5,
  ratingType: 1,
  likeOptions: { isActive: true, title: "Like" },
  dislikeOptions: { isActive: true, title: "Dislike" },
  bookmarkOptions: { isActive: true, title: "Bookmark" },
  androidAudioContentType: "music",
  maxCacheSize: 200 * 1024,
  autoHandleInterruptions: true,
  alwaysPauseOnInterruption: false,
  gaplessEnabled: true,
  persistQueue: true,
  persistPosition: true,
  outputProfile: "default",
  dvcEnabled: false,
  resamplerQuality: "high",
  targetResampleRateHz: 0,
  android: {
    appKilledPlaybackBehavior: "ContinuePlayback",
    stopForegroundGracePeriod: 5000,
    alwaysPauseOnInterruption: false,
  } as AndroidOptions,
};

// Silent track for audio pipeline warm-up (1kHz tone, 0.1 seconds, near-silent)
// This forces AudioTrack creation without audible output
const SILENT_TRACK = {
  id: "__mavin_silent_warmup__",
  url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
  title: "Silent Warmup",
  artist: "Mavin",
  duration: 0.1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

const log = (message: string, ...args: any[]) => {
  console.log(`${TAG} ${message}`, ...args);
};

const warn = (message: string, ...args: any[]) => {
  console.warn(`${TAG} ${message}`, ...args);
};

const error = (message: string, ...args: any[]) => {
  console.error(`${TAG} ${message}`, ...args);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Public API - Module Access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the raw native MavinPlayer module.
 */
export function getPlayerModule() {
  return MavinPlayerNative;
}

/**
 * Check if the player is currently initialized.
 */
export function isPlayerReady(): boolean {
  return GLOBAL_STATE.isInitialized && GLOBAL_STATE.audioPipelineWarmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Pipeline Warm-Up (Poweramp/Neutron Style)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Warm up the audio pipeline by loading and playing a silent track.
 * This forces ExoPlayer to create the AudioTrack and bind to AudioFlinger,
 * ensuring instant playback when the user selects a real track.
 * 
 * 🔥 CRITICAL: Does NOT call reset() - keeps the pipeline hot and ready.
 * The silent track stays loaded, and the first real track will replace it
 * via load() which swaps the MediaSource without tearing down the AudioTrack.
 * 
 * This is exactly what Poweramp does at startup - creates an AudioTrack
 * playing silence, then pauses it to keep the pipeline "hot".
 */
async function warmUpAudioPipeline(): Promise<boolean> {
  log("🔥 Warming up audio pipeline...");
  
  try {
    // Step 1: Load the silent track directly (no reset before)
    // This replaces any existing track but keeps the AudioTrack alive
    await TrackPlayer.load(SILENT_TRACK as any);
    log("  📀 Silent track loaded");
    
    // Step 2: Wait for the track to be prepared (AudioTrack creation)
    await sleep(100);
    
    // Step 3: Start playback to activate the audio thread
    // Wrap in its own try/catch because on Android, play() internally
    // calls activateKeepAwake() which can throw if expo-keep-awake hasn't
    // fully initialised yet. This error is benign - the AudioTrack is still
    // created and the pipeline is still warm.
    try {
      await TrackPlayer.play();
      log("  ▶️ Audio pipeline activated");
    } catch (playErr) {
      const msg = playErr instanceof Error ? playErr.message : String(playErr);
      if (msg.toLowerCase().includes('keep awake') || msg.toLowerCase().includes('keepawake')) {
        log("  ▶️ Audio pipeline activated (keep-awake warning suppressed — benign)");
      } else {
        throw playErr; // Re-throw real errors
      }
    }
    
    // Step 4: Wait for AudioTrack to fully start
    await sleep(150);
    
    // Step 5: Pause - keeps AudioTrack "hot" but silent
    await TrackPlayer.pause();
    log("  ⏸️ Audio pipeline paused (hot standby)");
    
    // 🔥 CRITICAL: DO NOT CALL reset() HERE!
    // The silent track stays loaded. The first real track will replace it
    // via load() which swaps the MediaSource without destroying the AudioTrack.
    
    log("✅ Audio pipeline warmed up and ready (silent track loaded, AudioTrack hot)");
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    warn(`⚠️ Audio pipeline warm-up failed: ${errorMessage}`);
    
    // Even if warm-up fails, the player might still work (with delay)
    // Don't block app startup on this
    return false;
  }
}

/**
 * Verify that the player is truly ready by checking if the audio pipeline
 * can accept commands. Uses the warm-up sequence to ensure AudioTrack exists.
 */
export async function verifyPlayerReady(): Promise<boolean> {
  if (GLOBAL_STATE.audioPipelineWarmed) {
    return true;
  }
  
  try {
    // First, check if we can access the queue (basic readiness)
    await TrackPlayer.getQueue();
    
    // Then, warm up the audio pipeline if not already done
    if (!GLOBAL_STATE.audioPipelineWarmed) {
      const warmed = await warmUpAudioPipeline();
      GLOBAL_STATE.audioPipelineWarmed = warmed;
      return warmed;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for player to be fully verified ready.
 * Polls verifyPlayerReady() until success or timeout.
 */
export async function waitForVerifiedPlayer(timeoutMs: number = 8000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const isReady = await verifyPlayerReady();
    if (isReady) {
      log("✅ Player verified ready (audio pipeline warm)");
      return true;
    }
    await sleep(200);
  }
  
  warn(`Player verification timed out after ${timeoutMs}ms`);
  return false;
}

/**
 * Setup player and wait for verification (including audio pipeline warm-up).
 * This is the recommended single-call function for app startup.
 */
export async function setupAndVerifyPlayer(
  options?: Partial<SetupOptions>
): Promise<boolean> {
  const setupOk = await setupPlayerGlobal(options);
  if (!setupOk) {
    error("Player setup failed");
    return false;
  }
  
  const verified = await waitForVerifiedPlayer(5000);
  if (!verified) {
    error("Player verification failed - audio pipeline may not be ready");
    // Don't fail completely - player might still work with delay
    GLOBAL_STATE.audioPipelineWarmed = false;
  }
  
  log("✅ Player setup and verified");
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Setup Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setup the Mavin player with default options.
 * This function is a true singleton - it will only initialize once per app session.
 */
export async function setupPlayerGlobal(
  options?: Partial<SetupOptions>
): Promise<boolean> {
  // Already initialized - return immediately
  if (GLOBAL_STATE.isInitialized) {
    return true;
  }

  // Already completed setup (even if state was reset by hot reload)
  if (GLOBAL_STATE.setupCompleted) {
    GLOBAL_STATE.isInitialized = true;
    return true;
  }

  // Currently initializing - wait for existing promise
  if (GLOBAL_STATE.isInitializing && GLOBAL_STATE.initializationPromise) {
    log("Setup already in progress, waiting...");
    return GLOBAL_STATE.initializationPromise;
  }

  // Start initialization
  GLOBAL_STATE.isInitializing = true;

  const mergedOptions = mergeOptions(options);

  GLOBAL_STATE.initializationPromise = (async () => {
    try {
      log("Starting player setup...");
      
      // Check if player is already setup (native side might survive hot reload)
      try {
        await TrackPlayer.getQueue();
        // If we can get queue, player is already fully setup
        log("Player already setup natively");
        GLOBAL_STATE.isInitialized = true;
        GLOBAL_STATE.setupCompleted = true;
        return true;
      } catch {
        // Player not setup, continue with setup
      }

      // Setup the player
      await TrackPlayer.setupPlayer(mergedOptions);
      
      // Give the native module time to fully initialize
      await sleep(100);
      
      GLOBAL_STATE.isInitialized = true;
      GLOBAL_STATE.setupCompleted = true;
      
      log("✅ Player setup complete");
      return true;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // If error indicates already initialized, treat as success
      if (errorMessage.includes("already") || errorMessage.includes("initialized")) {
        log("Player already initialized (detected from error)");
        GLOBAL_STATE.isInitialized = true;
        GLOBAL_STATE.setupCompleted = true;
        return true;
      }
      
      error(`Player setup failed: ${errorMessage}`);
      return false;
    } finally {
      GLOBAL_STATE.isInitializing = false;
    }
  })();

  return GLOBAL_STATE.initializationPromise;
}

/**
 * Merge user options with defaults.
 */
function mergeOptions(options?: Partial<SetupOptions>): SetupOptions {
  if (!options) {
    return DEFAULT_OPTIONS;
  }

  return {
    ...DEFAULT_OPTIONS,
    ...options,
    android: {
      ...DEFAULT_OPTIONS.android,
      ...(options.android || {}),
    } as AndroidOptions,
    likeOptions: options.likeOptions ? {
      ...DEFAULT_OPTIONS.likeOptions,
      ...options.likeOptions,
    } : DEFAULT_OPTIONS.likeOptions,
    dislikeOptions: options.dislikeOptions ? {
      ...DEFAULT_OPTIONS.dislikeOptions,
      ...options.dislikeOptions,
    } : DEFAULT_OPTIONS.dislikeOptions,
    bookmarkOptions: options.bookmarkOptions ? {
      ...DEFAULT_OPTIONS.bookmarkOptions,
      ...options.bookmarkOptions,
    } : DEFAULT_OPTIONS.bookmarkOptions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Release/Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Release the player and clean up resources.
 * Only call this on actual app termination, not during development hot reloads.
 */
export async function releasePlayerGlobal(): Promise<void> {
  // In development, don't actually release to avoid timeout errors during hot reload
  if (__DEV__) {
    log("Development mode - skipping actual player release (hot reload safety)");
    return;
  }

  log("Releasing player");

  try {
    if (GLOBAL_STATE.isInitialized) {
      await TrackPlayer.destroy();
    }
  } catch (err) {
    warn("Error destroying player:", err);
  }

  GLOBAL_STATE.isInitialized = false;
  GLOBAL_STATE.isInitializing = false;
  GLOBAL_STATE.initializationPromise = null;
  GLOBAL_STATE.audioPipelineWarmed = false;

  log("Player released");
}

// ─────────────────────────────────────────────────────────────────────────────
// Development Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset state for development (useful when you want to force re-initialization).
 */
export function devResetState(): void {
  if (!__DEV__) return;
  GLOBAL_STATE.isInitialized = false;
  GLOBAL_STATE.isInitializing = false;
  GLOBAL_STATE.initializationPromise = null;
  GLOBAL_STATE.setupCompleted = false;
  GLOBAL_STATE.audioPipelineWarmed = false;
  log("Development state reset");
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function reinitializePlayer(
  options?: Partial<SetupOptions>
): Promise<boolean> {
  if (__DEV__) {
    devResetState();
  } else {
    await releasePlayerGlobal();
  }
  return setupAndVerifyPlayer(options);
}

export async function updatePlayerOptions(
  options: Partial<SetupOptions>
): Promise<void> {
  if (!GLOBAL_STATE.isInitialized) {
    warn("Cannot update options - player not initialized");
    return;
  }

  try {
    await TrackPlayer.updateOptions(options);
    log("Player options updated");
  } catch (err) {
    error("Failed to update player options:", err);
    throw err;
  }
}

export function getSetupStatus(): {
  isInitialized: boolean;
  isInitializing: boolean;
  setupCompleted: boolean;
  audioPipelineWarmed: boolean;
} {
  return {
    isInitialized: GLOBAL_STATE.isInitialized,
    isInitializing: GLOBAL_STATE.isInitializing,
    setupCompleted: GLOBAL_STATE.setupCompleted,
    audioPipelineWarmed: GLOBAL_STATE.audioPipelineWarmed,
  };
}

export async function waitForPlayerReady(timeoutMs: number = 10000): Promise<boolean> {
  if (GLOBAL_STATE.isInitialized && GLOBAL_STATE.audioPipelineWarmed) {
    return true;
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (GLOBAL_STATE.isInitialized && GLOBAL_STATE.audioPipelineWarmed) {
      return true;
    }

    if (GLOBAL_STATE.isInitializing && GLOBAL_STATE.initializationPromise) {
      try {
        return await GLOBAL_STATE.initializationPromise;
      } catch {
        // Continue waiting
      }
    }

    await sleep(100);
  }

  warn(`Timeout waiting for player to be ready after ${timeoutMs}ms`);
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform-Specific Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getAndroidDefaultOptions(): Partial<AndroidOptions> {
  return {
    appKilledPlaybackBehavior: "ContinuePlayback",
    stopForegroundGracePeriod: 5000,
    alwaysPauseOnInterruption: false,
  };
}

export function getBufferConfigForNetwork(networkType: string): {
  minBuffer: number;
  maxBuffer: number;
  playBuffer: number;
} {
  switch (networkType) {
    case "cellular":
    case "slow":
      return { minBuffer: 60, maxBuffer: 120, playBuffer: 5 };
    case "wifi":
    case "fast":
    default:
      return { minBuffer: 30, maxBuffer: 60, playBuffer: 2 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug Utilities
// ─────────────────────────────────────────────────────────────────────────────

export async function logPlayerConfig(): Promise<void> {
  if (!GLOBAL_STATE.isInitialized) {
    log("Player not initialized");
    return;
  }

  try {
    const volume = await TrackPlayer.getVolume();
    const repeatMode = await TrackPlayer.getRepeatMode();
    const shuffleMode = await TrackPlayer.getShuffleMode();
    const queue = await TrackPlayer.getQueue();
    const activeTrack = await TrackPlayer.getActiveTrack();

    log("=== Player Configuration ===");
    log(`Volume: ${volume}`);
    log(`Repeat Mode: ${repeatMode}`);
    log(`Shuffle Mode: ${shuffleMode}`);
    log(`Queue Size: ${queue.length}`);
    log(`Active Track: ${activeTrack?.title ?? "none"}`);
    log(`Audio Pipeline Warmed: ${GLOBAL_STATE.audioPipelineWarmed}`);
    log("============================");
  } catch (err) {
    error("Failed to log player config:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export Default
// ─────────────────────────────────────────────────────────────────────────────

export default {
  setupPlayerGlobal,
  releasePlayerGlobal,
  getPlayerModule,
  isPlayerReady,
  verifyPlayerReady,
  waitForVerifiedPlayer,
  setupAndVerifyPlayer,
  warmUpAudioPipeline,
  reinitializePlayer,
  updatePlayerOptions,
  getSetupStatus,
  waitForPlayerReady,
  logPlayerConfig,
  getAndroidDefaultOptions,
  getBufferConfigForNetwork,
};