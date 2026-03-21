/**
 * supabase-helpers.ts — expo-autoeq-engine
 *
 * All Supabase interactions for the EQ module:
 *   - fetchUserProfile()         → Pro status + eq_minutes_remaining
 *   - fetchUserPresets()         → user's saved 31-band / biquad presets
 *   - savePreset()               → persist a new preset to Supabase
 *   - deletePreset()             → remove a preset by id
 *   - claimEqMinutes()           → deduct minutes via RPC (atomic, safe)
 *   - addEqMinutes()             → top-up after purchase
 *   - claimEqMinutesForPlayback()→ full Pro gate: check → deduct → setupEQ
 *
 * Import your Supabase client from wherever it lives in your app.
 * This file does NOT create a Supabase client — it receives one as a parameter
 * so it works with your existing auth session.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EqPreset, EqBiquadFilter, EqBandGains } from "./types";
import MyEQ from "./index";

// ── Supabase row shapes ───────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  is_pro: boolean;
  pro_ends_at: string | null;
  eq_minutes_remaining: number;
}

interface PresetRow {
  id: string;
  user_id: string;
  name: string;
  type: "graphic_31band" | "biquad";
  gains_31: number[] | null;
  biquad_filters: EqBiquadFilter[] | null;
  created_at: string;
}

// ── Profile ───────────────────────────────────────────────────────────────────

/**
 * Fetch the current user's Pro status and remaining EQ minutes.
 * Returns null if the user is not authenticated.
 */
export async function fetchUserProfile(
  supabase: SupabaseClient
): Promise<ProfileRow | null> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, is_pro, pro_ends_at, eq_minutes_remaining")
    .eq("id", authData.user.id)
    .single();

  if (error) throw new Error(`fetchUserProfile: ${error.message}`);
  return data as ProfileRow;
}

/**
 * Returns true if the profile has an active, unexpired Pro subscription.
 */
export function isProActive(profile: ProfileRow): boolean {
  if (!profile.is_pro) return false;
  if (!profile.pro_ends_at) return true; // lifetime / no expiry
  return new Date(profile.pro_ends_at) > new Date();
}

// ── EQ minutes ────────────────────────────────────────────────────────────────

/**
 * Atomically deduct `minutes` from the current user's eq_minutes_remaining.
 * Calls the `deduct_eq_minutes` Supabase RPC which:
 *   1. Checks remaining >= requested amount.
 *   2. Deducts atomically.
 *   3. Inserts a row in eq_usage for audit.
 *   4. Returns true on success, false if insufficient balance.
 */
export async function claimEqMinutes(
  supabase: SupabaseClient,
  minutes: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc("deduct_eq_minutes", {
    p_minutes: minutes,
  });
  if (error) throw new Error(`claimEqMinutes: ${error.message}`);
  return data === true;
}

/**
 * Add minutes to the current user's balance after a successful purchase.
 * Call this after Stripe / IAP confirmation — not before.
 */
export async function addEqMinutes(
  supabase: SupabaseClient,
  minutes: number
): Promise<void> {
  const { error } = await supabase.rpc("add_eq_minutes", {
    p_minutes: minutes,
  });
  if (error) throw new Error(`addEqMinutes: ${error.message}`);
}

// ── Full Pro gate ─────────────────────────────────────────────────────────────

/**
 * claimEqMinutesForPlayback
 *
 * The full Pro gate. Call this when the user enables EQ for a track.
 *
 * Flow:
 *   1. Check Pro status — reject if expired or not subscribed.
 *   2. Compute minutes needed from durationSeconds.
 *   3. Check balance — if insufficient, surface top-up prompt via onNeedTopUp().
 *   4. Atomically deduct minutes from Supabase.
 *   5. Call MyEQ.setupEQ(audioSessionId) only on success.
 *
 * @param supabase        Your Supabase client (authenticated).
 * @param audioSessionId  From TrackPlayer.getAudioSessionId().
 * @param durationSeconds Track duration — used to compute minutes needed.
 * @param onNeedTopUp     Optional callback when balance is insufficient.
 *                        Return true if the user completed a top-up, false to abort.
 * @returns true if EQ was successfully set up, false if aborted.
 */
export async function claimEqMinutesForPlayback(
  supabase: SupabaseClient,
  audioSessionId: number,
  durationSeconds: number,
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>
): Promise<boolean> {
  const profile = await fetchUserProfile(supabase);

  if (!profile) {
    console.warn("[AutoEQ] User not authenticated");
    return false;
  }

  // 1. Pro check
  if (!isProActive(profile)) {
    console.warn("[AutoEQ] Pro subscription required or expired");
    return false;
  }

  // 2. Compute minutes (round up — partial minutes cost a full minute)
  const minutesNeeded = Math.ceil(durationSeconds / 60);

  // 3. Balance check
  if (profile.eq_minutes_remaining < minutesNeeded) {
    if (!onNeedTopUp) return false;
    const didTopUp = await onNeedTopUp(minutesNeeded, profile.eq_minutes_remaining);
    if (!didTopUp) return false;
  }

  // 4. Deduct atomically — the RPC handles the race condition
  const success = await claimEqMinutes(supabase, minutesNeeded);
  if (!success) {
    console.warn("[AutoEQ] claimEqMinutes returned false — insufficient balance");
    return false;
  }

  // 5. Wire up EQ now that we have the budget
  await MyEQ.setupEQ(audioSessionId);
  return true;
}

// ── Presets ───────────────────────────────────────────────────────────────────

/**
 * Fetch all EQ presets saved by the current user.
 * Returns built-in presets should be merged client-side with BUILT_IN_PRESETS.
 */
export async function fetchUserPresets(
  supabase: SupabaseClient
): Promise<EqPreset[]> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return [];

  const { data, error } = await supabase
    .from("eq_presets")
    .select("id, name, type, gains_31, biquad_filters, created_at")
    .eq("user_id", authData.user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`fetchUserPresets: ${error.message}`);

  return (data as PresetRow[]).map((row) => {
    if (row.type === "graphic_31band") {
      return {
        id: row.id,
        name: row.name,
        type: "graphic_31band",
        gains_31: row.gains_31 as EqBandGains,
      };
    }
    return {
      id: row.id,
      name: row.name,
      type: "biquad",
      biquad_filters: row.biquad_filters as EqBiquadFilter[],
    };
  }) as EqPreset[];
}

/**
 * Save a new preset to Supabase.
 * Returns the created preset row id.
 */
export async function savePreset(
  supabase: SupabaseClient,
  preset: Omit<EqPreset, "id">
): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Not authenticated");

  const row = {
    user_id: authData.user.id,
    name: preset.name,
    type: preset.type,
    gains_31: preset.type === "graphic_31band" ? preset.gains_31 : null,
    biquad_filters: preset.type === "biquad" ? preset.biquad_filters : null,
  };

  const { data, error } = await supabase
    .from("eq_presets")
    .insert(row)
    .select("id")
    .single();

  if (error) throw new Error(`savePreset: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Delete a preset by id. Only deletes presets owned by the current user
 * (Supabase RLS enforces this — the DELETE will silently no-op if the
 * user doesn't own the row).
 */
export async function deletePreset(
  supabase: SupabaseClient,
  presetId: string
): Promise<void> {
  const { error } = await supabase
    .from("eq_presets")
    .delete()
    .eq("id", presetId);

  if (error) throw new Error(`deletePreset: ${error.message}`);
}
