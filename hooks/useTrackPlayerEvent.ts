// hooks/useTrackPlayerEvents.ts
/**
 * useTrackPlayerEvents - expo-av replacement for react-native-track-player's useTrackPlayerEvents
 * 
 * Attaches event listeners to TrackPlayer events and cleans up on unmount.
 * For expo-av, we provide a compatible event system that works with MusicPlayerContext.
 */

import { useEffect, useRef } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

// RNTP-compatible Event enum
export enum Event {
  PlaybackState = 'playback-state',
  PlaybackError = 'playback-error',
  PlaybackTrackChanged = 'playback-track-changed',
  PlaybackActiveTrackChanged = 'playback-active-track-changed',
  PlaybackQueueEnded = 'playback-queue-ended',
  PlaybackMetadataReceived = 'playback-metadata-received',
  RemotePlay = 'remote-play',
  RemotePause = 'remote-pause',
  RemoteStop = 'remote-stop',
  RemoteNext = 'remote-next',
  RemotePrevious = 'remote-previous',
  RemoteSeek = 'remote-seek',
  RemoteJumpForward = 'remote-jump-forward',
  RemoteJumpBackward = 'remote-jump-backward',
  RemoteDuck = 'remote-duck',
  RemoteLike = 'remote-like',
  RemoteDislike = 'remote-dislike',
  RemoteBookmark = 'remote-bookmark',
}

// Event payload types
export interface PlaybackStateEvent {
  type: Event.PlaybackState;
  state: string;
}

export interface PlaybackErrorEvent {
  type: Event.PlaybackError;
  error: Error;
}

export interface PlaybackTrackChangedEvent {
  type: Event.PlaybackTrackChanged;
  nextTrack: number | null;
  position: number;
}

export interface PlaybackActiveTrackChangedEvent {
  type: Event.PlaybackActiveTrackChanged;
  track: any | null;
}

export interface PlaybackQueueEndedEvent {
  type: Event.PlaybackQueueEnded;
}

export interface RemotePlayEvent {
  type: Event.RemotePlay;
}

export interface RemotePauseEvent {
  type: Event.RemotePause;
}

export interface RemoteStopEvent {
  type: Event.RemoteStop;
}

export interface RemoteNextEvent {
  type: Event.RemoteNext;
}

export interface RemotePreviousEvent {
  type: Event.RemotePrevious;
}

export interface RemoteSeekEvent {
  type: Event.RemoteSeek;
  position: number;
}

export interface RemoteJumpForwardEvent {
  type: Event.RemoteJumpForward;
  interval: number;
}

export interface RemoteJumpBackwardEvent {
  type: Event.RemoteJumpBackward;
  interval: number;
}

export type TrackPlayerEvent = 
  | PlaybackStateEvent
  | PlaybackErrorEvent
  | PlaybackTrackChangedEvent
  | PlaybackActiveTrackChangedEvent
  | PlaybackQueueEndedEvent
  | RemotePlayEvent
  | RemotePauseEvent
  | RemoteStopEvent
  | RemoteNextEvent
  | RemotePreviousEvent
  | RemoteSeekEvent
  | RemoteJumpForwardEvent
  | RemoteJumpBackwardEvent;

type EventHandler = (event: TrackPlayerEvent) => void;

// Global event listeners store
const eventListeners = new Map<Event, Set<EventHandler>>();

/**
 * Emit an event to all registered listeners (for internal use)
 */
export function emitEvent(event: TrackPlayerEvent): void {
  const listeners = eventListeners.get(event.type);
  if (listeners) {
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[TrackPlayerEvents] Listener error:', error);
      }
    });
  }
}

/**
 * Add an event listener
 */
export function addEventListener(
  event: Event,
  handler: EventHandler
): { remove: () => void } {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler);
  
  return {
    remove: () => {
      const listeners = eventListeners.get(event);
      if (listeners) {
        listeners.delete(handler);
        if (listeners.size === 0) {
          eventListeners.delete(event);
        }
      }
    },
  };
}

/**
 * Remove an event listener
 */
export function removeEventListener(
  event: Event,
  handler: EventHandler
): void {
  const listeners = eventListeners.get(event);
  if (listeners) {
    listeners.delete(handler);
    if (listeners.size === 0) {
      eventListeners.delete(event);
    }
  }
}

/**
 * Hook that attaches handlers to TrackPlayer events and cleans up on unmount.
 * 
 * @param events - Array of events to subscribe to
 * @param handler - Callback function that receives the event
 * 
 * @example
 * useTrackPlayerEvents([Event.PlaybackState, Event.PlaybackError], (event) => {
 *   console.log('Event:', event.type, event);
 * });
 */
export const useTrackPlayerEvents = <T extends Event[]>(
  events: T,
  handler: (event: TrackPlayerEvent) => void
): void => {
  const handlerRef = useRef(handler);
  
  // Update handler ref when handler changes
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Set up and clean up event listeners
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    
    for (const event of events) {
      const wrappedHandler = (eventData: TrackPlayerEvent) => {
        handlerRef.current(eventData);
      };
      
      const { remove } = addEventListener(event, wrappedHandler);
      unsubscribes.push(remove);
    }
    
    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, [events.join(',')]); // Re-run when events array changes
};

// Default export
export default useTrackPlayerEvents;

// Hook for subscribing to a single event
export function useTrackPlayerEvent(
  event: Event,
  handler: (event: TrackPlayerEvent) => void
): void {
  useTrackPlayerEvents([event], handler);
}