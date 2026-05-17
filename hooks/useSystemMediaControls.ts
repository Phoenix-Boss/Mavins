// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// Intended behavior:
// - Continuous lock-screen progress updates
// - Proper duration sync with fallback to track.duration
// - Seek support from lock screen
// - Repeat mode sync and control
// - Notification tap expands player instead of routing
// - Swipe-down returns to home screen naturally
// - Defensive capability validation
// - Robust error handling
// - No circular dependency: all data is passed in via props
//
// Android-only. No iOS references.

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

  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onExpandPlayer: () => void;
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
    case 'one':
      return 1;
    case 'all':
      return 2;
    default:
      return 0;
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
    onPlay,
    onPause,
    onSkipNext,
    onSkipPrevious,
    onSeek,
    onSetRepeatMode,
    onExpandPlayer,
  } = props;

  const initializedRef = useRef(false);
  const pendingPropsRef = useRef<SystemMediaControlsProps | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const propsRef = useRef<SystemMediaControlsProps>(props);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const pushMetadataAndState = useCallback(async (nextProps: SystemMediaControlsProps) => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;
    if (!nextProps.track) return;

    const elapsedTime = safePosition(nextProps.position);
    const durationValue = safeDuration(nextProps.duration, nextProps.track.duration);
    const artworkUri = buildArtworkUri(nextProps.track);

    await safeMediaCall(async () => {
      await MediaControl.updateMetadata({
        title: nextProps.track?.title || 'Unknown Title',
        artist: nextProps.track?.artist || 'Unknown Artist',
        duration: durationValue,
        elapsedTime,
        repeatMode: repeatModeToNative(nextProps.repeatMode),
        ...(artworkUri ? { artwork: { uri: artworkUri } } : {}),
      });
    });

    await safeMediaCall(async () => {
      await MediaControl.updatePlaybackState(
        playbackStateFor(nextProps.isPlaying),
        elapsedTime,
        nextProps.isPlaying ? 1.0 : 0.0,
      );
    });
  }, []);

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
          notification: {
            color: '#D4AF37',
          },
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

    return () => {
      cancelled = true;
    };
  }, [pushMetadataAndState]);

  useEffect(() => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;
    if (!track) return;

    const durationValue = safeDuration(duration, track.duration);
    if (durationValue <= 0) return;

    void safeMediaCall(async () => {
      await MediaControl.updateMetadata({ duration: durationValue });
    });
  }, [duration, track?.duration, track?.title, track?.artist, track?.videoId, track?.artwork]);

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
    pushMetadataAndState,
  ]);

  useEffect(() => {
    if (!isMediaControlAvailable() || !initializedRef.current) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    intervalRef.current = setInterval(() => {
      const current = propsRef.current;
      if (!current.track) return;
      if (!initializedRef.current) return;

      const elapsedTime = safePosition(current.position);
      const state = playbackStateFor(current.isPlaying);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(
          state,
          elapsedTime,
          current.isPlaying ? 1.0 : 0.0,
        );
      });
    }, LOCK_SCREEN_UPDATE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isMediaControlAvailable() || typeof MediaControl.addListener !== 'function') return;

    let removeListener: (() => void) | null = null;

    try {
      removeListener = MediaControl.addListener((event: MediaControlEvent) => {
        const current = propsRef.current;

        switch (event.command) {
          case Command.PLAY:
            current.onPlay();
            break;

          case Command.PAUSE:
            current.onPause();
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
              const maxDuration = safeDuration(current.duration, current.track?.duration);
              const clamped = maxDuration > 0 ? Math.min(nextPosition, maxDuration) : nextPosition;
              current.onSeek(clamped);

              void safeMediaCall(async () => {
                await MediaControl.updatePlaybackState(
                  playbackStateFor(current.isPlaying),
                  clamped,
                  current.isPlaying ? 1.0 : 0.0,
                );
              });
            }
            break;
          }

          case Command.STOP:
            current.onPause();
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
        try {
          removeListener();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      if (!isMediaControlAvailable() || !initializedRef.current) return;

      const current = propsRef.current;
      if (!current.track) return;

      const elapsedTime = safePosition(current.position);
      const durationValue = safeDuration(current.duration, current.track.duration);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(
          playbackStateFor(current.isPlaying),
          elapsedTime,
          current.isPlaying ? 1.0 : 0.0,
        );
      });

      void safeMediaCall(async () => {
        await MediaControl.updateMetadata({
          duration: durationValue,
          elapsedTime,
          repeatMode: repeatModeToNative(current.repeatMode),
          title: current.track?.title || 'Unknown Title',
          artist: current.track?.artist || 'Unknown Artist',
          ...(buildArtworkUri(current.track) ? { artwork: { uri: buildArtworkUri(current.track)! } } : {}),
        });
      });
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;

      const current = propsRef.current;
      if (!current.track || !initializedRef.current) return;

      setTimeout(() => {
        try {
          current.onExpandPlayer();
        } catch {
          // intentionally silent
        }
      }, 150);
    });

    return () => sub.remove();
  }, []);

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

      initializedRef.current = false;
      pendingPropsRef.current = null;
    };
  }, []);
}

export default useSystemMediaControls;