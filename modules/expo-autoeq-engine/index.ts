/**
 * index.ts — expo-autoeq-engine
 *
 * Usage:
 *   import MyEQ, { applyPreset } from "mavin-eq";
 *
 *   // Called inside MusicPlayerContext when a song starts playing:
 *   const sessionId = await TrackPlayer.getAudioSessionId();
 *   await MyEQ.setupEQ(sessionId);
 *   await applyPreset(BUILT_IN_PRESETS.harman.gains_31);
 *
 *   // On track change / player destroy:
 *   await MyEQ.release();
 */

import { NativeModulesProxy } from "expo-modules-core";
import type {
  AutoEQNativeModule,
  EqBandGains,
  EqBiquadFilter,
  EqPreset,
} from "../expo-autoeq-engine/src/types";

const AutoEQNative = NativeModulesProxy.AutoEQModule as AutoEQNativeModule;

if (!AutoEQNative) {
  console.error(
    "[mavin-eq] AutoEQModule not found. " +
      "Run `npx expo run:android` (not Expo Go).",
  );
}

export default AutoEQNative;

export * from "../expo-autoeq-engine/src/types";
export * from "../expo-autoeq-engine/src/presets";
export {
  fetchUserProfile,
  fetchUserPresets,
  savePreset,
  deletePreset,
  claimEqMinutes,
  addEqMinutes,
  claimEqMinutesForPlayback,
  isProActive,
} from "../expo-autoeq-engine/src/supabase-helpers";
export { useEqualizer } from "../expo-autoeq-engine/src/useEqualizer";

// ── applyPreset ───────────────────────────────────────────────────────────────
/** Apply a 31-band graphic preset in one bridge call. */
export async function applyPreset(
  gains: EqBandGains | number[],
): Promise<void> {
  await AutoEQNative.applyBands(gains as number[]);
}

// ── applyParametricPreset ─────────────────────────────────────────────────────
/** Apply an AutoEq parametric preset (from Supabase or autoeq-parser). */
export async function applyParametricPreset(
  filters: EqBiquadFilter[],
  preampDb: number = 0,
): Promise<void> {
  await AutoEQNative.setParametricFilters(filters, preampDb);
}

// ── applyEqPreset ─────────────────────────────────────────────────────────────
/** Unified — handles both graphic and parametric presets. */
export async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await applyPreset(preset.gains_31);
  } else {
    await applyParametricPreset(preset.biquad_filters, preset.preamp_db ?? 0);
  }
}
