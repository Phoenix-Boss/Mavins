// hooks/useIsPlaying.ts
/**
 * useIsPlaying - expo-av replacement for react-native-track-player's is playing detection
 * 
 * Tells whether the player is in a mode that most people would describe as "playing".
 * Includes buffering and loading states as "effectively playing" for UI purposes.
 */

import { useMemo } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

export interface IsPlayingState {
  isPlaying: boolean;
  isEffectivelyPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
}

/**
 * Hook that tells whether the player is playing or in a playing-like state.
 * 
 * @returns Object with playing state flags
 * 
 * @example
 * const { isPlaying, isEffectivelyPlaying } = useIsPlaying();
 * 
 * // For UI that should show playing animation (includes buffering)
 * if (isEffectivelyPlaying) { showPlayingAnimation(); }
 */
export const useIsPlaying = (): IsPlayingState => {
  const { isPlaying, isLoading, isBuffering } = useMusicPlayer();

  // "Effectively playing" includes buffering - useful for UI animations
  const isEffectivelyPlaying = useMemo(() => {
    return isPlaying || isBuffering;
  }, [isPlaying, isBuffering]);

  return {
    isPlaying,
    isEffectivelyPlaying,
    isLoading,
    isBuffering,
  };
};

// Simple boolean hook for when you just need true/false playing state
export const useIsPlayingSimple = (): boolean => {
  const { isPlaying } = useMusicPlayer();
  return isPlaying;
};

// For backward compatibility with RNTP's useIsPlaying
export const useIsPlayingRNTP = (): boolean => {
  const { isPlaying } = useMusicPlayer();
  return isPlaying;
};

export default useIsPlaying;