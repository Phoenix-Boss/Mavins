/**
 * index.ts — expo-autoeq-engine
 *
 * Public API surface for the EQ module.
 *
 * Usage:
 *   import MyEQ, { applyPreset, applyBiquadPreset } from "expo-autoeq-engine";
 *
 *   // 1. Wire EQ to the player's audio session (call on every track change)
 *   await MyEQ.setupEQ(audioSessionId);
 *
 *   // 2a. Apply a built-in or Supabase graphic preset (single bridge call)
 *   await applyPreset(BUILT_IN_PRESETS.harman.gains_31);
 *
 *   // 2b. Apply a biquad parametric preset from Supabase
 *   await applyBiquadPreset(preset.biquad_filters);
 *
 *   // 3. Toggle without releasing
 *   await MyEQ.setEnabled(false);
 *
 *   // 4. Always release on track change or player destroy
 *   await MyEQ.release();
 */

import { NativeModulesProxy } from "expo-modules-core";
import type {
  AutoEQNativeModule,
  EqBandGains,
  EqBandIndex,
  EqBiquadFilter,
  EqBiquadType,
  EqPreset,
} from "./types";

// ── Native module binding ─────────────────────────────────────────────────────
// expo-modules-core's NativeModulesProxy bridges to the Kotlin AutoEQModule.
// The string "AutoEQModule" must match getName() / Name("AutoEQModule") in Kotlin.
const AutoEQNative = NativeModulesProxy.AutoEQModule as AutoEQNativeModule;

if (!AutoEQNative) {
  console.error(
    "[expo-autoeq-engine] AutoEQModule native module not found. " +
    "Make sure you are running a Dev Client build (not Expo Go) and " +
    "have run `eas build` or `npx expo run:android`."
  );
}

export default AutoEQNative;

// ── Re-exports ────────────────────────────────────────────────────────────────
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

// ── applyPreset ───────────────────────────────────────────────────────────────
/**
 * Apply a full 31-band graphic preset in a single native bridge call.
 * Much faster than calling setBand() 31 times.
 *
 * @param gains  Array of 31 dB values (-12..+12), ordered 20 Hz → 20 kHz.
 */
export async function applyPreset(gains: EqBandGains | number[]): Promise<void> {
  // applyBands() sends all 31 values in one bridge call
  await AutoEQNative.applyBands(gains as number[]);
}

// ── applyBiquadPreset ─────────────────────────────────────────────────────────
/**
 * Apply a parametric biquad preset (as stored in Supabase biquad_filters).
 * Each filter is applied to its specified band index.
 *
 * @param filters  Array of EqBiquadFilter objects from a biquad EqPreset.
 */
export async function applyBiquadPreset(filters: EqBiquadFilter[]): Promise<void> {
  for (const f of filters) {
    await AutoEQNative.setBiquadParam(f.type, f.bandIndex, f.fc, f.gainDb);
  }
}

// ── applyEqPreset ─────────────────────────────────────────────────────────────
/**
 * Unified preset applicator — handles both graphic and biquad presets.
 * Use this when you don't know the preset type at the call site.
 */
export async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await applyPreset(preset.gains_31);
  } else {
    await applyBiquadPreset(preset.biquad_filters);
  }
}
