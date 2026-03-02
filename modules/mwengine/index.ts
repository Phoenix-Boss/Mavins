// modules/modules/mwengine/index.ts
// ✅ EXACT mavin-engine pattern + MWEngine DSP

import { requireNativeModule } from 'expo-modules-core';

// ======================
// Type Definitions
// ======================
export interface Preset {
  name: string;
  gain: number[];
  q: number[];
  freq: number[];
}

export interface DspStatus {
  isActive: boolean;
  currentPreset: string;
  latencyMs: number;
}

// ======================
// Native Module Access
// ======================
export const MavinEQMW = requireNativeModule('MavinEQMW');

// ======================
// Type-Safe Wrapper Functions
// ======================
export const loadGlobalPreset = async (presetName: string): Promise<boolean> => {
  try {
    if (!MavinEQMW?.loadGlobalPreset) {
      throw new Error('MavinEQMW.loadGlobalPreset not available');
    }
    return await MavinEQMW.loadGlobalPreset(presetName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Preset load failed: ${errorMessage}`);
  }
};

export const setCustomEq = async (gain: number[]): Promise<boolean> => {
  try {
    if (!MavinEQMW?.setCustomEq) {
      throw new Error('MavinEQMW.setCustomEq not available');
    }
    return await MavinEQMW.setCustomEq(gain);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Custom EQ failed');
  }
};

export const getDspStatus = async (): Promise<DspStatus> => {
  try {
    if (!MavinEQMW?.getDspStatus) {
      throw new Error('MavinEQMW.getDspStatus not available');
    }
    return await MavinEQMW.getDspStatus();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'DSP status failed');
  }
};

// ======================
// Default Export (BACKWARD COMPATIBLE)
// ======================
export default {
  MavinEQMW,
  loadGlobalPreset,
  setCustomEq,
  getDspStatus,
};
