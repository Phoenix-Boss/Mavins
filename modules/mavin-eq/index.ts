// modules/mavin-player/index.ts
// Complete JS wrapper for MavinPlayer — matches MavinPlayerModule.kt exactly

import { EventEmitter } from 'expo-modules-core';
import { getNativeModule } from './MavinPlayerNative';
import { useEffect, useState, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE imports — enums and consts must NOT be `import type`
// ─────────────────────────────────────────────────────────────────────────────
import { MavinEvent, ISO_FREQ_CENTERS, RepeatMode as RepeatModeEnum } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPE-ONLY imports
// ─────────────────────────────────────────────────────────────────────────────
import type {
  // Core
  Nullable,
  Optional,

  // Track & Playback
  Track,
  VideoTrack,
  PlaybackState,
  PlaybackStateName,
  Progress,
  PeakMeter,
  RepeatMode,
  ShuffleMode,

  // EQ Types
  IsoFreqIndex,
  EQGains,
  EqBandGains,
  EqBandInfo,
  EqMode,
  DitherMode,
  EqBiquadFilter,

  // DSP Types
  CompressorSettings,
  CrossfeedSettings,
  ReplayGainMode,
  ReplayGainInfo,
  FxMode,
  FxState,
  ConvolutionState,

  // Hardware Types
  DacInfo,
  DacCapabilities,
  AudioCapabilities,
  OptimalAudioFormat,

  // Config Types
  CacheStats,
  PreloadStrategy,
  AndroidOptions,
  BufferConfig,
  SetupOptions,
  UpdateOptions,
  Capability,
  FeedbackOptions,

  // Events
  MavinEvent as MavinEventType,
  EventSubscription,
  EventName,

  // Event Payloads
  PlaybackStateChangedEvent,
  TrackChangedEvent,
  PlaybackActiveTrackChangedEvent,
  PlaybackQueueEndedEvent,
  PlaybackErrorEvent,
  ProgressEvent,
  SpectrumEvent,
  PeakMeterEvent,
  ReplayGainAppliedEvent,
  RemoteSeekEvent,
  RemoteSkipEvent,
  RemoteSetRatingEvent,
  RemoteJumpEvent,
  RemoteDuckEvent,
  MetadataEvent,
  ChapterChangedEvent,
  NetworkQualityEvent,
  PositionBookmarkedEvent,
  OutputProfileChangedEvent,
  WakeUpTimerFiredEvent,
  RmsMeterEvent,
  BpmDetectedEvent,
  FrcPresetChangedEvent,
  SurroundModeChangedEvent,
  AutomixTransitionEvent,
  AbsoluteVolumeChangedEvent,
  PipelineModeChangedEvent,

  // Preset Types
  PresetCategory,
  PresetTag,
  EqPreset,
  PresetGroup,

  // Hook Types
  UseProgressOptions,
  UsePlaybackStateResult,
  UseActiveTrackResult,
  UseSpectrumOptions,

  // Storage Types
  PresetStorageAdapter,
  SupabasePresetRow,

  // Native Module
  MavinPlayerNativeModule,
  MavinPlayerEvents,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Native module access
// ─────────────────────────────────────────────────────────────────────────────

const getMavinPlayer = getNativeModule;
const getEmitter = () => new EventEmitter(getMavinPlayer());

// ─────────────────────────────────────────────────────────────────────────────
// STATE ENUM - Metro Hot Reload Safe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Playback state constants. Use these instead of string literals for type safety.
 * Matches the native PlaybackStateName type exactly.
 * 
 * NOTE: Defined as a regular object (not using 'as const') to avoid Metro
 * hot reload issues with "property is not configurable" errors.
 */
export const State = {
  None: 'none' as const,
  Idle: 'idle' as const,
  Ready: 'ready' as const,
  Playing: 'playing' as const,
  Paused: 'paused' as const,
  Stopped: 'stopped' as const,
  Buffering: 'buffering' as const,
  Loading: 'loading' as const,
  Error: 'error' as const,
  Ended: 'ended' as const,
  ConnectionError: 'connection-error' as const,
};

// Type export for TypeScript
export type State = typeof State[keyof typeof State];

// ─────────────────────────────────────────────────────────────────────────────
// REPEAT MODE ENUM - Re-export for convenience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Repeat mode constants.
 * Off = 0, Track = 1, Queue = 2
 */
export const RepeatMode = {
  Off: 0,
  Track: 1,
  Queue: 2,
} as const;

export type RepeatMode = typeof RepeatMode[keyof typeof RepeatMode];

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SUBSCRIPTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type-safe mapping from every event name to its payload.
 */
type EventPayloadMap = {
  // ── Mavin events (kebab-case to match native) ─────────────────────────────
  [MavinEvent.PlaybackState]: PlaybackStateChangedEvent;
  [MavinEvent.PlaybackTrackChanged]: TrackChangedEvent;
  [MavinEvent.PlaybackActiveTrackChanged]: PlaybackActiveTrackChangedEvent;
  [MavinEvent.PlaybackQueueEnded]: PlaybackQueueEndedEvent;
  [MavinEvent.PlaybackError]: PlaybackErrorEvent;
  [MavinEvent.PlaybackProgressUpdated]: ProgressEvent;
  [MavinEvent.PlaybackPlayWhenReadyChanged]: { playWhenReady: boolean; reason: string };
  [MavinEvent.PlaybackSpeedChanged]: { speed: number };
  [MavinEvent.PlaybackPitchChanged]: { pitch: number };
  [MavinEvent.PlaybackPositionBookmarked]: PositionBookmarkedEvent;
  [MavinEvent.PlaybackMetadataReceived]: MetadataEvent;
  [MavinEvent.AudioCommonMetadataReceived]: MetadataEvent;
  [MavinEvent.AudioTimedMetadataReceived]: MetadataEvent;
  [MavinEvent.AudioChapterMetadataReceived]: MetadataEvent;
  [MavinEvent.ChapterChanged]: ChapterChangedEvent;
  [MavinEvent.PeakMeterUpdate]: PeakMeterEvent;
  [MavinEvent.NetworkQualityChanged]: NetworkQualityEvent;
  [MavinEvent.OutputProfileChanged]: OutputProfileChangedEvent;
  [MavinEvent.SleepTimerFired]: Record<string, never>;
  [MavinEvent.BluetoothDeviceConnected]: { deviceName: string };
  [MavinEvent.BluetoothDeviceDisconnected]: { deviceName: string };
  [MavinEvent.HeadphonesConnected]: Record<string, never>;
  [MavinEvent.HeadphonesDisconnected]: Record<string, never>;
  [MavinEvent.RemotePlay]: Record<string, never>;
  [MavinEvent.RemotePause]: Record<string, never>;
  [MavinEvent.RemoteStop]: Record<string, never>;
  [MavinEvent.RemoteNext]: Record<string, never>;
  [MavinEvent.RemotePrevious]: Record<string, never>;
  [MavinEvent.RemoteSeek]: RemoteSeekEvent;
  [MavinEvent.RemoteJumpForward]: RemoteJumpEvent;
  [MavinEvent.RemoteJumpBackward]: RemoteJumpEvent;
  [MavinEvent.RemoteSetRating]: RemoteSetRatingEvent;
  [MavinEvent.RemoteLike]: Record<string, never>;
  [MavinEvent.RemoteDislike]: Record<string, never>;
  [MavinEvent.RemoteBookmark]: Record<string, never>;
  [MavinEvent.RemoteDuck]: RemoteDuckEvent;
  [MavinEvent.RemoteSkip]: RemoteSkipEvent;
  [MavinEvent.RemoteMute]: Record<string, never>;
  [MavinEvent.RemoteUnmute]: Record<string, never>;
  [MavinEvent.RemotePlayFromId]: { id: string; extras: Record<string, unknown> };
  [MavinEvent.RemotePlayFromSearch]: { query: string; extras: Record<string, unknown> };
  // v3
  [MavinEvent.WakeUpTimerFired]: WakeUpTimerFiredEvent;
  [MavinEvent.RmsMeterUpdate]: RmsMeterEvent;
  [MavinEvent.BpmDetected]: BpmDetectedEvent;
  [MavinEvent.FrcPresetChanged]: FrcPresetChangedEvent;
  [MavinEvent.SurroundModeChanged]: SurroundModeChangedEvent;
  [MavinEvent.AutomixTransition]: AutomixTransitionEvent;
  [MavinEvent.AbsoluteVolumeChanged]: AbsoluteVolumeChangedEvent;
  [MavinEvent.PipelineModeChanged]: PipelineModeChangedEvent;

  // Fallback for arbitrary string event names
  [key: string]: unknown;
};

/**
 * Add a type-safe event listener.
 */
export function addEventListener<K extends keyof EventPayloadMap>(
  event: K,
  listener: (data: EventPayloadMap[K]) => void,
): EventSubscription {
  const subscription = getEmitter().addListener(event as string, listener as any);
  return { remove: () => subscription.remove() };
}

/**
 * Remove a specific listener, or all listeners for an event if none is given.
 */
export function removeEventListener<K extends keyof EventPayloadMap>(
  event: K,
  listener?: (data: EventPayloadMap[K]) => void,
): void {
  if (listener) {
    getEmitter().removeListener(event as string, listener as any);
  } else {
    getEmitter().removeAllListeners(event as string);
  }
}

/**
 * Subscribe to multiple events with a single handler.
 */
export function subscribeToEvents<K extends keyof EventPayloadMap>(
  events: K[],
  handler: (event: K, data: EventPayloadMap[K]) => void,
): EventSubscription {
  const subscriptions = events.map((evt) =>
    getEmitter().addListener(evt as string, (data: any) => handler(evt, data)),
  );
  return { remove: () => subscriptions.forEach((s) => s.remove()) };
}

/**
 * RNTP-compatible hook for subscribing to events.
 */
export function useTrackPlayerEvents(
  events: Array<keyof EventPayloadMap>,
  handler: (data: any) => void,
): void {
  const handlerRef = useRef(handler);
  
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const subscriptions = events.map((event) =>
      getEmitter().addListener(event as string, (data: any) => {
        const wrappedData = {
          ...data,
          type: event,
        };
        handlerRef.current(wrappedData);
      })
    );

    return () => {
      subscriptions.forEach((sub) => sub.remove());
    };
  }, [events]);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT EXPORT — raw native module for advanced use
// ─────────────────────────────────────────────────────────────────────────────

export default getMavinPlayer;

// ─────────────────────────────────────────────────────────────────────────────
// Re-export enum values and constants
// ─────────────────────────────────────────────────────────────────────────────
export { MavinEvent, ISO_FREQ_CENTERS };

// ─────────────────────────────────────────────────────────────────────────────
// Re-export pure types
// ─────────────────────────────────────────────────────────────────────────────
export type {
  Nullable,
  Optional,
  Track,
  VideoTrack,
  PlaybackState,
  PlaybackStateName,
  Progress,
  PeakMeter,
  ShuffleMode,
  IsoFreqIndex,
  EQGains,
  EqBandGains,
  EqBandInfo,
  EqMode,
  DitherMode,
  EqBiquadFilter,
  CompressorSettings,
  CrossfeedSettings,
  ReplayGainMode,
  ReplayGainInfo,
  FxMode,
  FxState,
  ConvolutionState,
  DacInfo,
  DacCapabilities,
  AudioCapabilities,
  OptimalAudioFormat,
  CacheStats,
  PreloadStrategy,
  AndroidOptions,
  BufferConfig,
  SetupOptions,
  UpdateOptions,
  Capability,
  FeedbackOptions,
  EventName,
  PlaybackStateChangedEvent,
  TrackChangedEvent,
  PlaybackActiveTrackChangedEvent,
  PlaybackQueueEndedEvent,
  PlaybackErrorEvent,
  ProgressEvent,
  SpectrumEvent,
  PeakMeterEvent,
  ReplayGainAppliedEvent,
  RemoteSeekEvent,
  RemoteSkipEvent,
  RemoteSetRatingEvent,
  RemoteJumpEvent,
  RemoteDuckEvent,
  MetadataEvent,
  ChapterChangedEvent,
  NetworkQualityEvent,
  PositionBookmarkedEvent,
  OutputProfileChangedEvent,
  WakeUpTimerFiredEvent,
  RmsMeterEvent,
  BpmDetectedEvent,
  FrcPresetChangedEvent,
  SurroundModeChangedEvent,
  AutomixTransitionEvent,
  AbsoluteVolumeChangedEvent,
  PipelineModeChangedEvent,
  PresetCategory,
  PresetTag,
  EqPreset,
  PresetGroup,
  UseProgressOptions,
  UsePlaybackStateResult,
  UseActiveTrackResult,
  UseSpectrumOptions,
  PresetStorageAdapter,
  SupabasePresetRow,
  MavinPlayerNativeModule,
  MavinPlayerEvents,
  EventSubscription,
};

// ═══════════════════════════════════════════════════════════════════════════
// LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/** Initialize the player. */
export const setupPlayer = (options?: SetupOptions | null): Promise<void> =>
  getMavinPlayer().setupPlayer(options ?? null);

/** Alias for setupPlayer */
export const initPlayer = setupPlayer;

/** Release all resources. */
export const destroy = (): Promise<void> => getMavinPlayer().destroy();

/** Alias for destroy */
export const release = destroy;

/** Update player options at runtime. */
export const updateOptions = (options: UpdateOptions): Promise<void> =>
  getMavinPlayer().updateOptions(options);

/** Check if the playback service is running. */
export const isServiceRunning = (): Promise<boolean> => getMavinPlayer().isServiceRunning();

/** Stop the foreground service explicitly. */
export const stopService = (): Promise<void> => getMavinPlayer().stopService();

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK CONTROL
// ═══════════════════════════════════════════════════════════════════════════

export const play = (): Promise<void> => getMavinPlayer().play();
export const pause = (): Promise<void> => getMavinPlayer().pause();
export const stop = (): Promise<void> => getMavinPlayer().stop();
export const reset = (): Promise<void> => getMavinPlayer().reset();

/** Seek to absolute position in seconds. */
export const seekTo = (positionSeconds: number): Promise<void> =>
  getMavinPlayer().seekTo(positionSeconds);

/** Seek relative to current position in seconds. */
export const seekBy = (offsetSeconds: number): Promise<void> =>
  getMavinPlayer().seekBy(offsetSeconds);

/** Skip to next track, optionally at specific position. Returns success. */
export const skipToNext = (initialPositionSeconds?: number): Promise<boolean> =>
  getMavinPlayer().skipToNext(initialPositionSeconds);

/** Skip to previous track, optionally at specific position. Returns success. */
export const skipToPrevious = (initialPositionSeconds?: number): Promise<boolean> =>
  getMavinPlayer().skipToPrevious(initialPositionSeconds);

/** Skip to track at index with optional initial position. Returns success. */
export const skip = (index: number, positionSeconds?: number): Promise<boolean> =>
  getMavinPlayer().skip(index, positionSeconds);

/** Alias for skip - skip to specific index */
export const skipToIndex = skip;

/** Skip relative by seconds */
export const skipRelative = (seconds: number): Promise<void> => getMavinPlayer().skip(seconds);

/** Retry playback after error. */
export const retry = (): Promise<void> => getMavinPlayer().retry();

/** Retry with fallback URL */
export const retryWithFallback = (fallbackUri: string): Promise<void> =>
  getMavinPlayer().retryWithFallback(fallbackUri);

// ═══════════════════════════════════════════════════════════════════════════
// PLAY-WHEN-READY
// ═══════════════════════════════════════════════════════════════════════════

export const setPlayWhenReady = (playWhenReady: boolean): Promise<void> =>
  getMavinPlayer().setPlayWhenReady(playWhenReady);

export const getPlayWhenReady = (): Promise<boolean> => getMavinPlayer().getPlayWhenReady();

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/** Load a single track and start playback. */
export const load = (track: Track): Promise<void> => getMavinPlayer().load(track);

/** Replace the entire queue. */
export const setQueue = (
  tracks: Track[],
  startIndex?: number,
  startPositionSeconds?: number
): Promise<void> => getMavinPlayer().setQueue(tracks, startIndex, startPositionSeconds);

/**
 * Add track(s) to queue. Returns the first added track index.
 * @param tracks - Single track or array of tracks
 * @param insertBeforeIndex - Optional position to insert before
 */
export const add = (
  tracks: Track | Track[],
  insertBeforeIndex?: number,
): Promise<number> => getMavinPlayer().add(tracks, insertBeforeIndex);

/** Add single track to queue end (alias for add). */
export const addToQueue = (track: Track): Promise<number> => getMavinPlayer().add(track);

/** Insert track at specific index (alias for add with insertBeforeIndex). */
export const addToQueueAt = (track: Track, index: number): Promise<number> =>
  getMavinPlayer().add(track, index);

/** Remove track(s) by index or array of indices. */
export const remove = (indices: number | number[]): Promise<void> =>
  getMavinPlayer().remove(indices);

/** Remove single track by index (alias for remove). */
export const removeTrack = (index: number): Promise<void> => getMavinPlayer().remove(index);

/** Remove all upcoming tracks (after current). */
export const removeUpcomingTracks = (): Promise<void> =>
  getMavinPlayer().removeUpcomingTracks();

/** Remove all previous tracks (before current). */
export const removePreviousTracks = (): Promise<void> =>
  getMavinPlayer().removePreviousTracks();

/** Move track from one position to another. */
export const move = (fromIndex: number, toIndex: number): Promise<void> =>
  getMavinPlayer().move(fromIndex, toIndex);

/** Alias for move */
export const moveTrack = move;

/** Update metadata for track at index. */
export const updateMetadataForTrack = (index: number, metadata: Partial<Track>): Promise<void> =>
  getMavinPlayer().updateMetadataForTrack(index, metadata);

/** Alias for updateMetadataForTrack */
export const updateTrack = updateMetadataForTrack;

/** Update metadata for currently playing track. */
export const updateNowPlayingMetadata = (metadata: Partial<Track>): Promise<void> =>
  getMavinPlayer().updateNowPlayingMetadata(metadata);

/** Clear now playing metadata. */
export const clearNowPlayingMetadata = (): Promise<void> =>
  getMavinPlayer().clearNowPlayingMetadata();

/** Preload next track for gapless playback. */
export const preloadNextTrack = (track: Track): Promise<void> =>
  getMavinPlayer().preloadNextTrack(track);

/** Get persisted queue state. */
export const getPersistedQueue = (): Promise<{ tracks: Track[]; currentIndex: number }> =>
  getMavinPlayer().getPersistedQueue();

/** Restore persisted queue. */
export const restorePersistedQueue = (): Promise<void> =>
  getMavinPlayer().restorePersistedQueue();

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO
// ═══════════════════════════════════════════════════════════════════════════

/** Load a video track. */
export const loadVideoTrack = (videoTrack: VideoTrack, playWhenReady?: boolean): Promise<void> =>
  getMavinPlayer().loadVideoTrack(videoTrack, playWhenReady);

// ═══════════════════════════════════════════════════════════════════════════
// STATE GETTERS
// ═══════════════════════════════════════════════════════════════════════════

/** Get simple state string. */
export const getState = (): Promise<PlaybackStateName> => getMavinPlayer().getState();

/** Get detailed playback state with error info. */
export const getPlaybackState = (): Promise<PlaybackState> => getMavinPlayer().getPlaybackState();

/** Get current progress in seconds. */
export const getProgress = (): Promise<Progress> => getMavinPlayer().getProgress();

/** Get track duration in seconds. */
export const getDuration = (): Promise<number> => getMavinPlayer().getDuration();

/** Get current position in seconds. */
export const getPosition = (): Promise<number> => getMavinPlayer().getPosition();

/** Get buffered position in seconds. */
export const getBufferedPosition = (): Promise<number> => getMavinPlayer().getBufferedPosition();

/** Check if currently playing. */
export const isPlaying = (): Promise<boolean> => getMavinPlayer().isPlaying();

/** Check if loading/buffering. */
export const isLoading = (): Promise<boolean> => getMavinPlayer().isLoading();

/** Get current track metadata. */
export const getCurrentTrack = (): Promise<Nullable<Track>> => getMavinPlayer().getCurrentTrack();

/** Get active track (same as current, but may differ in some states). */
export const getActiveTrack = (): Promise<Nullable<Track>> => getMavinPlayer().getActiveTrack();

/** Get active track index. */
export const getActiveTrackIndex = (): Promise<Nullable<number>> =>
  getMavinPlayer().getActiveTrackIndex();

/** Get current video track. */
export const getCurrentVideoTrack = (): Promise<Nullable<VideoTrack>> =>
  getMavinPlayer().getCurrentVideoTrack();

/** Get track at specific index. */
export const getTrack = (index: number): Promise<Nullable<Track>> =>
  getMavinPlayer().getTrack(index);

/** Get full queue. */
export const getQueue = (): Promise<Track[]> => getMavinPlayer().getQueue();

/** Get queue size (helper). */
export const getQueueSize = async (): Promise<number> => {
  const queue = await getMavinPlayer().getQueue();
  return queue.length;
};

/** Get audio focus state */
export const getAudioFocus = (): Promise<boolean> => getMavinPlayer().getAudioFocus();

// ═══════════════════════════════════════════════════════════════════════════
// VOLUME & AUDIO SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export const getVolume = (): Promise<number> => getMavinPlayer().getVolume();
export const setVolume = (volume: number): Promise<void> => getMavinPlayer().setVolume(volume);
export const mute = (): Promise<void> => getMavinPlayer().mute();
export const unmute = (): Promise<void> => getMavinPlayer().unmute();
export const isMuted = (): Promise<boolean> => getMavinPlayer().isMuted();
export const getUnmutedVolume = (): Promise<number> => getMavinPlayer().getUnmutedVolume();

export const getRepeatMode = (): Promise<RepeatMode> => getMavinPlayer().getRepeatMode();
export const setRepeatMode = (mode: RepeatMode | number): Promise<void> =>
  getMavinPlayer().setRepeatMode(mode);

export const getShuffleMode = (): Promise<boolean> => getMavinPlayer().getShuffleMode();
export const setShuffleMode = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setShuffleMode(enabled);

/** Get playback rate (speed). */
export const getRate = (): Promise<number> => getMavinPlayer().getRate();
/** Set playback rate (speed). */
export const setRate = (rate: number): Promise<void> => getMavinPlayer().setRate(rate);

/** Alias for getRate */
export const getPlaybackSpeed = getRate;
/** Alias for setRate */
export const setPlaybackSpeed = setRate;

/** Get playback pitch. */
export const getPitch = (): Promise<number> => getMavinPlayer().getPitch();
/** Set playback pitch. */
export const setPitch = (pitch: number): Promise<void> => getMavinPlayer().setPitch(pitch);

/** Alias for getPitch */
export const getPlaybackPitch = getPitch;
/** Alias for setPitch */
export const setPlaybackPitch = setPitch;

/** Set both speed and pitch */
export const setPlaybackParameters = (speed: number, pitch: number): Promise<void> =>
  getMavinPlayer().setPlaybackParameters(speed, pitch);

/** Get tempo (time-stretch factor). */
export const getTempo = (): Promise<number> => getMavinPlayer().getTempo();
/** Set tempo (time-stretch factor). */
export const setTempo = (tempo: number): Promise<void> => getMavinPlayer().setTempo(tempo);

/** Set progress update interval in seconds. */
export const setProgressUpdateInterval = (intervalSeconds: number): Promise<void> =>
  getMavinPlayer().setProgressUpdateInterval(intervalSeconds);

/** Get progress update interval in seconds. */
export const getProgressUpdateInterval = (): Promise<number> =>
  getMavinPlayer().getProgressUpdateInterval();

/** Get cache size in bytes. */
export const getCacheSize = (): Promise<number> => getMavinPlayer().getCacheSize();

/** Set cache configuration */
export const setCacheConfig = (options: { sizeMB?: number; sizeBytes?: number }): Promise<void> =>
  getMavinPlayer().setCacheConfig(options);

/** Set audio attributes */
export const setAudioAttributes = (options: { usage?: string; contentType?: string }): Promise<void> =>
  getMavinPlayer().setAudioAttributes(options);

/** Set wake mode */
export const setWakeMode = (mode: number): Promise<void> => getMavinPlayer().setWakeMode(mode);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

export const setBalance = (leftGain: number, rightGain: number): Promise<void> =>
  getMavinPlayer().setBalance(leftGain, rightGain);

export const getBalance = (): Promise<{ left: number; right: number }> =>
  getMavinPlayer().getBalance();

export const setPan = (pan: number): Promise<void> => getMavinPlayer().setPan(pan);
export const getPan = (): Promise<number> => getMavinPlayer().getPan();

export const setStereoExpansion = (expansion: number): Promise<void> =>
  getMavinPlayer().setStereoExpansion(expansion);

export const getStereoExpansion = (): Promise<number> => getMavinPlayer().getStereoExpansion();

export const setMonoMix = (enabled: boolean): Promise<void> => getMavinPlayer().setMonoMix(enabled);
export const isMonoMix = (): Promise<boolean> => getMavinPlayer().isMonoMix();

export const setBassBoost = (gainDb: number): Promise<void> => getMavinPlayer().setBassBoost(gainDb);
export const getBassBoost = (): Promise<number> => getMavinPlayer().getBassBoost();

export const setTrebleBoost = (gainDb: number): Promise<void> =>
  getMavinPlayer().setTrebleBoost(gainDb);

export const getTrebleBoost = (): Promise<number> => getMavinPlayer().getTrebleBoost();

export const setLimiterEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setLimiterEnabled(enabled);

export const isLimiterEnabled = (): Promise<boolean> => getMavinPlayer().isLimiterEnabled();

export const setLimiterThreshold = (thresholdDb: number): Promise<void> =>
  getMavinPlayer().setLimiterThreshold(thresholdDb);

export const getLimiterThreshold = (): Promise<number> => getMavinPlayer().getLimiterThreshold();

export const setLoudnessNormalizationEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setLoudnessNormalizationEnabled(enabled);

export const isLoudnessNormalizationEnabled = (): Promise<boolean> =>
  getMavinPlayer().isLoudnessNormalizationEnabled();

export const setTargetLufs = (lufs: number): Promise<void> => getMavinPlayer().setTargetLufs(lufs);
export const getTargetLufs = (): Promise<number> => getMavinPlayer().getTargetLufs();

export const setHeadroomGuardEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setHeadroomGuardEnabled(enabled);

export const isHeadroomGuardEnabled = (): Promise<boolean> =>
  getMavinPlayer().isHeadroomGuardEnabled();

export const setHeadroomGuardThreshold = (thresholdDb: number): Promise<void> =>
  getMavinPlayer().setHeadroomGuardThreshold(thresholdDb);

export const getHeadroomGuardThreshold = (): Promise<number> =>
  getMavinPlayer().getHeadroomGuardThreshold();

export const setPhaseInvert = (left: boolean, right: boolean): Promise<void> =>
  getMavinPlayer().setPhaseInvert(left, right);

export const getPhaseInvert = (): Promise<{ left: boolean; right: boolean }> =>
  getMavinPlayer().getPhaseInvert();

export const setEqProcessingMode = (mode: string): Promise<void> =>
  getMavinPlayer().setEqProcessingMode(mode);

export const getEqProcessingMode = (): Promise<string> => getMavinPlayer().getEqProcessingMode();

export const setGaplessEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setGaplessEnabled(enabled);

export const isGaplessEnabled = (): Promise<boolean> => getMavinPlayer().isGaplessEnabled();

export const setDvcEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setDvcEnabled(enabled);

export const isDvcEnabled = (): Promise<boolean> => getMavinPlayer().isDvcEnabled();

export const setResamplerQuality = (quality: string): Promise<void> =>
  getMavinPlayer().setResamplerQuality(quality);

export const getResamplerQuality = (): Promise<string> => getMavinPlayer().getResamplerQuality();

export const setTargetResampleRate = (hz: number): Promise<void> =>
  getMavinPlayer().setTargetResampleRate(hz);

export const getTargetResampleRate = (): Promise<number> => getMavinPlayer().getTargetResampleRate();

export const setOutputProfile = (profile: string): Promise<void> =>
  getMavinPlayer().setOutputProfile(profile);

export const getCurrentOutputProfile = (): Promise<string> => getMavinPlayer().getCurrentOutputProfile();

export const setOutputProfilePreset = (profile: string, presetName: string | null): Promise<void> =>
  getMavinPlayer().setOutputProfilePreset(profile, presetName);

export const getOutputProfilePreset = (profile: string): Promise<string | null> =>
  getMavinPlayer().getOutputProfilePreset(profile);

// ═══════════════════════════════════════════════════════════════════════════
// EQ: GRAPHIC & PARAMETRIC
// ═══════════════════════════════════════════════════════════════════════════

export const setEQEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setEQEnabled(enabled);

export const getEQEnabled = (): Promise<boolean> => getMavinPlayer().getEQEnabled();
export const isEQEnabled = getEQEnabled;

export const setEQBand = (band: number, gainDb: number): Promise<void> =>
  getMavinPlayer().setEQBand(band, gainDb);

export const applyEQBands = (gainsDb: number[]): Promise<void> =>
  getMavinPlayer().applyEQBands(gainsDb);

export const setEQPreamp = (gainDb: number): Promise<void> =>
  getMavinPlayer().setEQPreamp(gainDb);

export const setEQBandQ = (band: number, q: number): Promise<void> =>
  getMavinPlayer().setEQBandQ(band, q);

export const resetEQ = (): Promise<void> => getMavinPlayer().resetEQ();

export const getEQGains = (): Promise<Array<{ band: number; gain: number }>> =>
  getMavinPlayer().getEQGains();

export const getEQPreamp = (): Promise<number> => getMavinPlayer().getEQPreamp();

export const setEQMode = (mode: EqMode | string): Promise<void> =>
  getMavinPlayer().setEQMode(mode);

export const getEQMode = (): Promise<string> => getMavinPlayer().getEQMode();

export const setParametricBandGain = (band: number, gainDb: number): Promise<void> =>
  getMavinPlayer().setParametricBandGain(band, gainDb);

export const applyParametricBands = (gainsDb: number[]): Promise<void> =>
  getMavinPlayer().applyParametricBands(gainsDb);

export const setParametricBandFreq = (band: number, freqHz: number): Promise<void> =>
  getMavinPlayer().setParametricBandFreq(band, freqHz);

export const getParametricGains = (): Promise<Array<{ band: number; gain: number }>> =>
  getMavinPlayer().getParametricGains();

export const getParametricFreqs = (): Promise<Array<{ band: number; freqHz: number }>> =>
  getMavinPlayer().getParametricFreqs();

/** Get Q values for parametric EQ bands. */
export const getEQQValues = (): Promise<Array<{ band: number; q: number }>> =>
  getMavinPlayer().getEQQValues();

/** Reset parametric EQ to default. */
export const resetParametric = (): Promise<void> =>
  getMavinPlayer().resetParametric();

export const setDitherMode = (mode: DitherMode | string): Promise<void> =>
  getMavinPlayer().setDitherMode(mode);

export const getDitherMode = (): Promise<string> => getMavinPlayer().getDitherMode();

export const setSmoothingRamp = (ms: number): Promise<void> =>
  getMavinPlayer().setSmoothingRamp(ms);

export const getLoudnessDb = (): Promise<number> => getMavinPlayer().getLoudnessDb();

export const getSpectrumMagnitudes = (): Promise<Array<{ bin: number; magnitude: number }>> =>
  getMavinPlayer().getSpectrumMagnitudes();

export const computeAutoEQ = (): Promise<Array<{ band: number; gain: number; freqHz: number }>> =>
  getMavinPlayer().computeAutoEQ();

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSOR (DRC)
// ═══════════════════════════════════════════════════════════════════════════

export const setCompressorEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setCompressorEnabled(enabled);

export const getCompressorEnabled = (): Promise<boolean> => getMavinPlayer().getCompressorEnabled();
export const isCompressorEnabled = getCompressorEnabled;

export const setCompressorThreshold = (thresholdDb: number): Promise<void> =>
  getMavinPlayer().setCompressorThreshold(thresholdDb);

export const setCompressorRatio = (ratio: number): Promise<void> =>
  getMavinPlayer().setCompressorRatio(ratio);

export const setCompressorAttack = (ms: number): Promise<void> =>
  getMavinPlayer().setCompressorAttack(ms);

export const setCompressorRelease = (ms: number): Promise<void> =>
  getMavinPlayer().setCompressorRelease(ms);

export const setCompressorKnee = (db: number): Promise<void> =>
  getMavinPlayer().setCompressorKnee(db);

export const setCompressorMakeupGain = (db: number): Promise<void> =>
  getMavinPlayer().setCompressorMakeupGain(db);

export const getCompressorReduction = (): Promise<number> =>
  getMavinPlayer().getCompressorReduction();

export const getCompressorThreshold = (): Promise<number> =>
  getMavinPlayer().getCompressorThreshold();

export const getCompressorRatio = (): Promise<number> => getMavinPlayer().getCompressorRatio();

export const getCompressorAttack = (): Promise<number> => getMavinPlayer().getCompressorAttack();

export const getCompressorRelease = (): Promise<number> => getMavinPlayer().getCompressorRelease();

// ═══════════════════════════════════════════════════════════════════════════
// CROSSFADE
// ═══════════════════════════════════════════════════════════════════════════

export const setCrossfadeEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setCrossfadeEnabled(enabled);

export const isCrossfadeEnabled = (): Promise<boolean> => getMavinPlayer().isCrossfadeEnabled();

export const setCrossfadeDuration = (ms: number): Promise<void> =>
  getMavinPlayer().setCrossfadeDuration(ms);

export const getCrossfadeDuration = (): Promise<number> => getMavinPlayer().getCrossfadeDuration();

// ═══════════════════════════════════════════════════════════════════════════
// CROSSFEED
// ═══════════════════════════════════════════════════════════════════════════

export const setCrossfeedEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setCrossfeedEnabled(enabled);

export const getCrossfeedEnabled = (): Promise<boolean> => getMavinPlayer().getCrossfeedEnabled();
export const isCrossfeedEnabled = getCrossfeedEnabled;

export const setCrossfeedStrength = (strength: number): Promise<void> =>
  getMavinPlayer().setCrossfeedStrength(strength);

export const getCrossfeedStrength = (): Promise<number> => getMavinPlayer().getCrossfeedStrength();

export const setCrossfeedCutoff = (hz: number): Promise<void> =>
  getMavinPlayer().setCrossfeedCutoff(hz);

export const getCrossfeedCutoff = (): Promise<number> => getMavinPlayer().getCrossfeedCutoff();

export const setCrossfeedDelayMs = (ms: number): Promise<void> =>
  getMavinPlayer().setCrossfeedDelayMs(ms);

export const getCrossfeedDelayMs = (): Promise<number> => getMavinPlayer().getCrossfeedDelayMs();

// ═══════════════════════════════════════════════════════════════════════════
// PEAK METER
// ═══════════════════════════════════════════════════════════════════════════

export const setPeakHoldMs = (ms: number): Promise<void> => getMavinPlayer().setPeakHoldMs(ms);
export const setPeakReleaseMs = (ms: number): Promise<void> => getMavinPlayer().setPeakReleaseMs(ms);

export const getCurrentPeaks = (): Promise<{ left: number; right: number }> =>
  getMavinPlayer().getCurrentPeaks();

export const getHeldPeaks = (): Promise<{ left: number; right: number }> =>
  getMavinPlayer().getHeldPeaks();

export const resetPeaks = (): Promise<void> => getMavinPlayer().resetPeaks();

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY GAIN
// ═══════════════════════════════════════════════════════════════════════════

export const setReplayGainMode = (mode: ReplayGainMode | string): Promise<void> =>
  getMavinPlayer().setReplayGainMode(mode);

export const setReplayGainPreamp = (gainDb: number): Promise<void> =>
  getMavinPlayer().setReplayGainPreamp(gainDb);

export const setReplayGainFromMap = (tags: Record<string, string>): Promise<void> =>
  getMavinPlayer().setReplayGainFromMap(tags);

export const getReplayGainInfo = (): Promise<ReplayGainInfo> => getMavinPlayer().getReplayGainInfo();

// ═══════════════════════════════════════════════════════════════════════════
// PRESETS
// ═══════════════════════════════════════════════════════════════════════════

export const applyPreset = (name: string): Promise<void> => getMavinPlayer().applyPreset(name);
export const savePreset = (name: string): Promise<void> => getMavinPlayer().savePreset(name);
export const listPresets = (): Promise<string[]> => getMavinPlayer().listPresets();
export const deletePreset = (name: string): Promise<boolean> => getMavinPlayer().deletePreset(name);
export const exportPreset = (name: string): Promise<string | null> =>
  getMavinPlayer().exportPreset(name);

export const importPreset = (json: string): Promise<void> => getMavinPlayer().importPreset(json);

export const assignTrackPreset = (mediaId: string, presetName: string | null): Promise<void> =>
  getMavinPlayer().assignTrackPreset(mediaId, presetName);

export const getTrackPreset = (mediaId: string): Promise<string | null> =>
  getMavinPlayer().getTrackPreset(mediaId);

export const setAutoSwitchPresets = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setAutoSwitchPresets(enabled);

// ═══════════════════════════════════════════════════════════════════════════
// CONVOLUTION
// ═══════════════════════════════════════════════════════════════════════════

export const loadImpulseResponse = (filePath: string): Promise<void> =>
  getMavinPlayer().loadImpulseResponse(filePath);

export const clearImpulseResponse = (): Promise<void> => getMavinPlayer().clearImpulseResponse();

export const isImpulseResponseLoaded = (): Promise<boolean> =>
  getMavinPlayer().isImpulseResponseLoaded();

export const getIrLength = (): Promise<number> => getMavinPlayer().getIrLength();

export const setConvolutionEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setConvolutionEnabled(enabled);

export const isConvolutionEnabled = (): Promise<boolean> => getMavinPlayer().isConvolutionEnabled();

// ═══════════════════════════════════════════════════════════════════════════
// FX PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

export const setFxEnabled = (enabled: boolean): Promise<void> => getMavinPlayer().setFxEnabled(enabled);
export const getFxEnabled = (): Promise<boolean> => getMavinPlayer().getFxEnabled();
export const isFxEnabled = getFxEnabled;

export const setFxMode = (mode: FxMode | string): Promise<void> => getMavinPlayer().setFxMode(mode);
export const getFxMode = (): Promise<string> => getMavinPlayer().getFxMode();

export const setFxMix = (mix: number): Promise<void> => getMavinPlayer().setFxMix(mix);
export const getFxMix = (): Promise<number> => getMavinPlayer().getFxMix();

export const setFxBypass = (bypass: boolean): Promise<void> => getMavinPlayer().setFxBypass(bypass);
export const isFxBypassed = (): Promise<boolean> => getMavinPlayer().isFxBypassed();

// Reverb
export const setReverbRoomSize = (value: number): Promise<void> =>
  getMavinPlayer().setReverbRoomSize(value);

export const setReverbDecay = (value: number): Promise<void> => getMavinPlayer().setReverbDecay(value);
export const setReverbPreDelay = (value: number): Promise<void> =>
  getMavinPlayer().setReverbPreDelay(value);

export const setReverbDamping = (value: number): Promise<void> =>
  getMavinPlayer().setReverbDamping(value);

// Delay
export const setDelayTime = (value: number): Promise<void> => getMavinPlayer().setDelayTime(value);
export const setDelayFeedback = (value: number): Promise<void> =>
  getMavinPlayer().setDelayFeedback(value);

export const setDelayLowCut = (value: number): Promise<void> => getMavinPlayer().setDelayLowCut(value);
export const setDelayHighCut = (value: number): Promise<void> =>
  getMavinPlayer().setDelayHighCut(value);

// Modulation
export const setModRate = (value: number): Promise<void> => getMavinPlayer().setModRate(value);
export const setModDepth = (value: number): Promise<void> => getMavinPlayer().setModDepth(value);
export const setModPhase = (value: number): Promise<void> => getMavinPlayer().setModPhase(value);
export const setModFeedback = (value: number): Promise<void> => getMavinPlayer().setModFeedback(value);

// ═══════════════════════════════════════════════════════════════════════════
// SLEEP TIMER
// ═══════════════════════════════════════════════════════════════════════════

export const setSleepTimer = (
  durationSeconds: number,
  fadeOutSeconds?: number
): Promise<void> => getMavinPlayer().setSleepTimer(durationSeconds, fadeOutSeconds);

export const setSleepTimerEndAfterCurrentTrack = (): Promise<void> =>
  getMavinPlayer().setSleepTimerEndAfterCurrentTrack();

export const cancelSleepTimer = (): Promise<void> => getMavinPlayer().cancelSleepTimer();

export const getSleepTimerState = (): Promise<{
  isActive: boolean;
  remainingSeconds: number | null;
  fadeOutSeconds: number;
  endAfterCurrentTrack: boolean;
}> => getMavinPlayer().getSleepTimerState();

// ═══════════════════════════════════════════════════════════════════════════
// BOOKMARKS
// ═══════════════════════════════════════════════════════════════════════════

export const bookmarkCurrentPosition = (): Promise<void> =>
  getMavinPlayer().bookmarkCurrentPosition();

export const addBookmark = (positionSeconds: number): Promise<void> =>
  getMavinPlayer().addBookmark(positionSeconds);

export const removeBookmark = (positionSeconds: number): Promise<void> =>
  getMavinPlayer().removeBookmark(positionSeconds);

export const getBookmarks = (): Promise<Array<{ trackId: string; position: number }>> =>
  getMavinPlayer().getBookmarks();

export const clearBookmarks = (): Promise<void> => getMavinPlayer().clearBookmarks();

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

export const getLastPlayedPosition = (trackId: string): Promise<number | null> =>
  getMavinPlayer().getLastPlayedPosition(trackId);

export const clearLastPlayedPosition = (trackId: string): Promise<void> =>
  getMavinPlayer().clearLastPlayedPosition(trackId);

export const clearAllPlayedPositions = (): Promise<void> =>
  getMavinPlayer().clearAllPlayedPositions();

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK & VISUALIZATION
// ═══════════════════════════════════════════════════════════════════════════

export const getNetworkQuality = (): Promise<NetworkQualityEvent> =>
  getMavinPlayer().getNetworkQuality();

export const getWaveformData = (numBuckets?: number): Promise<number[]> =>
  getMavinPlayer().getWaveformData(numBuckets);

export const getSpectrumData = (): Promise<{
  magnitudes: Array<{ bin: number; magnitude: number }>;
  sampleRate: number;
  binCount: number;
}> => getMavinPlayer().getSpectrumData();

export const importAutoEqPreset = (name: string, csv: string): Promise<void> =>
  getMavinPlayer().importAutoEqPreset(name, csv);

// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED DSP (v2)
// ═══════════════════════════════════════════════════════════════════════════

export const isCrossfadeEnabled_v2 = (): Promise<boolean> => getMavinPlayer().isCrossfadeEnabled();
export const setCrossfadeEnabled_v2 = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setCrossfadeEnabled(enabled);

export const getCrossfadeDurationMs = (): Promise<number> => getMavinPlayer().getCrossfadeDurationMs();
export const setCrossfadeDurationMs = (durationMs: number): Promise<void> =>
  getMavinPlayer().setCrossfadeDurationMs(durationMs);

export const isOfflineMode = (): Promise<boolean> => getMavinPlayer().isOfflineMode();
export const setOfflineMode = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setOfflineMode(enabled);

export const is64BitProcessingEnabled = (): Promise<boolean> =>
  getMavinPlayer().is64BitProcessingEnabled();

export const set64BitProcessingEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().set64BitProcessingEnabled(enabled);

export const isUsbDacConnected = (): Promise<boolean> => getMavinPlayer().isUsbDacConnected();
export const isDirectUsbRoutingEnabled = (): Promise<boolean> =>
  getMavinPlayer().isDirectUsbRoutingEnabled();

export const enableDirectUsbRouting = (enabled: boolean): Promise<void> =>
  getMavinPlayer().enableDirectUsbRouting(enabled);

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETRIC BAND CONFIG (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setParametricBandConfig = (
  band: number,
  config: {
    type?: string;
    freqHz?: number;
    gainDb?: number;
    q?: number;
    channel?: string;
  }
): Promise<void> => getMavinPlayer().setParametricBandConfig(band, config);

export const getParametricBandConfig = (
  band: number
): Promise<{
  type: string;
  freqHz: number;
  gainDb: number;
  q: number;
  channel: string;
} | null> => getMavinPlayer().getParametricBandConfig(band);

export const getAllParametricBandConfigs = (): Promise<
  Array<{
    band: number;
    type: string;
    freqHz: number;
    gainDb: number;
    q: number;
    channel: string;
  }>
> => getMavinPlayer().getAllParametricBandConfigs();

export const setBassFrequency = (hz: number): Promise<void> =>
  getMavinPlayer().setBassFrequency(hz);

export const getBassFrequency = (): Promise<number> => getMavinPlayer().getBassFrequency();
export const setBassQ = (q: number): Promise<void> => getMavinPlayer().setBassQ(q);
export const getBassQ = (): Promise<number> => getMavinPlayer().getBassQ();

export const setTrebleFrequency = (hz: number): Promise<void> =>
  getMavinPlayer().setTrebleFrequency(hz);

export const getTrebleFrequency = (): Promise<number> => getMavinPlayer().getTrebleFrequency();
export const setTrebleQ = (q: number): Promise<void> => getMavinPlayer().setTrebleQ(q);
export const getTrebleQ = (): Promise<number> => getMavinPlayer().getTrebleQ();

// ═══════════════════════════════════════════════════════════════════════════
// FRC (Frequency Response Correction) (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const importFrcPreset = (presetMap: {
  name: string;
  gains: number[];
  freqHz: number[];
  qValues: number[];
  description?: string;
  deviceModel?: string;
}): Promise<void> => getMavinPlayer().importFrcPreset(presetMap);

export const applyFrcPreset = (name: string): Promise<void> => getMavinPlayer().applyFrcPreset(name);
export const clearFrcPreset = (): Promise<void> => getMavinPlayer().clearFrcPreset();
export const getActiveFrcPreset = (): Promise<string | null> => getMavinPlayer().getActiveFrcPreset();
export const listFrcPresets = (): Promise<string[]> => getMavinPlayer().listFrcPresets();

export const exportFrcPreset = (name: string): Promise<{
  name: string;
  gains: number[];
  freqHz: number[];
  qValues: number[];
  description: string;
  deviceModel: string;
} | null> => getMavinPlayer().exportFrcPreset(name);

// ═══════════════════════════════════════════════════════════════════════════
// SURROUND DSP (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setSurroundMode = (mode: string): Promise<void> => getMavinPlayer().setSurroundMode(mode);
export const getSurroundMode = (): Promise<string> => getMavinPlayer().getSurroundMode();
export const setSurroundEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setSurroundEnabled(enabled);

export const isSurroundEnabled = (): Promise<boolean> => getMavinPlayer().isSurroundEnabled();
export const setSurroundWidth = (widthPercent: number): Promise<void> =>
  getMavinPlayer().setSurroundWidth(widthPercent);

export const getSurroundWidth = (): Promise<number> => getMavinPlayer().getSurroundWidth();
export const setSurroundDelay = (ms: number): Promise<void> => getMavinPlayer().setSurroundDelay(ms);
export const getSurroundDelay = (): Promise<number> => getMavinPlayer().getSurroundDelay();
export const setSurroundRoomSize = (ms: number): Promise<void> =>
  getMavinPlayer().setSurroundRoomSize(ms);

export const getSurroundRoomSize = (): Promise<number> => getMavinPlayer().getSurroundRoomSize();
export const setOversamplingFilterType = (type: string): Promise<void> =>
  getMavinPlayer().setOversamplingFilterType(type);

export const getOversamplingFilterType = (): Promise<string> =>
  getMavinPlayer().getOversamplingFilterType();

// ═══════════════════════════════════════════════════════════════════════════
// TUBE SATURATION (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setTubeMode = (mode: string): Promise<void> => getMavinPlayer().setTubeMode(mode);
export const getTubeMode = (): Promise<string> => getMavinPlayer().getTubeMode();
export const setTubeDrive = (driveDb: number): Promise<void> => getMavinPlayer().setTubeDrive(driveDb);
export const getTubeDrive = (): Promise<number> => getMavinPlayer().getTubeDrive();
export const setTubeHarmonic2 = (amount: number): Promise<void> =>
  getMavinPlayer().setTubeHarmonic2(amount);

export const getTubeHarmonic2 = (): Promise<number> => getMavinPlayer().getTubeHarmonic2();
export const setTubeHarmonic3 = (amount: number): Promise<void> =>
  getMavinPlayer().setTubeHarmonic3(amount);

export const getTubeHarmonic3 = (): Promise<number> => getMavinPlayer().getTubeHarmonic3();

// ═══════════════════════════════════════════════════════════════════════════
// ALC (Adaptive Loudness Compensation) (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setAlcEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setAlcEnabled(enabled);

export const isAlcEnabled = (): Promise<boolean> => getMavinPlayer().isAlcEnabled();
export const setAlcTarget = (lufs: number): Promise<void> => getMavinPlayer().setAlcTarget(lufs);
export const getAlcTarget = (): Promise<number> => getMavinPlayer().getAlcTarget();

// ═══════════════════════════════════════════════════════════════════════════
// RMS METER (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const getRmsMeter = (): Promise<{
  rmsLeft: number;
  rmsRight: number;
  peakLeft: number;
  peakRight: number;
  lufs: number;
}> => getMavinPlayer().getRmsMeter();

// ═══════════════════════════════════════════════════════════════════════════
// BPM & AUTOMIX (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setTrackBpm = (trackId: string, bpm: number): Promise<void> =>
  getMavinPlayer().setTrackBpm(trackId, bpm);

export const getTrackBpm = (trackId: string): Promise<number | null> =>
  getMavinPlayer().getTrackBpm(trackId);

export const getCurrentTrackBpm = (): Promise<number> => getMavinPlayer().getCurrentTrackBpm();

export const setAutomixConfig = (config: {
  mode?: string;
  manualCrossfadeOnly?: boolean;
  bpmAutomixEnabled?: boolean;
  bpmInPoint?: number;
  bpmOutPoint?: number;
}): Promise<void> => getMavinPlayer().setAutomixConfig(config);

export const getAutomixConfig = (): Promise<{
  mode: string;
  manualCrossfadeOnly: boolean;
  bpmAutomixEnabled: boolean;
  bpmInPoint: number;
  bpmOutPoint: number;
}> => getMavinPlayer().getAutomixConfig();

export const setManualCrossfadeOnly = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setManualCrossfadeOnly(enabled);

export const isManualCrossfadeOnly = (): Promise<boolean> => getMavinPlayer().isManualCrossfadeOnly();

// ═══════════════════════════════════════════════════════════════════════════
// WAKE-UP TIMER (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setWakeUpTimer = (
  epochMs: number,
  trackId: string | null,
  fadeInSeconds?: number
): Promise<void> => getMavinPlayer().setWakeUpTimer(epochMs, trackId, fadeInSeconds);

export const cancelWakeUpTimer = (): Promise<void> => getMavinPlayer().cancelWakeUpTimer();

export const getWakeUpTimerState = (): Promise<{
  isSet: boolean;
  remainingSeconds: number | null;
  trackId: string | null;
  volumeFadeInSeconds: number;
}> => getMavinPlayer().getWakeUpTimerState();

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE AUTO-CLEAR (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setQueueAutoClear = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setQueueAutoClear(enabled);

export const isQueueAutoClearEnabled = (): Promise<boolean> =>
  getMavinPlayer().isQueueAutoClearEnabled();

// ═══════════════════════════════════════════════════════════════════════════
// ANDROID 15 COMPAT (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setPipelineMode = (mode: string): Promise<void> =>
  getMavinPlayer().setPipelineMode(mode);

export const getPipelineMode = (): Promise<string> => getMavinPlayer().getPipelineMode();
export const setAbsoluteVolumeEnabled = (enabled: boolean): Promise<void> =>
  getMavinPlayer().setAbsoluteVolumeEnabled(enabled);

export const isAbsoluteVolumeEnabled = (): Promise<boolean> =>
  getMavinPlayer().isAbsoluteVolumeEnabled();

// ═══════════════════════════════════════════════════════════════════════════
// MAX BITRATE (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const setMaxBitrate = (kbps: number): Promise<void> => getMavinPlayer().setMaxBitrate(kbps);
export const getMaxBitrate = (): Promise<number> => getMavinPlayer().getMaxBitrate();

// ═══════════════════════════════════════════════════════════════════════════
// PLAYING DETAIL (v3)
// ═══════════════════════════════════════════════════════════════════════════

export const isPlayingWithDetail = (): Promise<{
  playing: boolean | null;
  bufferingDuringPlay: boolean | null;
}> => getMavinPlayer().isPlayingWithDetail();

// ═══════════════════════════════════════════════════════════════════════════
// REACT HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to playback progress via the native `playback-progress-updated` event.
 * Falls back to polling on the given interval.
 */
export function useProgress(options: UseProgressOptions = {}): Progress {
  const { intervalMs = 1000, enabled = true } = options;
  const [progress, setProgress] = useState<Progress>({ position: 0, duration: 0, buffered: 0 });

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    const sub = addEventListener(MavinEvent.PlaybackProgressUpdated, (data: ProgressEvent) => {
      if (mounted) setProgress(data);
    });

    const poll = async () => {
      if (!mounted) return;
      try {
        const p = await getProgress();
        if (mounted) setProgress(p);
      } catch {
        // Player not ready — ignore
      }
    };

    poll();
    const id = setInterval(poll, intervalMs);

    return () => {
      mounted = false;
      sub.remove();
      clearInterval(id);
    };
  }, [intervalMs, enabled]);

  return progress;
}

/**
 * Subscribe to playback state changes.
 */
export function usePlaybackState(): UsePlaybackStateResult {
  const [state, setState] = useState<PlaybackState>({ state: 'none', stateCode: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    getPlaybackState()
      .then((s) => {
        if (mounted) {
          setState(s);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });

    const sub = addEventListener(MavinEvent.PlaybackState, (data: PlaybackStateChangedEvent) => {
      if (!mounted) return;
      setState((prev) => ({ ...prev, state: data.state, stateCode: data.stateCode }));
      setIsLoading(false);
    });

    const errSub = addEventListener(MavinEvent.PlaybackError, (data: PlaybackErrorEvent) => {
      if (!mounted) return;
      setError(new Error(`${data.code}: ${data.message}`));
    });

    return () => {
      mounted = false;
      sub.remove();
      errSub.remove();
    };
  }, []);

  return { state, isLoading, error };
}

/**
 * Subscribe to the currently active track.
 */
export function useActiveTrack(): UseActiveTrackResult {
  const [track, setTrack] = useState<Nullable<Track>>(null);
  const [index, setIndex] = useState<Nullable<number>>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    Promise.all([getActiveTrack(), getActiveTrackIndex()])
      .then(([t, i]) => {
        if (mounted) {
          setTrack(t);
          setIndex(i);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });

    const sub = addEventListener(
      MavinEvent.PlaybackActiveTrackChanged,
      (data: PlaybackActiveTrackChangedEvent) => {
        if (!mounted) return;
        setTrack(data.track);
        setIndex(data.index);
        setIsLoading(false);
      },
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return { track, index, isLoading };
}

/**
 * Returns `true` whenever the player is actively playing.
 */
export function useIsPlaying(): boolean {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let mounted = true;

    isPlaying().then((p) => { if (mounted) setPlaying(p); }).catch(() => {});

    const sub = addEventListener(MavinEvent.PlaybackState, (data: PlaybackStateChangedEvent) => {
      if (!mounted) return;
      setPlaying(data.state === 'playing');
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return playing;
}

/**
 * Returns current volume, polled every second.
 */
export function useVolume(): number {
  const [volume, setVolume] = useState(1.0);

  useEffect(() => {
    let mounted = true;

    getVolume().then((v) => { if (mounted) setVolume(v); }).catch(() => {});

    const id = setInterval(() => {
      if (!mounted) return;
      getVolume().then(setVolume).catch(() => {});
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return volume;
}

/**
 * Returns current repeat mode. Seeded once.
 */
export function useRepeatMode(): RepeatMode {
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);

  useEffect(() => {
    let mounted = true;
    getRepeatMode()
      .then((mode) => { if (mounted) setRepeatMode(mode); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  return repeatMode;
}

/**
 * Returns current shuffle mode. Seeded once.
 */
export function useShuffleMode(): boolean {
  const [shuffle, setShuffle] = useState(false);

  useEffect(() => {
    let mounted = true;
    getShuffleMode()
      .then((s) => { if (mounted) setShuffle(s); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  return shuffle;
}

/**
 * Fire `onEnded` when the queue finishes playing.
 */
export function useQueueEnded(onEnded: (position: number) => void): void {
  const callbackRef = useRef(onEnded);

  useEffect(() => {
    callbackRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const sub = addEventListener(MavinEvent.PlaybackQueueEnded, (data: PlaybackQueueEndedEvent) => {
      callbackRef.current?.(data.position);
    });
    return () => sub.remove();
  }, []);
}

/**
 * Fire `onError` on playback errors.
 */
export function useOnError(onError: (error: PlaybackErrorEvent) => void): void {
  const callbackRef = useRef(onError);

  useEffect(() => {
    callbackRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const sub = addEventListener(MavinEvent.PlaybackError, (data: PlaybackErrorEvent) => {
      callbackRef.current?.(data);
    });
    return () => sub.remove();
  }, []);
}

/**
 * Subscribe to USB DAC connection state.
 */
export function useUsbDacConnection(): { connected: boolean; info: Nullable<DacInfo> } {
  const [state, setState] = useState<{ connected: boolean; info: Nullable<DacInfo> }>({
    connected: false,
    info: null,
  });

  useEffect(() => {
    let mounted = true;

    isUsbDacConnected()
      .then((connected) => {
        if (!mounted) return;
        if (connected) {
          getCurrentDacInfo().then((info) => {
            if (mounted) setState({ connected: true, info });
          });
        } else {
          setState({ connected: false, info: null });
        }
      })
      .catch(() => {});

    const sub1 = addEventListener(MavinEvent.UsbDacConnected, (data: DacInfo) => {
      if (!mounted) return;
      setState({ connected: true, info: data });
    });

    const sub2 = addEventListener(MavinEvent.UsbDacDisconnected, () => {
      if (!mounted) return;
      setState({ connected: false, info: null });
    });

    return () => {
      mounted = false;
      sub1.remove();
      sub2.remove();
    };
  }, []);

  return state;
}

/**
 * Subscribe to real-time spectrum data via `onSpectrum` events.
 */
export function useSpectrum(
  options: UseSpectrumOptions = {},
): Array<{ bin: number; magnitude: number }> {
  const { enabled = true, intervalMs = 100, useAnimationFrame = false } = options;
  const [magnitudes, setMagnitudes] = useState<Array<{ bin: number; magnitude: number }>>([]);

  useEffect(() => {
    if (!enabled) {
      setMagnitudes([]);
      return;
    }

    let mounted = true;
    let animationFrame: number;
    let intervalId: ReturnType<typeof setInterval>;

    const sub = addEventListener(MavinEvent.Spectrum, (data: SpectrumEvent) => {
      if (!mounted) return;
      setMagnitudes(data.magnitudes.map((magnitude, bin) => ({ bin, magnitude })));
    });

    if (useAnimationFrame) {
      const poll = async () => {
        if (!mounted) return;
        try {
          const data = await getSpectrumMagnitudes();
          if (mounted) setMagnitudes(data);
        } catch { /* ignore */ }
        animationFrame = requestAnimationFrame(poll);
      };
      poll();
    } else if (intervalMs > 0) {
      const poll = async () => {
        if (!mounted) return;
        try {
          const data = await getSpectrumMagnitudes();
          if (mounted) setMagnitudes(data);
        } catch { /* ignore */ }
      };
      intervalId = setInterval(poll, intervalMs);
    }

    return () => {
      mounted = false;
      sub.remove();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled, intervalMs, useAnimationFrame]);

  return magnitudes;
}

/**
 * Subscribe to peak meter values via `onPeakMeter` events.
 */
export function usePeakMeter(enabled = true): PeakMeter {
  const [peaks, setPeaks] = useState<PeakMeter>({ left: 0, right: 0 });

  useEffect(() => {
    if (!enabled) {
      setPeaks({ left: 0, right: 0 });
      return;
    }

    let mounted = true;

    const sub = addEventListener(MavinEvent.PeakMeterUpdate, (data: PeakMeterEvent) => {
      if (!mounted) return;
      setPeaks({ left: data.left, right: data.right });
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [enabled]);

  return peaks;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/** Convert seconds to milliseconds. */
export const secondsToMs = (seconds: number): number => seconds * 1000;

/** Convert milliseconds to seconds. */
export const msToSeconds = (ms: number): number => ms / 1000;

/** Format a duration (seconds) as MM:SS or HH:MM:SS. */
export const formatDuration = (seconds: number): string => {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

/** Returns true if the track object has a playable URL. */
export const isValidTrack = (track: Nullable<Track>): track is Track =>
  !!track && !!(track.url || track.uri);

/** Create a track object with a generated ID. */
export const createTrack = (overrides: Partial<Track> & { url: string }): Track => ({
  id: `track_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  ...overrides,
});

/** Deep-clone a track (avoids shared references). */
export const cloneTrack = (track: Track): Track => JSON.parse(JSON.stringify(track));

/** Type guard — asserts gains array is exactly 31 bands. */
export const validateEQGains = (gains: number[]): gains is EQGains =>
  gains.length === ISO_FREQ_CENTERS.length;

/** Clamp `value` to [min, max]. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Debounce a function. */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/** Throttle a function. */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): ((...args: Parameters<T>) => void) => {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
};
