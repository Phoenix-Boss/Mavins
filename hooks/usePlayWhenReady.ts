// hooks/usePlayWhenReady.ts
/**
 * usePlayWhenReady - expo-av replacement for react-native-track-player's play when ready
 * 
 * For expo-av, we don't have a direct "playWhenReady" concept.
 * This hook provides a compatible API that manages playing state and restores after loading.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

export interface PlayWhenReadyState {
  playWhenReady: boolean;
  setPlayWhenReady: (value: boolean) => Promise<void>;
  isLoading: boolean;
}

/**
 * Hook that manages the "play when ready" concept.
 * In expo-av, this manages whether the player should auto-play when a track loads.
 * 
 * @returns Object with playWhenReady state and control function
 * 
 * @example
 * const { playWhenReady, setPlayWhenReady } = usePlayWhenReady();
 */
export const usePlayWhenReady = (): PlayWhenReadyState => {
  const { isPlaying, isLoading, togglePlayPause, currentTrack } = useMusicPlayer();
  const [playWhenReady, setPlayWhenReadyState] = useState(false);
  const pendingPlayRef = useRef(false);
  const trackIdRef = useRef<string | null>(null);

  // Sync playWhenReady with actual playing state
  useEffect(() => {
    if (isLoading) return;
    
    // When a track is loaded and playWhenReady is true but not playing, start playback
    if (playWhenReady && !isPlaying && currentTrack && !isLoading) {
      if (!pendingPlayRef.current) {
        pendingPlayRef.current = true;
        togglePlayPause().finally(() => {
          pendingPlayRef.current = false;
        });
      }
    }
    
    // Update playWhenReady when playing state changes externally
    if (!isLoading && !pendingPlayRef.current) {
      if (isPlaying !== playWhenReady) {
        setPlayWhenReadyState(isPlaying);
      }
    }
  }, [isPlaying, isLoading, currentTrack, playWhenReady, togglePlayPause]);

  // Track changes - reset pending flag
  useEffect(() => {
    if (currentTrack?.id !== trackIdRef.current) {
      trackIdRef.current = currentTrack?.id || null;
      pendingPlayRef.current = false;
    }
  }, [currentTrack]);

  const setPlayWhenReady = useCallback(async (value: boolean) => {
    setPlayWhenReadyState(value);
    
    if (value && currentTrack && !isPlaying && !isLoading) {
      // User wants to play, and we have a track
      await togglePlayPause();
    } else if (!value && isPlaying) {
      // User wants to pause
      await togglePlayPause();
    }
  }, [currentTrack, isPlaying, isLoading, togglePlayPause]);

  return {
    playWhenReady,
    setPlayWhenReady,
    isLoading,
  };
};

// Alias for backward compatibility
export const usePlaybackStateWhenReady = usePlayWhenReady;

export default usePlayWhenReady;