// hooks/useLogTrackPlayerState.tsx
/**
 * useLogTrackPlayerState - expo-av replacement for react-native-track-player's logging hook
 * 
 * Safe logging hook for development mode. Logs playback state changes and events.
 * Version-safe - handles both RNTP and expo-av gracefully.
 * 
 * FIX: useTrackPlayerEvents is called unconditionally to satisfy Rules of Hooks.
 * Passing an empty array is safe: the hook simply registers no listeners.
 */

import { useEffect, useRef } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { 
  useTrackPlayerEvents, 
  Event, 
  TrackPlayerEvent,
  PlaybackStateEvent,
  PlaybackErrorEvent,
  PlaybackTrackChangedEvent,
  PlaybackActiveTrackChangedEvent
} from './useTrackPlayerEvents';

// Safe event list - filters out events that might not exist
// For expo-av, we use our own Event enum
const SAFE_EVENTS: Event[] = [
  Event.PlaybackState,
  Event.PlaybackError,
  Event.PlaybackTrackChanged,
  Event.PlaybackActiveTrackChanged,
  Event.PlaybackQueueEnded,
];

/**
 * Hook that logs TrackPlayer state changes and events in development mode.
 * Does nothing in production.
 * 
 * @example
 * useLogTrackPlayerState();
 */
export const useLogTrackPlayerState = (): void => {
  const { isPlaying, isBuffering, isLoading, position, duration, currentTrack } = useMusicPlayer();
  const lastStateRef = useRef<string>('');
  const lastTrackIdRef = useRef<string | null>(null);

  // Log playback state changes (development only)
  useEffect(() => {
    if (!__DEV__) return;
    
    let currentState = '';
    if (isLoading) currentState = 'loading';
    else if (isBuffering) currentState = 'buffering';
    else if (isPlaying) currentState = 'playing';
    else if (position > 0 && position < duration) currentState = 'paused';
    else if (position >= duration && duration > 0) currentState = 'ended';
    else currentState = 'ready';
    
    if (lastStateRef.current !== currentState) {
      lastStateRef.current = currentState;
      console.log(`[TrackPlayer] Playback state: ${currentState}`, {
        position,
        duration,
        isLoading,
        isBuffering,
        isPlaying,
      });
    }
  }, [isPlaying, isBuffering, isLoading, position, duration]);

  // Log track changes
  useEffect(() => {
    if (!__DEV__) return;
    
    const trackId = currentTrack?.id;
    if (trackId && lastTrackIdRef.current !== trackId) {
      console.log(`[TrackPlayer] Track changed:`, {
        prevTrack: lastTrackIdRef.current,
        nextTrack: trackId,
        title: currentTrack?.title,
        artist: currentTrack?.artist,
      });
      lastTrackIdRef.current = trackId;
    }
  }, [currentTrack]);

  // Always call useTrackPlayerEvents unconditionally
  // This satisfies Rules of Hooks - passing empty array is safe
  useTrackPlayerEvents(SAFE_EVENTS, async (event: TrackPlayerEvent) => {
    if (!__DEV__) return;

    switch (event.type) {
      case Event.PlaybackError: {
        const errorEvent = event as PlaybackErrorEvent;
        console.warn('[TrackPlayer] Playback error:', errorEvent.error);
        break;
      }
      case Event.PlaybackTrackChanged: {
        const trackEvent = event as PlaybackTrackChangedEvent;
        console.log('[TrackPlayer] Track position changed:', trackEvent.position);
        break;
      }
      case Event.PlaybackActiveTrackChanged: {
        const activeEvent = event as PlaybackActiveTrackChangedEvent;
        console.log('[TrackPlayer] Active track changed:', activeEvent.track);
        break;
      }
      case Event.PlaybackQueueEnded: {
        console.log('[TrackPlayer] Queue ended');
        break;
      }
      case Event.PlaybackState: {
        const stateEvent = event as PlaybackStateEvent;
        console.log('[TrackPlayer] State event:', stateEvent.state);
        break;
      }
      default:
        console.log('[TrackPlayer] Event:', event.type);
    }
  });
};

// Default export
export default useLogTrackPlayerState;

// Development-only logger component
export function TrackPlayerLogger(): null {
  useLogTrackPlayerState();
  return null;
}