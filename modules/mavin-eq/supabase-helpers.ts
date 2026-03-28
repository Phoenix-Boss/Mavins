/**
 * supabase-helpers.ts — mavin-eq (FREE VERSION - No Pro Required)
 *
 * REMOVED:
 * - Pro subscription checks (is_pro, pro_ends_at)
 * - EQ minutes billing system
 * - Authentication requirements for EQ usage
 * 
 * KEPT:
 * - Preset saving/loading (optional, only if user is logged in)
 * - Profile functions for other features
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EqPreset, EqBiquadFilter, EqBandGains } from "./types";

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
  // Kept for backwards compatibility with other features
  if (!profile.is_pro) return false;
  if (!profile.pro_ends_at) return true;
  return new Date(profile.pro_ends_at) > new Date();
}

// ── EQ minutes (DEPRECATED - kept for API compatibility, always returns true) ────────────────────────────────────────────────────────────────

export async function claimEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<boolean> {
  // No longer deducts minutes - EQ is free
  return true;
}

export async function addEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<void> {
  // No longer adds minutes - EQ is free
  return;
}

/**
 * ✅ FREE EQ - No Pro subscription required
 * 
 * This function now always returns true, allowing EQ for all users.
 * The mixer-first architecture handles audio session management natively.
 */
export async function claimEqMinutesForPlayback(
  supabase: SupabaseClient,
  audioSessionId: number,
  durationSeconds: number,
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>,
): Promise<boolean> {
  // EQ is now free - no authentication or subscription required
  // Just return true to allow EQ processing
  return true;
}

// ── Presets ───────────────────────────────────────────────────────────────────

export async function fetchUserPresets(
  supabase: SupabaseClient,
): Promise<EqPreset[]> {
  // Try to fetch user presets if logged in, otherwise return empty array
  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return [];

    const { data, error } = await supabase
      .from("eq_presets")
      .select("id, name, type, gains_31, biquad_filters, preamp_db, created_at")
      .eq("user_id", authData.user.id)
      .order("created_at", { ascending: false });

    if (error) return [];

    return (data ?? []).map((row: any) => {
      if (row.type === "graphic_31band") {
        return {
          id:       row.id,
          name:     row.name,
          type:     "graphic_31band",
          gains_31: row.gains_31 as EqBandGains,
          preamp_db: row.preamp_db ?? 0,
        } as EqPreset;
      }
      return {
        id:             row.id,
        name:           row.name,
        type:           "biquad",
        biquad_filters: (row.biquad_filters ?? []) as EqBiquadFilter[],
        preamp_db:      row.preamp_db ?? 0,
      } as EqPreset;
    });
  } catch {
    return [];
  }
}

export async function savePreset(
  supabase: SupabaseClient,
  preset: Omit<EqPreset, "id">,
): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Not authenticated");

  const row = {
    user_id:        authData.user.id,
    name:           preset.name,
    type:           preset.type,
    gains_31:       preset.type === "graphic_31band" ? preset.gains_31 : null,
    biquad_filters: preset.type === "biquad" ? preset.biquad_filters : null,
    preamp_db:      (preset as any).preamp_db ?? 0,
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