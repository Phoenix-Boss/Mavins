/**
 * useEqualizer.ts — mavin-eq (Mixer-First Architecture, FREE VERSION)
 *
 * CHANGES:
 * - Removed Pro subscription checks
 * - Removed EQ minutes billing
 * - Removed authentication requirements
 * - Simplified setup() - just enables EQ directly
 * - Removed error state for "Pro required"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AutoEQNative from "./AutoEQNative";
import { fetchUserPresets } from "./supabase-helpers";
import { BUILT_IN_PRESETS, FLAT } from "./presets";
import type { EqPreset, EqState, EqBiquadFilter } from "./types";

interface UseEqualizerOptions {
  supabase: SupabaseClient;
  /** Kept for API compatibility, not used */
  trackDuration?: number;
  /** If true, automatically enable EQ on mount */
  autoEnable?: boolean;
}

interface UseEqualizerReturn extends EqState {
  presets: EqPreset[];
  toggle: () => Promise<void>;
  applyPreset: (preset: EqPreset) => Promise<void>;
  setBand: (index: number, gainDb: number) => Promise<void>;
  refreshPresets: () => Promise<void>;
  setup: () => Promise<void>;
}

// ── local helper ─────────────────────────────────────────────────────────────
async function applyEqPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band") {
    await AutoEQNative.applyBands(preset.gains_31 as number[]);
  } else {
    await AutoEQNative.setParametricFilters(
      preset.biquad_filters as EqBiquadFilter[],
      preset.preamp_db ?? 0
    );
  }
}

export function useEqualizer({
  supabase,
  trackDuration = 0,
  autoEnable = false,
}: UseEqualizerOptions): UseEqualizerReturn {

  const [state, setState] = useState<EqState>({
    isSetup:      false,
    isEnabled:    false,
    gains:        [...FLAT],
    activePreset: BUILT_IN_PRESETS.flat,
    isLoading:    false,
    error:        null,
  });

  const [presets, setPresets] = useState<EqPreset[]>(
    Object.values(BUILT_IN_PRESETS)
  );

  const isSetupRef         = useRef(false);
  const setupInProgressRef = useRef(false);
  const activePresetRef    = useRef(state.activePreset);

  useEffect(() => {
    activePresetRef.current = state.activePreset;
  }, [state.activePreset]);

  // ── autoEnable ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoEnable && !isSetupRef.current) {
      setup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnable]);

  // ── Load presets ──────────────────────────────────────────────────────────
  const refreshPresets = useCallback(async () => {
    try {
      const userPresets = await fetchUserPresets(supabase);
      setPresets([...Object.values(BUILT_IN_PRESETS), ...userPresets]);
    } catch (e) {
      // Silently fail - presets are optional
      console.log("[AutoEQ] Could not load user presets");
    }
  }, [supabase]);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  // ── setup ─────────────────────────────────────────────────────────────────
  /**
   * Enable the EQ - no billing, no Pro check, just works.
   * The mixer's DynamicsProcessing is already attached at initMixerEQ() time.
   */
  const setup = useCallback(async () => {
    if (setupInProgressRef.current || isSetupRef.current) return;

    setupInProgressRef.current = true;
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // Check mixer is ready
      const mixerSessionId: number = await AutoEQNative.getMixerSessionId();

      if (!mixerSessionId || mixerSessionId <= 0) {
        setupInProgressRef.current = false;
        setState(s => ({
          ...s,
          isLoading: false,
          error: "EQ mixer not initialised. Restart the app.",
        }));
        return;
      }

      // ✅ FREE EQ - No billing, no Pro check
      // Just enable the native EQ
      await AutoEQNative.setEnabled(true);
      isSetupRef.current = true;

      // Apply active preset
      const preset = activePresetRef.current;
      if (preset) {
        await applyEqPreset(preset);
      }

      const gains =
        preset?.type === "graphic_31band"
          ? [...preset.gains_31]
          : [...FLAT];

      setState(s => ({
        ...s,
        isSetup:   true,
        isEnabled: true,
        isLoading: false,
        gains,
      }));

    } catch (e: any) {
      isSetupRef.current = false;
      setState(s => ({
        ...s,
        isLoading: false,
        error: e?.message ?? "EQ setup failed",
      }));
    } finally {
      setupInProgressRef.current = false;
    }
  }, []);

  // ── toggle ────────────────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (!isSetupRef.current) {
      await setup();
      return;
    }

    setState(s => {
      const next = !s.isEnabled;
      AutoEQNative.setEnabled(next).catch((e: any) =>
        setState(ss => ({ ...ss, error: e?.message }))
      );
      return { ...s, isEnabled: next };
    });
  }, [setup]);

  // ── applyPreset ───────────────────────────────────────────────────────────
  const applyPreset = useCallback(async (preset: EqPreset) => {
    if (!isSetupRef.current) {
      setState(s => ({ ...s, error: "EQ not active. Use toggle() first." }));
      return;
    }
    setState(s => ({ ...s, isLoading: true }));
    try {
      await applyEqPreset(preset);
      const gains =
        preset.type === "graphic_31band"
          ? [...preset.gains_31]
          : await AutoEQNative.getGains().then((g: any[]) =>
              g.map((item: any) => item.gain)
            );
      setState(s => ({ ...s, activePreset: preset, gains, isLoading: false }));
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e?.message }));
    }
  }, []);

  // ── setBand ───────────────────────────────────────────────────────────────
  const setBand = useCallback(async (index: number, gainDb: number) => {
    if (!isSetupRef.current) {
      console.warn("[AutoEQ] setBand: EQ not active, call toggle() first");
      return;
    }
    // Optimistic UI update
    setState(s => {
      const gains = [...s.gains];
      gains[index] = gainDb;
      return { ...s, gains, activePreset: null };
    });
    try {
      await AutoEQNative.setBand(index, gainDb);
    } catch (e: any) {
      console.warn("[AutoEQ] setBand failed:", e?.message);
      // Roll back
      setState(s => {
        const gains = [...s.gains];
        gains[index] = 0;
        return { ...s, gains };
      });
    }
  }, []);

  return {
    ...state,
    presets,
    toggle,
    applyPreset,
    setBand,
    refreshPresets,
    setup,
  };
}