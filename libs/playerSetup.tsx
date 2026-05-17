// libs/playerSetup.tsx
//
// SINGLE SOURCE OF TRUTH for consumers.
// All player types, hooks, and contexts are re-exported from here.
//
// Architecture:
//   MusicPlayerContext.tsx  ← owns all logic, defines contexts, exports hooks
//   playerSetup.tsx         ← re-exports everything + adds GestureContext
//   All other files         ← import from playerSetup ONLY
//
// This breaks the circular dependency: playerSetup never imports from itself,
// and MusicPlayerContext never imports from playerSetup.

import { createContext, useContext } from 'react';
import { type SharedValue } from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export everything consumers need from MusicPlayerContext
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Song,
  RepeatMode,
  ShuffleMode,
  PlayerEngineState,
  MusicPlayerContextType,
  TrackExtras,
  ResolvedTrack,
  MusicPlayerProviderProps,
} from '@/components/MusicPlayerContext';

export {
  usePlayerEngine,
  useMusicPlayer,
  useTrackExtrasVersion,
  getTrackExtras,
  MusicPlayerProvider,
} from '@/components/MusicPlayerContext';

// ─────────────────────────────────────────────────────────────────────────────
// Preload function for search results (ISSUE 3 FIX)
// ─────────────────────────────────────────────────────────────────────────────

export interface PreloadSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  videoId: string;
  duration: number;
}

/**
 * Preloads search results for instant playback
 * This caches the track metadata and optionally prefetches audio data
 */
export const preloadSearchResults = async (songs: PreloadSong[]): Promise<void> => {
  if (!songs || songs.length === 0) return;
  
  try {
    // Option 1: Cache track metadata for faster access
    const { cache } = await import('@/libs/cache');
    
    const preloadPromises = songs.map(async (song) => {
      const cacheKey = `preload:track:${song.id}`;
      await cache.set(
        cacheKey,
        {
          preloaded: true,
          timestamp: Date.now(),
          track: {
            id: song.id,
            title: song.title,
            artist: song.artist,
            url: song.url,
            videoId: song.videoId,
          }
        },
        3600000 // 1 hour TTL
      ).catch(() => {});
      
      // Option 2: Prefetch the URL headers (lightweight)
      // This can help with faster initial load
      if (song.url) {
        // Use HEAD request to pre-connect and cache DNS
        fetch(song.url, { 
          method: 'HEAD',
          mode: 'no-cors' // This prevents CORS issues
        }).catch(() => {});
      }
    });
    
    await Promise.allSettled(preloadPromises);
    console.log(`[PlayerSetup] Preloaded ${songs.length} search results`);
  } catch (error) {
    // Non-critical, don't throw
    console.warn('[PlayerSetup] Failed to preload search results:', error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GestureContext — lives here because it is owned by _layout.tsx,
// not by the player engine. No circular dep risk.
// ─────────────────────────────────────────────────────────────────────────────

export interface GestureContextValue {
  setSliderActive:  (active: boolean) => void;
  setButtonActive:  (active: boolean) => void;
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
// Helper function to check if expandPlayer is registered
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