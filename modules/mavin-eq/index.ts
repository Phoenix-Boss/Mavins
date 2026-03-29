// mavin-eq/index.ts

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import MavinPlayerNative from "./MavinPlayerNative";
import type { 
  EqBandGains, 
  EqBiquadFilter, 
  EqPreset, 
  PresetGroup,
  PresetStorageAdapter,
  MavinTrack 
} from "./types";

export default MavinPlayerNative;
export * from "./types";
export * from "./presets";
export {
  fetchUserProfile,
  fetchCloudPresets,
  fetchPublicPresets,
  saveCloudPreset,
  deleteCloudPreset,
  updatePresetLastUsed,
  syncPresetsToCloud,
  claimEqMinutes,
  addEqMinutes,
  claimEqMinutesForPlayback,
  isProActive,
} from "./supabase-helpers";
export { useEqualizer } from "./useEqualizer";

// ── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  USER_PRESETS: "@mavin_eq/user_presets",
  FAVORITE_IDS: "@mavin_eq/favorite_ids",
  LAST_USED_ID: "@mavin_eq/last_used_preset",
};

// ── Local Storage Implementation ─────────────────────────────────────────────

class LocalPresetStorage implements PresetStorageAdapter {
  private cache: Map<string, EqPreset> = new Map();
  private favorites: Set<string> = new Set();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const [userPresetsJson, favoritesJson] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.USER_PRESETS),
        AsyncStorage.getItem(STORAGE_KEYS.FAVORITE_IDS),
      ]);

      if (userPresetsJson) {
        const presets: EqPreset[] = JSON.parse(userPresetsJson);
        presets.forEach(p => this.cache.set(p.id, p));
      }

      if (favoritesJson) {
        const favs: string[] = JSON.parse(favoritesJson);
        favs.forEach(id => this.favorites.add(id));
      }

      this.initialized = true;
    } catch (error) {
      console.error("[mavin-eq] LocalStorage init failed:", error);
    }
  }

  async getAllPresets(): Promise<EqPreset[]> {
    await this.initialize();
    const { BUILT_IN_PRESETS_LIST } = await import("./presets");
    
    const userPresets = Array.from(this.cache.values());
    const allPresets = [...BUILT_IN_PRESETS_LIST, ...userPresets];
    
    return allPresets.map(p => ({
      ...p,
      isFavorite: this.favorites.has(p.id),
    }));
  }

  async getUserPresets(): Promise<EqPreset[]> {
    await this.initialize();
    return Array.from(this.cache.values()).map(p => ({
      ...p,
      isFavorite: this.favorites.has(p.id),
    }));
  }

  async getPresetById(id: string): Promise<EqPreset | null> {
    await this.initialize();
    
    const { BUILT_IN_PRESETS_LIST } = await import("./presets");
    const builtin = BUILT_IN_PRESETS_LIST.find(p => p.id === id);
    if (builtin) return { ...builtin, isFavorite: this.favorites.has(id) };
    
    const user = this.cache.get(id);
    if (user) return { ...user, isFavorite: this.favorites.has(id) };
    
    return null;
  }

  async savePreset(preset: EqPreset): Promise<void> {
    await this.initialize();
    
    const presetWithMeta = {
      ...preset,
      updatedAt: new Date().toISOString(),
      source: "local" as const,
      category: "user" as const,
    };
    
    this.cache.set(preset.id, presetWithMeta);
    await this.persist();
  }

  async deletePreset(id: string): Promise<boolean> {
    await this.initialize();
    
    if (id.startsWith("builtin_")) return false;
    
    const deleted = this.cache.delete(id);
    if (deleted) {
      this.favorites.delete(id);
      await Promise.all([this.persist(), this.persistFavorites()]);
    }
    return deleted;
  }

  async updatePreset(id: string, updates: Partial<EqPreset>): Promise<EqPreset | null> {
    await this.initialize();
    
    const existing = this.cache.get(id);
    if (!existing) return null;
    
    const updated = {
      ...existing,
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    
    this.cache.set(id, updated);
    await this.persist();
    return updated;
  }

  async toggleFavorite(id: string): Promise<boolean> {
    await this.initialize();
    
    const isFav = this.favorites.has(id);
    if (isFav) {
      this.favorites.delete(id);
    } else {
      this.favorites.add(id);
    }
    
    await this.persistFavorites();
    return !isFav;
  }

  async getFavorites(): Promise<EqPreset[]> {
    await this.initialize();
    const all = await this.getAllPresets();
    return all.filter(p => this.favorites.has(p.id));
  }

  async setLastUsed(id: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_USED_ID, id);
  }

  async getLastUsed(): Promise<string | null> {
    return AsyncStorage.getItem(STORAGE_KEYS.LAST_USED_ID);
  }

  async exportPresets(): Promise<string> {
    const presets = await this.getUserPresets();
    return JSON.stringify(presets, null, 2);
  }

  async importPresets(jsonString: string): Promise<number> {
    try {
      const imported: EqPreset[] = JSON.parse(jsonString);
      let count = 0;
      
      for (const preset of imported) {
        if (preset.id && preset.name && preset.gains_31) {
          const newPreset = {
            ...preset,
            id: `imported_${Date.now()}_${count}`,
            source: "imported" as const,
            category: "user" as const,
            createdAt: new Date().toISOString(),
          };
          this.cache.set(newPreset.id, newPreset);
          count++;
        }
      }
      
      await this.persist();
      return count;
    } catch (error) {
      console.error("[mavin-eq] Import failed:", error);
      return 0;
    }
  }

  private async persist(): Promise<void> {
    const presets = Array.from(this.cache.values());
    await AsyncStorage.setItem(STORAGE_KEYS.USER_PRESETS, JSON.stringify(presets));
  }

  private async persistFavorites(): Promise<void> {
    const favs = Array.from(this.favorites);
    await AsyncStorage.setItem(STORAGE_KEYS.FAVORITE_IDS, JSON.stringify(favs));
  }
}

// ── Singleton Storage Instance ───────────────────────────────────────────────

const localStorage = new LocalPresetStorage();

export function getLocalPresetStorage(): PresetStorageAdapter {
  return localStorage;
}

// ── Preset Engine Functions ─────────────────────────────────────────────────

export async function getAllGroupedPresets(supabase?: SupabaseClient): Promise<PresetGroup[]> {
  await localStorage.initialize();
  
  let allPresets = await localStorage.getAllPresets();
  
  if (supabase) {
    const { fetchCloudPresets } = await import("./supabase-helpers");
    const cloudPresets = await fetchCloudPresets(supabase);
    const existingIds = new Set(allPresets.map(p => p.supabaseId).filter(Boolean));
    const newCloudPresets = cloudPresets.filter(p => !existingIds.has(p.supabaseId));
    allPresets.push(...newCloudPresets);
  }

  const groups: Record<string, EqPreset[]> = {
    builtin: [],
    user: [],
    supabase: [],
    artist: [],
    genre: [],
    device: [],
  };

  for (const preset of allPresets) {
    if (groups[preset.category]) {
      groups[preset.category].push(preset);
    }
  }

  const sortPresets = (a: EqPreset, b: EqPreset) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  };

  return [
    {
      id: "builtin",
      title: "Factory Presets",
      icon: "box",
      presets: groups.builtin.sort(sortPresets),
      isExpanded: true,
      sortOrder: 0,
    },
    {
      id: "user",
      title: "My Presets",
      icon: "user",
      presets: groups.user.sort(sortPresets),
      isExpanded: true,
      sortOrder: 1,
    },
    {
      id: "supabase",
      title: "Cloud Presets",
      icon: "cloud",
      presets: groups.supabase.sort(sortPresets),
      isExpanded: false,
      sortOrder: 2,
    },
    {
      id: "artist",
      title: "Artist Curated",
      icon: "star",
      presets: groups.artist.sort(sortPresets),
      isExpanded: false,
      sortOrder: 3,
    },
  ].filter(g => g.presets.length > 0 || g.id === "user");
}

export async function searchPresets(query: string): Promise<EqPreset[]> {
  await localStorage.initialize();
  const all = await localStorage.getAllPresets();
  const lowerQuery = query.toLowerCase();
  
  return all.filter(p => 
    p.name.toLowerCase().includes(lowerQuery) ||
    p.description?.toLowerCase().includes(lowerQuery) ||
    p.tags?.some(t => t.toLowerCase().includes(lowerQuery))
  );
}

export async function getRecentPresets(limit = 5): Promise<EqPreset[]> {
  await localStorage.initialize();
  const all = await localStorage.getAllPresets();
  return all
    .filter(p => p.lastUsedAt)
    .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())
    .slice(0, limit);
}

export async function saveUserPreset(preset: EqPreset, supabase?: SupabaseClient): Promise<void> {
  await localStorage.savePreset(preset);
  
  if (supabase) {
    const { saveCloudPreset } = await import("./supabase-helpers");
    await saveCloudPreset(supabase, preset);
  }
}

export async function deleteUserPreset(id: string, supabase?: SupabaseClient): Promise<boolean> {
  const success = await localStorage.deletePreset(id);
  
  if (success && supabase && id.startsWith("supabase_")) {
    const { deleteCloudPreset } = await import("./supabase-helpers");
    const supabaseId = id.replace("supabase_", "");
    await deleteCloudPreset(supabase, supabaseId);
  }
  
  return success;
}

export async function duplicateUserPreset(preset: EqPreset): Promise<EqPreset> {
  const { duplicatePreset } = await import("./presets");
  const duplicated = duplicatePreset(preset);
  await localStorage.savePreset(duplicated);
  return duplicated;
}

export async function exportUserPresets(): Promise<string> {
  return localStorage.exportPresets();
}

export async function importUserPresets(jsonString: string): Promise<number> {
  return localStorage.importPresets(jsonString);
}

// ── EQ Control (Direct Native Calls) ───────────────────────────────────────────

export async function setEQEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setEQEnabled(enabled);
}

export async function applyEQBands(gains: EqBandGains | number[]): Promise<void> {
  await MavinPlayerNative.applyEQBands(gains as number[]);
}

export async function setEQBand(index: number, gainDb: number): Promise<void> {
  await MavinPlayerNative.setEQBand(index, gainDb);
}

export async function setEQPreamp(gainDb: number): Promise<void> {
  await MavinPlayerNative.setEQPreamp(gainDb);
}

export async function resetEQ(): Promise<void> {
  await MavinPlayerNative.resetEQ();
}

export async function applyEQPreset(preset: EqPreset): Promise<void> {
  if (preset.type === "graphic_31band" && preset.gains_31) {
    await MavinPlayerNative.applyEQBands(preset.gains_31 as number[]);
  }
  // Note: biquad/parametric not yet supported in native
}

// ── Player Control (Re-exported) ─────────────────────────────────────────────

export async function initPlayer(): Promise<void> {
  await MavinPlayerNative.initPlayer();
}

export async function loadTrack(track: MavinTrack): Promise<void> {
  await MavinPlayerNative.load(track);
}

export async function play(): Promise<void> {
  await MavinPlayerNative.play();
}

export async function pause(): Promise<void> {
  await MavinPlayerNative.pause();
}

export async function releasePlayer(): Promise<void> {
  await MavinPlayerNative.release();
}

export function isSupported(): boolean {
  return Platform.OS === "android";
}