// mavin-eq/index.ts

import { Platform } from "react-native";
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
 * Step 1 of 2 in the EQ setup sequence.
 *
 * Creates a permanent AudioTrack ("mixer") whose sessionId is available
 * INSTANTLY at construction time. Attaches DynamicsProcessing to it.
 *
 * Always call this BEFORE setupPlayer() so you can pass androidAudioSessionId
 * on fresh installs. Then call injectMixerSession() after setupPlayer() to
 * handle the native-boot race case where RNTP self-initialized without it.
 *
 * Returns the mixer sessionId, or null on failure / non-Android.
 */
export async function initMixerEQ(): Promise<number | null> {
  if (Platform.OS !== "android") return null;

  try {
    console.log("[mavin-eq] 🎚️ initMixerEQ: creating permanent mixer AudioTrack...");
    const sessionId: number = await AutoEQNative.initMixer();

    if (!sessionId || sessionId <= 0) {
      console.warn("[mavin-eq] initMixerEQ: native returned invalid sessionId:", sessionId);
      return null;
    }

    console.log("[mavin-eq] ✅ Mixer ready, sessionId =", sessionId);
    return sessionId;
  } catch (e) {
    console.error("[mavin-eq] ❌ initMixerEQ failed:", e);
    return null;
  }
}

// ── injectMixerSession ───────────────────────────────────────────────────────
/**
 * Step 2 of 2 in the EQ setup sequence.
 *
 * Call this immediately after TrackPlayer.setupPlayer() resolves.
 *
 * Finds RNTP's ExoPlayer via the React Native NativeModule registry and calls
 * exoPlayer.setAudioSessionId(mixerSessionId) directly. This routes ExoPlayer's
 * audio output into the same AudioFlinger session as the mixer, where
 * DynamicsProcessing is already attached and processing audio.
 *
 * This is the permanent fix for the native-boot race: even if RNTP's
 * MusicService self-initialized ExoPlayer before JS ran (ignoring
 * androidAudioSessionId from setupPlayer), this call corrects the session
 * binding directly on the ExoPlayer instance.
 *
 * Returns { sessionId, strategy } or null on failure / non-Android.
 */
export async function injectMixerSession(): Promise<{ sessionId: number; strategy: string } | null> {
  if (Platform.OS !== "android") return null;

  try {
    const result = await AutoEQNative.injectMixerSession();
    console.log("[mavin-eq] ✅ injectMixerSession:", result);
    return result;
  } catch (e) {
    console.warn("[mavin-eq] ⚠️ injectMixerSession failed:", e);
    return null;
  }
}

// ── getMixerSessionId ────────────────────────────────────────────────────────
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
/** @deprecated Use initMixerEQ() + injectMixerSession() instead. */
export async function setupEQ(audioSessionId: number): Promise<void> {
  console.warn("[mavin-eq] setupEQ() is deprecated. Use initMixerEQ() + injectMixerSession() instead.");
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
    await AutoEQNative.setParametricFilters(preset.biquad_filters, preset.preamp_db ?? 0);
  }
}

// ── release ──────────────────────────────────────────────────────────────────
export async function release(): Promise<void> {
  await AutoEQNative.release();
}

// ── releaseMixer ─────────────────────────────────────────────────────────────
export async function releaseMixer(): Promise<void> {
  await AutoEQNative.releaseMixer();
}

// ── isSupported ───────────────────────────────────────────────────────────────
export function isSupported(): boolean {
  return Platform.OS === "android";
}