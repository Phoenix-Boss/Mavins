// libs/playerSetup.ts
//
// Singleton bootstrap for MavinPlayer (Android-only, custom ExoPlayer + full
// DSP chain: EqualizerProcessor, CompressorProcessor, CrossfeedProcessor,
// ConvolutionProcessor, FxProcessor, PeakMeterProcessor).
//
// ── Rules ────────────────────────────────────────────────────────────────────
//  • Import setupPlayerGlobal / releasePlayerGlobal from HERE only.
//    Layout files are Expo Router route modules; importing from them breaks
//    Fast Refresh and causes "is not a function" errors at runtime.
//  • This file is the ONE place that owns the native module reference.
//    Every other file that needs the player calls getPlayerModule() from here.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import MavinPlayer from '@/modules/mavin-eq';
import type { MavinPlayerNativeModule } from '@/modules/mavin-eq/types';

// ── Singleton state ───────────────────────────────────────────────────────────

let playerSetupPromise: Promise<boolean> | null = null;
let isPlayerReady                               = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

/** True when the native module is present and we're on Android. */
function nativeModuleAvailable(): boolean {
  return Platform.OS === 'android' && MavinPlayer != null;
}

/** Typed accessor — throws if the module is absent. */
function requireModule(): MavinPlayerNativeModule {
  if (!nativeModuleAvailable()) {
    throw new Error('[MavinPlayer] Native module unavailable on this platform.');
  }
  return MavinPlayer as MavinPlayerNativeModule;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise ExoPlayer + the full DSP chain exactly once.
 * Safe to call multiple times — subsequent calls return the cached promise.
 *
 * On Android, MavinPlaybackService (MediaSessionService) is started as a side
 * effect of the native initPlayer() call. The MediaSession is given the stable
 * ID "mavin-playback-session" on the Kotlin side to avoid the duplicate-ID
 * crash that occurs when the service restarts before the previous instance
 * tears down (hot reload, system restart, etc.).
 */
export async function setupPlayerGlobal(): Promise<boolean> {
  if (isPlayerReady) return true;
  if (playerSetupPromise) return playerSetupPromise;

  playerSetupPromise = (async (): Promise<boolean> => {
    try {
      if (Platform.OS !== 'android') {
        // MavinPlayer is Android-only. Wire up an iOS player here when needed.
        console.log('[MavinPlayer] Non-Android platform — skipping player init.');
        isPlayerReady = true;
        return true;
      }

      const player = requireModule();

      if (typeof player.initPlayer !== 'function') {
        throw new Error(
          '[MavinPlayer] initPlayer is not a function. ' +
          'Make sure mavin-player is linked and the build is clean. ' +
          'Run: cd android && ./gradlew clean && cd .. && npx expo run:android',
        );
      }

      // Boot ExoPlayer with the full DSP chain (EQ, compressor, crossfeed,
      // convolution, FX, peak meter) — all wired inside MavinAudioPlayer.kt.
      // This also starts MavinPlaybackService and creates the MediaSession.
      await player.initPlayer();
      console.log('[MavinPlayer] ✅ initPlayer complete — ExoPlayer + DSP chain ready.');

      // Global error monitor
      player.addListener('onError', (e: { code: string; message: string }) => {
        console.error('[MavinPlayer] Native error:', e.code, e.message);
      });

      isPlayerReady = true;
      return true;
    } catch (error) {
      console.error('[MavinPlayer] ❌ Setup failed:', error);
      playerSetupPromise = null; // allow a future retry
      return false;
    }
  })();

  return playerSetupPromise;
}

/**
 * Returns the native module instance.
 * Returns null on non-Android or before setupPlayerGlobal() resolves.
 */
export function getPlayerModule(): MavinPlayerNativeModule | null {
  if (!isPlayerReady || !nativeModuleAvailable()) return null;
  return MavinPlayer as MavinPlayerNativeModule;
}

/** True once initPlayer() has resolved successfully. */
export function isPlayerReadyGlobal(): boolean {
  return isPlayerReady;
}

/**
 * Fully release ExoPlayer, all DSP resources, and the Android service.
 *
 * Call order:
 *   1. stopService()  — stops MavinPlaybackService, which calls onDestroy()
 *                       → mediaSession.release().  This must happen FIRST so
 *                       the MediaSession ID is freed before the process might
 *                       recreate the service (hot reload, etc.).
 *   2. release()      — releases ExoPlayer + DSP AudioProcessor instances.
 *
 * If stopService() is not yet implemented on the native side, we fall back
 * gracefully to release() only (same as the original behaviour).
 *
 * Called from the app root's cleanup effect (RootLayout).
 */
export async function releasePlayerGlobal(): Promise<void> {
  if (!isPlayerReady) return;

  try {
    const player = requireModule();

    // Step 1 — Stop the MediaSessionService so its MediaSession is released
    // and the session ID is freed before any potential restart.
    if (typeof (player as any).stopService === 'function') {
      try {
        await (player as any).stopService();
        console.log('[MavinPlayer] Service stopped — MediaSession released.');
      } catch (stopErr) {
        // Non-fatal: log and continue with player.release() below.
        console.warn('[MavinPlayer] stopService error (non-fatal):', stopErr);
      }
    } else {
      // Native module not yet updated — log a reminder but don't throw.
      console.warn(
        '[MavinPlayer] stopService() not found on native module. ' +
        'Add it to MavinPlayerModule to fully prevent duplicate MediaSession ID crashes on hot reload.',
      );
    }

    // Step 2 — Release ExoPlayer + DSP chain.
    player.release();
    console.log('[MavinPlayer] Player resources released.');
  } catch (error) {
    console.error('[MavinPlayer] Error releasing player:', error);
  } finally {
    // Always reset singleton state so a fresh setupPlayerGlobal() is possible.
    isPlayerReady      = false;
    playerSetupPromise = null;
  }
}