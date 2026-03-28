/**
 * index.ts — mavin-eq (Mixer-First Architecture)
 *
 * PREVIOUS MISTAKES FIXED:
 *
 * 1. getAudioSessionId retry loop — removed entirely.
 *    The old loop tried NativeModules.TrackPlayer.getAudioSessionId (doesn't
 *    exist in stock RNTP), then TrackPlayer JS export (also not in stock RNTP),
 *    burning 10 × 300ms = 3 seconds before giving up. This was the symptom of
 *    trying to attach DynamicsProcessing to ExoPlayer's session *after* play(),
 *    which has a ~500-1500ms frame-render delay.
 *
 * 2. setupEQAuto — removed. It wrapped the broken retry loop. Replaced by
 *    initMixerEQ which sets up the permanent AudioTrack mixer at app startup
 *    and returns the session ID to give to RNTP before play().
 *
 * 3. Double setupEQ call — fixed. claimEqMinutesForPlayback no longer calls
 *    AutoEQNative.setupEQ internally; that responsibility is now in useEqualizer
 *    (and only called once via initMixer which is idempotent).
 *
 * NEW FLOW:
 *   App mount → initMixerEQ() → get sessionId → configure RNTP with sessionId
 *                                                        ↓
 *   TrackPlayer.play() → ExoPlayer joins mixer session → EQ processes audio
 *
 * Platform Notes:
 * - Android physical device (DynamicsProcessing API 29+)
 * - Emulator: mixer AudioTrack works but DynamicsProcessing may not produce
 *   audible effect — this is an emulator limitation, not a code bug
 * - iOS: not supported (Android-only module)
 */
import { Platform } from "react-native";
import TrackPlayer from "react-native-track-player";
import AutoEQNative from "./AutoEQNative";
import type { EqBandGains, EqBiquadFilter, EqPreset } from "./types";

export default AutoEQNative;
export * from "./types";
export * from "./presets";
export {
  fetchUserProfile,
  fetchUserPresets,
  savePreset,
  deletePreset,
  claimEqMinutes,
  addEqMinutes,
  claimEqMinutesForPlayback,
  isProActive,
} from "./supabase-helpers";
export { useEqualizer } from "./useEqualizer";

// ── initMixerEQ ──────────────────────────────────────────────────────────────
/**
 * ✅ NEW — replaces getAudioSessionId + setupEQ + setupEQAuto.
 *
 * Creates a permanent AudioTrack mixer whose sessionId is available
 * INSTANTLY (before any play() call), attaches DynamicsProcessing to it,
 * and optionally tells TrackPlayer to join that session before playback.
 *
 * Call this ONCE when your MusicPlayerContext mounts (or in App.tsx).
 * It is safe to call multiple times — the native module reuses the
 * existing mixer if one already exists (idempotent).
 *
 * @param configureTrackPlayer — if true (default), automatically calls
 *   TrackPlayer.updateOptions({ androidAudioSessionId }) so future
 *   ExoPlayer instances join the mixer session. Set to false only if
 *   you need to configure RNTP manually.
 *
 * @returns The mixer sessionId (> 0), or null on failure / non-Android.
 *
 * @example
 *   // In your MusicPlayerContext or App.tsx:
 *   useEffect(() => {
 *     initMixerEQ();
 *   }, []);
 */
export async function initMixerEQ(
  configureTrackPlayer: boolean = true
): Promise<number | null> {
  if (Platform.OS !== "android") {
    console.warn("[mavin-eq] initMixerEQ: Android only, skipping");
    return null;
  }

  try {
    console.log("[mavin-eq] 🎚️ initMixerEQ: creating permanent mixer AudioTrack...");
    const sessionId: number = await AutoEQNative.initMixer();

    if (!sessionId || sessionId <= 0) {
      console.warn("[mavin-eq] initMixerEQ: native returned invalid sessionId:", sessionId);
      return null;
    }

    console.log("[mavin-eq] ✅ Mixer ready, sessionId =", sessionId);

    if (configureTrackPlayer) {
      try {
        // Tell RNTP to create its next ExoPlayer instance inside this
        // audio session so it is processed by the DynamicsProcessing EQ.
        await TrackPlayer.updateOptions({
          androidAudioSessionId: sessionId,
        } as any);
        console.log("[mavin-eq] ✅ RNTP configured with mixer sessionId =", sessionId);
      } catch (e) {
        // updateOptions with androidAudioSessionId may not be supported in
        // older RNTP versions — log it but don't fail initMixerEQ.
        // In that case the user must pass sessionId via their RNTP setup manually.
        console.warn(
          "[mavin-eq] ⚠️ TrackPlayer.updateOptions({androidAudioSessionId}) failed.",
          "Pass the sessionId manually to your RNTP setup if needed.",
          e
        );
      }
    }

    return sessionId;
  } catch (e) {
    console.error("[mavin-eq] ❌ initMixerEQ failed:", e);
    return null;
  }
}

// ── getMixerSessionId ────────────────────────────────────────────────────────
/**
 * Returns the current mixer sessionId without re-initialising.
 * Returns null if initMixerEQ hasn't been called yet.
 */
export async function getMixerSessionId(): Promise<number | null> {
  if (Platform.OS !== "android") return null;
  try {
    const id: number = await AutoEQNative.getMixerSessionId();
    return id > 0 ? id : null;
  } catch {
    return null;
  }
}

// ── setupEQ (legacy shim) ────────────────────────────────────────────────────
/**
 * @deprecated Use initMixerEQ() instead.
 *
 * Retained for backwards compatibility. On the new architecture this
 * simply calls AutoEQNative.setupEQ which will prefer the mixer session
 * over the passed audioSessionId if the mixer is already initialised.
 */
export async function setupEQ(audioSessionId: number): Promise<void> {
  console.warn(
    "[mavin-eq] setupEQ() is deprecated. Use initMixerEQ() at app startup instead."
  );
  await AutoEQNative.setupEQ(audioSessionId);
}

// ── applyPreset ──────────────────────────────────────────────────────────────
export async function applyPreset(gains: EqBandGains | number[]): Promise<void> {
  await AutoEQNative.applyBands(gains as number[]);
}

// ── applyParametricPreset ────────────────────────────────────────────────────
export async function applyParametricPreset(
  filters: EqBiquadFilter[],
  preampDb: number = 0
): Promise<void> {
  await AutoEQNative.setParametricFilters(filters, preampDb);
}

// ── applyEqPreset ─────────────────────────────────────────────────────────────
export async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await AutoEQNative.applyBands(preset.gains_31 as number[]);
  } else {
    await AutoEQNative.setParametricFilters(
      preset.biquad_filters,
      preset.preamp_db ?? 0
    );
  }
}

// ── release ──────────────────────────────────────────────────────────────────
/**
 * Releases DynamicsProcessing for the current track.
 * The mixer AudioTrack stays alive so the next track can use it.
 */
export async function release(): Promise<void> {
  await AutoEQNative.release();
}

// ── releaseMixer ─────────────────────────────────────────────────────────────
/**
 * Full teardown of the mixer AudioTrack.
 * Only call this on app close / logout. After this, initMixerEQ() must
 * be called again before any EQ operations.
 */
export async function releaseMixer(): Promise<void> {
  await AutoEQNative.releaseMixer();
}

// ── isSupported ───────────────────────────────────────────────────────────────
export function isSupported(): boolean {
  return Platform.OS === "android";
}