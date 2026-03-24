/**
 * useEqualizer.ts — mavin-eq
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
 * - release() is only called on cleanup when a PRIOR valid session existed,
 *   preventing spurious calls on the initial null → null transition.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AutoEQNative from "./AutoEQNative";
import {
  fetchUserPresets,
  claimEqMinutesForPlayback,
} from "./supabase-helpers";
import { BUILT_IN_PRESETS, FLAT } from "./presets";
import type { EqPreset, EqState, EqBiquadFilter } from "./types";

interface UseEqualizerOptions {
  supabase: SupabaseClient;
  /**
   * The ExoPlayer audio session ID for the currently playing track.
   * Obtain this by calling getAudioSessionId() from mavin-eq AFTER
   * TrackPlayer.play() has started, then pass it here.
   * Pass null when no track is loaded or the player is idle.
   */
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

// ── applyEqPreset (local, no index import needed) ────────────────────────────
async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await AutoEQNative.applyBands(preset.gains_31 as number[]);
  } else {
    await AutoEQNative.setParametricFilters(
      preset.biquad_filters as EqBiquadFilter[],
      preset.preamp_db ?? 0,
    );
  }
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

  // true = minutes already deducted for this track's session.
  // Resets to false when audioSessionId changes (new track).
  const sessionClaimedRef = useRef(false);
  // true = setupEQ() is in-flight, prevents concurrent calls.
  const setupInProgressRef = useRef(false);
  // Track the previous session ID so we only release when a real session existed.
  const prevSessionIdRef = useRef<number | null>(null);

  // ── Teardown on track change ──────────────────────────────────────────────
  // Only call release() if a previous valid session was set up. Skipping this
  // guard caused release() to fire on the initial render (null → null) and on
  // the first real track load (null → id), neither of which has a live DP instance.
  useEffect(() => {
    sessionClaimedRef.current = false;
    setupInProgressRef.current = false;

    const prevId = prevSessionIdRef.current;
    prevSessionIdRef.current = audioSessionId;

    if (prevId !== null && prevId > 0) {
      // A real session was previously active — release the DynamicsProcessing instance.
      AutoEQNative.release().catch((e) =>
        console.warn("[AutoEQ] release on session change:", e),
      );
      setState((s) => ({ ...s, isSetup: false, isEnabled: false }));
    }
  }, [audioSessionId]);

  // ── Load presets from Supabase ────────────────────────────────────────────
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

  // ── Toggle EQ on / off ────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (!audioSessionId) return;

    // Already set up this session — just flip enabled, no minute cost.
    if (state.isSetup) {
      const next = !state.isEnabled;
      try {
        await AutoEQNative.setEnabled(next);
        setState((s) => ({ ...s, isEnabled: next }));
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.message }));
      }
      return;
    }

    // Guard: prevent double-tap or concurrent setup.
    if (setupInProgressRef.current) return;
    setupInProgressRef.current = true;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // claimEqMinutesForPlayback: Pro check → deduct minutes → setupEQ()
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

      // Re-apply the active preset so it takes effect immediately.
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

  // ── Apply preset ──────────────────────────────────────────────────────────
  const applyPreset = useCallback(
    async (preset: EqPreset) => {
      if (!state.isSetup) return;
      setState((s) => ({ ...s, isLoading: true }));
      try {
        await applyEqPreset(preset);
        const gains =
          preset.type === "graphic_31band"
            ? [...preset.gains_31]
            : await AutoEQNative.getGains(); // read back computed band gains
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

  // ── Set single band (optimistic UI) ──────────────────────────────────────
  const setBand = useCallback(
    async (index: number, gainDb: number) => {
      if (!state.isSetup) return;
      setState((s) => {
        const gains = [...s.gains];
        gains[index] = gainDb;
        return { ...s, gains, activePreset: null };
      });
      try {
        await AutoEQNative.setBand(index, gainDb);
      } catch (e: any) {
        console.warn("[AutoEQ] setBand:", e?.message);
      }
    },
    [state.isSetup],
  );

  return { ...state, presets, toggle, applyPreset, setBand, refreshPresets };
}