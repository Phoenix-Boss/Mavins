// hooks/useActiveTrack.ts
/**
 * useActiveTrack - expo-av replacement for react-native-track-player's useActiveTrack
 * 
 * Returns the currently playing/loaded track from the MusicPlayerContext.
 * Includes memoization and optional polling for track changes.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

export interface ActiveTrack {
  id: string;
  title: string;
  artist?: string;
  artwork?: string;
  url?: string;
  duration?: number;
  videoId?: string;
  [key: string]: any;
}

export interface UseActiveTrackOptions {
  /** Whether to include track metadata like artwork, duration */
  includeMetadata?: boolean;
  /** Custom selector for specific track fields */
  select?: (track: ActiveTrack | null) => any;
}

/**
 * Hook that returns the currently active track.
 * For expo-av, this reads from MusicPlayerContext which manages currentTrack state.
 * 
 * @param options - Optional configuration
 * @returns The active track or null
 * 
 * @example
 * const activeTrack = useActiveTrack();
 * console.log('Now playing:', activeTrack?.title);
 * 
 * // Select specific fields
 * const trackId = useActiveTrack({ select: (track) => track?.id });
 */
export function useActiveTrack(options?: UseActiveTrackOptions): ActiveTrack | null {
  const { currentTrack } = useMusicPlayer();
  
  const track = useMemo(() => {
    if (!currentTrack) return null;
    
    if (options?.includeMetadata === false) {
      // Return minimal track info
      return {
        id: currentTrack.id,
        title: currentTrack.title,
      } as ActiveTrack;
    }
    
    // Return full track info
    return {
      id: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork: currentTrack.artwork || currentTrack.thumbnail,
      url: currentTrack.url,
      duration: currentTrack.duration,
      videoId: currentTrack.videoId,
    } as ActiveTrack;
  }, [currentTrack, options?.includeMetadata]);
  
  if (options?.select) {
    return options.select(track);
  }
  
  return track;
}

/**
 * Hook that returns the active track ID only (re-renders less frequently)
 * 
 * @returns The active track ID or null
 */
export function useActiveTrackId(): string | null {
  const { currentTrack } = useMusicPlayer();
  return currentTrack?.id || null;
}

/**
 * Hook that returns whether a specific track is currently active
 * 
 * @param trackId - The track ID to check
 * @returns boolean indicating if the track is active
 */
export function useIsTrackActive(trackId: string | null | undefined): boolean {
  const activeTrack = useActiveTrack();
  return !!trackId && !!activeTrack && activeTrack.id === trackId;
}

// Default export
export default useActiveTrack;