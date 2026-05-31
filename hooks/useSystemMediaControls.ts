// hooks/useSystemMediaControls.ts
//
// Bridges the player engine → expo-media-control for lock screen controls (Android only).
//
// MASTER-SLAVE ARCHITECTURE:
//   - Reads from MASTER player only (single source of truth)
//   - No audio/video duality - the master player owns all playback state
//   - Lock screen controls reflect the master player's state at all times
//
// FIXED: Removed module-level singleton that persisted across provider remounts
// FIXED: Each hook instance manages its own state and cleanup
// FIXED: Skip metadata updates when duration is 0 to prevent showing "0:00" on lock screen
// FIXED: Wait for valid duration before pushing metadata to native
// FIXED: Single source of truth from master player

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Image } from 'react-native';
import {
  Command,
  MediaControl,
  PlaybackState,
  type MediaControlEvent,
} from 'expo-media-control';


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

  // Player state (from master player)
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  // Control callbacks
  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onExpandPlayer: () => void;
  // repeatMode and onSetRepeatMode intentionally removed: Android lock screen controls
  // do not support a repeat button via expo-media-control. The 'repeat-off' string
  // was being passed as a Material icon name, causing "not a valid icon name" warnings.

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
// HELPER FUNCTIONS (pure, no side effects)
// ─────────────────────────────────────────────────────────────────────────────
async function getFallbackArtworkUri(): Promise<string> {
  try {
    const resolved = Image.resolveAssetSource(FALLBACK_ICON);
    return resolved?.uri || '';
  } catch (error) {
    console.warn('[MediaControls] Failed to resolve fallback icon:', error);
    return '';
  }
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

function buildArtworkUri(track?: SystemMediaControlsTrack, fallbackUri?: string): string | undefined {
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

function generateMetadataHash(props: SystemMediaControlsProps, fallbackUri?: string): string {
  const activeDuration = safeDuration(props.duration, props.track?.duration);
  const activePosition = safePosition(props.position);
  const artworkUri = buildArtworkUri(props.track, fallbackUri);
  
  return JSON.stringify({
    title: props.track?.title || '',
    artist: props.track?.artist || '',
    duration: activeDuration,
    elapsedTime: activePosition,
    isPlaying: props.isPlaying,
    artwork: artworkUri,
    // repeatMode intentionally excluded: expo-media-control does not support a repeat
    // button on the Android lock screen. Including it caused 'repeat-off' to be passed
    // as a Material icon name, producing the "not a valid icon name" warning.
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HOOK - Each instance manages its own state
// ─────────────────────────────────────────────────────────────────────────────
export function useSystemMediaControls(props: SystemMediaControlsProps): void {
  // Instance-level state
  const isInitializedRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const commandListenerRemoverRef = useRef<(() => void) | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metadataRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataRetryCountRef = useRef(0);
  const lastMetadataHashRef = useRef('');
  const lastMetadataPushTimeRef = useRef(0);
  const fallbackUriRef = useRef<string>('');
  
  // Store props ref for use in callbacks that might get stale closures
  const propsRef = useRef(props);
  propsRef.current = props;

  // ─────────────────────────────────────────────────────────────────────────────
  // Push metadata to native
  // ─────────────────────────────────────────────────────────────────────────────
  const pushMetadataAndState = useCallback(async () => {
    const currentProps = propsRef.current;
    
    if (!isMediaControlAvailable() || !isInitializedRef.current) return;
    if (!currentProps.track) return;

    const activeDuration = safeDuration(currentProps.duration, currentProps.track?.duration);
    
    // Skip metadata update if duration is 0 (not loaded yet)
    if (activeDuration <= 0) {
      console.log('[MediaControls] Skipping metadata update - duration not loaded yet (duration: 0)');
      
      // Retry logic: if we have a track but duration is 0, try again later
      if (currentProps.track && metadataRetryCountRef.current < MAX_METADATA_RETRIES && !metadataRetryTimeoutRef.current) {
        metadataRetryCountRef.current++;
        console.log(`[MediaControls] Will retry metadata push in ${METADATA_RETRY_DELAY_MS}ms (attempt ${metadataRetryCountRef.current}/${MAX_METADATA_RETRIES})`);
        metadataRetryTimeoutRef.current = setTimeout(() => {
          metadataRetryTimeoutRef.current = null;
          pushMetadataAndState();
        }, METADATA_RETRY_DELAY_MS);
      }
      return;
    }
    
    // Reset retry count on success
    metadataRetryCountRef.current = 0;
    if (metadataRetryTimeoutRef.current) {
      clearTimeout(metadataRetryTimeoutRef.current);
      metadataRetryTimeoutRef.current = null;
    }

    const elapsedTime = safePosition(currentProps.position);
    const activePlaying = currentProps.isPlaying;
    const artworkUri = buildArtworkUri(currentProps.track, fallbackUriRef.current);

    // Generate hash to avoid duplicate updates
    const newHash = generateMetadataHash(currentProps, fallbackUriRef.current);
    const now = Date.now();
    
    // Debounce: don't push more than once every 200ms unless content changed
    if (newHash === lastMetadataHashRef.current && (now - lastMetadataPushTimeRef.current) < METADATA_DEBOUNCE_MS) {
      return;
    }

    lastMetadataHashRef.current = newHash;
    lastMetadataPushTimeRef.current = now;

    console.log('[MediaControls] Pushing metadata to native:', {
      title: currentProps.track?.title,
      artist: currentProps.track?.artist,
      duration: activeDuration,
      elapsedTime,
      isPlaying: activePlaying,
    });

    await safeMediaCall(async () => {
      await MediaControl.updateMetadata({
        title: currentProps.track?.title || 'Unknown Title',
        artist: currentProps.track?.artist || 'Unknown Artist',
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
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialize media controls
  // ─────────────────────────────────────────────────────────────────────────────
  const initializeMediaControls = useCallback(async () => {
    if (!isMediaControlAvailable()) {
      console.log('[MediaControls] MediaControl not available on this device');
      return;
    }
    if (isInitializedRef.current) return;

    console.log('[MediaControls] Initializing...');

    const { capabilities, compactCapabilities } = getNativeCapabilities();
    try {
      await MediaControl.enableMediaControls({
        capabilities,
        compactCapabilities,
        notification: { color: '#D4AF37' },
      });
      isInitializedRef.current = true;
      setIsInitialized(true);
      console.log('[MediaControls] Initialized successfully');
      
      // Push immediately, then again after a short delay to handle the race where
      // duration arrives before isInitializedRef is set (so the duration useEffect
      // fired early and returned without pushing).
      await pushMetadataAndState();
      setTimeout(() => { void pushMetadataAndState(); }, 600);
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '');
      if (message.includes('already') || message.includes('enabled')) {
        // Already enabled (e.g. provider re-mount) — still need to push current metadata
        isInitializedRef.current = true;
        setIsInitialized(true);
        console.log('[MediaControls] Already enabled, pushing current metadata');
        await pushMetadataAndState();
        setTimeout(() => { void pushMetadataAndState(); }, 600);
      } else {
        console.warn('[MediaControls] Init error:', message);
        isInitializedRef.current = true;
      }
    }
  }, [pushMetadataAndState]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Setup command listener
  // ─────────────────────────────────────────────────────────────────────────────
  const setupCommandListener = useCallback(() => {
    if (commandListenerRemoverRef.current) return;
    if (!isMediaControlAvailable() || typeof MediaControl.addListener !== 'function') return;

    console.log('[MediaControls] Setting up command listener');

    commandListenerRemoverRef.current = MediaControl.addListener((event: MediaControlEvent) => {
      const currentProps = propsRef.current;

      switch (event.command) {
        case Command.PLAY:
          currentProps.onPlay();
          break;

        case Command.PAUSE:
          currentProps.onPause();
          break;

        case Command.NEXT_TRACK:
          void currentProps.onSkipNext();
          break;

        case Command.PREVIOUS_TRACK:
          void currentProps.onSkipPrevious();
          break;

        case Command.SEEK: {
          const nextPosition = event.data?.position;
          if (typeof nextPosition === 'number' && Number.isFinite(nextPosition) && nextPosition >= 0) {
            const maxDuration = safeDuration(currentProps.duration, currentProps.track?.duration);
            const clamped = maxDuration > 0 ? Math.min(nextPosition, maxDuration) : nextPosition;

            currentProps.onSeek(clamped);

            void safeMediaCall(async () => {
              await MediaControl.updatePlaybackState(
                playbackStateFor(currentProps.isPlaying),
                clamped,
                currentProps.isPlaying ? 1.0 : 0.0,
              );
            });
          }
          break;
        }

        case Command.STOP:
          currentProps.onPause();
          break;

        default:
          break;
      }
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Start/stop progress interval
  // ─────────────────────────────────────────────────────────────────────────────
  const startProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    progressIntervalRef.current = setInterval(() => {
      const currentProps = propsRef.current;
      
      if (!isInitializedRef.current || !currentProps.track) return;
      
      const activeDuration = safeDuration(currentProps.duration, currentProps.track?.duration);
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
  }, []);

  const stopProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup function
  // ─────────────────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (commandListenerRemoverRef.current) {
      try {
        commandListenerRemoverRef.current();
      } catch {}
      commandListenerRemoverRef.current = null;
    }
    
    stopProgressInterval();
    
    if (metadataRetryTimeoutRef.current) {
      clearTimeout(metadataRetryTimeoutRef.current);
      metadataRetryTimeoutRef.current = null;
    }
    
    if (isMediaControlAvailable() && isInitializedRef.current) {
      void safeMediaCall(async () => {
        await MediaControl.disableMediaControls();
      });
    }
    
    isInitializedRef.current = false;
    setIsInitialized(false);
    lastMetadataHashRef.current = '';
    lastMetadataPushTimeRef.current = 0;
    metadataRetryCountRef.current = 0;
  }, [stopProgressInterval]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Load fallback artwork
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    getFallbackArtworkUri().then(uri => {
      fallbackUriRef.current = uri;
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialize on mount, cleanup on unmount
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    initializeMediaControls();
    setupCommandListener();
    startProgressInterval();

    return () => {
      cleanup();
    };
  }, [initializeMediaControls, setupCommandListener, startProgressInterval, cleanup]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Reset metadata hash when track changes
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    lastMetadataHashRef.current = '';
    lastMetadataPushTimeRef.current = 0;
    metadataRetryCountRef.current = 0;
    if (metadataRetryTimeoutRef.current) {
      clearTimeout(metadataRetryTimeoutRef.current);
      metadataRetryTimeoutRef.current = null;
    }
  }, [props.track?.title, props.track?.artist, props.track?.videoId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Post-init push — fires once when initialization completes, guaranteeing the
  // lock screen shows the currently-playing track even if all other useEffects
  // already fired before isInitializedRef was set (race condition guard).
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized || !props.track) return;
    const durationValue = safeDuration(props.duration, props.track?.duration);
    if (durationValue > 0) {
      void pushMetadataAndState();
    }
    // Only runs when isInitialized flips to true — intentionally narrow deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Duration sync effect - only push when duration becomes valid (>0)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitializedRef.current || !props.track) return;
    
    const durationValue = safeDuration(props.duration, props.track?.duration);
    if (durationValue > 0) {
      void pushMetadataAndState();
    }
  }, [props.duration, props.track?.duration, pushMetadataAndState]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Full metadata push on relevant changes (only when duration is valid)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitializedRef.current || !props.track) return;
    
    const activeDuration = safeDuration(props.duration, props.track?.duration);
    if (activeDuration <= 0) return;
    
    void pushMetadataAndState();
  }, [
    props.track?.title,
    props.track?.artist,
    props.track?.artwork,
    props.track?.videoId,
    props.duration,
    props.isPlaying,
    // props.repeatMode intentionally excluded — not pushed to lock screen
    pushMetadataAndState,
  ]);

  // ─────────────────────────────────────────────────────────────────────────────
  // App background handler
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      
      const currentProps = propsRef.current;
      
      if (!isInitializedRef.current || !currentProps.track) return;

      const activeDuration = safeDuration(currentProps.duration, currentProps.track?.duration);
      if (activeDuration <= 0) return;

      const elapsedTime = safePosition(currentProps.position);
      const activePlaying = currentProps.isPlaying;
      const artworkUri = buildArtworkUri(currentProps.track, fallbackUriRef.current);

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
          title: currentProps.track?.title || 'Unknown Title',
          artist: currentProps.track?.artist || 'Unknown Artist',
          ...(artworkUri ? { artwork: { uri: artworkUri } } : {}),
        });
      });

      currentProps.onAppBackground();
    });

    return () => sub.remove();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // App foreground handler
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      propsRef.current.onAppForeground();
    });

    return () => sub.remove();
  }, []);
}

export default useSystemMediaControls;