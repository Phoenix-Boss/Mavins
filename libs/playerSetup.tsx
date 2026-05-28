// libs/playerSetup.tsx
//
// SINGLE SOURCE OF TRUTH for consumers.
// All player types, hooks, and contexts are re-exported from here.
//
// MASTER-SLAVE ARCHITECTURE:
//   - MusicPlayerContext.tsx  ← owns all logic, defines contexts, exports hooks
//   - playerSetup.tsx         ← re-exports everything + adds GestureContext
//   - preload.ts              ← owns ALL preload logic (search + queue)
//   - All other files         ← import from playerSetup
//
// IMPORTANT: All components and screens should import from this file only.
// Do NOT import directly from MusicPlayerContext.tsx or preload.ts.

import { createContext, useContext } from 'react';
import { type SharedValue } from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────────────────────
// Import from MusicPlayerContext (the actual implementation)
// ─────────────────────────────────────────────────────────────────────────────

import {
  // Types
  type Song,
  type RepeatMode,
  type ShuffleMode,
  type PlayerEngineState,
  type MusicPlayerContextType,
  type TrackExtras,
  type ResolvedTrack,
  // Hooks and functions
  usePlayerEngine,
  useMusicPlayer,
  useTrackExtrasVersion,
  getTrackExtras,
  storeTrackExtras,
  MusicPlayerProvider,
  setMasterPlayer,
  // SSL fast-path reset utility
  resetSSLFastPath,
  // Video state updaters (for components that need them)
  type VideoPlayer,
} from '@/components/MusicPlayerContext';

// ─────────────────────────────────────────────────────────────────────────────
// Import from preload
// ─────────────────────────────────────────────────────────────────────────────

import {
  preloadSearchResults,
  preloadNextTracks,
  cancelAllPreloads,
  getPreloadAbortSignal,
  getActivePreloadCount,
  getResolvedCacheSize,
  clearResolvedUrlCache,
  type PreloadSong,
} from '@/libs/preload';

// ─────────────────────────────────────────────────────────────────────────────
// Import from trackMetadataCache
// getCachedTrackExtrasSync is the synchronous in-memory read used by UI
// components that need instant metadata without waiting for async disk reads.
// ─────────────────────────────────────────────────────────────────────────────

import { getCachedTrackExtrasSync } from '@/services/trackMetadataCache';

// ─────────────────────────────────────────────────────────────────────────────
// URI NORMALIZER — Shared utility for local file URIs
//
// Normalizes a local file URI to a format compatible with expo-video:
//   content:// URIs (Android MediaStore) → kept as-is (expo-video handles them)
//   file:// URIs                         → kept as-is
//   Absolute paths (starting with /)     → prefixed with file://
//   Empty strings                        → returned as empty string
//
// NOTE: This is the canonical implementation. MusicPlayerContext.tsx has an
// identical private copy (normalizeLocalUri) for module-level use. Keep both
// in sync. This export is for component-level use outside the context module.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeLocalUri(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('content://') || uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export everything consumers need from MusicPlayerContext
// ─────────────────────────────────────────────────────────────────────────────

// Types
export type {
  Song,
  RepeatMode,
  ShuffleMode,
  PlayerEngineState,
  MusicPlayerContextType,
  TrackExtras,
  ResolvedTrack,
  VideoPlayer,
};

// Hooks and Context exports
export {
  usePlayerEngine,
  useMusicPlayer,
  useTrackExtrasVersion,
  getTrackExtras,
  getCachedTrackExtrasSync,
  storeTrackExtras,
  MusicPlayerProvider,
  setMasterPlayer,
  resetSSLFastPath,
};

// ─────────────────────────────────────────────────────────────────────────────
// Re-export preload utilities (for advanced use cases)
// Most components won't need these directly - they're used internally
// ─────────────────────────────────────────────────────────────────────────────

export {
  preloadSearchResults,
  preloadNextTracks,
  cancelAllPreloads,
  getPreloadAbortSignal,
  getActivePreloadCount,
  getResolvedCacheSize,
  clearResolvedUrlCache,
  type PreloadSong,
};

// ─────────────────────────────────────────────────────────────────────────────
// GestureContext — lives here because it is owned by _layout.tsx,
// not by the player engine. No circular dep risk.
// ─────────────────────────────────────────────────────────────────────────────

export interface GestureContextValue {
  setSliderActive: (active: boolean) => void;
  setButtonActive: (active: boolean) => void;
  isGestureBlocked: () => boolean;
  gestureBlockedSV: SharedValue<boolean>;
}

export const GestureContext = createContext<GestureContextValue | null>(null);

export const useGestureContext = (): GestureContextValue => {
  const ctx = useContext(GestureContext);
  if (!ctx) throw new Error('useGestureContext must be used within GestureContext.Provider');
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions for expandPlayer registration
// ─────────────────────────────────────────────────────────────────────────────

let expandPlayerRegistered = false;
let registeredExpandPlayer: (() => void) | null = null;

/**
 * For internal use by MusicPlayerContext to register the expand function.
 */
export const registerExpandPlayer = (expandFn: () => void): void => {
  registeredExpandPlayer = expandFn;
  expandPlayerRegistered = true;
  console.log('[PlayerSetup] expandPlayer registered successfully');
};

/**
 * For internal use by MusicPlayerContext to get the registered expand function.
 */
export const getRegisteredExpandPlayer = (): (() => void) | null => {
  return registeredExpandPlayer;
};

/**
 * Check if expandPlayer is registered.
 */
export const isExpandPlayerRegistered = (): boolean => {
  return expandPlayerRegistered;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Create a song object from minimal data
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSongParams {
  id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  url: string;
  videoId?: string;
  duration?: number;
  isLocal?: boolean;
  isDownloaded?: boolean;
}

/**
 * Utility to create a standardized Song object.
 * Throws if required fields are missing.
 */
export function createSong(params: CreateSongParams): Song {
  if (!params.id) {
    throw new Error('createSong: id is required');
  }
  if (!params.title) {
    throw new Error('createSong: title is required');
  }
  if (!params.url) {
    throw new Error('createSong: url is required');
  }

  return {
    id: params.id,
    title: params.title,
    artist: params.artist || 'Unknown Artist',
    thumbnail: params.thumbnail,
    url: params.url,
    videoId: params.videoId,
    duration: params.duration,
    isLocal: params.isLocal,
    isDownloaded: params.isDownloaded,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Check if a track is local
// ─────────────────────────────────────────────────────────────────────────────

export function isLocalTrack(
  track: { url?: string; isLocal?: boolean; isDownloaded?: boolean } | null | undefined,
): boolean {
  if (!track) return false;
  const url = track.url || '';
  return (
    url.startsWith('file://') === true ||
    url.startsWith('/') === true ||
    url.startsWith('content://') === true ||
    track.isLocal === true ||
    track.isDownloaded === true
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Format duration (seconds) to MM:SS or HH:MM:SS
// ─────────────────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Format number of plays/listens
// ─────────────────────────────────────────────────────────────────────────────

export function formatPlayCount(count: number | undefined | null): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract video ID from various YouTube URL formats
// ─────────────────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  if (!url) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?#]+)/,
    /youtube\.com\/shorts\/([^&?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build watch URL from video ID
// ─────────────────────────────────────────────────────────────────────────────

export function toWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get master player state (for components that need direct access)
// ─────────────────────────────────────────────────────────────────────────────

export interface MasterPlayerState {
  isPlaying: boolean;
  position: number;
  duration: number;
  isBuffering: boolean;
  volume: number;
  playbackRate: number;
  isMuted: boolean;
}

/**
 * Get the current state of the master player.
 * Returns null if master player is not registered yet.
 */
export function getMasterPlayerState(): MasterPlayerState | null {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (!master) return null;
    
    return {
      isPlaying: master.playing ?? false,
      position: master.currentTime ?? 0,
      duration: master.duration ?? 0,
      isBuffering: master.isBuffering ?? false,
      volume: master.volume ?? 1.0,
      playbackRate: master.playbackRate ?? 1.0,
      isMuted: master.muted ?? false,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get the current state of the slave player.
 * Returns null if slave player is not registered yet.
 */
export function getSlavePlayerState(): MasterPlayerState | null {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    if (!slave) return null;
    
    return {
      isPlaying: slave.playing ?? false,
      position: slave.currentTime ?? 0,
      duration: slave.duration ?? 0,
      isBuffering: slave.isBuffering ?? false,
      volume: slave.volume ?? 0,
      playbackRate: slave.playbackRate ?? 1.0,
      isMuted: slave.muted ?? true,
    };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Control master player directly (for advanced use cases)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Play the master player.
 * Returns true if successful, false otherwise.
 */
export function playMaster(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) {
      master.play();
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] playMaster failed:', e);
    return false;
  }
}

/**
 * Pause the master player.
 * Returns true if successful, false otherwise.
 */
export function pauseMaster(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) {
      master.pause();
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] pauseMaster failed:', e);
    return false;
  }
}

/**
 * Seek the master player to a specific position.
 * Returns true if successful, false otherwise.
 */
export function seekMaster(positionSec: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) {
      master.currentTime = positionSec;
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] seekMaster failed:', e);
    return false;
  }
}

/**
 * Set volume on the master player.
 * Returns true if successful, false otherwise.
 */
export function setMasterVolume(volume: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) {
      master.volume = Math.min(Math.max(volume, 0), 1);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] setMasterVolume failed:', e);
    return false;
  }
}

/**
 * Set playback rate on the master player.
 * Returns true if successful, false otherwise.
 */
export function setMasterPlaybackRate(rate: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) {
      master.playbackRate = Math.min(Math.max(rate, 0.5), 16);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] setMasterPlaybackRate failed:', e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Control slave player directly (for advanced use cases)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the slave player (make it visible and sync to master).
 * Returns true if successful, false otherwise.
 */
export function showSlave(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    const master = (global as any).__MavinMasterPlayer__;
    if (slave && master) {
      slave.currentTime = master.currentTime ?? 0;
      slave.muted = true;
      if (master.playing) {
        slave.play();
      }
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] showSlave failed:', e);
    return false;
  }
}

/**
 * Hide the slave player (pause it).
 * Returns true if successful, false otherwise.
 */
export function hideSlave(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    if (slave) {
      slave.pause();
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] hideSlave failed:', e);
    return false;
  }
}

/**
 * Sync slave player position to master player.
 * Returns true if successful, false otherwise.
 */
export function syncSlaveToMaster(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    const master = (global as any).__MavinMasterPlayer__;
    if (slave && master) {
      const masterPos = master.currentTime ?? 0;
      const diff = Math.abs((slave.currentTime ?? 0) - masterPos);
      if (diff > 0.3) {
        slave.currentTime = masterPos;
      }
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[PlayerSetup] syncSlaveToMaster failed:', e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Reset SSL fast path (for network error recovery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset the SSL fast path cache.
 * Call this when you encounter SSL-related playback errors.
 */
export function resetSSLFastPathAndReload(): void {
  resetSSLFastPath();
  console.log('[PlayerSetup] SSL fast path reset');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Debug logging for player state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log the current state of both master and slave players for debugging.
 */
export function debugPlayerState(): void {
  const masterState = getMasterPlayerState();
  const slaveState = getSlavePlayerState();
  
  console.log('[PlayerSetup] ========== PLAYER STATE DEBUG ==========');
  console.log('[PlayerSetup] MASTER:', masterState);
  console.log('[PlayerSetup] SLAVE:', slaveState);
  console.log('[PlayerSetup] =========================================');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Check if audio is actually playing (for diagnostics)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the master player is actually producing audio.
 * Returns true if playing and volume > 0.
 */
export function isAudioPlaying(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (!master) return false;
    return (master.playing === true && master.volume > 0 && master.muted === false);
  } catch (e) {
    return false;
  }
}