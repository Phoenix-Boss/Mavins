// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// CORRECT API (expo-media-control):
//   • enableMediaControls()   - init with capability list
//   • updateMetadata()        - track title, artist, artwork { uri }, duration, elapsedTime
//   • updatePlaybackState()   - (state, position?, rate?) — native side animates progress
//   • addListener()           - single unified callback for ALL lock screen button events
//   • disableMediaControls()  - cleanup on unmount
//
// NOTE: There is NO setNowPlaying(), NO updatePlaybackPosition(), NO MediaControl.on().
//       The native platform animates scrubber progress automatically from position + rate,
//       so a periodic JS position-push interval is unnecessary and actually harmful
//       (it interrupts the native animation on Android).

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import {
  MediaControl,
  PlaybackState,
  Command,
  type MediaControlEvent,
} from 'expo-media-control';
import { usePlayerEngine, PlayerEngineState } from '@/libs/playerSetup';

// Only run on Android
const isAndroid = Platform.OS === 'android';

export function useSystemMediaControls(): void {
  const engine = usePlayerEngine();

  // Stable ref — lets AppState / event callbacks read the latest engine state
  // without being listed as deps (avoids teardown/re-subscribe churn).
  const engineRef = useRef<PlayerEngineState>(engine);
  useEffect(() => {
    engineRef.current = engine;
  });

  // ── 0. Initialize media controls (runs once on mount, Android only) ─────────
  useEffect(() => {
    if (!isAndroid) return;

    const initControls = async () => {
      try {
        await MediaControl.enableMediaControls({
          capabilities: [
            Command.PLAY,
            Command.PAUSE,
            Command.NEXT_TRACK,
            Command.PREVIOUS_TRACK,
            Command.SEEK,
            Command.STOP,
          ],
          compactCapabilities: [
            Command.PREVIOUS_TRACK,
            Command.PLAY,
            Command.NEXT_TRACK,
          ],
          notification: {
            color: '#D4AF37', // Mavin gold
          },
        });
        console.log('[MediaControls] Initialized successfully (Android)');
      } catch (error) {
        console.warn('[MediaControls] Init error on Android:', error);
      }
    };

    initControls();
  }, []);

  // ── 1. Metadata — re-runs only when the track identity changes ──────────────
  useEffect(() => {
    if (!isAndroid) return;

    const track = engine.currentTrack;
    if (!track) return;

    // Build artwork URL from the bare videoId if no explicit thumbnail is set.
    const artworkUri =
      track.thumbnail ||
      (track.videoId
        ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
        : undefined);

    // updateMetadata() — artwork must be { uri: string }, not a bare string.
    MediaControl.updateMetadata({
      title: track.title,
      artist: track.artist ?? 'Unknown Artist',
      duration: track.duration ?? 0,
      elapsedTime: engine.position,
      ...(artworkUri ? { artwork: { uri: artworkUri } } : {}),
    }).catch(e => console.warn('[MediaControls] updateMetadata error:', e));

    // Push the initial playback state alongside the new metadata.
    const initialState = engine.isPlaying ? PlaybackState.PLAYING : PlaybackState.PAUSED;
    MediaControl.updatePlaybackState(
      initialState,
      engine.position,
      engine.isPlaying ? 1.0 : 0.0,
    ).catch(e => console.warn('[MediaControls] updatePlaybackState error:', e));

    // Only re-run when the track itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.currentTrack?.id]);

  // ── 2. Playback state — re-runs when play/pause/buffer state changes ────────
  // Passing position + rate lets the native side animate the scrubber on its own,
  // so we do NOT need a periodic JS interval for position updates.
  useEffect(() => {
    if (!isAndroid) return;

    if (!engine.currentTrack) return;

    let state: PlaybackState;
    if (engine.isPlaying) {
      state = PlaybackState.PLAYING;
    } else if (engine.isBuffering) {
      state = PlaybackState.BUFFERING;
    } else {
      state = PlaybackState.PAUSED;
    }

    MediaControl.updatePlaybackState(
      state,
      engine.position,
      engine.isPlaying ? 1.0 : 0.0,
    ).catch(e => console.warn('[MediaControls] updatePlaybackState error:', e));
  }, [engine.isPlaying, engine.isBuffering, engine.currentTrack?.id]);

  // ── 3. Media button events — single unified addListener() ──────────────────
  // expo-media-control uses ONE addListener call that receives all commands
  // via event.command (a Command enum value). Returns a plain remove function.
  useEffect(() => {
    if (!isAndroid) return;

    const removeListener = MediaControl.addListener((event: MediaControlEvent) => {
      const e = engineRef.current;

      switch (event.command) {
        case Command.PLAY:
          console.log('[MediaControls] PLAY received');
          e.play();
          break;

        case Command.PAUSE:
          console.log('[MediaControls] PAUSE received');
          e.pause();
          break;

        case Command.NEXT_TRACK:
          console.log('[MediaControls] NEXT_TRACK received');
          e.skipToNext();
          break;

        case Command.PREVIOUS_TRACK:
          console.log('[MediaControls] PREVIOUS_TRACK received');
          e.skipToPrevious();
          break;

        case Command.SEEK: {
          const position = event.data?.position;
          if (position !== undefined && position !== null) {
            console.log('[MediaControls] SEEK received:', position);
            e.seekTo(position);
          }
          break;
        }

        case Command.STOP:
          console.log('[MediaControls] STOP received');
          e.pause();
          break;

        default:
          break;
      }
    });

    return () => {
      removeListener();
    };
  }, []);

  // ── 4. App backgrounded — push final state via ref ─────────────────────────
  // Ensures the lock screen reflects correct state when app goes to background.
  useEffect(() => {
    if (!isAndroid) return;

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;

      const e = engineRef.current;
      if (!e.currentTrack) return;

      const state = e.isPlaying ? PlaybackState.PLAYING : PlaybackState.PAUSED;
      MediaControl.updatePlaybackState(
        state,
        e.position,
        e.isPlaying ? 1.0 : 0.0,
      ).catch(err => console.warn('[MediaControls] background state update error:', err));
    });

    return () => sub.remove();
  }, []);

  // ── 5. Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAndroid) return;

    return () => {
      MediaControl.disableMediaControls().catch(e =>
        console.warn('[MediaControls] disable error:', e),
      );
    };
  }, []);
}

export default useSystemMediaControls;