// hooks/usePlaybackState.ts
/**
 * usePlaybackState - expo-av replacement for react-native-track-player's usePlaybackState
 * 
 * Returns the current playback state (playing, paused, buffering, loading, etc.)
 * This extends the RNTP State enum for backward compatibility.
 */

import { useMemo } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

// RNTP-compatible State enum
export enum State {
  None = 'none',
  Ready = 'ready',
  Playing = 'playing',
  Paused = 'paused',
  Stopped = 'stopped',
  Buffering = 'buffering',
  Loading = 'loading',
  Error = 'error',
  Ended = 'ended',
}

export interface PlaybackState {
  state: State;
  position: number;
  duration: number;
  buffered: number;
}

/**
 * Hook that returns the current playback state.
 * 
 * @returns PlaybackState object with state enum and position/duration
 * 
 * @example
 * const playbackState = usePlaybackState();
 * 
 * if (playbackState.state === State.Playing) {
 *   console.log('Currently playing at', playbackState.position);
 * }
 */
export const usePlaybackState = (): PlaybackState => {
  const { 
    isPlaying, 
    isBuffering, 
    isLoading, 
    position, 
    duration,
    error
  } = useMusicPlayer();

  const state = useMemo(() => {
    if (error) return State.Error;
    if (isLoading) return State.Loading;
    if (isBuffering) return State.Buffering;
    if (isPlaying) return State.Playing;
    if (position > 0 && position < duration && duration > 0) return State.Paused;
    if (position >= duration && duration > 0) return State.Ended;
    if (position === 0 && duration === 0) return State.None;
    return State.Ready;
  }, [isPlaying, isBuffering, isLoading, position, duration, error]);

  return {
    state,
    position,
    duration,
    buffered: 0, // expo-av doesn't expose buffered range easily
  };
};

// Helper hook to get just the state enum
export const usePlaybackStateEnum = (): State => {
  const { state } = usePlaybackState();
  return state;
};

// Helper hook to check if currently playing (includes buffering for UX)
export const useIsPlayingOrBuffering = (): boolean => {
  const { state } = usePlaybackState();
  return state === State.Playing || state === State.Buffering;
};

export default usePlaybackState;