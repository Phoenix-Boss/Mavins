// hooks/useSystemMediaControls.ts
//
// Bridges expo-audio (via usePlayerEngine) → mavin-media-session native module.
//
// Now imports from @/libs/playerSetup for consistency with the bridge pattern.
//
// FIXES vs original:
//  • engine.playerReady removed — not part of PlayerEngineState; readiness is
//    inferred from engine.currentTrack being non-null instead.
//  • mediaSession.setMetadata() is now async (AsyncFunction on native) — awaited.
//  • Media button handlers use an engineRef so they never capture a stale closure.
//  • Position sync interval is created once (on mount) and reads live values
//    from engineRef — no re-creation on every render.
//  • AppState background handler uses engineRef for the same reason.
//  • seekTo data.position guard changed: `!data?.position` is falsy when
//    position is 0 (valid seek target) — changed to `data?.position == null`.
//  • artworkUrl: track.videoId is already the bare video ID — no need to call
//    extractVideoId on it again.

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { usePlayerEngine, PlayerEngineState } from '@/libs/playerSetup';
import mediaSession from '@/modules/mavin-media-session';

const POSITION_SYNC_MS = 2000;

export function useSystemMediaControls() {
  const engine    = usePlayerEngine();
  // Stable ref so interval / AppState / event callbacks always see current values
  // without being listed as deps (which would cause teardown/re-subscribe churn).
  const engineRef = useRef<PlayerEngineState>(engine);

  useEffect(() => {
    engineRef.current = engine;
  });

  // ── 1. Metadata — fires when track changes ──────────────────────────────────
  useEffect(() => {
    const track = engine.currentTrack;
    if (!track) return;

    const artworkUrl =
      track.thumbnail ||
      (track.videoId
        ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
        : undefined);

    // setMetadata is async (Glide runs on background thread)
    mediaSession
      .setMetadata({
        title:      track.title,
        artist:     track.artist ?? 'Unknown Artist',
        artworkUrl,
        // expo-audio gives duration in seconds; MediaSessionCompat wants ms
        duration:   Math.round((track.duration ?? 0) * 1000),
        trackId:    track.id,
      })
      .catch(e => console.warn('[MediaControls] setMetadata error:', e));

    // Push initial playback state alongside metadata
    mediaSession.setPlaybackState(
      engine.isPlaying ? 'playing' : 'paused',
      Math.round(engine.position * 1000),
      1,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.currentTrack?.id]);   // only re-run when the track itself changes

  // ── 2. Playback state — fires when play/pause/buffer changes ───────────────
  useEffect(() => {
    if (!engine.currentTrack) return;

    const state = engine.isPlaying
      ? 'playing'
      : engine.isBuffering
      ? 'buffering'
      : 'paused';

    mediaSession.setPlaybackState(
      state,
      Math.round(engine.position * 1000),
      1,
    );
  }, [engine.isPlaying, engine.isBuffering, engine.currentTrack?.id]);

  // ── 3. Position sync — single interval, reads live ref ────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const e = engineRef.current;
      if (!e.currentTrack) return;
      mediaSession.updatePosition(
        Math.round(e.position * 1000),
        Math.round(e.duration * 1000),
      );
    }, POSITION_SYNC_MS);

    return () => clearInterval(id);
  }, []); // mount/unmount only

  // ── 4. Media button events — subscribe once, read engine via ref ───────────
  useEffect(() => {
    const unsubs = [
      mediaSession.addEventListener('onPlay', () => {
        engineRef.current.play();
      }),

      mediaSession.addEventListener('onPause', () => {
        engineRef.current.pause();
      }),

      mediaSession.addEventListener('onSkipToNext', () => {
        engineRef.current.skipToNext();
      }),

      mediaSession.addEventListener('onSkipToPrevious', () => {
        engineRef.current.skipToPrevious();
      }),

      mediaSession.addEventListener('onSeekTo', (data?: { position?: number }) => {
        // data.position arrives in milliseconds from the native side
        if (data?.position == null) return;
        engineRef.current.seekTo(data.position / 1000);
      }),

      mediaSession.addEventListener('onStop', () => {
        engineRef.current.pause();
      }),
    ];

    return () => {
      unsubs.forEach(u => u());
    };
  }, []); // mount/unmount only — engine read via ref

  // ── 5. App background — update state via ref ──────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      const e = engineRef.current;
      if (!e.currentTrack) return;
      mediaSession.setPlaybackState(
        'paused',
        Math.round(e.position * 1000),
        1,
      );
    });
    return () => sub.remove();
  }, []); // mount/unmount only

  // ── 6. Final cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mediaSession.removeAllListeners();
    };
  }, []);
}

export default useSystemMediaControls;