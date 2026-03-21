/**
 * useEqualizer.ts — expo-autoeq-engine
 *
 * Wires the EQ module to MusicPlayerContext's audio session.
 *
 * Key design decisions:
 * - setupEQ() is called only when a song is actively playing AND the user
 *   enables EQ — not on mount. DynamicsProcessing must attach to a live session.
 * - sessionClaimedRef tracks whether minutes were deducted for THIS track.
 *   It resets when audioSessionId changes (new track).
 * - toggle() on an already-setup EQ just calls setEnabled() — no minute deduction.
 * - toggle() on a not-yet-setup EQ runs the full Pro gate → deduct → setupEQ.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import MyEQ, { applyEqPreset } from "../index";
import {
  fetchUserPresets,
  claimEqMinutesForPlayback,
} from "./supabase-helpers";
import { BUILT_IN_PRESETS, FLAT } from "./presets";
import type { EqPreset, EqState } from "./types";

interface UseEqualizerOptions {
  supabase: SupabaseClient;
  /** From TrackPlayer.getAudioSessionId() — pass null when no track loaded */
  audioSessionId: number | null;
  /** Current track duration in seconds */
  trackDuration: number;
  /** Called when EQ minutes are insufficient. Return true if user topped up. */
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>;
}

interface UseEqualizerReturn extends EqState {
  presets: EqPreset[];
  toggle: () => Promise<void>;
  applyPreset: (preset: EqPreset) => Promise<void>;
  setBand: (index: number, gainDb: number) => Promise<void>;
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
    Object.values(BUILT_IN_PRESETS),
  );

  // true = minutes already deducted for this track's session
  // Resets to false when audioSessionId changes (new track)
  const sessionClaimedRef = useRef(false);
  // true = setupEQ() is in-flight, prevents concurrent calls
  const setupInProgressRef = useRef(false);

  // ── Teardown on track change ────────────────────────────────────────────────
  useEffect(() => {
    // New track — reset claim guard
    sessionClaimedRef.current = false;
    setupInProgressRef.current = false;

    return () => {
      // Release when audioSessionId changes or component unmounts
      MyEQ.release().catch((e) => console.warn("[AutoEQ] release:", e));
      setState((s) => ({ ...s, isSetup: false, isEnabled: false }));
    };
  }, [audioSessionId]);

  // ── Load presets from Supabase ──────────────────────────────────────────────
  const refreshPresets = useCallback(async () => {
    try {
      const userPresets = await fetchUserPresets(supabase);
      setPresets([...Object.values(BUILT_IN_PRESETS), ...userPresets]);
    } catch (e) {
      console.warn("[AutoEQ] fetchUserPresets:", e);
    }
  }, [supabase]);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  // ── Toggle EQ on / off ──────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (!audioSessionId) return;

    // Already set up this session — just flip enabled, no minute cost
    if (state.isSetup) {
      const next = !state.isEnabled;
      try {
        await MyEQ.setEnabled(next);
        setState((s) => ({ ...s, isEnabled: next }));
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.message }));
      }
      return;
    }

    // Guard: prevent double-tap or concurrent setup
    if (setupInProgressRef.current) return;
    setupInProgressRef.current = true;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // claimEqMinutesForPlayback checks Pro → deducts minutes → calls setupEQ()
      const ok = await claimEqMinutesForPlayback(
        supabase,
        audioSessionId,
        trackDuration,
        onNeedTopUp,
      );

      if (!ok) {
        setupInProgressRef.current = false;
        setState((s) => ({
          ...s,
          isLoading: false,
          error:
            "EQ requires an active Pro subscription with sufficient minutes.",
        }));
        return;
      }

      sessionClaimedRef.current = true;

      // Re-apply the active preset so it takes effect immediately
      if (state.activePreset) {
        await applyEqPreset(state.activePreset);
        const gains =
          state.activePreset.type === "graphic_31band"
            ? [...state.activePreset.gains_31]
            : state.gains;
        setState((s) => ({
          ...s,
          isSetup: true,
          isEnabled: true,
          isLoading: false,
          gains,
        }));
      } else {
        setState((s) => ({
          ...s,
          isSetup: true,
          isEnabled: true,
          isLoading: false,
        }));
      }
    } catch (e: any) {
      sessionClaimedRef.current = false;
      setState((s) => ({
        ...s,
        isLoading: false,
        error: e?.message ?? "EQ setup failed",
      }));
    } finally {
      setupInProgressRef.current = false;
    }
  }, [audioSessionId, state, supabase, trackDuration, onNeedTopUp]);

  // ── Apply preset ────────────────────────────────────────────────────────────
  const applyPreset = useCallback(
    async (preset: EqPreset) => {
      if (!state.isSetup) return;
      setState((s) => ({ ...s, isLoading: true }));
      try {
        await applyEqPreset(preset);
        const gains =
          preset.type === "graphic_31band"
            ? [...preset.gains_31]
            : await MyEQ.getGains(); // read back computed band gains from parametric
        setState((s) => ({
          ...s,
          activePreset: preset,
          gains,
          isLoading: false,
        }));
      } catch (e: any) {
        setState((s) => ({ ...s, isLoading: false, error: e?.message }));
      }
    },
    [state.isSetup],
  );

  // ── Set single band (optimistic UI) ────────────────────────────────────────
  const setBand = useCallback(
    async (index: number, gainDb: number) => {
      if (!state.isSetup) return;
      // Update UI immediately
      setState((s) => {
        const gains = [...s.gains];
        gains[index] = gainDb;
        return { ...s, gains, activePreset: null };
      });
      try {
        await MyEQ.setBand(index, gainDb);
      } catch (e: any) {
        console.warn("[AutoEQ] setBand:", e?.message);
      }
    },
    [state.isSetup],
  );

  return { ...state, presets, toggle, applyPreset, setBand, refreshPresets };
}
