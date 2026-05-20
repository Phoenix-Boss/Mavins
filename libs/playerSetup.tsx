// libs/playerSetup.tsx
//
// SINGLE SOURCE OF TRUTH for consumers.
// All player types, hooks, and contexts are re-exported from here.
//
// Architecture:
//   MusicPlayerContext.tsx  ← owns all logic, defines contexts, exports hooks
//   playerSetup.tsx         ← re-exports everything + adds GestureContext
//   preload.ts              ← owns ALL preload logic (search + queue)
//   All other files         ← import from playerSetup
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
  type MusicPlayerProviderProps,
  // Hooks and functions
  usePlayerEngine,
  useMusicPlayer,
  useTrackExtrasVersion,
  getTrackExtras,
  storeTrackExtras,
  MusicPlayerProvider,
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
// URI NORMALIZER - Shared utility for local file URIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a local file URI to a format compatible with expo-audio
 * - content:// URIs (Android MediaStore) are kept as-is (expo-audio handles them)
 * - file:// URIs are kept as-is
 * - Absolute paths are prefixed with file://
 * - Empty strings return empty string
 */
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
  MusicPlayerProviderProps,
};

// Hooks and Context exports
export {
  usePlayerEngine,
  useMusicPlayer,
  useTrackExtrasVersion,
  getTrackExtras,
  storeTrackExtras,
  MusicPlayerProvider,
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
 * For internal use by MusicPlayerContext to register the expand function
 */
export const registerExpandPlayer = (expandFn: () => void): void => {
  registeredExpandPlayer = expandFn;
  expandPlayerRegistered = true;
  console.log('[PlayerSetup] expandPlayer registered successfully');
};

/**
 * For internal use by MusicPlayerContext to get the registered expand function
 */
export const getRegisteredExpandPlayer = (): (() => void) | null => {
  return registeredExpandPlayer;
};

/**
 * Check if expandPlayer is registered
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
 * Utility to create a standardized Song object
 */
export function createSong(params: CreateSongParams): Song {
  // Ensure required fields have values
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

export function isLocalTrack(track: { url?: string; isLocal?: boolean; isDownloaded?: boolean } | null | undefined): boolean {
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
  
  // Regular expressions for different YouTube URL formats
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