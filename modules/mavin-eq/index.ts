/**
 * index.ts — mavin-eq
 * 
 * Usage:
 * import MyEQ, { applyPreset } from "@/modules/mavin-eq";
 * import { NativeModules } from 'react-native';
 * 
 * // Called AFTER a song has started playing:
 * // ⚠️ TrackPlayer.getAudioSessionId() does NOT exist on JS bridge
 * // Use NativeModules directly instead:
 * const mod = NativeModules.TrackPlayerModule ?? NativeModules.TrackPlayer;
 * const sessionId = await mod.getAudioSessionId();
 * 
 * await MyEQ.setupEQ(sessionId);
 * await applyPreset(BUILT_IN_PRESETS.harman.gains_31);
 * 
 * // On track change / player destroy:
 * await MyEQ.release();
 * 
 * Platform Notes:
 * - iOS Simulator / Android Emulator: getAudioSessionId() may return null
 * - Physical devices: Session ID available for native EQ processing
 * - Graceful fallback: EQ UI works without native audio processing
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

// ── Helper: Get Audio Session ID (matches equalizer.tsx implementation) ──────
/**
 * Retrieve native audio session ID for EQ attachment.
 * ⚠️ Returns null on simulators/emulators — test on physical device.
 * 
 * @example
 * const sessionId = await getAudioSessionId();
 * if (sessionId) {
 *   await MyEQ.setupEQ(sessionId);
 * }
 */
export async function getAudioSessionId(): Promise<number | null> {
  try {
    const { NativeModules } = await import('react-native');
    const mod = NativeModules.TrackPlayerModule ?? NativeModules.TrackPlayer;
    
    if (typeof mod?.getAudioSessionId !== 'function') {
      console.warn('[mavin-eq] getAudioSessionId not available on this platform');
      return null;
    }
    
    const id: number = await mod.getAudioSessionId();
    return id > 0 ? id : null;
  } catch (e) {
    console.warn('[mavin-eq] getAudioSessionId error:', e);
    return null;
  }
}