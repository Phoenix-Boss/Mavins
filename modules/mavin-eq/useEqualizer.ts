/**
 * useEqualizer.ts — mavin-eq (Mixer-First Architecture)
 *
 * PREVIOUS MISTAKES FIXED:
 *
 * 1. autoEnable 350ms delay — removed. This was compensating for ExoPlayer's
 *    frame-render delay before DynamicsProcessing could attach. With the mixer
 *    AudioTrack the EQ is attached at initMixerEQ() time, before any play()
 *    call. There is nothing to wait for.
 *
 * 2. Double setupEQ — fixed. claimEqMinutesForPlayback previously called
 *    AutoEQNative.setupEQ internally, then useEqualizer called it again.
 *    claimEqMinutesForPlayback no longer touches the native EQ — it only
 *    handles the Supabase billing. The hook calls setEnabled(true) directly
 *    after a successful claim.
 *
 * 3. Minutes double-deducted on retry — fixed. The old code re-fired
 *    claimEqMinutesForPlayback if setup() failed and was retried, because
 *    sessionClaimedRef wasn't set until after setupEQ succeeded. Now setup()
 *    is just enabling a pre-initialized EQ — it can't fail due to session
 *    timing, so there is no retry scenario.
 *
 * 4. isEnabled starts false after setupEQ — fixed. With mixer-first the EQ
 *    starts ENABLED in native. setup() here simply claims minutes then calls
 *    setEnabled(true) — which is a no-op confirming the state, not a race.
 *
 * 5. Stale audioSessionId prop — removed entirely. The hook no longer needs
 *    audioSessionId as a prop because the mixer session is managed natively
 *    and persists across track changes. The teardown/re-attach dance on
 *    session ID change is gone.
 *
 * NEW FLOW:
 *   App mount: initMixerEQ() (called ONCE from MusicPlayerContext or App.tsx)
 *                  ↓ (DynamicsProcessing is now attached, enabled=true natively)
 *   User presses play: TrackPlayer.play() → ExoPlayer joins mixer session → EQ active
 *                  ↓
 *   User opens EQ page: useEqualizer mounts → setup() → claimEqMinutes → setEnabled(true)
 *                  ↓
 *   User moves slider: setBand(index, gain) → instant response, no session wait
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AutoEQNative from "./AutoEQNative";
import { fetchUserPresets, claimEqMinutesForPlayback } from "./supabase-helpers";
import { BUILT_IN_PRESETS, FLAT } from "./presets";
import type { EqPreset, EqState, EqBiquadFilter } from "./types";

interface UseEqualizerOptions {
  supabase: SupabaseClient;
  /**
   * Current track duration in seconds — used for billing (EQ minutes).
   * Can be 0 if the track hasn't loaded yet; setup() will still succeed
   * but will deduct 0 minutes (ceil(0/60) = 0).
   */
  trackDuration: number;
  /** Called when EQ minutes are insufficient. Return true if user topped up. */
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>;
  /**
   * If true, automatically call setup() (claim minutes + enable EQ) as soon
   * as the hook mounts. Default: false — user must call toggle() or setup()
   * explicitly.
   *
   * NOTE: unlike the old autoEnable this fires IMMEDIATELY with no delay,
   * because the mixer is already initialised by the time any component mounts.
   */
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
  trackDuration,
  onNeedTopUp,
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

  // Refs for values that setup() needs without causing re-renders
  const isSetupRef         = useRef(false);
  const setupInProgressRef = useRef(false);
  const activePresetRef    = useRef(state.activePreset);

  useEffect(() => {
    activePresetRef.current = state.activePreset;
  }, [state.activePreset]);

  // ── autoEnable ────────────────────────────────────────────────────────────
  // No delay needed — the mixer EQ is already attached by the time this
  // component mounts (initMixerEQ was called at app startup).
  useEffect(() => {
    if (autoEnable && !isSetupRef.current) {
      setup();
    }
    // setup is stable (useCallback with no volatile deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnable]);

  // ── Load presets ──────────────────────────────────────────────────────────
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

  // ── setup ─────────────────────────────────────────────────────────────────
  /**
   * Claim EQ minutes for the current track and enable the EQ.
   *
   * Unlike the old version, this does NOT call AutoEQNative.setupEQ.
   * The mixer's DynamicsProcessing is already attached at initMixerEQ() time.
   * All we need to do here is:
   *   1. Check Pro subscription + deduct minutes (Supabase)
   *   2. Call setEnabled(true) on the native EQ
   *   3. Apply the active preset
   */
  const setup = useCallback(async () => {
    if (setupInProgressRef.current || isSetupRef.current) return;

    setupInProgressRef.current = true;
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // ── Step 1: Billing ────────────────────────────────────────────────
      // claimEqMinutesForPlayback no longer calls setupEQ internally —
      // that was the source of the double-setupEQ bug. It only does Supabase work.
      const mixerSessionId: number = await AutoEQNative.getMixerSessionId();

      if (!mixerSessionId || mixerSessionId <= 0) {
        // Mixer not initialised yet — this means initMixerEQ() was never called.
        // Provide a clear error instead of silently failing.
        setupInProgressRef.current = false;
        setState(s => ({
          ...s,
          isLoading: false,
          error: "EQ mixer not initialised. Call initMixerEQ() at app startup.",
        }));
        return;
      }

      const ok = await claimEqMinutesForPlayback(
        supabase,
        mixerSessionId,
        trackDuration,
        onNeedTopUp
      );

      if (!ok) {
        setupInProgressRef.current = false;
        setState(s => ({
          ...s,
          isLoading: false,
          error: "EQ requires an active Pro subscription with sufficient minutes.",
        }));
        return;
      }

      // ── Step 2: Enable native EQ ───────────────────────────────────────
      // The mixer's DynamicsProcessing is already attached; just flip it on.
      await AutoEQNative.setEnabled(true);
      isSetupRef.current = true;

      // ── Step 3: Apply active preset ────────────────────────────────────
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
  }, [supabase, trackDuration, onNeedTopUp]);

  // ── toggle ────────────────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (!isSetupRef.current) {
      // First toggle → claim minutes + enable
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
      // Roll back optimistic update
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