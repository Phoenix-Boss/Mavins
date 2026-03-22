/**
 * supabase-helpers.ts — expo-autoeq-engine
 *
 * All Supabase interactions. Receives your Supabase client as a parameter
 * so it works with your existing auth session from MusicPlayerContext.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EqPreset, EqBiquadFilter, EqBandGains } from "./types";
import MyEQ from "../index";

interface ProfileRow {
  id: string;
  is_pro: boolean;
  pro_ends_at: string | null;
  eq_minutes_remaining: number;
}

// ── Profile ───────────────────────────────────────────────────────────────────

export async function fetchUserProfile(
  supabase: SupabaseClient,
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

export function isProActive(profile: ProfileRow): boolean {
  if (!profile.is_pro) return false;
  if (!profile.pro_ends_at) return true;
  return new Date(profile.pro_ends_at) > new Date();
}

// ── EQ minutes ────────────────────────────────────────────────────────────────

export async function claimEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("deduct_eq_minutes", {
    p_minutes: minutes,
  });
  if (error) throw new Error(`claimEqMinutes: ${error.message}`);
  return data === true;
}

export async function addEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<void> {
  const { error } = await supabase.rpc("add_eq_minutes", {
    p_minutes: minutes,
  });
  if (error) throw new Error(`addEqMinutes: ${error.message}`);
}

/**
 * Full Pro gate — check subscription → deduct minutes → call setupEQ.
 * Called from useEqualizer when the user first enables EQ for a track.
 */
export async function claimEqMinutesForPlayback(
  supabase: SupabaseClient,
  audioSessionId: number,
  durationSeconds: number,
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>,
): Promise<boolean> {
  const profile = await fetchUserProfile(supabase);
  if (!profile) {
    console.warn("[AutoEQ] Not authenticated");
    return false;
  }
  if (!isProActive(profile)) {
    console.warn("[AutoEQ] Pro required");
    return false;
  }

  const minutesNeeded = Math.ceil(durationSeconds / 60);

  if (profile.eq_minutes_remaining < minutesNeeded) {
    if (!onNeedTopUp) return false;
    const didTopUp = await onNeedTopUp(
      minutesNeeded,
      profile.eq_minutes_remaining,
    );
    if (!didTopUp) return false;
  }

  const success = await claimEqMinutes(supabase, minutesNeeded);
  if (!success) {
    console.warn("[AutoEQ] Insufficient minutes");
    return false;
  }

  await MyEQ.setupEQ(audioSessionId);
  return true;
}

// ── Presets ───────────────────────────────────────────────────────────────────

export async function fetchUserPresets(
  supabase: SupabaseClient,
): Promise<EqPreset[]> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return [];

  const { data, error } = await supabase
    .from("eq_presets")
    .select("id, name, type, gains_31, biquad_filters, preamp_db, created_at")
    .eq("user_id", authData.user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`fetchUserPresets: ${error.message}`);

  return (data ?? []).map((row: any) => {
    if (row.type === "graphic_31band") {
      return {
        id: row.id,
        name: row.name,
        type: "graphic_31band",
        gains_31: row.gains_31 as EqBandGains,
        preamp_db: row.preamp_db ?? 0,
      } as EqPreset;
    }
    return {
      id: row.id,
      name: row.name,
      type: "biquad",
      // Supabase stores filters as jsonb — field names match EqBiquadFilter
      biquad_filters: (row.biquad_filters ?? []) as EqBiquadFilter[],
      preamp_db: row.preamp_db ?? 0,
    } as EqPreset;
  });
}

export async function savePreset(
  supabase: SupabaseClient,
  preset: Omit<EqPreset, "id">,
): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Not authenticated");

  const row = {
    user_id: authData.user.id,
    name: preset.name,
    type: preset.type,
    gains_31: preset.type === "graphic_31band" ? preset.gains_31 : null,
    biquad_filters: preset.type === "biquad" ? preset.biquad_filters : null,
    preamp_db: (preset as any).preamp_db ?? 0,
  };

  const { data, error } = await supabase
    .from("eq_presets")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`savePreset: ${error.message}`);
  return (data as { id: string }).id;
}

export async function deletePreset(
  supabase: SupabaseClient,
  presetId: string,
): Promise<void> {
  const { error } = await supabase
    .from("eq_presets")
    .delete()
    .eq("id", presetId);
  if (error) throw new Error(`deletePreset: ${error.message}`);
}
