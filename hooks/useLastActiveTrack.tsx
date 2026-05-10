// hooks/useLastActiveTrack.tsx
/**
 * useLastActiveTrack - expo-av replacement
 * 
 * Keeps track of the last active track in the music player.
 * Useful for scenarios where you need to reference the previously playing track
 * even after the player has stopped and the active track becomes undefined.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useActiveTrack, ActiveTrack } from './useActiveTrack';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

export interface UseLastActiveTrackOptions {
  /** Whether to persist across app restarts */
  persistToStorage?: boolean;
  /** Storage key for persistence */
  storageKey?: string;
}

// Storage helper
async function persistTrack(track: ActiveTrack | null, key: string): Promise<void> {
  if (!track) return;
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem(key, JSON.stringify(track));
  } catch (error) {
    console.warn('[useLastActiveTrack] Failed to persist:', error);
  }
}

async function loadPersistedTrack(key: string): Promise<ActiveTrack | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const saved = await AsyncStorage.getItem(key);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('[useLastActiveTrack] Failed to load persisted:', error);
  }
  return null;
}

/**
 * A custom hook that returns the last track that was active in the player.
 * It listens for changes in the active track and stores the last valid track object.
 * 
 * @param options - Optional configuration
 * @returns The last active Track object, or null if no track has been active yet.
 * 
 * @example
 * const lastActiveTrack = useLastActiveTrack();
 * const showMiniPlayer = !!lastActiveTrack && !activeTrack;
 */
export const useLastActiveTrack = (options?: UseLastActiveTrackOptions): ActiveTrack | null => {
  const activeTrack = useActiveTrack();
  const [lastActiveTrack, setLastActiveTrack] = useState<ActiveTrack | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const { isPlaying } = useMusicPlayer();
  
  const storageKey = options?.storageKey || '@mavin/last_active_track';
  const persistEnabled = options?.persistToStorage === true;

  // Load persisted track on mount
  useEffect(() => {
    if (persistEnabled) {
      loadPersistedTrack(storageKey).then(savedTrack => {
        if (savedTrack && !activeTrack) {
          setLastActiveTrack(savedTrack);
          lastTrackIdRef.current = savedTrack.id;
        }
      });
    }
  }, [persistEnabled, storageKey, activeTrack]);

  // Update last active track when a new track becomes active
  useEffect(() => {
    if (activeTrack && activeTrack.id) {
      if (lastTrackIdRef.current !== activeTrack.id) {
        lastTrackIdRef.current = activeTrack.id;
        setLastActiveTrack(activeTrack);
        
        if (persistEnabled) {
          persistTrack(activeTrack, storageKey);
        }
      }
    }
    // When activeTrack becomes null, we keep the lastActiveTrack
    // This is intentional - we want to remember the last track
  }, [activeTrack, persistEnabled, storageKey]);

  // Clear last track when playing state is false and no active track (optional)
  // This is commented out because most apps want to keep the last track
  // for the mini-player to reappear after background

  return lastActiveTrack;
};

/**
 * Hook that returns both current and last active tracks
 * 
 * @returns Object with current and last active tracks
 */
export function useTrackHistory(): {
  current: ActiveTrack | null;
  last: ActiveTrack | null;
} {
  const current = useActiveTrack();
  const last = useLastActiveTrack();
  
  return { current, last };
}

/**
 * Hook that returns whether there was a track played recently
 * 
 * @returns boolean indicating if there's a track history
 */
export function useHasTrackHistory(): boolean {
  const lastTrack = useLastActiveTrack();
  const currentTrack = useActiveTrack();
  return !!(currentTrack || lastTrack);
}

// Default export
export default useLastActiveTrack;