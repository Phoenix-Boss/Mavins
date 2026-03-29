// mavin-eq/useEqualizer.ts

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import MavinPlayerNative from "./MavinPlayerNative";
import { 
  getLocalPresetStorage, 
  getAllGroupedPresets, 
  saveUserPreset, 
  deleteUserPreset,
  duplicateUserPreset,
  searchPresets as searchPresetsFn,
  getRecentPresets as getRecentPresetsFn,
  applyEQPreset,
  setEQEnabled,
} from "./index";
import { 
  fetchCloudPresets, 
  updatePresetLastUsed,
  saveCloudPreset,
} from "./supabase-helpers";
import { 
  createCustomPreset, 
  normalizeGains, 
  FLAT,
  BUILT_IN_PRESETS,
} from "./presets";
import type { EqPreset, EqState, PresetGroup } from "./types";

interface UseEqualizerOptions {
  supabase?: SupabaseClient;
  enableCloudSync?: boolean;
  autoEnable?: boolean;
  onError?: (error: string) => void;
}

interface UseEqualizerReturn extends EqState {
  // Presets
  presetGroups: PresetGroup[];
  favorites: EqPreset[];
  recentPresets: EqPreset[];
  
  // Actions
  toggle: () => Promise<void>;
  applyPreset: (preset: EqPreset) => Promise<void>;
  setBand: (index: number, gainDb: number) => Promise<void>;
  setBands: (gains: number[]) => Promise<void>;
  resetToFlat: () => Promise<void>;
  
  // Preset Management
  createPreset: (name: string, description?: string) => Promise<EqPreset | null>;
  deletePreset: (id: string) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<boolean>;
  duplicatePreset: (preset: EqPreset, newName?: string) => Promise<EqPreset | null>;
  refreshPresets: () => Promise<void>;
  searchPresets: (query: string) => Promise<EqPreset[]>;
  
  // Cloud
  syncToCloud: () => Promise<{ uploaded: number; failed: number }>;
  
  // Setup
  setup: () => Promise<void>;
  isReady: boolean;
}

export function useEqualizer(options: UseEqualizerOptions = {}): UseEqualizerReturn {
  const { supabase, enableCloudSync = false, autoEnable = false, onError } = options;
  
  const localStorage = getLocalPresetStorage();
  
  const [state, setState] = useState<EqState>({
    isSetup: false,
    isEnabled: false,
    gains: [...FLAT],
    preampDb: 0,
    activePreset: null,
    isLoading: false,
    error: null,
  });
  
  const [presetGroups, setPresetGroups] = useState<PresetGroup[]>([]);
  const [favorites, setFavorites] = useState<EqPreset[]>([]);
  const [recentPresets, setRecentPresets] = useState<EqPreset[]>([]);
  const [isReady, setIsReady] = useState(false);
  
  const isSetupRef = useRef(false);
  const setupInProgressRef = useRef(false);
  const activePresetRef = useRef(state.activePreset);

  useEffect(() => {
    activePresetRef.current = state.activePreset;
  }, [state.activePreset]);

  // ── Initialization ──────────────────────────────────────────────────────────

  useEffect(() => {
    localStorage.initialize().then(() => {
      setIsReady(true);
      refreshPresets();
    });
  }, []);

  useEffect(() => {
    if (autoEnable && isReady && !isSetupRef.current) {
      setup();
    }
  }, [autoEnable, isReady]);

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setup = useCallback(async () => {
    if (setupInProgressRef.current || isSetupRef.current) return;

    setupInProgressRef.current = true;
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // Check if player is initialized by checking if we can call EQ
      // The native module will reject if player not ready
      await MavinPlayerNative.setEQEnabled(true);
      
      isSetupRef.current = true;

      // Restore last used preset
      const lastUsedId = await localStorage.getLastUsed();
      if (lastUsedId) {
        const lastPreset = await localStorage.getPresetById(lastUsedId);
        if (lastPreset) {
          await applyPresetInternal(lastPreset, false);
        }
      }

      setState(s => ({
        ...s,
        isSetup: true,
        isEnabled: true,
        isLoading: false,
      }));
    } catch (e: any) {
      isSetupRef.current = false;
      const errorMsg = e?.message ?? "EQ setup failed. Initialize player first.";
      setState(s => ({ ...s, isLoading: false, error: errorMsg }));
      onError?.(errorMsg);
    } finally {
      setupInProgressRef.current = false;
    }
  }, [onError]);

  // ── Preset Management ─────────────────────────────────────────────────────

  const refreshPresets = useCallback(async () => {
    const [groups, favs, recent] = await Promise.all([
      getAllGroupedPresets(supabase),
      localStorage.getFavorites(),
      getRecentPresetsFn(5),
    ]);
    
    setPresetGroups(groups);
    setFavorites(favs);
    setRecentPresets(recent);
  }, [supabase]);

  const applyPreset = useCallback(async (preset: EqPreset) => {
    if (!isSetupRef.current) {
      // Try to setup first
      try {
        await setup();
      } catch (e) {
        console.warn("[useEqualizer] Cannot apply preset - player not initialized");
        return;
      }
    }
    
    await applyPresetInternal(preset, true);
  }, [setup]);

  const applyPresetInternal = async (preset: EqPreset, updateLastUsed: boolean) => {
    setState(s => ({ ...s, isLoading: true }));
    
    try {
      await applyEQPreset(preset);

      const gains = preset.gains_31 
        ? [...preset.gains_31] 
        : [...FLAT];

      setState(s => ({
        ...s,
        activePreset: preset,
        gains,
        preampDb: preset.preamp_db ?? 0,
        isLoading: false,
      }));

      if (updateLastUsed) {
        await localStorage.setLastUsed(preset.id);
        
        if (preset.supabaseId && supabase) {
          await updatePresetLastUsed(supabase, preset.supabaseId);
        }
        
        refreshPresets();
      }
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e?.message }));
    }
  };

  const createPreset = useCallback(async (name: string, description?: string): Promise<EqPreset | null> => {
    if (!name.trim()) return null;
    
    const newPreset = createCustomPreset(name.trim(), normalizeGains(state.gains), {
      description,
      preamp_db: state.preampDb,
    });
    
    await saveUserPreset(newPreset, supabase);
    await refreshPresets();
    
    await applyPresetInternal(newPreset, true);
    
    return newPreset;
  }, [state.gains, state.preampDb, supabase, refreshPresets]);

  const deletePreset = useCallback(async (id: string): Promise<boolean> => {
    const success = await deleteUserPreset(id, supabase);
    if (success) {
      if (state.activePreset?.id === id) {
        await resetToFlat();
      }
      await refreshPresets();
    }
    return success;
  }, [supabase, state.activePreset, refreshPresets]);

  const toggleFavorite = useCallback(async (id: string): Promise<boolean> => {
    const result = await localStorage.toggleFavorite(id);
    await refreshPresets();
    return result;
  }, [refreshPresets]);

  const duplicatePreset = useCallback(async (preset: EqPreset, newName?: string): Promise<EqPreset | null> => {
    const { duplicatePreset: dupFn } = await import("./presets");
    const name = newName || `${preset.name} (Copy)`;
    const duplicated = dupFn(preset, name);
    await localStorage.savePreset(duplicated);
    await refreshPresets();
    return duplicated;
  }, [refreshPresets]);

  const searchPresets = useCallback(async (query: string): Promise<EqPreset[]> => {
    return searchPresetsFn(query);
  }, []);

  const syncToCloud = useCallback(async (): Promise<{ uploaded: number; failed: number }> => {
    if (!supabase) return { uploaded: 0, failed: 0 };
    
    const userPresets = await localStorage.getUserPresets();
    let uploaded = 0;
    let failed = 0;
    
    for (const preset of userPresets) {
      if (preset.supabaseId) continue;
      
      const cloudId = await saveCloudPreset(supabase, preset);
      if (cloudId) {
        uploaded++;
      } else {
        failed++;
      }
    }
    
    await refreshPresets();
    return { uploaded, failed };
  }, [supabase, refreshPresets]);

  // ── EQ Control ─────────────────────────────────────────────────────────────

  const toggle = useCallback(async () => {
    if (!isSetupRef.current) {
      await setup();
      return;
    }

    const nextEnabled = !state.isEnabled;
    await setEQEnabled(nextEnabled);
    setState(s => ({ ...s, isEnabled: nextEnabled }));
  }, [state.isEnabled, setup]);

  const setBand = useCallback(async (index: number, gainDb: number) => {
    if (!isSetupRef.current) {
      console.warn("[useEqualizer] EQ not active, call toggle() first");
      return;
    }

    setState(s => {
      const gains = [...s.gains];
      gains[index] = Math.max(-15, Math.min(15, gainDb));
      return { 
        ...s, 
        gains, 
        activePreset: null,
      };
    });

    try {
      await MavinPlayerNative.setEQBand(index, gainDb);
    } catch (e: any) {
      setState(s => {
        const gains = [...s.gains];
        gains[index] = 0;
        return { ...s, gains, error: e?.message };
      });
    }
  }, []);

  const setBands = useCallback(async (gains: number[]) => {
    if (!isSetupRef.current) return;
    
    const normalized = normalizeGains(gains);
    
    setState(s => ({
      ...s,
      gains: [...normalized],
      activePreset: null,
    }));
    
    await MavinPlayerNative.applyEQBands(normalized as number[]);
  }, []);

  const resetToFlat = useCallback(async () => {
    await setBands(FLAT);
    setState(s => ({ 
      ...s, 
      activePreset: BUILT_IN_PRESETS.flat,
      preampDb: 0 
    }));
  }, [setBands]);

  return {
    ...state,
    presetGroups,
    favorites,
    recentPresets,
    toggle,
    applyPreset,
    setBand,
    setBands,
    resetToFlat,
    createPreset,
    deletePreset,
    toggleFavorite,
    duplicatePreset,
    refreshPresets,
    searchPresets,
    syncToCloud,
    setup,
    isReady,
  };
}