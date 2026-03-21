/**
 * useEqualizer.ts — expo-autoeq-engine
 *
 * React hook that wires the EQ module to your player and Supabase.
 * Manages setup, teardown, preset application, and UI state in one place.
 *
 * Usage in your player or EQ screen:
 *
 *   const eq = useEqualizer({ supabase, audioSessionId, trackDuration });
 *
 *   // Toggle EQ on/off
 *   <Switch value={eq.isEnabled} onValueChange={eq.toggle} />
 *
 *   // Apply a preset
 *   <Button onPress={() => eq.applyPreset(BUILT_IN_PRESETS.harman)} />
 *
 *   // Render sliders from eq.gains
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import MyEQ, { applyEqPreset } from "./index";
import { fetchUserPresets, claimEqMinutesForPlayback } from "./supabase-helpers";
import { BUILT_IN_PRESETS, FLAT } from "./presets";
import type { EqPreset, EqState } from "./types";

interface UseEqualizerOptions {
  /** Your authenticated Supabase client */
  supabase: SupabaseClient;
  /** Audio session ID from TrackPlayer.getAudioSessionId() */
  audioSessionId: number | null;
  /** Current track duration in seconds — used for minute deduction */
  trackDuration: number;
  /**
   * Called when the user needs more EQ minutes.
   * Return true if they completed a top-up (e.g. opened purchase sheet and confirmed).
   * Return false to abort EQ setup.
   */
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>;
}

interface UseEqualizerReturn extends EqState {
  /** All presets: built-ins + user's Supabase presets */
  presets: EqPreset[];
  /** Toggle EQ on or off (keeps setup alive for instant re-enable) */
  toggle: () => Promise<void>;
  /** Apply a preset and update the gains in UI state */
  applyPreset: (preset: EqPreset) => Promise<void>;
  /** Adjust a single band gain in UI state and apply to native */
  setBand: (index: number, gainDb: number) => Promise<void>;
  /** Refresh presets from Supabase */
  refreshPresets: () => Promise<void>;
}

export function useEqualizer({
  supabase,
  audioSessionId,
  trackDuration,
  onNeedTopUp,
}: UseEqualizerOptions): UseEqualizerReturn {

  const [state, setState] = useState<EqState>({
    isSetup: false,
    isEnabled: false,
    gains: [...FLAT],
    activePreset: BUILT_IN_PRESETS.flat,
    isLoading: false,
    error: null,
  });

  const [presets, setPresets] = useState<EqPreset[]>(
    Object.values(BUILT_IN_PRESETS)
  );

  // Track whether we've claimed EQ minutes for the current session.
  // Prevents double-deduction if the hook re-renders.
  const sessionClaimedRef = useRef(false);

  // ── Setup / teardown on track change ────────────────────────────────────────
  useEffect(() => {
    if (!audioSessionId) return;
    sessionClaimedRef.current = false;

    // Teardown on track change — always release the old AudioEffect chain
    return () => {
      MyEQ.release().catch((e) =>
        console.warn("[AutoEQ] release error:", e)
      );
      setState((s) => ({ ...s, isSetup: false, isEnabled: false }));
    };
  }, [audioSessionId]);

  // ── Load user presets from Supabase ─────────────────────────────────────────
  const refreshPresets = useCallback(async () => {
    try {
      const userPresets = await fetchUserPresets(supabase);
      setPresets([...Object.values(BUILT_IN_PRESETS), ...userPresets]);
    } catch (e) {
      console.warn("[AutoEQ] fetchUserPresets error:", e);
    }
  }, [supabase]);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  // ── Toggle ───────────────────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (!audioSessionId) return;

    if (state.isSetup) {
      // Already set up — just toggle enabled state (no minute deduction)
      const next = !state.isEnabled;
      await MyEQ.setEnabled(next);
      setState((s) => ({ ...s, isEnabled: next }));
      return;
    }

    // First enable for this track — claim minutes and set up
    if (sessionClaimedRef.current) return; // guard against double-tap
    sessionClaimedRef.current = true;

    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const ok = await claimEqMinutesForPlayback(
        supabase,
        audioSessionId,
        trackDuration,
        onNeedTopUp
      );

      if (!ok) {
        sessionClaimedRef.current = false;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: "EQ requires an active Pro subscription with sufficient minutes.",
        }));
        return;
      }

      // Re-apply the last active preset after setup
      if (state.activePreset) {
        await applyEqPreset(state.activePreset);
        const gains = state.activePreset.type === "graphic_31band"
          ? [...state.activePreset.gains_31]
          : state.gains;
        setState((s) => ({ ...s, isSetup: true, isEnabled: true, isLoading: false, gains }));
      } else {
        setState((s) => ({ ...s, isSetup: true, isEnabled: true, isLoading: false }));
      }
    } catch (e: any) {
      sessionClaimedRef.current = false;
      setState((s) => ({ ...s, isLoading: false, error: e?.message ?? "Unknown EQ error" }));
    }
  }, [audioSessionId, state, supabase, trackDuration, onNeedTopUp]);

  // ── Apply preset ─────────────────────────────────────────────────────────────
  const applyPreset = useCallback(async (preset: EqPreset) => {
    if (!state.isSetup) return;

    setState((s) => ({ ...s, isLoading: true }));
    try {
      await applyEqPreset(preset);
      const gains = preset.type === "graphic_31band"
        ? [...preset.gains_31]
        : state.gains; // biquad presets don't map 1:1 to all 31 bands
      setState((s) => ({
        ...s,
        activePreset: preset,
        gains,
        isLoading: false,
      }));
    } catch (e: any) {
      setState((s) => ({ ...s, isLoading: false, error: e?.message }));
    }
  }, [state.isSetup, state.gains]);

  // ── Set single band ──────────────────────────────────────────────────────────
  const setBand = useCallback(async (index: number, gainDb: number) => {
    if (!state.isSetup) return;

    // Optimistic UI update — update gains array immediately
    setState((s) => {
      const gains = [...s.gains];
      gains[index] = gainDb;
      return { ...s, gains, activePreset: null }; // clear preset name since custom
    });

    try {
      await MyEQ.setBand(index, gainDb);
    } catch (e: any) {
      console.warn("[AutoEQ] setBand error:", e?.message);
    }
  }, [state.isSetup]);

  return {
    ...state,
    presets,
    toggle,
    applyPreset,
    setBand,
    refreshPresets,
  };
}
