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
  MavinTrack,
  PresetCategory
} from "./types";

// Re-export default
export default MavinPlayerNative;

// Export types from types.ts (includes ISO_FREQ_CENTERS)
export type * from "./types";

// Export specific items from presets.ts (NOT using export * to avoid ISO_FREQ_CENTERS conflict)
export {
  FLAT,
  HARMAN,
  BASS_BOOST,
  TREBLE_BOOST,
  VOCAL_BOOST,
  CLASSICAL,
  ELECTRONIC,
  ROCK,
  JAZZ,
  PODCAST,
  LOUDNESS,
  HIP_HOP,
  ACOUSTIC,
  BUILT_IN_PRESETS,
  BUILT_IN_PRESETS_LIST,
  formatFreq,
  getFreqLabel,
  createCustomPreset,
  createCustomParametricPreset,
  duplicatePreset,
  normalizeGains,
  interpolatePreset,
  getPresetTagsByGenre,
} from "./presets";

// Note: ISO_FREQ_CENTERS is already exported via types.ts, no need to re-export from presets

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

  const groups: Partial<Record<PresetCategory, EqPreset[]>> = {
    builtin: [],
    user: [],
    supabase: [],
    artist: [],
    genre: [],
    device: [],
  };

  for (const preset of allPresets) {
    if (groups[preset.category]) {
      groups[preset.category]!.push(preset);
    }
  }

  const sortPresets = (a: EqPreset, b: EqPreset) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  };

  const result: PresetGroup[] = [];

  if (groups.builtin && groups.builtin.length > 0) {
    result.push({
      id: "builtin",
      title: "Factory Presets",
      icon: "box",
      presets: groups.builtin.sort(sortPresets),
      isExpanded: true,
      sortOrder: 0,
    });
  }

  result.push({
    id: "user",
    title: "My Presets",
    icon: "user",
    presets: (groups.user || []).sort(sortPresets),
    isExpanded: true,
    sortOrder: 1,
  });

  if (groups.supabase && groups.supabase.length > 0) {
    result.push({
      id: "supabase",
      title: "Cloud Presets",
      icon: "cloud",
      presets: groups.supabase.sort(sortPresets),
      isExpanded: false,
      sortOrder: 2,
    });
  }

  if (groups.artist && groups.artist.length > 0) {
    result.push({
      id: "artist",
      title: "Artist Curated",
      icon: "star",
      presets: groups.artist.sort(sortPresets),
      isExpanded: false,
      sortOrder: 3,
    });
  }

  return result;
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

// ─────────────────────────────────────────────────────────────────────────────
// EQ CONTROL (Graphic)
// ─────────────────────────────────────────────────────────────────────────────

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

export async function setEQBandQ(band: number, q: number): Promise<void> {
  await MavinPlayerNative.setEQBandQ(band, q);
}

export async function resetEQ(): Promise<void> {
  await MavinPlayerNative.resetEQ();
}

// ─────────────────────────────────────────────────────────────────────────────
// PARAMETRIC EQ CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function applyParametricBands(gains: number[]): Promise<void> {
  await MavinPlayerNative.applyParametricBands(gains);
}

export async function setParametricBandGain(band: number, gainDb: number): Promise<void> {
  await MavinPlayerNative.setParametricBandGain(band, gainDb);
}

export async function setParametricBandFreq(band: number, freqHz: number): Promise<void> {
  await MavinPlayerNative.setParametricBandFreq(band, freqHz);
}

export async function resetParametric(): Promise<void> {
  await MavinPlayerNative.resetParametric();
}

// ─────────────────────────────────────────────────────────────────────────────
// EQ MODE CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setEQMode(mode: "GRAPHIC" | "PARAMETRIC" | "PARALLEL"): Promise<void> {
  await MavinPlayerNative.setEQMode(mode);
}

export async function getEQMode(): Promise<string> {
  return MavinPlayerNative.getEQMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// DITHER MODE CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setDitherMode(mode: "FLAT" | "HIGHPASS" | "E_WEIGHTED" | "F_WEIGHTED"): Promise<void> {
  await MavinPlayerNative.setDitherMode(mode);
}

export async function getDitherMode(): Promise<string> {
  return MavinPlayerNative.getDitherMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOOTHING CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setSmoothingRamp(ms: number): Promise<void> {
  await MavinPlayerNative.setSmoothingRamp(ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSOR (DRC) CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setCompressorEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setCompressorEnabled(enabled);
}

export async function isCompressorEnabled(): Promise<boolean> {
  return MavinPlayerNative.isCompressorEnabled();
}

export async function setCompressorThreshold(db: number): Promise<void> {
  await MavinPlayerNative.setCompressorThreshold(db);
}

export async function setCompressorRatio(ratio: number): Promise<void> {
  await MavinPlayerNative.setCompressorRatio(ratio);
}

export async function setCompressorAttack(ms: number): Promise<void> {
  await MavinPlayerNative.setCompressorAttack(ms);
}

export async function setCompressorRelease(ms: number): Promise<void> {
  await MavinPlayerNative.setCompressorRelease(ms);
}

export async function setCompressorKnee(db: number): Promise<void> {
  await MavinPlayerNative.setCompressorKnee(db);
}

export async function setCompressorMakeupGain(db: number): Promise<void> {
  await MavinPlayerNative.setCompressorMakeupGain(db);
}

export async function getCompressorReduction(): Promise<number> {
  return MavinPlayerNative.getCompressorReduction();
}

export async function getCompressorThreshold(): Promise<number> {
  return MavinPlayerNative.getCompressorThreshold();
}

export async function getCompressorRatio(): Promise<number> {
  return MavinPlayerNative.getCompressorRatio();
}

export async function getCompressorAttack(): Promise<number> {
  return MavinPlayerNative.getCompressorAttack();
}

export async function getCompressorRelease(): Promise<number> {
  return MavinPlayerNative.getCompressorRelease();
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFEED CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setCrossfeedEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setCrossfeedEnabled(enabled);
}

export async function isCrossfeedEnabled(): Promise<boolean> {
  return MavinPlayerNative.isCrossfeedEnabled();
}

export async function setCrossfeedStrength(strength: number): Promise<void> {
  await MavinPlayerNative.setCrossfeedStrength(strength);
}

export async function setCrossfeedCutoff(hz: number): Promise<void> {
  await MavinPlayerNative.setCrossfeedCutoff(hz);
}

export async function getCrossfeedStrength(): Promise<number> {
  return MavinPlayerNative.getCrossfeedStrength();
}

export async function getCrossfeedCutoff(): Promise<number> {
  return MavinPlayerNative.getCrossfeedCutoff();
}

// ─────────────────────────────────────────────────────────────────────────────
// PEAK METER (VU) CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentPeaks(): Promise<{ left: number; right: number }> {
  return MavinPlayerNative.getCurrentPeaks();
}

export async function getHeldPeaks(): Promise<{ left: number; right: number }> {
  return MavinPlayerNative.getHeldPeaks();
}

export async function resetPeaks(): Promise<void> {
  await MavinPlayerNative.resetPeaks();
}

export async function setPeakHoldMs(ms: number): Promise<void> {
  await MavinPlayerNative.setPeakHoldMs(ms);
}

export async function setPeakReleaseMs(ms: number): Promise<void> {
  await MavinPlayerNative.setPeakReleaseMs(ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK SPEED CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setPlaybackSpeed(speed: number): Promise<void> {
  await MavinPlayerNative.setPlaybackSpeed(speed);
}

export async function getPlaybackSpeed(): Promise<number> {
  return MavinPlayerNative.getPlaybackSpeed();
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFADE CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function setCrossfadeEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setCrossfadeEnabled(enabled);
}

export async function isCrossfadeEnabled(): Promise<boolean> {
  return MavinPlayerNative.isCrossfadeEnabled();
}

export async function setCrossfadeDuration(durationMs: number): Promise<void> {
  await MavinPlayerNative.setCrossfadeDuration(durationMs);
}

export async function getCrossfadeDuration(): Promise<number> {
  return MavinPlayerNative.getCrossfadeDuration();
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE MODE (ZERO TELEMETRY)
// ─────────────────────────────────────────────────────────────────────────────

export async function setOfflineMode(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setOfflineMode(enabled);
}

export async function isOfflineMode(): Promise<boolean> {
  return MavinPlayerNative.isOfflineMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// 64-BIT HIGH PRECISION PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

export async function set64BitProcessingEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.set64BitProcessingEnabled(enabled);
}

export async function is64BitProcessingEnabled(): Promise<boolean> {
  return MavinPlayerNative.is64BitProcessingEnabled();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVOLUTION PROCESSOR (IMPULSE RESPONSES)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadImpulseResponse(filePath: string): Promise<void> {
  await MavinPlayerNative.loadImpulseResponse(filePath);
}

export async function clearImpulseResponse(): Promise<void> {
  await MavinPlayerNative.clearImpulseResponse();
}

export async function isImpulseResponseLoaded(): Promise<boolean> {
  return MavinPlayerNative.isImpulseResponseLoaded();
}

export async function getIrLength(): Promise<number> {
  return MavinPlayerNative.getIrLength();
}

export async function setConvolutionEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setConvolutionEnabled(enabled);
}

export async function isConvolutionEnabled(): Promise<boolean> {
  return MavinPlayerNative.isConvolutionEnabled();
}

// ─────────────────────────────────────────────────────────────────────────────
// FX PROCESSOR (REVERB, DELAY, CHORUS, FLANGER, PHASER)
// ─────────────────────────────────────────────────────────────────────────────

export async function setFxEnabled(enabled: boolean): Promise<void> {
  await MavinPlayerNative.setFxEnabled(enabled);
}

export async function isFxEnabled(): Promise<boolean> {
  return MavinPlayerNative.isFxEnabled();
}

export async function setFxMode(mode: "REVERB" | "DELAY" | "CHORUS" | "FLANGER" | "PHASER"): Promise<void> {
  await MavinPlayerNative.setFxMode(mode);
}

export async function getFxMode(): Promise<string> {
  return MavinPlayerNative.getFxMode();
}

export async function setFxMix(mix: number): Promise<void> {
  await MavinPlayerNative.setFxMix(mix);
}

export async function getFxMix(): Promise<number> {
  return MavinPlayerNative.getFxMix();
}

export async function setFxBypass(bypass: boolean): Promise<void> {
  await MavinPlayerNative.setFxBypass(bypass);
}

export async function isFxBypassed(): Promise<boolean> {
  return MavinPlayerNative.isFxBypassed();
}

// Reverb Parameters
export async function setReverbRoomSize(value: number): Promise<void> {
  await MavinPlayerNative.setReverbRoomSize(value);
}

export async function setReverbDecay(value: number): Promise<void> {
  await MavinPlayerNative.setReverbDecay(value);
}

export async function setReverbPreDelay(value: number): Promise<void> {
  await MavinPlayerNative.setReverbPreDelay(value);
}

export async function setReverbDamping(value: number): Promise<void> {
  await MavinPlayerNative.setReverbDamping(value);
}

// Delay Parameters
export async function setDelayTime(value: number): Promise<void> {
  await MavinPlayerNative.setDelayTime(value);
}

export async function setDelayFeedback(value: number): Promise<void> {
  await MavinPlayerNative.setDelayFeedback(value);
}

export async function setDelayLowCut(value: number): Promise<void> {
  await MavinPlayerNative.setDelayLowCut(value);
}

export async function setDelayHighCut(value: number): Promise<void> {
  await MavinPlayerNative.setDelayHighCut(value);
}

// Modulation Parameters (Chorus/Flanger/Phaser)
export async function setModRate(value: number): Promise<void> {
  await MavinPlayerNative.setModRate(value);
}

export async function setModDepth(value: number): Promise<void> {
  await MavinPlayerNative.setModDepth(value);
}

export async function setModPhase(value: number): Promise<void> {
  await MavinPlayerNative.setModPhase(value);
}

export async function setModFeedback(value: number): Promise<void> {
  await MavinPlayerNative.setModFeedback(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// USB DAC CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function isUsbDacConnected(): Promise<boolean> {
  return MavinPlayerNative.isUsbDacConnected();
}

export async function getCurrentDacInfo(): Promise<{
  name: string;
  vendorId: number;
  productId: number;
  isConnected: boolean;
  hasAudioOutput: boolean;
  supportedSampleRates: number[];
  maxBitDepth: number;
  maxChannels: number;
  isNativeDirectSupported: boolean;
} | null> {
  return MavinPlayerNative.getCurrentDacInfo();
}

export async function getDacCapabilities(): Promise<{
  sampleRates: number[];
  bitDepths: number[];
  channelCounts: number[];
  supportsFloatOutput: boolean;
  supportsHdAudio: boolean;
  nativeSampleRate: number;
  nativeBitDepth: number;
} | null> {
  return MavinPlayerNative.getDacCapabilities();
}

export async function enableDirectUsbRouting(enabled: boolean): Promise<boolean> {
  return MavinPlayerNative.enableDirectUsbRouting(enabled);
}

export async function isDirectUsbRoutingEnabled(): Promise<boolean> {
  return MavinPlayerNative.isDirectUsbRoutingEnabled();
}

export async function setPreferredDacSampleRate(rate: number): Promise<boolean> {
  return MavinPlayerNative.setPreferredDacSampleRate(rate);
}

export async function setPreferredDacBitDepth(depth: number): Promise<boolean> {
  return MavinPlayerNative.setPreferredDacBitDepth(depth);
}

export async function rescanUsbDevices(): Promise<void> {
  await MavinPlayerNative.rescanUsbDevices();
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO FORMAT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export async function getAudioCapabilities(): Promise<{
  maxSampleRate: number;
  maxBitDepth: number;
  supportsFloat: boolean;
  supportsHdAudio: boolean;
  supportsUltraHdAudio: boolean;
  supportedSampleRates: number[];
  supportedBitDepths: number[];
  isHiResCapable: boolean;
} | null> {
  return MavinPlayerNative.getAudioCapabilities();
}

export async function getOptimalAudioFormat(): Promise<{
  sampleRate: number;
  bitDepth: number;
  encoding: number;
  isFloat: boolean;
  isHiRes: boolean;
  channelCount: number;
} | null> {
  return MavinPlayerNative.getOptimalAudioFormat();
}

export async function isHiResAudioCapable(): Promise<boolean> {
  return MavinPlayerNative.isHiResAudioCapable();
}

export async function getMaxSampleRate(): Promise<number> {
  return MavinPlayerNative.getMaxSampleRate();
}

export async function getMaxBitDepth(): Promise<number> {
  return MavinPlayerNative.getMaxBitDepth();
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLY FULL EQ PRESET (Supports Graphic + Parametric)
// ─────────────────────────────────────────────────────────────────────────────

export async function applyEQPreset(preset: EqPreset): Promise<void> {
  // 1. Apply graphic EQ bands
  if (preset.gains_31 && preset.type === "graphic_31band") {
    await MavinPlayerNative.applyEQBands(preset.gains_31 as number[]);
  }
  
  // 2. Apply parametric bands if present
  if (preset.parametric_gains) {
    await MavinPlayerNative.applyParametricBands(preset.parametric_gains as number[]);
  }
  
  // 3. Apply parametric frequencies if present
  if (preset.parametric_freqs) {
    for (let i = 0; i < Math.min(preset.parametric_freqs.length, 31); i++) {
      await MavinPlayerNative.setParametricBandFreq(i, preset.parametric_freqs[i]);
    }
  }
  
  // 4. Apply Q values if present
  if (preset.q_values) {
    for (let i = 0; i < Math.min(preset.q_values.length, 31); i++) {
      await MavinPlayerNative.setEQBandQ(i, preset.q_values[i]);
    }
  }
  
  // 5. Apply preamp
  if (preset.preamp_db !== undefined) {
    await MavinPlayerNative.setEQPreamp(preset.preamp_db);
  }
  
  // 6. Apply EQ mode if specified
  if (preset.eq_mode) {
    await MavinPlayerNative.setEQMode(preset.eq_mode);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATE BETWEEN TWO PRESETS
// ─────────────────────────────────────────────────────────────────────────────

export async function animatePresetTransition(
  fromPreset: EqPreset,
  toPreset: EqPreset,
  durationMs: number = 300,
  onProgress?: (progress: number) => void
): Promise<void> {
  const startTime = Date.now();
  const fromGains = fromPreset.gains_31 || new Array(31).fill(0);
  const toGains = toPreset.gains_31 || new Array(31).fill(0);
  
  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      
      const currentGains = fromGains.map((g, i) => g + (toGains[i] - g) * progress);
      MavinPlayerNative.applyEQBands(currentGains);
      
      onProgress?.(progress);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };
    
    requestAnimationFrame(animate);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER CONTROL (Re-exported)
// ─────────────────────────────────────────────────────────────────────────────

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