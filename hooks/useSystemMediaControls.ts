// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// MASTER-SLAVE ARCHITECTURE:
//   - Reads from MASTER player only (single source of truth)
//   - No audio/video duality - the master player owns all playback state
//   - Lock screen controls reflect the master player's state at all times
//
// FIXED: Removed isVideoActive duality - simplified to single player state
// FIXED: Skip metadata updates when duration is 0 to prevent showing "0:00" on lock screen
// FIXED: Wait for valid duration before pushing metadata to native
// FIXED: Single source of truth from master player
// FIXED: Use app icon (mavin.png) as default fallback artwork
// FIXED: Show "Mavin Player" as default title and "Upcoming Artist" as default artist

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Image } from 'react-native';
import {
  Command,
  MediaControl,
  PlaybackState,
  type MediaControlEvent,
} from 'expo-media-control';

import type { RepeatMode } from '@/libs/playerSetup';

// Import app icon as default fallback
const APP_ICON = require('@/assets/images/mavins.png');

export interface SystemMediaControlsTrack {
  title: string;
  artist: string;
  artwork?: string;
  videoId?: string;
  duration?: number;
}

export interface SystemMediaControlsProps {
  track?: SystemMediaControlsTrack;

  // Player state (from master player)
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  repeatMode: RepeatMode;

  // Control callbacks
  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onExpandPlayer: () => void;

  // App lifecycle callbacks
  onAppBackground: () => void;
  onAppForeground: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LOCK_SCREEN_UPDATE_INTERVAL_MS = 250;
const METADATA_DEBOUNCE_MS = 500;
const MAX_METADATA_RETRIES = 5;
const METADATA_RETRY_DELAY_MS = 1000;

// Default values for lock screen
const DEFAULT_TITLE = 'Mavin Player';
const DEFAULT_ARTIST = 'Upcoming Artist';

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
let lastMetadataHash: string = '';
let lastMetadataPushTime: number = 0;
let metadataRetryCount: number = 0;
let metadataRetryTimeout: ReturnType<typeof setTimeout> | null = null;

function getFallbackArtworkUri(): string {
  if (!cachedFallbackUri) {
    try {
      const resolved = Image.resolveAssetSource(APP_ICON);
      cachedFallbackUri = resolved?.uri || '';
    } catch (error) {
      console.warn('[MediaControls] Failed to resolve app icon:', error);
      cachedFallbackUri = '';
    }
  }
  return cachedFallbackUri || '';
}

function isMediaControlAvailable(): boolean {
  return !!MediaControl && typeof MediaControl.enableMediaControls === 'function';
}

function safeDuration(duration: number, trackDuration?: number): number {
  // Return 0 only if both are invalid
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

function getSafeTitle(track?: SystemMediaControlsTrack): string {
  if (!track) return DEFAULT_TITLE;
  if (track.title && track.title.trim().length > 0) {
    return track.title.trim();
  }
  return DEFAULT_TITLE;
}

function getSafeArtist(track?: SystemMediaControlsTrack): string {
  if (!track) return DEFAULT_ARTIST;
  if (track.artist && track.artist.trim().length > 0) {
    return track.artist.trim();
  }
  return DEFAULT_ARTIST;
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

function generateMetadataHash(props: SystemMediaControlsProps): string {
  const activeDuration = safeDuration(props.duration, props.track?.duration);
  const activePosition = safePosition(props.position);
  const artworkUri = buildArtworkUri(props.track);
  const title = getSafeTitle(props.track);
  const artist = getSafeArtist(props.track);
  
  return JSON.stringify({
    title,
    artist,
    duration: activeDuration,
    elapsedTime: activePosition,
    isPlaying: props.isPlaying,
    artwork: artworkUri,
    repeatMode: props.repeatMode,
  });
}

async function pushMetadataAndState(props: SystemMediaControlsProps): Promise<void> {
  if (!isMediaControlAvailable() || !isInitialized) return;

  const activeDuration = safeDuration(props.duration, props.track?.duration);
  
  // CRITICAL FIX: Skip metadata update if duration is 0 (not loaded yet)
  // This prevents showing "0:00" on the lock screen
  if (activeDuration <= 0) {
    console.log('[MediaControls] Skipping metadata update - duration not loaded yet (duration: 0)');
    
    // Retry logic: if we have a track but duration is 0, try again later
    if (props.track && metadataRetryCount < MAX_METADATA_RETRIES && !metadataRetryTimeout) {
      metadataRetryCount++;
      console.log(`[MediaControls] Will retry metadata push in ${METADATA_RETRY_DELAY_MS}ms (attempt ${metadataRetryCount}/${MAX_METADATA_RETRIES})`);
      metadataRetryTimeout = setTimeout(() => {
        metadataRetryTimeout = null;
        if (currentProps === props) {
          pushMetadataAndState(props);
        }
      }, METADATA_RETRY_DELAY_MS);
    }
    return;
  }
  
  // Reset retry count on success
  metadataRetryCount = 0;
  if (metadataRetryTimeout) {
    clearTimeout(metadataRetryTimeout);
    metadataRetryTimeout = null;
  }

  const elapsedTime = safePosition(props.position);
  const activePlaying = props.isPlaying;
  const artworkUri = buildArtworkUri(props.track);
  const title = getSafeTitle(props.track);
  const artist = getSafeArtist(props.track);

  // Generate hash to avoid duplicate updates
  const newHash = generateMetadataHash(props);
  const now = Date.now();
  
  // Debounce: don't push more than once every 200ms unless content changed
  if (newHash === lastMetadataHash && (now - lastMetadataPushTime) < METADATA_DEBOUNCE_MS) {
    return;
  }

  lastMetadataHash = newHash;
  lastMetadataPushTime = now;

  console.log('[MediaControls] Pushing metadata to native:', {
    title,
    artist,
    duration: activeDuration,
    elapsedTime,
    isPlaying: activePlaying,
  });

  await safeMediaCall(async () => {
    await MediaControl.updateMetadata({
      title,
      artist,
      duration: activeDuration,
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
    if (!isInitialized || !currentProps) return;
    
    const activeDuration = safeDuration(currentProps.duration, currentProps.track?.duration);
    // Skip progress updates if duration is still 0
    if (activeDuration <= 0) return;
    
    const elapsedTime = safePosition(currentProps.position);
    const activePlaying = currentProps.isPlaying;
    
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
  
  if (metadataRetryTimeout) {
    clearTimeout(metadataRetryTimeout);
    metadataRetryTimeout = null;
  }
  
  if (isMediaControlAvailable() && isInitialized) {
    void safeMediaCall(async () => {
      await MediaControl.disableMediaControls();
    });
  }
  isInitialized = false;
  initializationPromise = null;
  lastMetadataHash = '';
  lastMetadataPushTime = 0;
  metadataRetryCount = 0;
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

  // Reset metadata hash when track changes (so new metadata pushes through)
  useEffect(() => {
    lastMetadataHash = '';
    lastMetadataPushTime = 0;
    metadataRetryCount = 0;
    if (metadataRetryTimeout) {
      clearTimeout(metadataRetryTimeout);
      metadataRetryTimeout = null;
    }
  }, [props.track?.title, props.track?.artist, props.track?.videoId]);

  // Duration sync effect - only push when duration becomes valid (>0)
  useEffect(() => {
    if (!isInitialized) return;
    
    const durationValue = safeDuration(props.duration, props.track?.duration);
    // Only push if we have a valid duration
    if (durationValue > 0) {
      void pushMetadataAndState(props);
    }
  }, [props.duration, props.track?.duration]);

  // Full metadata push on relevant changes (only when duration is valid)
  useEffect(() => {
    if (!isInitialized) return;
    
    const activeDuration = safeDuration(props.duration, props.track?.duration);
    // Skip if duration is still 0 (not loaded yet)
    if (activeDuration <= 0) return;
    
    void pushMetadataAndState(props);
  }, [
    props.track?.title,
    props.track?.artist,
    props.track?.artwork,
    props.track?.videoId,
    props.duration,
    props.isPlaying,
    props.repeatMode,
  ]);

  // App background handler
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      if (!isInitialized) return;

      const activeDuration = safeDuration(props.duration, props.track?.duration);
      // Skip if duration not loaded
      if (activeDuration <= 0) return;

      const elapsedTime = safePosition(props.position);
      const activePlaying = props.isPlaying;
      const artworkUri = buildArtworkUri(props.track);
      const title = getSafeTitle(props.track);
      const artist = getSafeArtist(props.track);

      void safeMediaCall(async () => {
        await MediaControl.updatePlaybackState(
          playbackStateFor(activePlaying),
          elapsedTime,
          activePlaying ? 1.0 : 0.0,
        );
      });

      void safeMediaCall(async () => {
        await MediaControl.updateMetadata({
          duration: activeDuration,
          elapsedTime,
          title,
          artist,
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