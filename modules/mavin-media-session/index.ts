// modules/mavin-media-session/index.ts
//
// CHANGES vs original:
//  • setMetadata is now async (AsyncFunction on native side) — returns Promise.
//  • duration is kept as a number (milliseconds) — no unit conversion here,
//    callers must pass milliseconds to match what MediaMetadataCompat expects.
//  • All other methods and the event subscription API are unchanged.

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { MavinMediaSession: NativeMavinMediaSession } = NativeModules;

const eventEmitter =
  NativeMavinMediaSession ? new NativeEventEmitter(NativeMavinMediaSession) : null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'stopped';

export interface MediaMetadata {
  title: string;
  artist: string;
  album?: string;
  /** Full URL to the artwork image. Glide handles caching on the native side. */
  artworkUrl?: string;
  /** Duration in milliseconds. */
  duration: number;
  trackId: string;
}

export type MediaSessionEvent =
  | 'onPlay'
  | 'onPause'
  | 'onSkipToNext'
  | 'onSkipToPrevious'
  | 'onSeekTo'
  | 'onStop';

// ─── Manager ──────────────────────────────────────────────────────────────────

class MavinMediaSessionManager {
  private listeners: Map<string, Array<(data?: any) => void>> = new Map();

  constructor() {
    if (!eventEmitter) return;

    const events: MediaSessionEvent[] = [
      'onPlay',
      'onPause',
      'onSkipToNext',
      'onSkipToPrevious',
      'onSeekTo',
      'onStop',
    ];

    events.forEach(event => {
      eventEmitter!.addListener(event, (data: any) => {
        this.listeners.get(event)?.forEach(cb => cb(data));
      });
    });
  }

  /**
   * Set track metadata and trigger artwork loading on the native side.
   * Returns a Promise because artwork loading (Glide) is async.
   */
  async setMetadata(metadata: MediaMetadata): Promise<void> {
    if (Platform.OS === 'android' && NativeMavinMediaSession) {
      await NativeMavinMediaSession.setMetadata(metadata);
    }
  }

  /**
   * Update the playback state shown in the notification and on the lock screen.
   * @param state    One of 'playing' | 'paused' | 'buffering' | 'stopped'
   * @param position Current playback position in milliseconds.
   * @param speed    Playback speed (default 1.0).
   */
  setPlaybackState(state: PlaybackState, position = 0, speed = 1.0): void {
    if (Platform.OS === 'android' && NativeMavinMediaSession) {
      NativeMavinMediaSession.setPlaybackState(state, position, speed);
    }
  }

  /**
   * Lightweight position-only update (no notification rebuild).
   * Call this on a regular interval (e.g. every second) while playing.
   * @param position Current position in milliseconds.
   * @param duration Total duration in milliseconds.
   */
  updatePosition(position: number, duration: number): void {
    if (Platform.OS === 'android' && NativeMavinMediaSession) {
      NativeMavinMediaSession.updatePosition(position, duration);
    }
  }

  /**
   * Subscribe to a media session control event (fired by hardware buttons,
   * notification actions, and lock-screen controls).
   * Returns an unsubscribe function — call it in your cleanup / useEffect return.
   */
  addEventListener(
    event: MediaSessionEvent,
    callback: (data?: any) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);

    return () => {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        const idx = callbacks.indexOf(callback);
        if (idx > -1) callbacks.splice(idx, 1);
      }
    };
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Allow the media session to remain active when the app is backgrounded
   * without a foreground service (headless JS mode).
   */
  setHeadlessPlayback(enabled: boolean): void {
    if (Platform.OS === 'android' && NativeMavinMediaSession) {
      NativeMavinMediaSession.setHeadlessPlayback(enabled);
    }
  }
}

export const mediaSession = new MavinMediaSessionManager();
export default mediaSession;