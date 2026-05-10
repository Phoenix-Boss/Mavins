// hooks/useTrackPlayerFavorite.tsx
/**
 * useTrackPlayerFavorite - expo-av replacement for react-native-track-player's favorite hook
 * 
 * Manages favorite/liked songs state using the library store.
 * Tracks the currently playing song and provides toggle functionality.
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import { useActiveTrack } from './useActiveTrack';
import { useLibraryStore, useIsSongFavorite } from '@/store/library';
import { triggerHaptic, type HapticStrength } from '@/helpers/haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackData {
  id: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  url?: string;
  duration?: number;
  videoId?: string;
}

export interface UseTrackPlayerFavoriteResult {
  /** Whether the current track is favorited */
  isFavorite: boolean;
  /** Toggle favorite status for the current track */
  toggleFavorite: () => Promise<void>;
  /** Alias for toggleFavorite (backward compatibility) */
  toggleFavoriteFunc: () => Promise<void>;
  /** Current track ID (or null if no track) */
  currentTrackId: string | null;
  /** Whether favorite status is being loaded */
  isLoading: boolean;
  /** The current track object */
  currentTrack: TrackData | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state for cross-component sync
// ─────────────────────────────────────────────────────────────────────────────

let favoriteListeners: Set<(trackId: string, isFavorite: boolean) => void> = new Set();

export function subscribeToFavoriteChanges(
  callback: (trackId: string, isFavorite: boolean) => void
): () => void {
  favoriteListeners.add(callback);
  return () => {
    favoriteListeners.delete(callback);
  };
}

function notifyFavoriteChange(trackId: string, isFavorite: boolean): void {
  favoriteListeners.forEach(listener => {
    try {
      listener(trackId, isFavorite);
    } catch (e) {
      console.warn('[useTrackPlayerFavorite] Listener error:', e);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A custom hook that manages favorite status for the currently playing track.
 * 
 * @returns {UseTrackPlayerFavoriteResult} Favorite state and control functions
 * 
 * @example
 * const { isFavorite, toggleFavorite, isLoading } = useTrackPlayerFavorite();
 * 
 * return (
 *   <TouchableOpacity onPress={toggleFavorite}>
 *     <HeartIcon filled={isFavorite} />
 *   </TouchableOpacity>
 * );
 */
export const useTrackPlayerFavorite = (): UseTrackPlayerFavoriteResult => {
  const activeTrack = useActiveTrack();
  const currentTrackId = activeTrack?.id ?? null;
  const currentTrack = activeTrack;
  
  const trackLoading = !activeTrack?.id;
  
  const isFavoriteFromStore = useIsSongFavorite(currentTrackId ?? "");
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const addFavorite = useLibraryStore((s) => s.addFavorite);
  const removeFavorite = useLibraryStore((s) => s.removeFavorite);
  
  const lastTrackIdRef = useRef<string | null>(null);
  const pendingToggleRef = useRef<boolean>(false);
  const mountedRef = useRef(true);

  // Sync with store
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Update favorite when track changes
  useEffect(() => {
    if (trackLoading) {
      setIsLoading(true);
      return;
    }

    const trackId = activeTrack?.id;
    
    if (trackId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = trackId ?? null;
      pendingToggleRef.current = false;
    }
    
    if (!trackId) {
      if (mountedRef.current) {
        setIsFavorite(false);
        setIsLoading(false);
      }
      return;
    }
    
    if (mountedRef.current) {
      setIsFavorite(isFavoriteFromStore);
      setIsLoading(false);
    }
  }, [activeTrack?.id, isFavoriteFromStore, trackLoading, activeTrack]);

  // Listen to external favorite changes
  useEffect(() => {
    if (!currentTrackId) return;
    
    const unsubscribe = subscribeToFavoriteChanges((trackId, fav) => {
      if (trackId === currentTrackId && mountedRef.current) {
        setIsFavorite(fav);
      }
    });
    
    return unsubscribe;
  }, [currentTrackId]);

  /**
   * Toggle favorite status for the current track
   */
  const toggleFavorite = useCallback(async () => {
    const trackId = currentTrackId;
    
    if (!trackId || pendingToggleRef.current) return;
    pendingToggleRef.current = true;
    
    const newState = !isFavorite;
    
    // Optimistic update
    if (mountedRef.current) {
      setIsFavorite(newState);
    }
    
    // Haptic feedback
    const hapticType: HapticStrength = newState ? "light" : "medium";
    triggerHaptic(hapticType);
    
    try {
      if (newState) {
        // Save track metadata along with favorite
        const trackData: TrackData = {
          id: trackId,
          title: currentTrack?.title,
          artist: currentTrack?.artist,
          thumbnail: currentTrack?.artwork,
          url: currentTrack?.url,
          duration: currentTrack?.duration,
          videoId: currentTrack?.videoId,
        };
        
        // Store in library
        addFavorite('song', trackId, trackData);
        
        // Notify listeners
        notifyFavoriteChange(trackId, true);
        
        console.log('[useTrackPlayerFavorite] Added favorite:', currentTrack?.title);
      } else {
        removeFavorite('song', trackId);
        notifyFavoriteChange(trackId, false);
        
        console.log('[useTrackPlayerFavorite] Removed favorite:', currentTrack?.title);
      }
    } catch (error) {
      console.error("[useTrackPlayerFavorite] Failed to toggle favorite:", error);
      
      // Revert optimistic update on error
      if (mountedRef.current) {
        setIsFavorite(!newState);
      }
    } finally {
      pendingToggleRef.current = false;
    }
  }, [currentTrackId, isFavorite, addFavorite, removeFavorite, currentTrack]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pendingToggleRef.current = false;
    };
  }, []);

  return {
    isFavorite,
    toggleFavorite,
    toggleFavoriteFunc: toggleFavorite,
    currentTrackId,
    isLoading: isLoading || trackLoading,
    currentTrack,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a track is favorited without using the hook
 * 
 * @param trackId - The track ID to check
 * @returns boolean indicating if the track is favorited
 */
export const checkIsFavorite = (trackId: string | null | undefined): boolean => {
  if (!trackId) return false;
  const state = useLibraryStore.getState();
  return state.favoriteSongIds.includes(trackId);
};

/**
 * Get favorite status for multiple tracks
 * 
 * @param trackIds - Array of track IDs to check
 * @returns Map of track ID to favorite status
 */
export const getFavoritesMap = (trackIds: string[]): Map<string, boolean> => {
  const state = useLibraryStore.getState();
  const favoritesMap = new Map<string, boolean>();
  
  for (const id of trackIds) {
    favoritesMap.set(id, state.favoriteSongIds.includes(id));
  }
  
  return favoritesMap;
};

/**
 * Toggle favorite for a specific track (standalone)
 * 
 * @param trackId - The track ID to toggle
 * @param trackData - Optional track metadata to save when adding
 * @returns Promise<boolean> - New favorite state
 */
export const toggleTrackFavorite = async (
  trackId: string,
  trackData?: {
    title?: string;
    artist?: string;
    thumbnail?: string;
    url?: string;
    duration?: number;
  }
): Promise<boolean> => {
  const state = useLibraryStore.getState();
  const isCurrentlyFavorite = state.favoriteSongIds.includes(trackId);
  
  const hapticType: HapticStrength = isCurrentlyFavorite ? "medium" : "light";
  triggerHaptic(hapticType);
  
  if (isCurrentlyFavorite) {
    state.removeFavorite('song', trackId);
    notifyFavoriteChange(trackId, false);
    return false;
  } else {
    state.addFavorite('song', trackId, trackData);
    notifyFavoriteChange(trackId, true);
    return true;
  }
};

/**
 * Bulk add favorites
 * 
 * @param trackIds - Array of track IDs to add
 * @returns Promise<void>
 */
export const addMultipleFavorites = async (trackIds: string[]): Promise<void> => {
  const state = useLibraryStore.getState();
  
  for (const trackId of trackIds) {
    if (!state.favoriteSongIds.includes(trackId)) {
      state.addFavorite('song', trackId);
      notifyFavoriteChange(trackId, true);
    }
  }
  
  triggerHaptic("light");
};

/**
 * Remove multiple favorites
 * 
 * @param trackIds - Array of track IDs to remove
 * @returns Promise<void>
 */
export const removeMultipleFavorites = async (trackIds: string[]): Promise<void> => {
  const state = useLibraryStore.getState();
  
  for (const trackId of trackIds) {
    if (state.favoriteSongIds.includes(trackId)) {
      state.removeFavorite('song', trackId);
      notifyFavoriteChange(trackId, false);
    }
  }
  
  triggerHaptic("medium");
};

// Default export
export default useTrackPlayerFavorite;