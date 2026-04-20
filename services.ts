// service.ts
/**
 * RNTP Playback Service - Background Audio Handler
 * 
 * This service runs in a separate thread and handles all remote control events
 * including: notification controls, lockscreen controls, headset buttons,
 * Bluetooth controls, and smartwatch controls.
 * 
 * Registered in index.js via TrackPlayer.registerPlaybackService()
 */

import TrackPlayer, { Event, State } from 'react-native-track-player';
import { Platform } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level variables for cross-event state (service runs in separate thread)
// ─────────────────────────────────────────────────────────────────────────────

let lastTrackId: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely execute TrackPlayer operations with error handling
 */
async function safeTrackPlayerOperation<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[PlaybackService] ${operationName} failed:`, error);
    return null;
  }
}

/**
 * Get current playback state safely
 */
async function getPlaybackState(): Promise<State> {
  try {
    const state = await TrackPlayer.getPlaybackState();
    return state;
  } catch {
    return State.None;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Playback Service Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Playback Service - handles all remote events
 * This function is registered via TrackPlayer.registerPlaybackService()
 */
export async function PlaybackService(): Promise<void> {
  console.log('[PlaybackService] Service started');

  // ─── Playback Control Events ───────────────────────────────────────────────

  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    console.log('[PlaybackService] RemotePlay');
    await safeTrackPlayerOperation(() => TrackPlayer.play(), 'RemotePlay');
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    console.log('[PlaybackService] RemotePause');
    await safeTrackPlayerOperation(() => TrackPlayer.pause(), 'RemotePause');
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    console.log('[PlaybackService] RemoteStop');
    await safeTrackPlayerOperation(() => TrackPlayer.stop(), 'RemoteStop');
  });

  TrackPlayer.addEventListener(Event.RemoteTogglePlayback, async () => {
    console.log('[PlaybackService] RemoteTogglePlayback');
    const state = await getPlaybackState();
    if (state === State.Playing) {
      await safeTrackPlayerOperation(() => TrackPlayer.pause(), 'TogglePause');
    } else {
      await safeTrackPlayerOperation(() => TrackPlayer.play(), 'TogglePlay');
    }
  });

  // ─── Track Navigation Events ────────────────────────────────────────────────

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    console.log('[PlaybackService] RemoteNext');
    await safeTrackPlayerOperation(() => TrackPlayer.skipToNext(), 'RemoteNext');
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    console.log('[PlaybackService] RemotePrevious');
    
    // Get current position
    const progress = await safeTrackPlayerOperation(
      () => TrackPlayer.getProgress(),
      'GetProgress'
    );
    
    // If more than 3 seconds in, restart current track (YT Music behavior)
    if (progress && progress.position > 3) {
      await safeTrackPlayerOperation(() => TrackPlayer.seekTo(0), 'SeekToStart');
    } else {
      await safeTrackPlayerOperation(() => TrackPlayer.skipToPrevious(), 'SkipToPrevious');
    }
  });

  // ─── Seeking Events ─────────────────────────────────────────────────────────

  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    console.log('[PlaybackService] RemoteSeek:', event);
    const { position } = event as { position: number };
    if (typeof position === 'number' && !isNaN(position)) {
      await safeTrackPlayerOperation(() => TrackPlayer.seekTo(position), 'RemoteSeek');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
    console.log('[PlaybackService] RemoteJumpForward:', event);
    const { interval = 10 } = event as { interval?: number };
    const progress = await safeTrackPlayerOperation(() => TrackPlayer.getProgress(), 'GetProgress');
    if (progress) {
      const newPosition = Math.min(progress.position + interval, progress.duration);
      await safeTrackPlayerOperation(() => TrackPlayer.seekTo(newPosition), 'JumpForward');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
    console.log('[PlaybackService] RemoteJumpBackward:', event);
    const { interval = 10 } = event as { interval?: number };
    const progress = await safeTrackPlayerOperation(() => TrackPlayer.getProgress(), 'GetProgress');
    if (progress) {
      const newPosition = Math.max(0, progress.position - interval);
      await safeTrackPlayerOperation(() => TrackPlayer.seekTo(newPosition), 'JumpBackward');
    }
  });

  // ─── Rating/Feedback Events ───────────────────────────────────────────────

  TrackPlayer.addEventListener(Event.RemoteLike, async () => {
    console.log('[PlaybackService] RemoteLike');
    // Emit to main app via global event or store
  });

  TrackPlayer.addEventListener(Event.RemoteDislike, async () => {
    console.log('[PlaybackService] RemoteDislike');
  });

  // ─── Metadata/State Events ────────────────────────────────────────────────

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    console.log('[PlaybackService] PlaybackActiveTrackChanged:', event);
    const { track } = event;
    if (track?.id && track.id !== lastTrackId) {
      lastTrackId = track.id;
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (event) => {
    console.log('[PlaybackService] PlaybackQueueEnded:', event);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async (event) => {
    console.error('[PlaybackService] PlaybackError:', event);
  });

  // ─── Android Specific Events ─────────────────────────────────────────────

  if (Platform.OS === 'android') {
    TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
      console.log('[PlaybackService] RemoteDuck:', event);
      const { paused, permanent } = event as { paused: boolean; permanent: boolean };
      
      if (permanent) {
        await safeTrackPlayerOperation(() => TrackPlayer.pause(), 'DuckPause');
      } else if (paused) {
        await safeTrackPlayerOperation(() => TrackPlayer.pause(), 'DuckTempPause');
      } else {
        await safeTrackPlayerOperation(() => TrackPlayer.play(), 'DuckResume');
      }
    });
  }

  // ─── iOS Specific Events ─────────────────────────────────────────────────

  if (Platform.OS === 'ios') {
    TrackPlayer.addEventListener(Event.RemoteChangePlaybackPosition, async (event) => {
      console.log('[PlaybackService] RemoteChangePlaybackPosition:', event);
      const { position } = event as { position: number };
      if (typeof position === 'number') {
        await safeTrackPlayerOperation(() => TrackPlayer.seekTo(position), 'iOSChangePosition');
      }
    });
  }

  console.log('[PlaybackService] All event listeners registered');
}

/**
 * Default export for simpler registration
 * Usage: TrackPlayer.registerPlaybackService(() => require('./service').default);
 */
export default async function (): Promise<void> {
  return PlaybackService();
}