// modules/modules/honeygain/index.ts
// ✅ EXACT mavin-engine pattern + ALWAYS-ON Honeygain (24/7 revenue)

import { requireNativeModule } from 'expo-modules-core';

// ======================
// Type Definitions (Updated for Always-On)
// ======================
export interface AlwaysOnStatus {
  isRunning: boolean;
  isOptedIn: boolean;
  isBackground: boolean;
  launchOnBoot: boolean;
  lastError?: string;
}

export interface PresetBoostResult {
  success: boolean;
  presetName: string;
  notification: string;
  boostTriggered: number;  // Fixed 1GB
  alwaysOn: boolean;       // Background continues
}

export interface SongDownloadResult {
  success: boolean;
  songTitle: string;
  notification: string;
  boostTriggered: number;
}

// ======================
// Native Module Access
// ======================
export const HoneygainModule = requireNativeModule('Honeygain');

// ======================
// Type-Safe Wrapper Functions (Always-On + Boosts)
// ======================

// ALWAYS-ON STATUS (24/7 monitoring)
export const getStatus = async (): Promise<AlwaysOnStatus> => {
  try {
    if (!HoneygainModule?.getStatus) {
      throw new Error('HoneygainModule.getStatus not available');
    }
    return await HoneygainModule.getStatus();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Status check failed: ${errorMessage}`);
  }
};

// PRESET CLICK → 1GB INSTANT BOOST (on top of always-on)
export const downloadPresetWithBandwidth = async (
  presetName: string
): Promise<PresetBoostResult> => {
  try {
    if (!HoneygainModule?.downloadPresetWithBandwidth) {
      throw new Error('HoneygainModule.downloadPresetWithBandwidth not available');
    }
    return await HoneygainModule.downloadPresetWithBandwidth(presetName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Preset boost failed: ${errorMessage}`);
  }
};

// OFFLINE SONGS → 1GB BOOST (same pattern)
export const downloadSongWithBandwidth = async (
  songTitle: string
): Promise<SongDownloadResult> => {
  try {
    if (!HoneygainModule?.downloadSongWithBandwidth) {
      throw new Error('HoneygainModule.downloadSongWithBandwidth not available');
    }
    return await HoneygainModule.downloadSongWithBandwidth(songTitle);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Song boost failed: ${errorMessage}`);
  }
};

// MANUAL STOP (Temporary - restarts on reboot/init)
export const stopSharing = async (): Promise<boolean> => {
  try {
    if (!HoneygainModule?.stopSharing) {
      throw new Error('HoneygainModule.stopSharing not available');
    }
    return await HoneygainModule.stopSharing();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Stop failed: ${errorMessage}`);
  }
};

// LEGACY METHODS (Backward compatible)
export const startBandwidthSession = async (
  durationSeconds: number
): Promise<boolean> => {
  console.warn('startBandwidthSession deprecated - using always-on');
  return await getStatus().then(status => status.isRunning);
};

export const getEarnings = async (): Promise<AlwaysOnStatus> => {
  console.warn('getEarnings deprecated - using getStatus');
  return await getStatus();
};

export const stopSession = async (): Promise<void> => {
  console.warn('stopSession deprecated - using stopSharing');
  await stopSharing();
};

// ======================
// Default Export (BACKWARD COMPATIBLE)
// ======================
export default {
  HoneygainModule,
  
  // ALWAYS-ON CORE (24/7 revenue)
  getStatus,
  stopSharing,
  
  // 1GB BOOSTS (Preset/Song clicks)
  downloadPresetWithBandwidth,
  downloadSongWithBandwidth,
  
  // LEGACY (Redirects to always-on)
  startBandwidthSession,
  getEarnings,
  stopSession,
};
