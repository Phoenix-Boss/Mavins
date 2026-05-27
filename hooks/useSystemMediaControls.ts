// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// ARCHITECTURE: Dual-mode lock screen controls
//   - When on Song tab: Shows audio player state (isPlaying, position, duration)
//   - When on Video tab: Shows video player state (videoIsPlaying, videoPosition, videoDuration)
//   - Seamless switching between audio and video without re-initializing
//
// COMMANDS AVAILABLE (from expo-media-control API):
//   PLAY, PAUSE, STOP, NEXT_TRACK, PREVIOUS_TRACK, SKIP_FORWARD, SKIP_BACKWARD, SEEK
//
// FIXED: Removed spamming of "Adding media control event listener"
// FIXED: Single initialization, no duplicate listeners
// FIXED: Proper cleanup on unmount

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Image } from 'react-native';
import {
  Command,
  MediaControl,
  PlaybackState,
  type MediaControlEvent,
} from 'expo-media-control';

import type { RepeatMode } from '@/libs/playerSetup';

// Import fallback image for local tracks without artwork
const FALLBACK_ICON = require('@/assets/images/icon.png');

export interface SystemMediaControlsTrack {
  title: string;
  artist: string;
  artwork?: string;
  videoId?: string;
  duration?: number;
}

export interface SystemMediaControlsProps {
  track?: SystemMediaControlsTrack;

  // Audio player state
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  repeatMode: RepeatMode;

  // Video player state (used when video tab is active)
  isVideoActive: boolean;
  videoPosition: number;
  videoDuration: number;
  videoIsPlaying: boolean;

  // Audio control callbacks
  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onExpandPlayer: () => void;

  // Video control callbacks (used when video tab is active)
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoSeek: (positionSec: number) => void;

  // App lifecycle callbacks
  onAppBackground: () => void;
  onAppForeground: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LOCK_SCREEN_UPDATE_INTERVAL_MS = 250;

// Valid commands in expo-media-control
const MEDIA_CAPABILITY_KEYS = [
  'PLAY',
  'PAUSE',
  'NEXT_TRACK',
  'PREVIOUS_TRACK',
  'STOP',
  'SEEK',
] as const;

const COMPACT_CAPABILITY_KEYS = ['PREVIOUS_TRACK', 'PLAY', 'NEXT_TRACK'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL SINGLETON STATE
// Prevents multiple initializations and duplicate listeners
// ─────────────────────────────────────────────────────────────────────────────
let cachedFallbackUri: string | null = null;
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let commandListenerRemover: (() => void) | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let currentProps: SystemMediaControlsProps | null = null;
let isMounted = true;

function getFallbackArtworkUri(): string {
  if (!cachedFallbackUri) {
    try {
      const resolved = Image.resolveAssetSource(FALLBACK_ICON);
      cachedFallbackUri = resolved?.uri || '';
    } catch (error) {
      console.warn('[MediaControls] Failed to resolve fallback icon:', error);
      cachedFallbackUri = '';
    }
  }
  return cachedFallbackUri || '';
}

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
  const fallbackUri = getFallbackArtworkUri();

  if (!track) {
    return fallbackUri || undefined;
  }

  if (track.artwork && track.artwork.trim().length > 0) {
    return track.artwork;
  }

  if (track.videoId) {
    return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
  }

  return fallbackUri || undefined;
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

function getActivePosition(p: SystemMediaControlsProps): number {
  return p.isVideoActive ? safePosition(p.videoPosition) : safePosition(p.position);
}

function getActiveDuration(p: SystemMediaControlsProps): number {
  return p.isVideoActive
    ? safeDuration(p.videoDuration, p.track?.duration)
    : safeDuration(p.duration, p.track?.duration);
}

function getActivePlaying(p: SystemMediaControlsProps): boolean {
  return p.isVideoActive ? p.videoIsPlaying : p.isPlaying;
}

async function pushMetadataAndState(props: SystemMediaControlsProps): Promise<void> {
  if (!isMediaControlAvailable() || !isInitialized) return;
  if (!props.track) return;

  const elapsedTime = getActivePosition(props);
  const durationValue = getActiveDuration(props);
  const activePlaying = getActivePlaying(props);
  const artworkUri = buildArtworkUri(props.track);

  await safeMediaCall(async () => {
    await MediaControl.updateMetadata({
      title: props.track?.title || 'Unknown Title',
      artist: props.track?.artist || 'Unknown Artist',
      duration: durationValue,
      elapsedTime,
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
}

async function initializeMediaControls(): Promise<void> {
  if (!isMediaControlAvailable()) {
    console.log('[MediaControls] MediaControl not available on this device');
    return;
  }
  if (isInitialized) return;
  if (initializationPromise) return initializationPromise;

  console.log('[MediaControls] Initializing...');

  initializationPromise = (async () => {
    const { capabilities, compactCapabilities } = getNativeCapabilities();
    try {
      await MediaControl.enableMediaControls({
        capabilities,
        compactCapabilities,
        notification: { color: '#D4AF37' },
      });
      isInitialized = true;
      console.log('[MediaControls] Initialized successfully');
      
      if (currentProps) {
        await pushMetadataAndState(currentProps);
      }
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '');
      if (!message.includes('already') && !message.includes('enabled')) {
        console.warn('[MediaControls] Init error:', message);
      }
      isInitialized = true;
    }
  })();

  return initializationPromise;
}

function setupCommandListener(): void {
  if (commandListenerRemover) return;
  if (!isMediaControlAvailable() || typeof MediaControl.addListener !== 'function') return;

  console.log('[MediaControls] Setting up command listener');

  commandListenerRemover = MediaControl.addListener((event: MediaControlEvent) => {
    if (!currentProps) return;
    const current = currentProps;

    switch (event.command) {
      case Command.PLAY:
        if (current.isVideoActive) {
          current.onVideoPlay();
        } else {
          current.onPlay();
        }
        break;

      case Command.PAUSE:
        if (current.isVideoActive) {
          current.onVideoPause();
        } else {
          current.onPause();
        }
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

          if (current.isVideoActive) {
            current.onVideoSeek(clamped);
          } else {
            current.onSeek(clamped);
          }

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
        if (current.isVideoActive) {
          current.onVideoPause();
        } else {
          current.onPause();
        }
        break;

      default:
        break;
    }
  });
}

function startProgressInterval(): void {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  progressInterval = setInterval(() => {
    if (!isInitialized || !currentProps || !currentProps.track) return;
    
    const elapsedTime = getActivePosition(currentProps);
    const activePlaying = getActivePlaying(currentProps);
    
    void safeMediaCall(async () => {
      await MediaControl.updatePlaybackState(
        playbackStateFor(activePlaying),
        elapsedTime,
        activePlaying ? 1.0 : 0.0,
      );
    });
  }, LOCK_SCREEN_UPDATE_INTERVAL_MS);
}

function stopProgressInterval(): void {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

function cleanupMediaControls(): void {
  if (commandListenerRemover) {
    try {
      commandListenerRemover();
    } catch {}
    commandListenerRemover = null;
  }
  stopProgressInterval();
  
  if (isMediaControlAvailable() && isInitialized) {
    void safeMediaCall(async () => {
      await MediaControl.disableMediaControls();
    });
  }
  isInitialized = false;
  initializationPromise = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HOOK
// ─────────────────────────────────────────────────────────────────────────────
export function useSystemMediaControls(props: SystemMediaControlsProps): void {
  // Update currentProps reference
  currentProps = props;

  // Single initialization effect - runs once
  useEffect(() => {
    getFallbackArtworkUri();
    initializeMediaControls();
    setupCommandListener();
    startProgressInterval();

    return () => {
      // Only cleanup if this is the last instance
      cleanupMediaControls();
    };
  }, []); // Empty dependency array - runs once

  // Duration sync effect
  useEffect(() => {
    if (!isInitialized || !props.track) return;
    
    const durationValue = getActiveDuration(props);
    if (durationValue > 0) {
      void safeMediaCall(async () => {
        await MediaControl.updateMetadata({ duration: durationValue });
      });
    }
  }, [props.duration, props.videoDuration, props.track?.duration]);

  // Full metadata push on relevant changes
  useEffect(() => {
    if (!isInitialized || !props.track) return;
    void pushMetadataAndState(props);
  }, [
    props.track?.title,
    props.track?.artist,
    props.track?.artwork,
    props.track?.videoId,
    props.track?.duration,
    props.duration,
    props.isPlaying,
    props.repeatMode,
    props.isVideoActive,
    props.videoDuration,
    props.videoIsPlaying,
  ]);

  // App background handler
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      if (!isInitialized || !props.track) return;

      const elapsedTime = getActivePosition(props);
      const durationValue = getActiveDuration(props);
      const activePlaying = getActivePlaying(props);
      const artworkUri = buildArtworkUri(props.track);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(
          playbackStateFor(activePlaying),
          elapsedTime,
          activePlaying ? 1.0 : 0.0,
        );
      });

      void safeMediaCall(async () => {
        await MediaControl.updateMetadata({
          duration: durationValue,
          elapsedTime,
          title: props.track?.title || 'Unknown Title',
          artist: props.track?.artist || 'Unknown Artist',
          ...(artworkUri ? { artwork: { uri: artworkUri } } : {}),
        });
      });

      props.onAppBackground();
    });

    return () => sub.remove();
  }, [props.onAppBackground, props.track]);

  // App foreground handler
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      props.onAppForeground();
    });

    return () => sub.remove();
  }, [props.onAppForeground]);
}

export default useSystemMediaControls;