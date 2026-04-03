// modules/mavin-eq/index.ts
// Complete JS wrapper for MavinPlayer — imports types from types.ts

import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import { useEffect, useState, useCallback, useRef } from 'react';

// Import all types from centralized types file
import type {
  // Core types
  Nullable,
  Optional,
  
  // Track & Playback
  Track,
  State,
  PlaybackState,
  Progress,
  PeakMeter,
  RepeatMode,
  ShuffleMode,
  
  // EQ Types
  ISO_FREQ_CENTERS,
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
  Capability,
  UpdateOptions,
  
  // Events
  MavinEvent,
  RNTPEvent,
  EventName,
  EventSubscription,
  
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
  AudioFocusEvent,
  RemoteSeekEvent,
  RemoteSkipEvent,
  RemoteSetRatingEvent,
  RemoteJumpEvent,
  RemoteDuckEvent,
  MetadataEvent,
  
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

const MavinPlayer = requireNativeModule('MavinPlayer') as MavinPlayerNativeModule;
const eventEmitter = new EventEmitter(MavinPlayer);

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SUBSCRIPTION — Type-safe with string fallback
// ─────────────────────────────────────────────────────────────────────────────

export interface EventSubscription {
  remove: () => void;
}

/**
 * Add an event listener for playback events.
 * Supports both Mavin (camelCase) and RNTP (kebab-case) event names.
 * 
 * @example
 * ```ts
 * addEventListener(MavinEvent.PlaybackStateChanged, (data) => {
 *   console.log('State:', data.state);
 * });
 * 
 * addEventListener('playback-state', (data) => {
 *   // RNTP parity event
 *   console.log('RNTP state:', data.state);
 * });
 * ```
 */
export function addEventListener<K extends EventName>(
  event: K,
  listener: K extends keyof MavinPlayerEvents 
    ? MavinPlayerEvents[K] 
    : (data: any) => void
): EventSubscription {
  // Type assertion to satisfy expo-modules-core EventEmitter
  const subscription = eventEmitter.addListener(event as keyof MavinPlayerEvents, listener as any);
  return { remove: () => subscription.remove() };
}

/**
 * Remove an event listener.
 * 
 * @param event - Event name string
 * @param listener - Optional specific listener to remove. If omitted, removes all listeners for the event.
 */
export function removeEventListener(
  event: EventName,
  listener?: (data: any) => void
): void {
  if (listener) {
    eventEmitter.removeListener(event as any, listener);
  } else {
    eventEmitter.removeAllListeners(event as any);
  }
}

/**
 * Subscribe to multiple events with a single handler.
 * RNTP parity: useTrackPlayerEvents equivalent.
 * 
 * @example
 * ```ts
 * subscribeToEvents(
 *   [MavinEvent.PlaybackStateChanged, MavinEvent.PlaybackProgress],
 *   (event, data) => {
 *     console.log(`${event}:`, data);
 *   }
 * );
 * ```
 */
export function subscribeToEvents(
  events: EventName[],
  handler: (event: EventName, data: any) => void
): EventSubscription {
  const subscriptions = events.map((evt) =>
    eventEmitter.addListener(evt as any, (data: any) => handler(evt, data))
  );
  return {
    remove: () => subscriptions.forEach((sub) => sub.remove()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT EXPORT — raw native module for advanced use
// ─────────────────────────────────────────────────────────────────────────────

export default MavinPlayer;

// Re-export all types for convenience
export type {
  Nullable,
  Optional,
  Track,
  State,
  PlaybackState,
  Progress,
  PeakMeter,
  RepeatMode,
  ShuffleMode,
  ISO_FREQ_CENTERS,
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
  Capability,
  UpdateOptions,
  MavinEvent,
  RNTPEvent,
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
  AudioFocusEvent,
  RemoteSeekEvent,
  RemoteSkipEvent,
  RemoteSetRatingEvent,
  RemoteJumpEvent,
  RemoteDuckEvent,
  MetadataEvent,
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
};

// Re-export enums for convenience
export { MavinEvent, RNTPEvent, State, RepeatMode };

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE FUNCTIONS (Mavin + RNTP Aliases)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the player. (Mavin name)
 * @param options - Optional configuration
 */
export const initPlayer = (options?: SetupOptions | null): Promise<void> =>
  MavinPlayer.initPlayer(options ?? null);

/**
 * Initialize the player. (RNTP alias for initPlayer)
 * @param options - Optional configuration
 */
export const setupPlayer = (options?: SetupOptions | null): Promise<void> =>
  MavinPlayer.setupPlayer(options ?? null);

/**
 * Release all resources and stop playback. (Mavin name)
 */
export const release = (): Promise<void> => MavinPlayer.release();

/**
 * Release all resources and stop playback. (RNTP alias for release)
 */
export const destroy = (): Promise<void> => MavinPlayer.destroy();

/**
 * Stop the foreground service explicitly.
 */
export const stopService = (): Promise<void> => MavinPlayer.stopService();

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK CONTROL FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const play = (): Promise<void> => MavinPlayer.play();
export const pause = (): Promise<void> => MavinPlayer.pause();
export const stop = (): Promise<void> => MavinPlayer.stop();
export const reset = (): Promise<void> => MavinPlayer.reset();

/**
 * Seek to absolute position.
 * @param ms - Position in **milliseconds** (Mavin native precision)
 */
export const seekTo = (ms: number): Promise<void> => MavinPlayer.seekTo(ms);

/**
 * Seek relative to current position. (RNTP parity)
 * @param offsetMs - Offset in **milliseconds**
 */
export const seekBy = (offsetMs: number): Promise<void> => MavinPlayer.seekBy(offsetMs);

export const skipToNext = (): Promise<void> => MavinPlayer.skipToNext();
export const skipToPrevious = (): Promise<void> => MavinPlayer.skipToPrevious();

/**
 * Skip to track at index with optional initial position.
 * @param index - Track index in queue
 * @param initialPositionMs - Optional start position in milliseconds (RNTP v5)
 */
export const skipToIndex = (index: number, initialPositionMs?: number): Promise<void> =>
  MavinPlayer.skipToIndex(index, initialPositionMs);

/**
 * Skip forward/backward by seconds. (RNTP parity)
 * @param seconds - Relative skip in seconds
 */
export const skip = (seconds: number): Promise<void> => MavinPlayer.skip(seconds);

export const setVolume = (vol: number): Promise<void> => MavinPlayer.setVolume(vol);
export const setRepeatMode = (mode: RepeatMode | number): Promise<void> => MavinPlayer.setRepeatMode(mode);
export const setShuffleMode = (enabled: boolean): Promise<void> => MavinPlayer.setShuffleMode(enabled);

// ─────────────────────────────────────────────────────────────────────────────
// ERROR RECOVERY (RNTP Missing — Mavin Addition)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retry the current track after an error. (RNTP parity)
 */
export const retry = (): Promise<void> => MavinPlayer.retry();

/**
 * Retry with an alternative URI if the current track fails. (Mavin enhancement)
 * @param fallbackUri - Alternative stream URL
 */
export const retryWithFallback = (fallbackUri: string): Promise<void> =>
  MavinPlayer.retryWithFallback(fallbackUri);

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE MANAGEMENT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const load = (track: Track): Promise<void> => MavinPlayer.load(track);

/**
 * Replace the entire queue.
 * @param tracks - Array of track objects
 * @param startIndex - Optional index to start playback from
 */
export const setQueue = (tracks: Track[], startIndex?: number): Promise<void> =>
  MavinPlayer.setQueue(tracks, startIndex ?? 0);

/**
 * Add track(s) to queue. (RNTP parity: supports single track or array)
 * @param tracks - Single track object or array of tracks
 * @param insertBeforeIndex - Optional index to insert before (RNTP v5)
 */
export const add = (
  tracks: Track | Track[],
  insertBeforeIndex?: number
): Promise<void> => MavinPlayer.add(tracks, insertBeforeIndex);

/**
 * Add single track to queue end. (Mavin name)
 */
export const addToQueue = (track: Track): Promise<void> => MavinPlayer.addToQueue(track);

/**
 * Insert track at specific queue position.
 */
export const addToQueueAt = (track: Track, index: number): Promise<void> =>
  MavinPlayer.addToQueueAt(track, index);

/**
 * Remove track(s) from queue. (RNTP parity: supports single index or array)
 * @param indices - Single index number or array of indices
 */
export const remove = (indices: number | number[]): Promise<void> =>
  MavinPlayer.remove(indices);

/**
 * Remove single track by index. (Mavin name)
 */
export const removeTrack = (index: number): Promise<void> => MavinPlayer.removeTrack(index);

export const removeUpcomingTracks = (): Promise<void> => MavinPlayer.removeUpcomingTracks();
export const moveTrack = (fromIndex: number, toIndex: number): Promise<void> =>
  MavinPlayer.moveTrack(fromIndex, toIndex);

/**
 * Update metadata for track at index. (RNTP alias)
 */
export const updateMetadataForTrack = (index: number, track: Partial<Track>): Promise<void> =>
  MavinPlayer.updateMetadataForTrack(index, track);

/**
 * Update metadata for track at index. (Mavin name)
 */
export const updateTrack = (index: number, track: Partial<Track>): Promise<void> =>
  MavinPlayer.updateTrack(index, track);

export const getTrack = (index: number): Promise<Nullable<Track>> => MavinPlayer.getTrack(index);
export const getQueue = (): Promise<Track[]> => MavinPlayer.getQueue();

/**
 * Update now playing metadata without changing queue.
 */
export const updateNowPlayingMetadata = (track: Partial<Track>): Promise<void> =>
  MavinPlayer.updateNowPlayingMetadata(track);

// ─────────────────────────────────────────────────────────────────────────────
// STATE GETTER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getPosition = (): Promise<number> => MavinPlayer.getPosition(); // milliseconds
export const getDuration = (): Promise<number> => MavinPlayer.getDuration(); // milliseconds
export const getBufferedPosition = (): Promise<number> => MavinPlayer.getBufferedPosition(); // milliseconds

export const getCurrentTrack = (): Promise<Nullable<Track>> => MavinPlayer.getCurrentTrack();

/**
 * Get currently active track. (RNTP v4 name)
 */
export const getActiveTrack = (): Promise<Nullable<Track>> => MavinPlayer.getActiveTrack();

/**
 * Get index of currently active track. (RNTP v4)
 */
export const getActiveTrackIndex = (): Promise<Nullable<number>> => MavinPlayer.getActiveTrackIndex();

export const isPlaying = (): Promise<boolean> => MavinPlayer.isPlaying();
export const getQueueSize = (): Promise<number> => MavinPlayer.getQueueSize();

/**
 * Get playback progress. All values in **milliseconds**.
 */
export const getProgress = (): Promise<Progress> => MavinPlayer.getProgress();

/**
 * Get playback state with error details.
 */
export const getPlaybackState = (): Promise<PlaybackState> => MavinPlayer.getPlaybackState();

export const getVolume = (): Promise<number> => MavinPlayer.getVolume();
export const getRepeatMode = (): Promise<RepeatMode> => MavinPlayer.getRepeatMode();
export const getShuffleMode = (): Promise<boolean> => MavinPlayer.getShuffleMode();
export const getAudioFocus = (): Promise<boolean> => MavinPlayer.getAudioFocus();

// ─────────────────────────────────────────────────────────────────────────────
// PLAY-WHEN-READY (RNTP 4.x Parity)
// ─────────────────────────────────────────────────────────────────────────────

export const setPlayWhenReady = (playWhenReady: boolean): Promise<void> =>
  MavinPlayer.setPlayWhenReady(playWhenReady);

export const getPlayWhenReady = (): Promise<boolean> => MavinPlayer.getPlayWhenReady();

// ─────────────────────────────────────────────────────────────────────────────
// SPEED / PITCH FUNCTIONS (Independent Control — Mavin Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

export const setPlaybackSpeed = (speed: number): Promise<void> =>
  MavinPlayer.setPlaybackSpeed(speed);

export const getPlaybackSpeed = (): Promise<number> => MavinPlayer.getPlaybackSpeed();

export const setPlaybackPitch = (pitch: number): Promise<void> =>
  MavinPlayer.setPlaybackPitch(pitch);

export const getPlaybackPitch = (): Promise<number> => MavinPlayer.getPlaybackPitch();

export const setPlaybackParameters = (speed: number, pitch: number): Promise<void> =>
  MavinPlayer.setPlaybackParameters(speed, pitch);

/**
 * Get playback rate. (RNTP alias for getPlaybackSpeed)
 */
export const getRate = (): Promise<number> => MavinPlayer.getRate();

/**
 * Set playback rate. (RNTP alias for setPlaybackSpeed)
 */
export const setRate = (rate: number): Promise<void> => MavinPlayer.setRate(rate);

// ─────────────────────────────────────────────────────────────────────────────
// PRELOADING (RNTP v5 Feature — Mavin Implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preload a track for faster playback.
 * @param track - Track to preload
 */
export const preload = (track: Track): Promise<void> => MavinPlayer.preload(track);

/**
 * Set preload strategy for queue items.
 * @param strategy - 'none' | 'current' | 'upcoming' | 'all'
 */
export const setPreloadStrategy = (strategy: PreloadStrategy): Promise<void> =>
  MavinPlayer.setPreloadStrategy(strategy);

/**
 * Get cache usage statistics.
 */
export const getCacheStats = (): Promise<CacheStats> => MavinPlayer.getCacheStats();

// ─────────────────────────────────────────────────────────────────────────────
// EQ FUNCTIONS (Graphic EQ)
// ─────────────────────────────────────────────────────────────────────────────

export const setEQEnabled = (enabled: boolean): Promise<void> => MavinPlayer.setEQEnabled(enabled);
export const isEQEnabled = (): Promise<boolean> => MavinPlayer.isEQEnabled();

export const setEQBand = (band: number, gainDb: number): Promise<void> =>
  MavinPlayer.setEQBand(band, gainDb);

export const applyEQBands = (gains: number[]): Promise<void> => MavinPlayer.applyEQBands(gains);
export const setEQPreamp = (gainDb: number): Promise<void> => MavinPlayer.setEQPreamp(gainDb);
export const setEQBandQ = (band: number, q: number): Promise<void> => MavinPlayer.setEQBandQ(band, q);
export const resetEQ = (): Promise<void> => MavinPlayer.resetEQ();

export const getEQGains = (): Promise<EqBandInfo[]> => MavinPlayer.getEQGains();
export const getEQPreamp = (): Promise<number> => MavinPlayer.getEQPreamp();
export const getEQQValues = (): Promise<Array<{ band: number; q: number }>> => MavinPlayer.getEQQValues();

export const setEQMode = (mode: EqMode): Promise<void> => MavinPlayer.setEQMode(mode);
export const getEQMode = (): Promise<EqMode> => MavinPlayer.getEQMode();
export const getLoudnessDb = (): Promise<number> => MavinPlayer.getLoudnessDb();

// ─────────────────────────────────────────────────────────────────────────────
// PARAMETRIC EQ FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setParametricBandGain = (band: number, gainDb: number): Promise<void> =>
  MavinPlayer.setParametricBandGain(band, gainDb);

export const applyParametricBands = (gains: number[]): Promise<void> =>
  MavinPlayer.applyParametricBands(gains);

export const setParametricBandFreq = (band: number, freqHz: number): Promise<void> =>
  MavinPlayer.setParametricBandFreq(band, freqHz);

export const resetParametric = (): Promise<void> => MavinPlayer.resetParametric();

export const getParametricGains = (): Promise<EqBandInfo[]> => MavinPlayer.getParametricGains();
export const getParametricFreqs = (): Promise<Array<{ band: number; freqHz: number }>> =>
  MavinPlayer.getParametricFreqs();

// ─────────────────────────────────────────────────────────────────────────────
// DITHER / SMOOTHING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setDitherMode = (mode: DitherMode): Promise<void> =>
  MavinPlayer.setDitherMode(mode);

export const getDitherMode = (): Promise<DitherMode> => MavinPlayer.getDitherMode();
export const setSmoothingRamp = (ms: number): Promise<void> => MavinPlayer.setSmoothingRamp(ms);

// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSOR (DRC) FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setCompressorEnabled = (enabled: boolean): Promise<void> =>
  MavinPlayer.setCompressorEnabled(enabled);

export const isCompressorEnabled = (): Promise<boolean> => MavinPlayer.isCompressorEnabled();

export const setCompressorThreshold = (db: number): Promise<void> =>
  MavinPlayer.setCompressorThreshold(db);

export const setCompressorRatio = (ratio: number): Promise<void> =>
  MavinPlayer.setCompressorRatio(ratio);

export const setCompressorAttack = (ms: number): Promise<void> =>
  MavinPlayer.setCompressorAttack(ms);

export const setCompressorRelease = (ms: number): Promise<void> =>
  MavinPlayer.setCompressorRelease(ms);

export const setCompressorKnee = (db: number): Promise<void> =>
  MavinPlayer.setCompressorKnee(db);

export const setCompressorMakeupGain = (db: number): Promise<void> =>
  MavinPlayer.setCompressorMakeupGain(db);

export const getCompressorReduction = (): Promise<number> => MavinPlayer.getCompressorReduction();
export const getCompressorThreshold = (): Promise<number> => MavinPlayer.getCompressorThreshold();
export const getCompressorRatio = (): Promise<number> => MavinPlayer.getCompressorRatio();
export const getCompressorAttack = (): Promise<number> => MavinPlayer.getCompressorAttack();
export const getCompressorRelease = (): Promise<number> => MavinPlayer.getCompressorRelease();

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFADE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setCrossfadeEnabled = (enabled: boolean): Promise<void> =>
  MavinPlayer.setCrossfadeEnabled(enabled);

export const isCrossfadeEnabled = (): Promise<boolean> => MavinPlayer.isCrossfadeEnabled();

export const setCrossfadeDuration = (ms: number): Promise<void> =>
  MavinPlayer.setCrossfadeDuration(ms);

export const getCrossfadeDuration = (): Promise<number> => MavinPlayer.getCrossfadeDuration();

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFEED FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setCrossfeedEnabled = (enabled: boolean): Promise<void> =>
  MavinPlayer.setCrossfeedEnabled(enabled);

export const isCrossfeedEnabled = (): Promise<boolean> => MavinPlayer.isCrossfeedEnabled();

export const setCrossfeedStrength = (strength: number): Promise<void> =>
  MavinPlayer.setCrossfeedStrength(strength);

export const setCrossfeedCutoff = (hz: number): Promise<void> =>
  MavinPlayer.setCrossfeedCutoff(hz);

export const getCrossfeedStrength = (): Promise<number> => MavinPlayer.getCrossfeedStrength();
export const getCrossfeedCutoff = (): Promise<number> => MavinPlayer.getCrossfeedCutoff();

export const setCrossfeedDelayMs = (ms: number): Promise<void> =>
  MavinPlayer.setCrossfeedDelayMs(ms);

export const getCrossfeedDelayMs = (): Promise<number> => MavinPlayer.getCrossfeedDelayMs();

// ─────────────────────────────────────────────────────────────────────────────
// REPLAY GAIN FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setReplayGainMode = (mode: ReplayGainMode): Promise<void> =>
  MavinPlayer.setReplayGainMode(mode);

export const setReplayGainPreamp = (gainDb: number): Promise<void> =>
  MavinPlayer.setReplayGainPreamp(gainDb);

export const setReplayGainFromMap = (tags: Record<string, string>): Promise<void> =>
  MavinPlayer.setReplayGainFromMap(tags);

export const getReplayGainInfo = (): Promise<ReplayGainInfo> =>
  MavinPlayer.getReplayGainInfo();

// ─────────────────────────────────────────────────────────────────────────────
// PEAK METER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const setPeakHoldMs = (ms: number): Promise<void> => MavinPlayer.setPeakHoldMs(ms);
export const setPeakReleaseMs = (ms: number): Promise<void> => MavinPlayer.setPeakReleaseMs(ms);

export const getCurrentPeaks = (): Promise<PeakMeter> => MavinPlayer.getCurrentPeaks();
export const getHeldPeaks = (): Promise<PeakMeter> => MavinPlayer.getHeldPeaks();
export const resetPeaks = (): Promise<void> => MavinPlayer.resetPeaks();

// ─────────────────────────────────────────────────────────────────────────────
// CONVOLUTION (Impulse Response) FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const loadImpulseResponse = (filePath: string): Promise<void> =>
  MavinPlayer.loadImpulseResponse(filePath);

export const clearImpulseResponse = (): Promise<void> => MavinPlayer.clearImpulseResponse();
export const isImpulseResponseLoaded = (): Promise<boolean> => MavinPlayer.isImpulseResponseLoaded();
export const getIrLength = (): Promise<number> => MavinPlayer.getIrLength();

export const setConvolutionEnabled = (enabled: boolean): Promise<void> =>
  MavinPlayer.setConvolutionEnabled(enabled);

export const isConvolutionEnabled = (): Promise<boolean> => MavinPlayer.isConvolutionEnabled();

// ─────────────────────────────────────────────────────────────────────────────
// FX PROCESSOR FUNCTIONS (Reverb, Delay, Modulation)
// ─────────────────────────────────────────────────────────────────────────────

export const setFxEnabled = (enabled: boolean): Promise<void> => MavinPlayer.setFxEnabled(enabled);
export const isFxEnabled = (): Promise<boolean> => MavinPlayer.isFxEnabled();

export const setFxMode = (mode: FxMode): Promise<void> => MavinPlayer.setFxMode(mode);
export const getFxMode = (): Promise<FxMode> => MavinPlayer.getFxMode();
export const setFxMix = (mix: number): Promise<void> => MavinPlayer.setFxMix(mix); // 0-100
export const getFxMix = (): Promise<number> => MavinPlayer.getFxMix();

export const setFxBypass = (bypass: boolean): Promise<void> => MavinPlayer.setFxBypass(bypass);
export const isFxBypassed = (): Promise<boolean> => MavinPlayer.isFxBypassed();

// ── Reverb Parameters ──
export const setReverbRoomSize = (value: number): Promise<void> =>
  MavinPlayer.setReverbRoomSize(value); // 0-100

export const setReverbDecay = (value: number): Promise<void> =>
  MavinPlayer.setReverbDecay(value); // 0-100

export const setReverbPreDelay = (value: number): Promise<void> =>
  MavinPlayer.setReverbPreDelay(value); // 0-100

export const setReverbDamping = (value: number): Promise<void> =>
  MavinPlayer.setReverbDamping(value); // 0-100

// ── Delay Parameters ──
export const setDelayTime = (value: number): Promise<void> => MavinPlayer.setDelayTime(value); // 0-100
export const setDelayFeedback = (value: number): Promise<void> => MavinPlayer.setDelayFeedback(value); // 0-100
export const setDelayLowCut = (value: number): Promise<void> => MavinPlayer.setDelayLowCut(value); // 0-100
export const setDelayHighCut = (value: number): Promise<void> => MavinPlayer.setDelayHighCut(value); // 0-100

// ── Modulation Parameters ──
export const setModRate = (value: number): Promise<void> => MavinPlayer.setModRate(value); // 0-100
export const setModDepth = (value: number): Promise<void> => MavinPlayer.setModDepth(value); // 0-100
export const setModPhase = (value: number): Promise<void> => MavinPlayer.setModPhase(value); // 0-100
export const setModFeedback = (value: number): Promise<void> => MavinPlayer.setModFeedback(value); // 0-100

// ─────────────────────────────────────────────────────────────────────────────
// PRESET FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const applyPreset = (name: string): Promise<void> => MavinPlayer.applyPreset(name);
export const savePreset = (name: string): Promise<void> => MavinPlayer.savePreset(name);
export const listPresets = (): Promise<string[]> => MavinPlayer.listPresets();
export const deletePreset = (name: string): Promise<boolean> => MavinPlayer.deletePreset(name);
export const exportPreset = (name: string): Promise<Nullable<string>> => MavinPlayer.exportPreset(name);
export const importPreset = (json: string): Promise<void> => MavinPlayer.importPreset(json);

export const assignTrackPreset = (mediaId: string, presetName: string | null): Promise<void> =>
  MavinPlayer.assignTrackPreset(mediaId, presetName);

export const getTrackPreset = (mediaId: string): Promise<Nullable<string>> =>
  MavinPlayer.getTrackPreset(mediaId);

export const setAutoSwitchPresets = (enabled: boolean): Promise<void> =>
  MavinPlayer.setAutoSwitchPresets(enabled);

// ─────────────────────────────────────────────────────────────────────────────
// SPECTRUM / AUTO-EQ FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getSpectrumMagnitudes = (): Promise<Array<{ bin: number; magnitude: number }>> =>
  MavinPlayer.getSpectrumMagnitudes();

export const computeAutoEQ = (): Promise<Array<{ band: number; gain: number; freqHz: number }>> =>
  MavinPlayer.computeAutoEQ();

// ─────────────────────────────────────────────────────────────────────────────
// USB DAC FUNCTIONS (Mavin Exclusive)
// ─────────────────────────────────────────────────────────────────────────────

export const isUsbDacConnected = (): Promise<boolean> => MavinPlayer.isUsbDacConnected();
export const getCurrentDacInfo = (): Promise<Nullable<DacInfo>> => MavinPlayer.getCurrentDacInfo();
export const getDacCapabilities = (): Promise<Nullable<DacCapabilities>> => MavinPlayer.getDacCapabilities();

export const enableDirectUsbRouting = (enabled: boolean): Promise<boolean> =>
  MavinPlayer.enableDirectUsbRouting(enabled);

export const isDirectUsbRoutingEnabled = (): Promise<boolean> =>
  MavinPlayer.isDirectUsbRoutingEnabled();

export const setPreferredDacSampleRate = (rate: number): Promise<boolean> =>
  MavinPlayer.setPreferredDacSampleRate(rate);

export const setPreferredDacBitDepth = (depth: number): Promise<boolean> =>
  MavinPlayer.setPreferredDacBitDepth(depth);

export const rescanUsbDevices = (): Promise<void> => MavinPlayer.rescanUsbDevices();

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO FORMAT DETECTION (Mavin Exclusive)
// ─────────────────────────────────────────────────────────────────────────────

export const getAudioCapabilities = (): Promise<Nullable<AudioCapabilities>> =>
  MavinPlayer.getAudioCapabilities();

export const getOptimalAudioFormat = (): Promise<Nullable<OptimalAudioFormat>> =>
  MavinPlayer.getOptimalAudioFormat();

export const isHiResAudioCapable = (): Promise<boolean> => MavinPlayer.isHiResAudioCapable();
export const getMaxSampleRate = (): Promise<number> => MavinPlayer.getMaxSampleRate();
export const getMaxBitDepth = (): Promise<number> => MavinPlayer.getMaxBitDepth();

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE / 64-BIT PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

export const setOfflineMode = (enabled: boolean): Promise<void> =>
  MavinPlayer.setOfflineMode(enabled);

export const isOfflineMode = (): Promise<boolean> => MavinPlayer.isOfflineMode();

export const set64BitProcessingEnabled = (enabled: boolean): Promise<void> =>
  MavinPlayer.set64BitProcessingEnabled(enabled);

export const is64BitProcessingEnabled = (): Promise<boolean> =>
  MavinPlayer.is64BitProcessingEnabled();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update player options dynamically. (Full RNTP parity implementation)
 */
export const updateOptions = (options: UpdateOptions): Promise<void> =>
  MavinPlayer.updateOptions(options);

export const setProgressUpdateInterval = (ms: number): Promise<void> =>
  MavinPlayer.setProgressUpdateInterval(ms);

export const getProgressUpdateInterval = (): Promise<number> =>
  MavinPlayer.getProgressUpdateInterval();

export const setCacheConfig = (options: { sizeMB?: number; sizeBytes?: number }): Promise<void> =>
  MavinPlayer.setCacheConfig(options);

export const setAudioAttributes = (options: { usage?: string; contentType?: string }): Promise<void> =>
  MavinPlayer.setAudioAttributes(options);

export const setWakeMode = (mode: number): Promise<void> => MavinPlayer.setWakeMode(mode);

// ─────────────────────────────────────────────────────────────────────────────
// REACT HOOKS — Type-safe, memoized, cleanup-aware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poll for playback progress. All values in **milliseconds**.
 * @param options - Polling options (interval, enabled)
 */
export function useProgress(options: UseProgressOptions = {}): Progress {
  const { intervalMs = 1000, enabled = true } = options;
  const [progress, setProgress] = useState<Progress>({ position: 0, duration: 0, buffered: 0 });
  const isActive = useRef(enabled);

  useEffect(() => {
    isActive.current = enabled;
    if (!enabled) return;
    
    let mounted = true;

    const sync = async () => {
      if (!mounted || !isActive.current) return;
      try {
        const p = await getProgress();
        if (mounted && isActive.current) setProgress(p);
      } catch {
        // Player not ready — ignore
      }
    };

    sync();
    const id = setInterval(sync, intervalMs);

    return () => {
      mounted = false;
      isActive.current = false;
      clearInterval(id);
    };
  }, [intervalMs, enabled]);

  return progress;
}

/**
 * Subscribe to playback state changes via native events.
 */
export function usePlaybackState(): UsePlaybackStateResult {
  const [state, setState] = useState<PlaybackState>({ state: State.None });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    // Initial fetch
    getPlaybackState()
      .then((s) => {
        if (mounted) {
          setState({ ...s, state: (s?.state ?? State.None) as State });
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setIsLoading(false);
        }
      });

    // Subscribe to state changes (both Mavin and RNTP events)
    const sub1 = addEventListener(MavinEvent.PlaybackStateChanged, (data: PlaybackStateChangedEvent) => {
      if (!mounted) return;
      setState({ state: (data?.state ?? State.None) as State });
      setIsLoading(false);
    });

    const sub2 = addEventListener(RNTPEvent.PlaybackState, (data: any) => {
      if (!mounted) return;
      setState({ ...data, state: (data?.state ?? State.None) as State });
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      sub1.remove();
      sub2.remove();
    };
  }, []);

  return { state, isLoading, error };
}

/**
 * Subscribe to the currently active track via native events.
 */
export function useActiveTrack(): UseActiveTrackResult {
  const [track, setTrack] = useState<Nullable<Track>>(null);
  const [index, setIndex] = useState<Nullable<number>>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    // Initial fetch
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

    // Subscribe to track changes
    const sub = addEventListener(MavinEvent.PlaybackActiveTrackChanged, (data: PlaybackActiveTrackChangedEvent) => {
      if (!mounted) return;
      setTrack(data.track);
      setIndex(data.index);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return { track, index, isLoading };
}

/**
 * Subscribe to play/pause state via native events.
 */
export function useIsPlaying(): boolean {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Initial fetch
    isPlaying().then((p) => {
      if (mounted) setPlaying(p);
    });

    // Subscribe to state changes
    const sub = addEventListener(MavinEvent.PlaybackStateChanged, (data: PlaybackStateChangedEvent) => {
      if (!mounted) return;
      setPlaying(data?.state === State.Playing);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return playing;
}

/**
 * Subscribe to volume changes with polling fallback.
 */
export function useVolume(): number {
  const [volume, setVolume] = useState(1.0);

  useEffect(() => {
    let mounted = true;

    // Initial fetch
    getVolume().then((v) => {
      if (mounted) setVolume(v);
    });

    // Poll for changes (native volume events not exposed)
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
 * Subscribe to repeat mode changes.
 */
export function useRepeatMode(): RepeatMode {
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);

  useEffect(() => {
    let mounted = true;

    getRepeatMode()
      .then((mode) => {
        if (mounted) setRepeatMode(mode);
      })
      .catch(() => {});

    // Note: No native event for repeat mode changes — poll if needed
    return () => {
      mounted = false;
    };
  }, []);

  return repeatMode;
}

/**
 * Subscribe to shuffle mode changes.
 */
export function useShuffleMode(): boolean {
  const [shuffle, setShuffle] = useState(false);

  useEffect(() => {
    let mounted = true;

    getShuffleMode()
      .then((s) => {
        if (mounted) setShuffle(s);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  return shuffle;
}

/**
 * Subscribe to queue-ended events.
 * @param onEnded - Callback fired when queue finishes playing
 */
export function useQueueEnded(onEnded: (position: number) => void): void {
  const callbackRef = useRef(onEnded);

  useEffect(() => {
    callbackRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const sub = addEventListener(MavinEvent.PlaybackQueueEnded, (data: PlaybackQueueEndedEvent) => {
      callbackRef.current?.(data?.position ?? 0);
    });
    return () => sub.remove();
  }, []);
}

/**
 * Subscribe to error events.
 * @param onError - Callback fired on playback errors
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
 * Subscribe to USB DAC connection events.
 */
export function useUsbDacConnection(): { connected: boolean; info: Nullable<DacInfo> } {
  const [state, setState] = useState<{ connected: boolean; info: Nullable<DacInfo> }>({
    connected: false,
    info: null,
  });

  useEffect(() => {
    let mounted = true;

    // Initial check
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

    // Subscribe to connection events
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
 * Subscribe to spectrum data for visualizers.
 * @param options - Spectrum polling options
 */
export function useSpectrum(options: UseSpectrumOptions = {}): Array<{ bin: number; magnitude: number }> {
  const { enabled = true, intervalMs = 100, useAnimationFrame = false } = options;
  const [magnitudes, setMagnitudes] = useState<Array<{ bin: number; magnitude: number }>>([]);

  useEffect(() => {
    if (!enabled) {
      setMagnitudes([]);
      return;
    }

    let mounted = true;
    let animationFrame: number;
    let intervalId: NodeJS.Timeout;

    const poll = async () => {
      if (!mounted) return;
      try {
        const data = await getSpectrumMagnitudes();
        if (mounted) setMagnitudes(data);
      } catch {
        // Ignore errors
      }
      if (useAnimationFrame) {
        animationFrame = requestAnimationFrame(poll);
      }
    };

    if (useAnimationFrame) {
      poll();
    } else {
      poll();
      intervalId = setInterval(poll, intervalMs);
    }

    return () => {
      mounted = false;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled, intervalMs, useAnimationFrame]);

  return magnitudes;
}

/**
 * Subscribe to peak meter data for VU meters.
 * @param enabled - Whether to enable peak meter subscription
 */
export function usePeakMeter(enabled = true): PeakMeter {
  const [peaks, setPeaks] = useState<PeakMeter>({ left: 0, right: 0 });

  useEffect(() => {
    if (!enabled) {
      setPeaks({ left: 0, right: 0 });
      return;
    }

    let mounted = true;

    const sub = addEventListener(MavinEvent.PeakMeter, (data: PeakMeterEvent) => {
      if (!mounted) return;
      setPeaks({ left: data?.left ?? 0, right: data?.right ?? 0 });
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [enabled]);

  return peaks;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert milliseconds to seconds (for RNTP compatibility layer).
 */
export const msToSeconds = (ms: number): number => ms / 1000;

/**
 * Convert seconds to milliseconds (for Mavin native precision).
 */
export const secondsToMs = (seconds: number): number => seconds * 1000;

/**
 * Format duration as MM:SS or HH:MM:SS.
 */
export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Check if a track object is valid for playback.
 */
export const isValidTrack = (track: Nullable<Track>): boolean => {
  if (!track) return false;
  return !!(track.uri || track.url);
};

/**
 * Merge default track properties with user-provided values.
 */
export const createTrack = (overrides: Partial<Track>): Track => ({
  id: `track_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  uri: '',
  ...overrides,
});

/**
 * Deep clone a track object to avoid reference issues.
 */
export const cloneTrack = (track: Track): Track => JSON.parse(JSON.stringify(track));

/**
 * Validate EQ gains array length for 31-band EQ.
 */
export const validateEQGains = (gains: number[]): gains is EQGains => {
  return gains.length === ISO_FREQ_CENTERS.length;
};

/**
 * Clamp a value to a range.
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Debounce a function call.
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Throttle a function call.
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};