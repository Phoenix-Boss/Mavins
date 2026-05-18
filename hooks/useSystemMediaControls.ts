// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// FIXED: SystemMediaControlsProps interface now includes isVideoActive, videoPosition,
//        videoDuration, videoIsPlaying, onVideoPlay, onVideoPause, onVideoSeek,
//        onAppBackground, onAppForeground so the bridge can switch lock screen data
//        between audio and video without TypeScript errors.
// FIXED: AppState foreground handler removed — double-expand was caused by this hook
//        AND MusicPlayerContext both calling expandPlayer on foreground. Removed from here;
//        MusicPlayerContext owns that responsibility.

import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  Command,
  MediaControl,
  PlaybackState,
  type MediaControlEvent,
} from 'expo-media-control';

import type { RepeatMode } from '@/libs/playerSetup';

export interface SystemMediaControlsTrack {
  title: string;
  artist: string;
  artwork?: string;
  videoId?: string;
  duration?: number;
}

export interface SystemMediaControlsProps {
  track?: SystemMediaControlsTrack;

  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  repeatMode: RepeatMode;

  // Video-tab state — bridge passes these so the hook can switch data sources
  isVideoActive: boolean;
  videoPosition: number;
  videoDuration: number;
  videoIsPlaying: boolean;

  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onExpandPlayer: () => void;

  // Video-specific lock screen actions
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoSeek: (positionSec: number) => void;

  // App lifecycle callbacks
  onAppBackground: () => void;
  onAppForeground: () => void;
}

const LOCK_SCREEN_UPDATE_INTERVAL_MS = 250;

const MEDIA_CAPABILITY_KEYS = [
  'PLAY',
  'PAUSE',
  'NEXT_TRACK',
  'PREVIOUS_TRACK',
  'STOP',
  'SEEK',
  'REPEAT',
] as const;

const COMPACT_CAPABILITY_KEYS = ['PREVIOUS_TRACK', 'PLAY', 'NEXT_TRACK'] as const;

function isMediaControlAvailable(): boolean {
  return !!MediaControl && typeof MediaControl.enableMediaControls === 'function';
}

function safeDuration(duration: number, trackDuration?: number): number {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (Number.isFinite(trackDuration ?? NaN) && (trackDuration ?? 0) > 0) return trackDuration ?? 0;
  return 0;
}

function safePosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, position);
}

function repeatModeToNative(mode: RepeatMode): number {
  switch (mode) {
    case 'one':  return 1;
    case 'all':  return 2;
    default:     return 0;
  }
}

function playbackStateFor(isPlaying: boolean): PlaybackState {
  return isPlaying ? PlaybackState.PLAYING : PlaybackState.PAUSED;
}

async function safeMediaCall<T>(action: () => Promise<T>, fallback?: T): Promise<T | undefined> {
  try {
    return await action();
  } catch (error: any) {
    const message = String(error?.message ?? error ?? '');
    if (
      !message.includes('already') &&
      !message.includes('initialized') &&
      !message.includes('enabled')
    ) {
      console.warn('[MediaControls]', message);
    }
    return fallback;
  }
}

function buildArtworkUri(track?: SystemMediaControlsTrack): string | undefined {
  if (!track) return undefined;
  if (track.artwork) return track.artwork;
  if (track.videoId) return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
  return undefined;
}

function getNativeCapabilities(): {
  capabilities: Command[];
  compactCapabilities: Command[];
} {
  const capabilities = MEDIA_CAPABILITY_KEYS
    .map((key) => (Command as any)[key])
    .filter((value): value is Command => value !== undefined);

  const compactCapabilities = COMPACT_CAPABILITY_KEYS
    .map((key) => (Command as any)[key])
    .filter((value): value is Command => value !== undefined);

  return { capabilities, compactCapabilities };
}

export function useSystemMediaControls(props: SystemMediaControlsProps): void {
  const {
    track,
    isPlaying,
    isBuffering,
    position,
    duration,
    repeatMode,
    isVideoActive,
    videoPosition,
    videoDuration,
    videoIsPlaying,
    onPlay,
    onPause,
    onSkipNext,
    onSkipPrevious,
    onSeek,
    onSetRepeatMode,
    onExpandPlayer,
    onVideoPlay,
    onVideoPause,
    onVideoSeek,
    onAppBackground,
    onAppForeground,
  } = props;

  const initializedRef = useRef(false);
  const pendingPropsRef = useRef<SystemMediaControlsProps | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const propsRef = useRef<SystemMediaControlsProps>(props);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  // ── Helpers that pick the active player's data ────────────────────────────
  const getActivePosition = (p: SystemMediaControlsProps) =>
    p.isVideoActive ? safePosition(p.videoPosition) : safePosition(p.position);

  const getActiveDuration = (p: SystemMediaControlsProps) =>
    p.isVideoActive
      ? safeDuration(p.videoDuration, p.track?.duration)
      : safeDuration(p.duration, p.track?.duration);

  const getActivePlaying = (p: SystemMediaControlsProps) =>
    p.isVideoActive ? p.videoIsPlaying : p.isPlaying;

  // ─────────────────────────────────────────────────────────────────────────

  const pushMetadataAndState = useCallback(async (nextProps: SystemMediaControlsProps) => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;
    if (!nextProps.track) return;

    const elapsedTime  = getActivePosition(nextProps);
    const durationValue = getActiveDuration(nextProps);
    const activePlaying = getActivePlaying(nextProps);
    const artworkUri    = buildArtworkUri(nextProps.track);

    await safeMediaCall(async () => {
      await MediaControl.updateMetadata({
        title:      nextProps.track?.title  || 'Unknown Title',
        artist:     nextProps.track?.artist || 'Unknown Artist',
        duration:   durationValue,
        elapsedTime,
        repeatMode: repeatModeToNative(nextProps.repeatMode),
        ...(artworkUri ? { artwork: { uri: artworkUri } } : {}),
      });
    });

    await safeMediaCall(async () => {
      await MediaControl.updatePlaybackState(
        playbackStateFor(activePlaying),
        elapsedTime,
        activePlaying ? 1.0 : 0.0,
      );
    });
  }, []);

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMediaControlAvailable()) {
      console.log('[MediaControls] MediaControl not available on this device');
      return;
    }
    if (initializedRef.current) return;

    let cancelled = false;

    const init = async () => {
      const { capabilities, compactCapabilities } = getNativeCapabilities();
      try {
        await MediaControl.enableMediaControls({
          capabilities,
          compactCapabilities,
          notification: { color: '#D4AF37' },
        });
        if (cancelled) return;
        initializedRef.current = true;
        console.log('[MediaControls] Initialized successfully (Android)');
        if (pendingPropsRef.current) {
          await pushMetadataAndState(pendingPropsRef.current);
          pendingPropsRef.current = null;
        }
      } catch (error: any) {
        const message = String(error?.message ?? error ?? '');
        if (!message.includes('already') && !message.includes('enabled')) {
          console.warn('[MediaControls] Init error:', message);
        }
        initializedRef.current = true;
      }
    };

    void init();
    return () => { cancelled = true; };
  }, [pushMetadataAndState]);

  // ── Duration sync on track change ─────────────────────────────────────────
  useEffect(() => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;
    if (!track) return;
    const durationValue = getActiveDuration(propsRef.current);
    if (durationValue <= 0) return;
    void safeMediaCall(async () => {
      await MediaControl.updateMetadata({ duration: durationValue });
    });
  }, [duration, videoDuration, track?.duration, track?.title, track?.artist, track?.videoId, track?.artwork]);

  // ── Full metadata push on relevant state changes ──────────────────────────
  useEffect(() => {
    if (!track || !isMediaControlAvailable()) return;
    if (!initializedRef.current) {
      pendingPropsRef.current = propsRef.current;
      return;
    }
    void pushMetadataAndState(propsRef.current);
  }, [
    track?.title,
    track?.artist,
    track?.artwork,
    track?.videoId,
    track?.duration,
    duration,
    position,
    isPlaying,
    repeatMode,
    isVideoActive,
    videoPosition,
    videoDuration,
    videoIsPlaying,
    pushMetadataAndState,
  ]);

  // ── Progress polling interval ─────────────────────────────────────────────
  useEffect(() => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    intervalRef.current = setInterval(() => {
      const current = propsRef.current;
      if (!current.track || !initializedRef.current) return;

      const elapsedTime  = getActivePosition(current);
      const activePlaying = getActivePlaying(current);
      const state         = playbackStateFor(activePlaying);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(state, elapsedTime, activePlaying ? 1.0 : 0.0);
      });
    }, LOCK_SCREEN_UPDATE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // ── Command listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMediaControlAvailable() || typeof MediaControl.addListener !== 'function') return;

    let removeListener: (() => void) | null = null;

    try {
      removeListener = MediaControl.addListener((event: MediaControlEvent) => {
        const current = propsRef.current;

        switch (event.command) {
          case Command.PLAY:
            if (current.isVideoActive) current.onVideoPlay();
            else current.onPlay();
            break;

          case Command.PAUSE:
            if (current.isVideoActive) current.onVideoPause();
            else current.onPause();
            break;

          case Command.NEXT_TRACK:
            void current.onSkipNext();
            break;

          case Command.PREVIOUS_TRACK:
            void current.onSkipPrevious();
            break;

          case Command.SEEK: {
            const nextPosition = event.data?.position;
            if (typeof nextPosition === 'number' && Number.isFinite(nextPosition) && nextPosition >= 0) {
              const maxDuration = getActiveDuration(current);
              const clamped = maxDuration > 0 ? Math.min(nextPosition, maxDuration) : nextPosition;

              if (current.isVideoActive) current.onVideoSeek(clamped);
              else current.onSeek(clamped);

              const activePlaying = getActivePlaying(current);
              void safeMediaCall(async () => {
                await MediaControl.updatePlaybackState(
                  playbackStateFor(activePlaying),
                  clamped,
                  activePlaying ? 1.0 : 0.0,
                );
              });
            }
            break;
          }

          case Command.STOP:
            if (current.isVideoActive) current.onVideoPause();
            else current.onPause();
            break;

          case Command.REPEAT: {
            if (current.repeatMode === 'off') current.onSetRepeatMode('all');
            else if (current.repeatMode === 'all') current.onSetRepeatMode('one');
            else current.onSetRepeatMode('off');
            break;
          }

          default:
            break;
        }
      });
    } catch (error: any) {
      console.warn('[MediaControls] Failed to add listener:', String(error?.message ?? error ?? ''));
    }

    return () => {
      if (removeListener) {
        try { removeListener(); } catch { /* ignore */ }
      }
    };
  }, []);

  // ── App background handler — push final state ─────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      if (!isMediaControlAvailable() || !initializedRef.current) return;

      const current = propsRef.current;
      if (!current.track) return;

      const elapsedTime   = getActivePosition(current);
      const durationValue = getActiveDuration(current);
      const activePlaying = getActivePlaying(current);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(
          playbackStateFor(activePlaying),
          elapsedTime,
          activePlaying ? 1.0 : 0.0,
        );
      });

      void safeMediaCall(async () => {
        await MediaControl.updateMetadata({
          duration:   durationValue,
          elapsedTime,
          repeatMode: repeatModeToNative(current.repeatMode),
          title:      current.track?.title  || 'Unknown Title',
          artist:     current.track?.artist || 'Unknown Artist',
          ...(buildArtworkUri(current.track) ? { artwork: { uri: buildArtworkUri(current.track)! } } : {}),
        });
      });

      // Notify parent so it can save tab state
      current.onAppBackground();
    });

    return () => sub.remove();
  }, []);

  // ── App foreground handler — notify parent only, NO expandPlayer ──────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      const current = propsRef.current;
      if (current.onAppForeground) {
        current.onAppForeground();
      }
    });

    return () => sub.remove();
  }, []);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (isMediaControlAvailable() && initializedRef.current) {
        void safeMediaCall(async () => {
          await MediaControl.disableMediaControls();
        });
      }
      initializedRef.current  = false;
      pendingPropsRef.current = null;
    };
  }, []);
}

export default useSystemMediaControls;