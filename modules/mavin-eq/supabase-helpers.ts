/**
 * supabase-helpers.ts — mavin-eq
 * 
 * Supabase integration for cloud-synced presets + legacy profile functions
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EqPreset, EqBiquadFilter, EqBandGains, SupabasePresetRow } from "./types";

interface ProfileRow {
  id: string;
  is_pro: boolean;
  pro_ends_at: string | null;
  eq_minutes_remaining: number;
}

// ── Profile Functions ─────────────────────────────────────────────────────────

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

// ── Legacy EQ Minutes (Deprecated) ─────────────────────────────────────────────

export async function claimEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<boolean> {
  return true; // EQ is free
}

export async function addEqMinutes(
  supabase: SupabaseClient,
  minutes: number,
): Promise<void> {
  return; // EQ is free
}

export async function claimEqMinutesForPlayback(
  supabase: SupabaseClient,
  audioSessionId: number,
  durationSeconds: number,
  onNeedTopUp?: (needed: number, remaining: number) => Promise<boolean>,
): Promise<boolean> {
  return true; // EQ is free
}

// ── Preset Cloud Functions ───────────────────────────────────────────────────

export async function fetchCloudPresets(
  supabase: SupabaseClient,
): Promise<EqPreset[]> {
  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return [];

    const { data, error } = await supabase
      .from("eq_presets")
      .select("*")
      .eq("user_id", authData.user.id)
      .order("last_used_at", { ascending: false });

    if (error) {
      console.error("[supabase-helpers] fetchCloudPresets error:", error);
      return [];
    }

    return (data || []).map(mapSupabaseRowToPreset);
  } catch (e) {
    console.error("[supabase-helpers] fetchCloudPresets failed:", e);
    return [];
  }
}

export async function fetchPublicPresets(
  supabase: SupabaseClient,
  limit = 50
): Promise<EqPreset[]> {
  try {
    const { data, error } = await supabase
      .from("eq_presets")
      .select("*")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[supabase-helpers] fetchPublicPresets error:", error);
      return [];
    }

    return (data || []).map(mapSupabaseRowToPreset);
  } catch (e) {
    console.error("[supabase-helpers] fetchPublicPresets failed:", e);
    return [];
  }
}

export async function saveCloudPreset(
  supabase: SupabaseClient,
  preset: Omit<EqPreset, "id"> & { id?: string }
): Promise<string | null> {
  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return null;

    const row: Partial<SupabasePresetRow> = {
      user_id: authData.user.id,
      name: preset.name,
      type: preset.type,
      description: preset.description,
      icon: preset.icon,
      color: preset.color,
      tags: preset.tags,
      preamp_db: preset.preamp_db ?? 0,
      is_public: false,
      updated_at: new Date().toISOString(),
    };

    if (preset.type === "graphic_31band") {
      row.gains_31 = preset.gains_31;
    } else {
      row.biquad_filters = preset.biquad_filters;
    }

    let result;
    
    // Update existing if it has a real supabase id
    if (preset.id && !preset.id.startsWith("builtin_") && !preset.id.startsWith("user_") && !preset.id.startsWith("imported_")) {
      const { data, error } = await supabase
        .from("eq_presets")
        .update(row)
        .eq("id", preset.id)
        .select("id")
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Insert new
      row.created_at = new Date().toISOString();
      const { data, error } = await supabase
        .from("eq_presets")
        .insert(row)
        .select("id")
        .single();
      
      if (error) throw error;
      result = data;
    }

    return result?.id || null;
  } catch (e) {
    console.error("[supabase-helpers] saveCloudPreset failed:", e);
    return null;
  }
}

export async function deleteCloudPreset(
  supabase: SupabaseClient,
  presetId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("eq_presets")
      .delete()
      .eq("id", presetId);

    if (error) {
      console.error("[supabase-helpers] deleteCloudPreset error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[supabase-helpers] deleteCloudPreset failed:", e);
    return false;
  }
}

export async function updatePresetLastUsed(
  supabase: SupabaseClient,
  presetId: string
): Promise<void> {
  try {
    await supabase
      .from("eq_presets")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", presetId);
  } catch (e) {
    // Non-critical error
    console.log("[supabase-helpers] updatePresetLastUsed failed:", e);
  }
}

export async function syncPresetsToCloud(
  supabase: SupabaseClient,
  localPresets: EqPreset[]
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  for (const preset of localPresets) {
    // Skip if already has supabaseId (already synced)
    if (preset.supabaseId) continue;

    const cloudId = await saveCloudPreset(supabase, preset);
    if (cloudId) {
      uploaded++;
    } else {
      failed++;
    }
  }

  return { uploaded, failed };
}

// ── Helper ───────────────────────────────────────────────────────────────────

function mapSupabaseRowToPreset(row: SupabasePresetRow): EqPreset {
  return {
    id: `supabase_${row.id}`,
    name: row.name,
    type: row.type,
    category: row.is_public ? "artist" : "supabase",
    description: row.description,
    icon: row.icon,
    color: row.color,
    tags: row.tags as any[],
    gains_31: row.gains_31 as EqBandGains,
    biquad_filters: row.biquad_filters,
    preamp_db: row.preamp_db,
    source: "supabase",
    supabaseId: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}