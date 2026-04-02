// mavin-player/index.ts
// Full RNTP-parity JS layer for MavinPlayer.
// Drop-in replacement for react-native-track-player in existing service files.

import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import { useEffect, useRef, useState, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Native module bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const _native = requireNativeModule('MavinPlayer');
const _emitter = new EventEmitter(_native);

export const MavinPlayer = _native;
export default MavinPlayer;

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors RNTP's State enum */
export enum State {
  None      = 'none',
  Ready     = 'ready',
  Playing   = 'playing',
  Paused    = 'paused',
  Stopped   = 'stopped',
  Buffering = 'buffering',
  Loading   = 'loading',
  Error     = 'error',
  Ended     = 'ended',
}

/** Mirrors RNTP's RepeatMode enum */
export enum RepeatMode {
  Off   = 0,
  Track = 1,
  Queue = 2,
}

/** All event names emitted by the native module. Mirrors RNTP's Event enum. */
export enum Event {
  // ── Playback ──────────────────────────────────────────────────────────────
  PlaybackState                = 'onPlaybackStateChanged',
  PlaybackError                = 'onError',
  PlaybackQueueEnded           = 'onPlaybackQueueEnded',
  /** @deprecated Use PlaybackActiveTrackChanged */
  PlaybackTrackChanged         = 'onTrackChanged',
  PlaybackActiveTrackChanged   = 'onPlaybackActiveTrackChanged',
  PlaybackProgressUpdated      = 'onProgress',
  PlaybackPlayWhenReadyChanged = 'onPlaybackPlayWhenReadyChanged',
  // ── Remote controls ────────────────────────────────────────────────────────
  RemotePlay        = 'onRemotePlay',
  RemotePlayId      = 'onRemotePlayId',
  RemotePlaySearch  = 'onRemotePlaySearch',
  RemotePause       = 'onRemotePause',
  RemoteStop        = 'onRemoteStop',
  RemoteSkip        = 'onRemoteSkip',
  RemoteNext        = 'onRemoteNext',
  RemotePrevious    = 'onRemotePrevious',
  RemoteSeek        = 'onRemoteSeek',
  RemoteSetRating   = 'onRemoteSetRating',
  RemoteJumpForward  = 'onRemoteJumpForward',
  RemoteJumpBackward = 'onRemoteJumpBackward',
  RemoteDuck        = 'onRemoteDuck',
  // ── Metadata ──────────────────────────────────────────────────────────────
  AudioCommonMetadataReceived = 'onAudioCommonMetadataReceived',
  AudioTimedMetadataReceived  = 'onAudioTimedMetadataReceived',
  // ── Mavin-specific ────────────────────────────────────────────────────────
  Spectrum           = 'onSpectrum',
  PeakMeter          = 'onPeakMeter',
  ReplayGainApplied  = 'onReplayGainApplied',
  UsbDacConnected    = 'onUsbDacConnected',
  UsbDacDisconnected = 'onUsbDacDisconnected',
  AudioFocusLost     = 'onAudioFocusLost',
  AudioFocusGranted  = 'onAudioFocusGranted',
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Track {
  id?: string;
  /** Audio source – required */
  url: string;
  /** Alias for url */
  uri?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  artworkUri?: string;
  duration?: number;
  genre?: string;
  description?: string;
  date?: string;
  rating?: number;
  isLiveStream?: boolean;
  headers?: Record<string, string>;
  replayGainTags?: Record<string, string>;
  [key: string]: unknown;
}

/** Progress values are in milliseconds (raw native values). */
export interface Progress {
  position: number;
  duration: number;
  buffered: number;
}

export interface PlaybackState {
  state: State | undefined;
}

export interface PlayerOptions {
  minBuffer?: number;
  maxBuffer?: number;
  playBuffer?: number;
  backBuffer?: number;
  maxCacheSize?: number;
  waitForBuffer?: boolean;
  autoHandleInterruptions?: boolean;
  audioContentType?: string;
  audioUsage?: string;
}

type EventPayload = Record<string, unknown>;
type EventHandler = (data: EventPayload & { type: string }) => void;

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/** Initialise the player. Mirrors RNTP's setupPlayer(). */
export async function setupPlayer(options?: PlayerOptions): Promise<void> {
  return _native.initPlayer(options ?? null);
}

/** Tear down the player and release all resources. */
export async function destroy(): Promise<void> {
  return _native.release();
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK CONTROL
// ─────────────────────────────────────────────────────────────────────────────

export async function play(): Promise<void>  { return _native.play(); }
export async function pause(): Promise<void> { return _native.pause(); }
export async function stop(): Promise<void>  { return _native.stop(); }
export async function reset(): Promise<void> { return _native.reset(); }

/**
 * Seek to an absolute position in seconds (RNTP-compatible).
 * Converts to milliseconds before calling the native layer.
 */
export async function seekTo(positionSeconds: number): Promise<void> {
  return _native.seekTo(positionSeconds * 1000);
}

/**
 * Seek forward or backward by a relative offset in seconds.
 * Mirrors RNTP's seekBy().
 */
export async function seekBy(offsetSeconds: number): Promise<void> {
  return _native.skip(Math.round(offsetSeconds));
}

export async function skipToNext(): Promise<void>     { return _native.skipToNext(); }
export async function skipToPrevious(): Promise<void>  { return _native.skipToPrevious(); }

/**
 * Skip to a track by index. Mirrors RNTP's skip(index).
 */
export async function skip(index: number): Promise<void> {
  return _native.skipToIndex(index);
}

export async function setVolume(level: number): Promise<void>       { return _native.setVolume(level); }
export async function setRepeatMode(mode: RepeatMode): Promise<void> { return _native.setRepeatMode(mode); }
export async function setShuffleMode(enabled: boolean): Promise<void>{ return _native.setShuffleMode(enabled); }

// ─────────────────────────────────────────────────────────────────────────────
// RATE  (RNTP-compatible aliases for setPlaybackSpeed / getPlaybackSpeed)
// ─────────────────────────────────────────────────────────────────────────────

/** Set playback rate. 1.0 = normal speed. */
export async function setRate(rate: number): Promise<void>  { return _native.setPlaybackSpeed(rate); }
/** Get current playback rate. */
export async function getRate(): Promise<number>            { return _native.getPlaybackSpeed(); }

// ─────────────────────────────────────────────────────────────────────────────
// PLAY-WHEN-READY  (RNTP 4.x)
// ─────────────────────────────────────────────────────────────────────────────

export async function setPlayWhenReady(playWhenReady: boolean): Promise<void> {
  return _native.setPlayWhenReady(playWhenReady);
}

export async function getPlayWhenReady(): Promise<boolean> {
  return _native.getPlayWhenReady();
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Load a single track (replaces current item). Mirrors RNTP's load(). */
export async function load(track: Track): Promise<void> {
  return _native.load(track);
}

/**
 * Add one or more tracks to the queue.
 * Mirrors RNTP's add(tracks, insertBeforeIndex?).
 *
 * @param tracks           Single track or array of tracks.
 * @param insertBeforeIndex  Insert before this index. Appends if omitted.
 */
export async function add(
  tracks: Track | Track[],
  insertBeforeIndex?: number
): Promise<void> {
  const arr = Array.isArray(tracks) ? tracks : [tracks];
  if (insertBeforeIndex !== undefined) {
    for (let i = 0; i < arr.length; i++) {
      await _native.addToQueueAt(arr[i], insertBeforeIndex + i);
    }
  } else {
    for (const track of arr) {
      await _native.addToQueue(track);
    }
  }
}

/**
 * Remove one or more tracks from the queue by index.
 * Mirrors RNTP's remove(indexes).
 */
export async function remove(indexes: number | number[]): Promise<void> {
  const arr = (Array.isArray(indexes) ? indexes : [indexes])
    .slice()
    .sort((a, b) => b - a); // remove highest index first to keep earlier indices valid
  for (const idx of arr) {
    await _native.removeTrack(idx);
  }
}

/** Remove all upcoming tracks. */
export async function removeUpcomingTracks(): Promise<void> {
  return _native.removeUpcomingTracks();
}

/**
 * Move a track from one position to another.
 * Mirrors RNTP's move(fromIndex, toIndex).
 */
export async function move(fromIndex: number, toIndex: number): Promise<void> {
  return _native.moveTrack(fromIndex, toIndex);
}

/**
 * Replace the entire queue.
 * @param tracks      New queue.
 * @param startIndex  Track to start playing from (default 0).
 */
export async function setQueue(tracks: Track[], startIndex = 0): Promise<void> {
  return _native.setQueue(tracks, startIndex);
}

/** Update a track's metadata at a given index. */
export async function updateMetadataForTrack(
  index: number,
  metadata: Partial<Track>
): Promise<void> {
  return _native.updateTrack(index, metadata);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE GETTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full queue.
 * Mirrors RNTP's getQueue().
 */
export async function getQueue(): Promise<Track[]> {
  return _native.getQueue();
}

/**
 * Get a single track by index.
 * Mirrors RNTP's getTrack(index).
 */
export async function getTrack(index: number): Promise<Track | undefined> {
  const t = await _native.getTrack(index);
  return t ?? undefined;
}

/**
 * Get the currently active track object.
 * Mirrors RNTP's getActiveTrack().
 */
export async function getActiveTrack(): Promise<Track | undefined> {
  const info = await _native.getActiveTrack();
  return info ?? undefined;
}

/**
 * Get the index of the currently active track.
 * Mirrors RNTP's getActiveTrackIndex().
 */
export async function getActiveTrackIndex(): Promise<number | undefined> {
  const idx = await _native.getActiveTrackIndex();
  return idx ?? undefined;
}

/** @deprecated Use getActiveTrack() */
export async function getCurrentTrack(): Promise<Track | undefined> {
  return getActiveTrack();
}

/**
 * Returns { position, duration, buffered } snapshot in milliseconds.
 * Mirrors RNTP's getProgress().
 */
export async function getProgress(): Promise<Progress> {
  return _native.getProgress();
}

/**
 * Returns the current playback state.
 * Mirrors RNTP's getPlaybackState().
 */
export async function getPlaybackState(): Promise<PlaybackState> {
  const result = await _native.getPlaybackState() as { state: string };
  const stateValues = Object.values(State) as string[];
  const state = stateValues.includes(result.state) ? (result.state as State) : State.None;
  return { state };
}

/** @deprecated Use getPlaybackState() */
export async function getState(): Promise<State> {
  const { state } = await getPlaybackState();
  return state ?? State.None;
}

/** Current position in milliseconds. */
export async function getPosition(): Promise<number>       { return _native.getPosition(); }
/** Total duration in milliseconds. */
export async function getDuration(): Promise<number>       { return _native.getDuration(); }
/** Buffered position in milliseconds. */
export async function getBufferedPosition(): Promise<number>{ return _native.getBufferedPosition(); }

export async function getVolume(): Promise<number>         { return _native.getVolume(); }
export async function getRepeatMode(): Promise<RepeatMode> { return _native.getRepeatMode(); }
export async function getShuffleMode(): Promise<boolean>   { return _native.getShuffleMode(); }
export async function isPlaying(): Promise<boolean>        { return _native.isPlaying(); }
export async function getQueueSize(): Promise<number>      { return _native.getQueueSize(); }
export async function getAudioFocus(): Promise<boolean>    { return _native.getAudioFocus(); }

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION / OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function updateOptions(options: Record<string, unknown>): Promise<void> {
  return _native.updateOptions(options);
}
export async function setProgressUpdateEventInterval(ms: number): Promise<void> {
  return _native.setProgressUpdateInterval(ms);
}
export async function setCacheConfig(options: { sizeMB?: number; sizeBytes?: number }): Promise<void> {
  return _native.setCacheConfig(options);
}
export async function setAudioAttributes(options: { usage?: string; contentType?: string }): Promise<void> {
  return _native.setAudioAttributes(options);
}
export async function setWakeMode(mode: number): Promise<void> {
  return _native.setWakeMode(mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEED / PITCH
// ─────────────────────────────────────────────────────────────────────────────

export async function setPlaybackSpeed(speed: number): Promise<void>              { return _native.setPlaybackSpeed(speed); }
export async function getPlaybackSpeed(): Promise<number>                          { return _native.getPlaybackSpeed(); }
export async function setPlaybackPitch(pitch: number): Promise<void>              { return _native.setPlaybackPitch(pitch); }
export async function getPlaybackPitch(): Promise<number>                          { return _native.getPlaybackPitch(); }
export async function setPlaybackParameters(speed: number, pitch: number): Promise<void> {
  return _native.setPlaybackParameters(speed, pitch);
}

// ─────────────────────────────────────────────────────────────────────────────
// EQ
// ─────────────────────────────────────────────────────────────────────────────

export async function setEQEnabled(enabled: boolean): Promise<void>                         { return _native.setEQEnabled(enabled); }
export async function isEQEnabled(): Promise<boolean>                                        { return _native.isEQEnabled(); }
export async function setEQBand(band: number, gainDb: number): Promise<void>                { return _native.setEQBand(band, gainDb); }
export async function applyEQBands(gains: number[]): Promise<void>                         { return _native.applyEQBands(gains); }
export async function setEQPreamp(gainDb: number): Promise<void>                           { return _native.setEQPreamp(gainDb); }
export async function setEQBandQ(band: number, q: number): Promise<void>                   { return _native.setEQBandQ(band, q); }
export async function resetEQ(): Promise<void>                                              { return _native.resetEQ(); }
export async function getEQGains(): Promise<Array<{ band: number; gain: number }>>          { return _native.getEQGains(); }
export async function getEQPreamp(): Promise<number>                                        { return _native.getEQPreamp(); }
export async function getEQQValues(): Promise<Array<{ band: number; q: number }>>           { return _native.getEQQValues(); }
export async function setEQMode(mode: 'GRAPHIC' | 'PARAMETRIC' | 'PARALLEL'): Promise<void>{ return _native.setEQMode(mode); }
export async function getEQMode(): Promise<string>                                          { return _native.getEQMode(); }
export async function getLoudnessDb(): Promise<number>                                      { return _native.getLoudnessDb(); }

// Parametric EQ
export async function setParametricBandGain(band: number, gainDb: number): Promise<void>    { return _native.setParametricBandGain(band, gainDb); }
export async function applyParametricBands(gains: number[]): Promise<void>                  { return _native.applyParametricBands(gains); }
export async function setParametricBandFreq(band: number, freqHz: number): Promise<void>    { return _native.setParametricBandFreq(band, freqHz); }
export async function resetParametric(): Promise<void>                                       { return _native.resetParametric(); }
export async function getParametricGains(): Promise<Array<{ band: number; gain: number }>>  { return _native.getParametricGains(); }
export async function getParametricFreqs(): Promise<Array<{ band: number; freqHz: number }>>{ return _native.getParametricFreqs(); }

// Dither / smoothing
export async function setDitherMode(mode: string): Promise<void>  { return _native.setDitherMode(mode); }
export async function getDitherMode(): Promise<string>            { return _native.getDitherMode(); }
export async function setSmoothingRamp(ms: number): Promise<void> { return _native.setSmoothingRamp(ms); }

// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSOR
// ─────────────────────────────────────────────────────────────────────────────

export async function setCompressorEnabled(enabled: boolean): Promise<void>  { return _native.setCompressorEnabled(enabled); }
export async function isCompressorEnabled(): Promise<boolean>                { return _native.isCompressorEnabled(); }
export async function setCompressorThreshold(db: number): Promise<void>     { return _native.setCompressorThreshold(db); }
export async function setCompressorRatio(ratio: number): Promise<void>      { return _native.setCompressorRatio(ratio); }
export async function setCompressorAttack(ms: number): Promise<void>        { return _native.setCompressorAttack(ms); }
export async function setCompressorRelease(ms: number): Promise<void>       { return _native.setCompressorRelease(ms); }
export async function setCompressorKnee(db: number): Promise<void>          { return _native.setCompressorKnee(db); }
export async function setCompressorMakeupGain(db: number): Promise<void>    { return _native.setCompressorMakeupGain(db); }
export async function getCompressorReduction(): Promise<number>             { return _native.getCompressorReduction(); }
export async function getCompressorThreshold(): Promise<number>             { return _native.getCompressorThreshold(); }
export async function getCompressorRatio(): Promise<number>                 { return _native.getCompressorRatio(); }
export async function getCompressorAttack(): Promise<number>                { return _native.getCompressorAttack(); }
export async function getCompressorRelease(): Promise<number>               { return _native.getCompressorRelease(); }

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFADE
// ─────────────────────────────────────────────────────────────────────────────

export async function setCrossfadeEnabled(enabled: boolean): Promise<void>   { return _native.setCrossfadeEnabled(enabled); }
export async function isCrossfadeEnabled(): Promise<boolean>                 { return _native.isCrossfadeEnabled(); }
export async function setCrossfadeDuration(ms: number): Promise<void>        { return _native.setCrossfadeDuration(ms); }
export async function getCrossfadeDuration(): Promise<number>                { return _native.getCrossfadeDuration(); }

// ─────────────────────────────────────────────────────────────────────────────
// CROSSFEED
// ─────────────────────────────────────────────────────────────────────────────

export async function setCrossfeedEnabled(enabled: boolean): Promise<void>   { return _native.setCrossfeedEnabled(enabled); }
export async function isCrossfeedEnabled(): Promise<boolean>                 { return _native.isCrossfeedEnabled(); }
export async function setCrossfeedStrength(strength: number): Promise<void>  { return _native.setCrossfeedStrength(strength); }
export async function setCrossfeedCutoff(hz: number): Promise<void>          { return _native.setCrossfeedCutoff(hz); }
export async function getCrossfeedStrength(): Promise<number>                { return _native.getCrossfeedStrength(); }
export async function getCrossfeedCutoff(): Promise<number>                  { return _native.getCrossfeedCutoff(); }
export async function setCrossfeedDelayMs(ms: number): Promise<void>        { return _native.setCrossfeedDelayMs(ms); }
export async function getCrossfeedDelayMs(): Promise<number>                { return _native.getCrossfeedDelayMs(); }

// ─────────────────────────────────────────────────────────────────────────────
// REPLAY GAIN
// ─────────────────────────────────────────────────────────────────────────────

export async function setReplayGainMode(mode: string): Promise<void>                     { return _native.setReplayGainMode(mode); }
export async function setReplayGainPreamp(gainDb: number): Promise<void>                { return _native.setReplayGainPreamp(gainDb); }
export async function setReplayGainFromMap(tags: Record<string, string>): Promise<void> { return _native.setReplayGainFromMap(tags); }
export async function getReplayGainInfo(): Promise<unknown>                              { return _native.getReplayGainInfo(); }

// ─────────────────────────────────────────────────────────────────────────────
// PEAK METER
// ─────────────────────────────────────────────────────────────────────────────

export async function setPeakHoldMs(ms: number): Promise<void>                  { return _native.setPeakHoldMs(ms); }
export async function setPeakReleaseMs(ms: number): Promise<void>               { return _native.setPeakReleaseMs(ms); }
export async function getCurrentPeaks(): Promise<{ left: number; right: number }>{ return _native.getCurrentPeaks(); }
export async function getHeldPeaks(): Promise<{ left: number; right: number }>   { return _native.getHeldPeaks(); }
export async function resetPeaks(): Promise<void>                               { return _native.resetPeaks(); }

// ─────────────────────────────────────────────────────────────────────────────
// CONVOLUTION
// ─────────────────────────────────────────────────────────────────────────────

export async function loadImpulseResponse(filePath: string): Promise<void>   { return _native.loadImpulseResponse(filePath); }
export async function clearImpulseResponse(): Promise<void>                  { return _native.clearImpulseResponse(); }
export async function isImpulseResponseLoaded(): Promise<boolean>            { return _native.isImpulseResponseLoaded(); }
export async function getIrLength(): Promise<number>                         { return _native.getIrLength(); }
export async function setConvolutionEnabled(enabled: boolean): Promise<void> { return _native.setConvolutionEnabled(enabled); }
export async function isConvolutionEnabled(): Promise<boolean>               { return _native.isConvolutionEnabled(); }

// ─────────────────────────────────────────────────────────────────────────────
// FX (Reverb / Delay / Mod)
// ─────────────────────────────────────────────────────────────────────────────

export async function setFxEnabled(enabled: boolean): Promise<void>   { return _native.setFxEnabled(enabled); }
export async function isFxEnabled(): Promise<boolean>                 { return _native.isFxEnabled(); }
export async function setFxMode(mode: string): Promise<void>          { return _native.setFxMode(mode); }
export async function getFxMode(): Promise<string>                    { return _native.getFxMode(); }
export async function setFxMix(mix: number): Promise<void>            { return _native.setFxMix(mix); }
export async function getFxMix(): Promise<number>                     { return _native.getFxMix(); }
export async function setFxBypass(bypass: boolean): Promise<void>    { return _native.setFxBypass(bypass); }
export async function isFxBypassed(): Promise<boolean>               { return _native.isFxBypassed(); }

export async function setReverbRoomSize(value: number): Promise<void> { return _native.setReverbRoomSize(value); }
export async function setReverbDecay(value: number): Promise<void>    { return _native.setReverbDecay(value); }
export async function setReverbPreDelay(value: number): Promise<void> { return _native.setReverbPreDelay(value); }
export async function setReverbDamping(value: number): Promise<void>  { return _native.setReverbDamping(value); }
export async function setDelayTime(value: number): Promise<void>      { return _native.setDelayTime(value); }
export async function setDelayFeedback(value: number): Promise<void>  { return _native.setDelayFeedback(value); }
export async function setDelayLowCut(value: number): Promise<void>    { return _native.setDelayLowCut(value); }
export async function setDelayHighCut(value: number): Promise<void>   { return _native.setDelayHighCut(value); }
export async function setModRate(value: number): Promise<void>        { return _native.setModRate(value); }
export async function setModDepth(value: number): Promise<void>       { return _native.setModDepth(value); }
export async function setModPhase(value: number): Promise<void>       { return _native.setModPhase(value); }
export async function setModFeedback(value: number): Promise<void>    { return _native.setModFeedback(value); }

// ─────────────────────────────────────────────────────────────────────────────
// PRESETS
// ─────────────────────────────────────────────────────────────────────────────

export async function applyPreset(name: string): Promise<void>                                          { return _native.applyPreset(name); }
export async function savePreset(name: string): Promise<void>                                           { return _native.savePreset(name); }
export async function listPresets(): Promise<string[]>                                                  { return _native.listPresets(); }
export async function deletePreset(name: string): Promise<boolean>                                      { return _native.deletePreset(name); }
export async function exportPreset(name: string): Promise<string>                                       { return _native.exportPreset(name); }
export async function importPreset(json: string): Promise<void>                                         { return _native.importPreset(json); }
export async function assignTrackPreset(mediaId: string, presetName: string | null): Promise<void>      { return _native.assignTrackPreset(mediaId, presetName); }
export async function getTrackPreset(mediaId: string): Promise<string | null>                           { return _native.getTrackPreset(mediaId); }
export async function setAutoSwitchPresets(enabled: boolean): Promise<void>                             { return _native.setAutoSwitchPresets(enabled); }

// ─────────────────────────────────────────────────────────────────────────────
// SPECTRUM / AUTO-EQ
// ─────────────────────────────────────────────────────────────────────────────

export async function getSpectrumMagnitudes(): Promise<Array<{ bin: number; magnitude: number }>> {
  return _native.getSpectrumMagnitudes();
}
export async function computeAutoEQ(): Promise<Array<{ band: number; gain: number; freqHz: number }>> {
  return _native.computeAutoEQ();
}

// ─────────────────────────────────────────────────────────────────────────────
// USB DAC
// ─────────────────────────────────────────────────────────────────────────────

export async function isUsbDacConnected(): Promise<boolean>                       { return _native.isUsbDacConnected(); }
export async function getCurrentDacInfo(): Promise<unknown>                       { return _native.getCurrentDacInfo(); }
export async function getDacCapabilities(): Promise<unknown>                      { return _native.getDacCapabilities(); }
export async function enableDirectUsbRouting(enabled: boolean): Promise<boolean>  { return _native.enableDirectUsbRouting(enabled); }
export async function isDirectUsbRoutingEnabled(): Promise<boolean>               { return _native.isDirectUsbRoutingEnabled(); }
export async function setPreferredDacSampleRate(rate: number): Promise<boolean>   { return _native.setPreferredDacSampleRate(rate); }
export async function setPreferredDacBitDepth(depth: number): Promise<boolean>    { return _native.setPreferredDacBitDepth(depth); }
export async function rescanUsbDevices(): Promise<void>                           { return _native.rescanUsbDevices(); }

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO FORMAT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export async function getAudioCapabilities(): Promise<unknown>  { return _native.getAudioCapabilities(); }
export async function getOptimalAudioFormat(): Promise<unknown> { return _native.getOptimalAudioFormat(); }
export async function isHiResAudioCapable(): Promise<boolean>  { return _native.isHiResAudioCapable(); }
export async function getMaxSampleRate(): Promise<number>       { return _native.getMaxSampleRate(); }
export async function getMaxBitDepth(): Promise<number>         { return _native.getMaxBitDepth(); }

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE / 64-BIT
// ─────────────────────────────────────────────────────────────────────────────

export async function setOfflineMode(enabled: boolean): Promise<void>             { return _native.setOfflineMode(enabled); }
export async function isOfflineMode(): Promise<boolean>                           { return _native.isOfflineMode(); }
export async function set64BitProcessingEnabled(enabled: boolean): Promise<void>  { return _native.set64BitProcessingEnabled(enabled); }
export async function is64BitProcessingEnabled(): Promise<boolean>                { return _native.is64BitProcessingEnabled(); }

// ─────────────────────────────────────────────────────────────────────────────
// NOW-PLAYING METADATA
// ─────────────────────────────────────────────────────────────────────────────

export async function updateNowPlayingMetadata(track: Partial<Track>): Promise<void> {
  return _native.updateNowPlayingMetadata(track);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SUBSCRIPTION  (mirrors RNTP's addEventListener)
// ─────────────────────────────────────────────────────────────────────────────

export function addEventListener(
  event: Event | string,
  listener: (data: EventPayload) => void
): { remove: () => void } {
  const subscription = _emitter.addListener(event as string, listener);
  return { remove: () => subscription.remove() };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poll for playback progress at the given interval (ms).
 * Returns { position, duration, buffered } in milliseconds.
 * Mirrors RNTP's useProgress(interval?).
 */
export function useProgress(intervalMs = 1000): Progress {
  const [progress, setProgress] = useState<Progress>({ position: 0, duration: 0, buffered: 0 });

  useEffect(() => {
    let active = true;

    const sync = async () => {
      try {
        const p = await getProgress();
        if (active) setProgress(p);
      } catch { /* player not ready yet */ }
    };

    sync();
    const id = setInterval(sync, intervalMs);
    return () => { active = false; clearInterval(id); };
  }, [intervalMs]);

  return progress;
}

/**
 * Keeps track of the current playback state.
 * Mirrors RNTP's usePlaybackState().
 */
export function usePlaybackState(): PlaybackState {
  const [ps, setPs] = useState<PlaybackState>({ state: undefined });

  useEffect(() => {
    getPlaybackState().then(setPs).catch(() => {});

    const sub = addEventListener(Event.PlaybackState, (data) => {
      const raw = (data as { state?: string }).state ?? '';
      const stateValues = Object.values(State) as string[];
      setPs({ state: stateValues.includes(raw) ? (raw as State) : State.None });
    });
    return () => sub.remove();
  }, []);

  return ps;
}

/**
 * Returns the currently active track, updating whenever it changes.
 * Mirrors RNTP's useActiveTrack().
 */
export function useActiveTrack(): Track | undefined {
  const [track, setTrack] = useState<Track | undefined>(undefined);

  useEffect(() => {
    getActiveTrack().then(setTrack).catch(() => {});

    const refresh = () => { getActiveTrack().then(setTrack).catch(() => {}); };
    const s1 = addEventListener(Event.PlaybackActiveTrackChanged, refresh);
    const s2 = addEventListener(Event.PlaybackTrackChanged, refresh);  // compat
    return () => { s1.remove(); s2.remove(); };
  }, []);

  return track;
}

/**
 * Returns { playing, bufferingDuringPlay }.
 * Mirrors RNTP's useIsPlaying().
 */
export function useIsPlaying(): { playing: boolean; bufferingDuringPlay: boolean } {
  const { state } = usePlaybackState();
  return {
    playing: state === State.Playing,
    bufferingDuringPlay: state === State.Buffering,
  };
}

/**
 * Keeps track of the playWhenReady flag.
 * Mirrors RNTP's usePlayWhenReady().
 */
export function usePlayWhenReady(): boolean {
  const [pwr, setPwr] = useState(true);

  useEffect(() => {
    getPlayWhenReady().then(setPwr).catch(() => {});

    const sub = addEventListener(Event.PlaybackPlayWhenReadyChanged, (data) => {
      setPwr(!!(data as { playWhenReady?: boolean }).playWhenReady);
    });
    return () => sub.remove();
  }, []);

  return pwr;
}

/**
 * Returns the full queue and keeps it fresh.
 * Mirrors RNTP's useQueue().
 */
export function useQueue(): Track[] {
  const [queue, setQueue] = useState<Track[]>([]);

  const refresh = useCallback(() => {
    getQueue().then(setQueue).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const subs = [
      addEventListener(Event.PlaybackActiveTrackChanged, refresh),
      addEventListener(Event.PlaybackTrackChanged, refresh),
      addEventListener(Event.PlaybackQueueEnded, refresh),
    ];
    return () => subs.forEach(s => s.remove());
  }, [refresh]);

  return queue;
}

/**
 * Subscribe to one or more events and call the handler when they fire.
 * Mirrors RNTP's useTrackPlayerEvents(events, handler).
 */
export function useTrackPlayerEvents(
  events: (Event | string)[],
  handler: EventHandler
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Stringify events array for stable dep comparison
  const eventsKey = events.join(',');

  useEffect(() => {
    const subs = events.map((event) =>
      addEventListener(event, (data) =>
        handlerRef.current({ ...data, type: event })
      )
    );
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey]);
}