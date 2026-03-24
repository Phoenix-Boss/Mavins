/**
 * index.ts — mavin-eq
 *
 * Usage:
 * import MyEQ, { getAudioSessionId, applyPreset } from "@/modules/mavin-eq";
 *
 * // Called AFTER TrackPlayer.play() has started audio rendering:
 * const sessionId = await getAudioSessionId();
 * if (sessionId) {
 *   await MyEQ.setupEQ(sessionId);
 *   await applyPreset(BUILT_IN_PRESETS.harman.gains_31);
 * }
 *
 * // On track change / player destroy:
 * await MyEQ.release();
 *
 * Platform Notes:
 * - Android physical device: session ID available after play() begins
 * - Android emulator: DynamicsProcessing may attach but produce no audible effect
 * - iOS: DynamicsProcessing is Android-only; this module is Android-only per expo-module.config.json
 */

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

// ── applyPreset ───────────────────────────────────────────────────────────────
/**
 * Apply a 31-band graphic preset in one bridge call.
 * @param gains - Array of 31 gain values in dB (-12 to +12)
 */
export async function applyPreset(
  gains: EqBandGains | number[],
): Promise<void> {
  await AutoEQNative.applyBands(gains as number[]);
}

// ── applyParametricPreset ─────────────────────────────────────────────────────
/**
 * Apply an AutoEq parametric preset (from Supabase or autoeq-parser).
 * @param filters - Array of biquad filter definitions
 * @param preampDb - Preamp gain in dB (default: 0)
 */
export async function applyParametricPreset(
  filters: EqBiquadFilter[],
  preampDb: number = 0,
): Promise<void> {
  await AutoEQNative.setParametricFilters(filters, preampDb);
}

// ── applyEqPreset ─────────────────────────────────────────────────────────────
/**
 * Unified preset applier — handles both graphic and parametric presets.
 * @param preset - EqPreset object with type discrimination
 */
export async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await AutoEQNative.applyBands(preset.gains_31 as number[]);
  } else {
    await AutoEQNative.setParametricFilters(
      preset.biquad_filters,
      preset.preamp_db ?? 0,
    );
  }
}

// ── getAudioSessionId ─────────────────────────────────────────────────────────
/**
 * Retrieve the ExoPlayer audio session ID via AutoEQModule's native bridge.
 * AutoEQModule internally reflects into RNTP's patched MusicModule to read
 * exoPlayer.audioSessionId — the real active session, not a new generated one.
 *
 * ⚠️  Call this AFTER TrackPlayer.play() has started audio rendering.
 *     Returns null if the player is idle or the session is not yet available.
 *
 * @example
 * await TrackPlayer.play();
 * const sessionId = await getAudioSessionId();
 * if (sessionId) {
 *   await MyEQ.setupEQ(sessionId);
 * }
 */
export async function getAudioSessionId(): Promise<number | null> {
  try {
    const id = await AutoEQNative.getAudioSessionId();
    return id > 0 ? id : null;
  } catch (e) {
    console.warn("[mavin-eq] getAudioSessionId error:", e);
    return null;
  }
}