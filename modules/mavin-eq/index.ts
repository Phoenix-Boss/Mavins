// mavin-eq/index.ts

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNativeModule, isNativeModuleAvailable } from "./MavinPlayerNative";
import type { 
  EqBandGains, 
  EqPreset, 
  PresetGroup,
  PresetStorageAdapter,
  MavinTrack,
  PresetCategory,
} from "./types";

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

// -- Storage Keys -------------------------------------------------------------

const STORAGE_KEYS = {
  USER_PRESETS: "@mavin_eq/user_presets",
  FAVORITE_IDS: "@mavin_eq/favorite_ids",
  LAST_USED_ID: "@mavin_eq/last_used_preset",
};

// -- Local Storage Implementation ---------------------------------------------

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

// -- Singleton Storage Instance -----------------------------------------------

const localStorage = new LocalPresetStorage();

export function getLocalPresetStorage(): PresetStorageAdapter {
  return localStorage;
}

// -- Preset Engine Functions -------------------------------------------------

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

// -----------------------------------------------------------------------------
// EQ CONTROL (Graphic)
// -----------------------------------------------------------------------------

export async function setEQEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setEQEnabled(enabled);
}

export async function applyEQBands(gains: EqBandGains | number[]): Promise<void> {
  await getNativeModule().applyEQBands(gains as number[]);
}

export async function setEQBand(index: number, gainDb: number): Promise<void> {
  await getNativeModule().setEQBand(index, gainDb);
}

export async function setEQPreamp(gainDb: number): Promise<void> {
  await getNativeModule().setEQPreamp(gainDb);
}

export async function setEQBandQ(band: number, q: number): Promise<void> {
  await getNativeModule().setEQBandQ(band, q);
}

export async function resetEQ(): Promise<void> {
  await getNativeModule().resetEQ();
}

// -----------------------------------------------------------------------------
// PARAMETRIC EQ CONTROL
// -----------------------------------------------------------------------------

export async function applyParametricBands(gains: number[]): Promise<void> {
  await getNativeModule().applyParametricBands(gains);
}

export async function setParametricBandGain(band: number, gainDb: number): Promise<void> {
  await getNativeModule().setParametricBandGain(band, gainDb);
}

export async function setParametricBandFreq(band: number, freqHz: number): Promise<void> {
  await getNativeModule().setParametricBandFreq(band, freqHz);
}

export async function resetParametric(): Promise<void> {
  await getNativeModule().resetParametric();
}

// -----------------------------------------------------------------------------
// EQ MODE CONTROL
// -----------------------------------------------------------------------------

export async function setEQMode(mode: "GRAPHIC" | "PARAMETRIC" | "PARALLEL"): Promise<void> {
  await getNativeModule().setEQMode(mode);
}

export async function getEQMode(): Promise<string> {
  return getNativeModule().getEQMode();
}

// -----------------------------------------------------------------------------
// DITHER MODE CONTROL
// -----------------------------------------------------------------------------

export async function setDitherMode(mode: "FLAT" | "HIGHPASS" | "E_WEIGHTED" | "F_WEIGHTED"): Promise<void> {
  await getNativeModule().setDitherMode(mode);
}

export async function getDitherMode(): Promise<string> {
  return getNativeModule().getDitherMode();
}

// -----------------------------------------------------------------------------
// SMOOTHING CONTROL
// -----------------------------------------------------------------------------

export async function setSmoothingRamp(ms: number): Promise<void> {
  await getNativeModule().setSmoothingRamp(ms);
}

// -----------------------------------------------------------------------------
// COMPRESSOR (DRC) CONTROL
// -----------------------------------------------------------------------------

export async function setCompressorEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setCompressorEnabled(enabled);
}

export async function isCompressorEnabled(): Promise<boolean> {
  return getNativeModule().isCompressorEnabled();
}

export async function setCompressorThreshold(db: number): Promise<void> {
  await getNativeModule().setCompressorThreshold(db);
}

export async function setCompressorRatio(ratio: number): Promise<void> {
  await getNativeModule().setCompressorRatio(ratio);
}

export async function setCompressorAttack(ms: number): Promise<void> {
  await getNativeModule().setCompressorAttack(ms);
}

export async function setCompressorRelease(ms: number): Promise<void> {
  await getNativeModule().setCompressorRelease(ms);
}

export async function setCompressorKnee(db: number): Promise<void> {
  await getNativeModule().setCompressorKnee(db);
}

export async function setCompressorMakeupGain(db: number): Promise<void> {
  await getNativeModule().setCompressorMakeupGain(db);
}

export async function getCompressorReduction(): Promise<number> {
  return getNativeModule().getCompressorReduction();
}

export async function getCompressorThreshold(): Promise<number> {
  return getNativeModule().getCompressorThreshold();
}

export async function getCompressorRatio(): Promise<number> {
  return getNativeModule().getCompressorRatio();
}

export async function getCompressorAttack(): Promise<number> {
  return getNativeModule().getCompressorAttack();
}

export async function getCompressorRelease(): Promise<number> {
  return getNativeModule().getCompressorRelease();
}

// -----------------------------------------------------------------------------
// CROSSFEED CONTROL
// -----------------------------------------------------------------------------

export async function setCrossfeedEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setCrossfeedEnabled(enabled);
}

export async function isCrossfeedEnabled(): Promise<boolean> {
  return getNativeModule().isCrossfeedEnabled();
}

export async function setCrossfeedStrength(strength: number): Promise<void> {
  await getNativeModule().setCrossfeedStrength(strength);
}

export async function setCrossfeedCutoff(hz: number): Promise<void> {
  await getNativeModule().setCrossfeedCutoff(hz);
}

export async function getCrossfeedStrength(): Promise<number> {
  return getNativeModule().getCrossfeedStrength();
}

export async function getCrossfeedCutoff(): Promise<number> {
  return getNativeModule().getCrossfeedCutoff();
}

// -----------------------------------------------------------------------------
// PEAK METER (VU) CONTROL
// -----------------------------------------------------------------------------

export async function getCurrentPeaks(): Promise<{ left: number; right: number }> {
  return getNativeModule().getCurrentPeaks();
}

export async function getHeldPeaks(): Promise<{ left: number; right: number }> {
  return getNativeModule().getHeldPeaks();
}

export async function resetPeaks(): Promise<void> {
  await getNativeModule().resetPeaks();
}

export async function setPeakHoldMs(ms: number): Promise<void> {
  await getNativeModule().setPeakHoldMs(ms);
}

export async function setPeakReleaseMs(ms: number): Promise<void> {
  await getNativeModule().setPeakReleaseMs(ms);
}

// -----------------------------------------------------------------------------
// PLAYBACK SPEED CONTROL
// -----------------------------------------------------------------------------

export async function setPlaybackSpeed(speed: number): Promise<void> {
  await getNativeModule().setPlaybackSpeed(speed);
}

export async function getPlaybackSpeed(): Promise<number> {
  return getNativeModule().getPlaybackSpeed();
}

// -----------------------------------------------------------------------------
// CROSSFADE CONTROL
// -----------------------------------------------------------------------------

export async function setCrossfadeEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setCrossfadeEnabled(enabled);
}

export async function isCrossfadeEnabled(): Promise<boolean> {
  return getNativeModule().isCrossfadeEnabled();
}

export async function setCrossfadeDuration(durationMs: number): Promise<void> {
  await getNativeModule().setCrossfadeDuration(durationMs);
}

export async function getCrossfadeDuration(): Promise<number> {
  return getNativeModule().getCrossfadeDuration();
}

// -----------------------------------------------------------------------------
// OFFLINE MODE (ZERO TELEMETRY)
// -----------------------------------------------------------------------------

export async function setOfflineMode(enabled: boolean): Promise<void> {
  await getNativeModule().setOfflineMode(enabled);
}

export async function isOfflineMode(): Promise<boolean> {
  return getNativeModule().isOfflineMode();
}

// -----------------------------------------------------------------------------
// 64-BIT HIGH PRECISION PROCESSING
// -----------------------------------------------------------------------------

export async function set64BitProcessingEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().set64BitProcessingEnabled(enabled);
}

export async function is64BitProcessingEnabled(): Promise<boolean> {
  return getNativeModule().is64BitProcessingEnabled();
}

// -----------------------------------------------------------------------------
// CONVOLUTION PROCESSOR (IMPULSE RESPONSES)
// -----------------------------------------------------------------------------

export async function loadImpulseResponse(filePath: string): Promise<void> {
  await getNativeModule().loadImpulseResponse(filePath);
}

export async function clearImpulseResponse(): Promise<void> {
  await getNativeModule().clearImpulseResponse();
}

export async function isImpulseResponseLoaded(): Promise<boolean> {
  return getNativeModule().isImpulseResponseLoaded();
}

export async function getIrLength(): Promise<number> {
  return getNativeModule().getIrLength();
}

export async function setConvolutionEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setConvolutionEnabled(enabled);
}

export async function isConvolutionEnabled(): Promise<boolean> {
  return getNativeModule().isConvolutionEnabled();
}

// -----------------------------------------------------------------------------
// FX PROCESSOR (REVERB, DELAY, CHORUS, FLANGER, PHASER)
// -----------------------------------------------------------------------------

export async function setFxEnabled(enabled: boolean): Promise<void> {
  await getNativeModule().setFxEnabled(enabled);
}

export async function isFxEnabled(): Promise<boolean> {
  return getNativeModule().isFxEnabled();
}

export async function setFxMode(mode: "REVERB" | "DELAY" | "CHORUS" | "FLANGER" | "PHASER"): Promise<void> {
  await getNativeModule().setFxMode(mode);
}

export async function getFxMode(): Promise<string> {
  return getNativeModule().getFxMode();
}

export async function setFxMix(mix: number): Promise<void> {
  await getNativeModule().setFxMix(mix);
}

export async function getFxMix(): Promise<number> {
  return getNativeModule().getFxMix();
}

export async function setFxBypass(bypass: boolean): Promise<void> {
  await getNativeModule().setFxBypass(bypass);
}

export async function isFxBypassed(): Promise<boolean> {
  return getNativeModule().isFxBypassed();
}

// Reverb Parameters
export async function setReverbRoomSize(value: number): Promise<void> {
  await getNativeModule().setReverbRoomSize(value);
}

export async function setReverbDecay(value: number): Promise<void> {
  await getNativeModule().setReverbDecay(value);
}

export async function setReverbPreDelay(value: number): Promise<void> {
  await getNativeModule().setReverbPreDelay(value);
}

export async function setReverbDamping(value: number): Promise<void> {
  await getNativeModule().setReverbDamping(value);
}

// Delay Parameters
export async function setDelayTime(value: number): Promise<void> {
  await getNativeModule().setDelayTime(value);
}

export async function setDelayFeedback(value: number): Promise<void> {
  await getNativeModule().setDelayFeedback(value);
}

export async function setDelayLowCut(value: number): Promise<void> {
  await getNativeModule().setDelayLowCut(value);
}

export async function setDelayHighCut(value: number): Promise<void> {
  await getNativeModule().setDelayHighCut(value);
}

// Modulation Parameters (Chorus/Flanger/Phaser)
export async function setModRate(value: number): Promise<void> {
  await getNativeModule().setModRate(value);
}

export async function setModDepth(value: number): Promise<void> {
  await getNativeModule().setModDepth(value);
}

export async function setModPhase(value: number): Promise<void> {
  await getNativeModule().setModPhase(value);
}

export async function setModFeedback(value: number): Promise<void> {
  await getNativeModule().setModFeedback(value);
}

// -----------------------------------------------------------------------------
// USB DAC CONTROL
// -----------------------------------------------------------------------------

export async function isUsbDacConnected(): Promise<boolean> {
  return getNativeModule().isUsbDacConnected();
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
  return getNativeModule().getCurrentDacInfo();
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
  return getNativeModule().getDacCapabilities();
}

export async function enableDirectUsbRouting(enabled: boolean): Promise<boolean> {
  return getNativeModule().enableDirectUsbRouting(enabled);
}

export async function isDirectUsbRoutingEnabled(): Promise<boolean> {
  return getNativeModule().isDirectUsbRoutingEnabled();
}

export async function setPreferredDacSampleRate(rate: number): Promise<boolean> {
  return getNativeModule().setPreferredDacSampleRate(rate);
}

export async function setPreferredDacBitDepth(depth: number): Promise<boolean> {
  return getNativeModule().setPreferredDacBitDepth(depth);
}

export async function rescanUsbDevices(): Promise<void> {
  await getNativeModule().rescanUsbDevices();
}

// -----------------------------------------------------------------------------
// AUDIO FORMAT DETECTION
// -----------------------------------------------------------------------------

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
  return getNativeModule().getAudioCapabilities();
}

export async function getOptimalAudioFormat(): Promise<{
  sampleRate: number;
  bitDepth: number;
  encoding: number;
  isFloat: boolean;
  isHiRes: boolean;
  channelCount: number;
} | null> {
  return getNativeModule().getOptimalAudioFormat();
}

export async function isHiResAudioCapable(): Promise<boolean> {
  return getNativeModule().isHiResAudioCapable();
}

export async function getMaxSampleRate(): Promise<number> {
  return getNativeModule().getMaxSampleRate();
}

export async function getMaxBitDepth(): Promise<number> {
  return getNativeModule().getMaxBitDepth();
}

// -----------------------------------------------------------------------------
// APPLY FULL EQ PRESET (Supports Graphic + Parametric)
// -----------------------------------------------------------------------------

export async function applyEQPreset(preset: EqPreset): Promise<void> {
  // 1. Apply graphic EQ bands
  if (preset.gains_31 && preset.type === "graphic_31band") {
    await getNativeModule().applyEQBands(preset.gains_31 as number[]);
  }
  
  // 2. Apply parametric bands if present
  if (preset.parametric_gains) {
    await getNativeModule().applyParametricBands(preset.parametric_gains as number[]);
  }
  
  // 3. Apply parametric frequencies if present
  if (preset.parametric_freqs) {
    for (let i = 0; i < Math.min(preset.parametric_freqs.length, 31); i++) {
      await getNativeModule().setParametricBandFreq(i, preset.parametric_freqs[i]);
    }
  }
  
  // 4. Apply Q values if present
  if (preset.q_values) {
    for (let i = 0; i < Math.min(preset.q_values.length, 31); i++) {
      await getNativeModule().setEQBandQ(i, preset.q_values[i]);
    }
  }
  
  // 5. Apply preamp
  if (preset.preamp_db !== undefined) {
    await getNativeModule().setEQPreamp(preset.preamp_db);
  }
  
  // 6. Apply EQ mode if specified
  if (preset.eq_mode) {
    await getNativeModule().setEQMode(preset.eq_mode);
  }
}

// -----------------------------------------------------------------------------
// ANIMATE BETWEEN TWO PRESETS
// -----------------------------------------------------------------------------

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
      getNativeModule().applyEQBands(currentGains);
      
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

// -----------------------------------------------------------------------------
// PLAYER CONTROL (Re-exported)
// -----------------------------------------------------------------------------

export async function initPlayer(): Promise<void> {
  await getNativeModule().initPlayer();
}

export async function loadTrack(track: MavinTrack): Promise<void> {
  await getNativeModule().load(track);
}

export async function play(): Promise<void> {
  await getNativeModule().play();
}

export async function pause(): Promise<void> {
  await getNativeModule().pause();
}

export async function releasePlayer(): Promise<void> {
  await getNativeModule().release();
}

export function isSupported(): boolean {
  return Platform.OS === "android";
}

// ✅ FIX: Export the native module instance as default export
// This allows consumers to import MavinPlayer directly from 'mavin-eq'
const MavinPlayerInstance = isNativeModuleAvailable() ? getNativeModule() : null;
export default MavinPlayerInstance;