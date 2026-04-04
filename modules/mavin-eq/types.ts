// modules/mavin-player/types.ts
// Complete TypeScript type definitions for MavinPlayer native module

import type { NativeModule, EventSubscription as ExpoEventSubscription } from 'expo-modules-core';

// ═══════════════════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

// ═══════════════════════════════════════════════════════════════════════════
// TRACK TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Track {
  // Required
  id: string;
  uri: string;

  // Optional metadata
  url?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  artworkUri?: string;
  duration?: number;       // milliseconds
  genre?: string;
  description?: string;
  date?: string;
  rating?: number;
  isLiveStream?: boolean;

  // Advanced
  headers?: Record<string, string>;
  replayGainTags?: Record<string, string>;

  // RNTP v5 compatibility
  type?: 'default' | 'hls' | 'dash' | 'smoothstreaming';
  userAgent?: string;
  contentType?: string;

  // Mavin extensions
  presetName?: string;
  isLossless?: boolean;
  bitDepth?: number;
  sampleRate?: number;

  // Allow extra fields
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK STATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum State {
  None      = 'none',
  Idle      = 'idle',
  Buffering = 'buffering',
  Ready     = 'ready',
  Playing   = 'playing',
  Paused    = 'paused',
  Stopped   = 'stopped',
  Ended     = 'ended',
  Error     = 'error',
  Loading   = 'loading',
}

export interface PlaybackState {
  state: State | string;
  stateCode?: number;
  error?: { message: string; code: string } | null;
}

export interface Progress {
  position: number; // milliseconds
  duration: number; // milliseconds
  buffered: number; // milliseconds
}

export interface PeakMeter {
  left: number;
  right: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPEAT & SHUFFLE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum RepeatMode {
  Off   = 0,
  Queue = 1,
  Track = 2,
}

export type ShuffleMode = 'off' | 'songs' | 'albums';

// ═══════════════════════════════════════════════════════════════════════════
// EQ TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const ISO_FREQ_CENTERS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const;

export type IsoFreqIndex =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19
  | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

export type EQGains = readonly [
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number, number
];

export type EqBandGains = number[] | EQGains;

export interface EqBandInfo {
  band: number;
  gain: number;   // dB
  freqHz: number;
  q?: number;
}

export type EqMode    = 'GRAPHIC' | 'PARAMETRIC' | 'PARALLEL';
export type DitherMode = 'FLAT' | 'HIGHPASS' | 'E_WEIGHTED' | 'F_WEIGHTED';

export interface EqBiquadFilter {
  type: 'peaking' | 'lowpass' | 'highpass' | 'lowshelf' | 'highshelf' | 'notch' | 'bandpass';
  frequency: number; // Hz
  gainDb: number;
  q: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSOR (DRC) TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CompressorSettings {
  enabled: boolean;
  threshold: number;   // dB
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeWidth: number;   // dB
  makeupGain: number;  // dB
  reductionDb: number; // current reduction (read-only)
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSSFEED TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CrossfeedSettings {
  enabled: boolean;
  strength: number;  // 0.0 - 1.0
  cutoffHz: number;
  delayMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY GAIN TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ReplayGainMode = 'TRACK' | 'ALBUM' | 'RADIO' | 'OFF';

export interface ReplayGainInfo {
  trackGain: number | null; // dB
  albumGain: number | null; // dB
  trackPeak: number | null;
  albumPeak: number | null;
  source: string;
  mode: ReplayGainMode;
  preampDb: number;         // dB
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESET TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type PresetCategory = 'builtin' | 'user' | 'supabase' | 'artist' | 'genre' | 'device';
export type PresetTag =
  | 'bass' | 'vocal' | 'treble' | 'balanced' | 'warm' | 'bright'
  | 'electronic' | 'rock' | 'classical' | 'jazz' | 'hiphop' | 'podcast'
  | 'gaming' | 'movie' | 'audiophile' | 'loudness' | 'flat' | 'custom';

export interface EqPreset {
  id: string;
  name: string;
  type: 'graphic_31band' | 'biquad' | 'parametric';
  category: PresetCategory;

  description?: string;
  icon?: string;
  color?: string;
  tags?: PresetTag[];
  isFavorite?: boolean;

  // EQ data
  gains_31?: EqBandGains;
  biquad_filters?: EqBiquadFilter[];
  parametric_gains?: number[];
  parametric_freqs?: number[];
  q_values?: number[];
  eq_mode?: EqMode;
  preamp_db?: number;

  // Source tracking
  source: 'local' | 'supabase' | 'imported';
  supabaseId?: string;

  // Timestamps
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

export interface PresetGroup {
  id: PresetCategory;
  title: string;
  icon: string;
  presets: EqPreset[];
  isExpanded?: boolean;
  sortOrder: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// FX PROCESSOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type FxMode = 'REVERB' | 'DELAY' | 'CHORUS' | 'FLANGER' | 'PHASER';

export interface FxState {
  enabled: boolean;
  mode: FxMode;
  mix: number;     // 0-100 (%)
  bypass: boolean;

  // Reverb
  reverbRoomSize: number; // 0-100
  reverbDecay: number;    // 0-100
  reverbPreDelay: number; // 0-100
  reverbDamping: number;  // 0-100

  // Delay
  delayTime: number;     // 0-100
  delayFeedback: number; // 0-100
  delayLowCut: number;   // 0-100
  delayHighCut: number;  // 0-100

  // Modulation
  modRate: number;     // 0-100
  modDepth: number;    // 0-100
  modPhase: number;    // 0-100
  modFeedback: number; // 0-100
}

// ═══════════════════════════════════════════════════════════════════════════
// USB DAC TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DacInfo {
  name: string;
  vendorId: number;
  productId: number;
  isConnected: boolean;
  hasAudioOutput: boolean;
  supportedSampleRates: number[];
  maxBitDepth: number;
  maxChannels: number;
  isNativeDirectSupported: boolean;
}

export interface DacCapabilities {
  sampleRates: number[];
  bitDepths: number[];
  channelCounts: number[];
  supportsFloatOutput: boolean;
  supportsHdAudio: boolean;
  nativeSampleRate: number;
  nativeBitDepth: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO FORMAT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AudioCapabilities {
  maxSampleRate: number;
  maxBitDepth: number;
  supportsFloat: boolean;
  supportsHdAudio: boolean;
  supportsUltraHdAudio: boolean;
  supportedSampleRates: number[];
  supportedBitDepths: number[];
  isHiResCapable: boolean;
}

export interface OptimalAudioFormat {
  sampleRate: number;
  bitDepth: number;
  encoding: string;
  isFloat: boolean;
  isHiRes: boolean;
  channelCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVOLUTION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ConvolutionState {
  enabled: boolean;
  impulseResponseLoaded: boolean;
  irLength: number; // samples
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE & PRELOAD TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CacheStats {
  cacheSizeBytes: number;
  cacheUsedBytes: number;
  cacheMaxBytes: number;
  queueSize: number;
  bufferedPosition: number;
}

export type PreloadStrategy = 'none' | 'current' | 'upcoming' | 'all';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AndroidOptions {
  appKilledPlaybackBehavior?:
    | 'ContinuePlayback'
    | 'PausePlayback'
    | 'StopPlaybackAndRemoveNotification'
    | 'ResumeAfterReconnect';
  alwaysPauseOnInterruption?: boolean;
  stopForegroundGracePeriod?: number; // milliseconds
}

export interface BufferConfig {
  minBuffer?: number;  // milliseconds
  maxBuffer?: number;  // milliseconds
  playBuffer?: number; // milliseconds
  backBuffer?: number; // milliseconds
}

export interface SetupOptions {
  // Audio attributes
  audioUsage?: string;
  audioContentType?: string;

  // Buffer config
  bufferConfig?: BufferConfig;

  // Wake mode
  wakeMode?: number;

  // Android lifecycle
  android?: AndroidOptions;

  // Cache size
  sizeMB?: number;
  sizeBytes?: number;
}

export type Capability =
  | 'play' | 'pause' | 'stop'
  | 'skipToNext' | 'skipToPrevious'
  | 'seekTo' | 'setRating'
  | 'like' | 'dislike' | 'bookmark'
  | 'jumpForward' | 'jumpBackward';

export interface UpdateOptions {
  // Audio attributes
  audioUsage?: string;
  audioContentType?: string;

  // RNTP: Capabilities
  capabilities?: Capability[];
  notificationCapabilities?: string[];
  compactCapabilities?: string[];

  // RNTP: Notification styling
  color?: string; // hex color
  icon?: string;  // drawable resource name

  // RNTP: Jump intervals (seconds)
  forwardJumpInterval?: number;
  backwardJumpInterval?: number;

  // RNTP: Rating
  ratingType?: string;

  // RNTP: Progress update
  progressUpdateEventInterval?: number; // milliseconds

  // Android lifecycle
  android?: AndroidOptions;

  // Buffer config
  bufferConfig?: BufferConfig;

  // Wake mode
  wakeMode?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPES (MAVIN — camelCase / onXxx)
// ═══════════════════════════════════════════════════════════════════════════

export enum MavinEvent {
  // Playback
  PlaybackStateChanged       = 'onPlaybackStateChanged',
  TrackChanged               = 'onTrackChanged',
  PlaybackActiveTrackChanged = 'onPlaybackActiveTrackChanged',
  PlaybackQueueEnded         = 'onPlaybackQueueEnded',
  PlaybackPlayWhenReadyChanged = 'onPlaybackPlayWhenReadyChanged',
  PlaybackError              = 'onError',
  PlaybackProgress           = 'onProgress',

  // DSP / Hardware
  Spectrum          = 'onSpectrum',           // ← correct name (not SpectrumData)
  PeakMeter         = 'onPeakMeter',
  ReplayGainApplied = 'onReplayGainApplied',
  UsbDacConnected   = 'onUsbDacConnected',
  UsbDacDisconnected = 'onUsbDacDisconnected',

  // Audio Focus — two separate events (no single AudioFocusChanged)
  AudioFocusLost    = 'onAudioFocusLost',
  AudioFocusGranted = 'onAudioFocusGranted',

  // Remote Controls
  RemotePlay        = 'onRemotePlay',
  RemotePause       = 'onRemotePause',
  RemoteStop        = 'onRemoteStop',
  RemoteNext        = 'onRemoteNext',
  RemotePrevious    = 'onRemotePrevious',
  RemoteSeek        = 'onRemoteSeek',
  RemoteSkip        = 'onRemoteSkip',
  RemotePlayId      = 'onRemotePlayId',
  RemotePlaySearch  = 'onRemotePlaySearch',
  RemoteSetRating   = 'onRemoteSetRating',
  RemoteJumpForward  = 'onRemoteJumpForward',  // ← individual (not RemoteJump)
  RemoteJumpBackward = 'onRemoteJumpBackward', // ← individual (not RemoteJump)
  RemoteDuck        = 'onRemoteDuck',

  // Metadata — two separate events (no single MetadataReceived)
  AudioCommonMetadataReceived = 'onAudioCommonMetadataReceived',
  AudioTimedMetadataReceived  = 'onAudioTimedMetadataReceived',
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPES (RNTP PARITY — kebab-case)
// ═══════════════════════════════════════════════════════════════════════════

export enum RNTPEvent {
  PlaybackState           = 'playback-state',
  PlaybackTrackChanged    = 'playback-track-changed',
  PlaybackQueueEnded      = 'playback-queue-ended',
  PlaybackError           = 'playback-error',
  PlaybackProgressUpdated = 'playback-progress-updated',
  PlaybackMetadataReceived = 'playback-metadata-received',

  RemotePlay     = 'remote-play',
  RemotePause    = 'remote-pause',
  RemoteStop     = 'remote-stop',
  RemoteNext     = 'remote-next',
  RemotePrevious = 'remote-previous',
  RemoteSeek     = 'remote-seek',
  RemoteSetRating = 'remote-set-rating',

  // RNTP uses Like/Dislike/Bookmark rather than JumpForward/JumpBackward
  RemoteLike     = 'remote-like',
  RemoteDislike  = 'remote-dislike',
  RemoteBookmark = 'remote-bookmark',
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT PAYLOAD TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PlaybackStateChangedEvent {
  state: State | string;
}

export interface TrackChangedEvent {
  index: number;
}

export interface PlaybackActiveTrackChangedEvent {
  index: number;
  track: Track | null;
}

export interface PlaybackQueueEndedEvent {
  position: number; // milliseconds
}

export interface PlaybackErrorEvent {
  message: string;
  code: string;
  isPlaybackError?: boolean;
  isRemoteError?: boolean;
}

export interface ProgressEvent {
  position: number; // milliseconds
  duration: number; // milliseconds
  buffered: number; // milliseconds
}

export interface SpectrumEvent {
  magnitudes: number[];
}

export interface PeakMeterEvent {
  left: number;
  right: number;
}

export interface ReplayGainAppliedEvent {
  trackGain?: number;
  albumGain?: number;
  appliedDb: number;
}

export interface AudioFocusEvent {
  // 'loss' = permanent, 'transient' = brief, 'duck' = volume reduction
  type: 'loss' | 'transient' | 'duck';
}

export interface RemoteSeekEvent {
  position: number; // milliseconds
}

export interface RemoteSkipEvent {
  index: number;
}

export interface RemoteSetRatingEvent {
  rating: number; // 0.0 - 1.0 normalised
}

export interface RemoteJumpEvent {
  interval: number; // seconds
}

export interface RemoteDuckEvent {
  permanent: boolean;
  paused: boolean;
}

export interface MetadataEvent {
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE MODULE EVENT MAP
// Required for Expo's EventEmitter type safety
// ═══════════════════════════════════════════════════════════════════════════

export type MavinPlayerEvents = {
  // ── Mavin events (camelCase / onXxx) ────────────────────────────────────
  [MavinEvent.PlaybackStateChanged]:        (event: PlaybackStateChangedEvent) => void;
  [MavinEvent.TrackChanged]:                (event: TrackChangedEvent) => void;
  [MavinEvent.PlaybackActiveTrackChanged]:  (event: PlaybackActiveTrackChangedEvent) => void;
  [MavinEvent.PlaybackQueueEnded]:          (event: PlaybackQueueEndedEvent) => void;
  [MavinEvent.PlaybackPlayWhenReadyChanged]:(event: { playWhenReady: boolean }) => void;
  [MavinEvent.PlaybackError]:               (event: PlaybackErrorEvent) => void;
  [MavinEvent.PlaybackProgress]:            (event: ProgressEvent) => void;
  [MavinEvent.Spectrum]:                    (event: SpectrumEvent) => void;
  [MavinEvent.PeakMeter]:                   (event: PeakMeterEvent) => void;
  [MavinEvent.ReplayGainApplied]:           (event: ReplayGainAppliedEvent) => void;
  [MavinEvent.UsbDacConnected]:             (event: DacInfo) => void;
  [MavinEvent.UsbDacDisconnected]:          (event: Record<string, never>) => void;
  [MavinEvent.AudioFocusLost]:              (event: AudioFocusEvent) => void;
  [MavinEvent.AudioFocusGranted]:           (event: Record<string, never>) => void;
  [MavinEvent.RemotePlay]:                  (event: Record<string, never>) => void;
  [MavinEvent.RemotePause]:                 (event: Record<string, never>) => void;
  [MavinEvent.RemoteStop]:                  (event: Record<string, never>) => void;
  [MavinEvent.RemoteNext]:                  (event: Record<string, never>) => void;
  [MavinEvent.RemotePrevious]:              (event: Record<string, never>) => void;
  [MavinEvent.RemoteSeek]:                  (event: RemoteSeekEvent) => void;
  [MavinEvent.RemoteSkip]:                  (event: RemoteSkipEvent) => void;
  [MavinEvent.RemotePlayId]:                (event: { id: string }) => void;
  [MavinEvent.RemotePlaySearch]:            (event: { query: string; extras: Record<string, unknown> }) => void;
  [MavinEvent.RemoteSetRating]:             (event: RemoteSetRatingEvent) => void;
  [MavinEvent.RemoteJumpForward]:           (event: RemoteJumpEvent) => void;
  [MavinEvent.RemoteJumpBackward]:          (event: RemoteJumpEvent) => void;
  [MavinEvent.RemoteDuck]:                  (event: RemoteDuckEvent) => void;
  [MavinEvent.AudioCommonMetadataReceived]: (event: MetadataEvent) => void;
  [MavinEvent.AudioTimedMetadataReceived]:  (event: MetadataEvent) => void;

  // ── RNTP parity events (kebab-case) ─────────────────────────────────────
  [RNTPEvent.PlaybackState]:           (event: { state: number; stateName?: string }) => void;
  [RNTPEvent.PlaybackTrackChanged]:    (event: { track: Track | null; index: number }) => void;
  [RNTPEvent.PlaybackQueueEnded]:      (event: { position: number }) => void;
  [RNTPEvent.PlaybackError]:           (event: PlaybackErrorEvent) => void;
  [RNTPEvent.PlaybackProgressUpdated]: (event: ProgressEvent) => void;
  [RNTPEvent.PlaybackMetadataReceived]:(event: MetadataEvent) => void;
  [RNTPEvent.RemotePlay]:              (event: Record<string, never>) => void;
  [RNTPEvent.RemotePause]:             (event: Record<string, never>) => void;
  [RNTPEvent.RemoteStop]:              (event: Record<string, never>) => void;
  [RNTPEvent.RemoteNext]:              (event: Record<string, never>) => void;
  [RNTPEvent.RemotePrevious]:          (event: Record<string, never>) => void;
  [RNTPEvent.RemoteSeek]:              (event: { position: number }) => void;
  [RNTPEvent.RemoteSetRating]:         (event: { rating: number }) => void;
  [RNTPEvent.RemoteLike]:              (event: Record<string, never>) => void;
  [RNTPEvent.RemoteDislike]:           (event: Record<string, never>) => void;
  [RNTPEvent.RemoteBookmark]:          (event: Record<string, never>) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE MODULE CLASS DECLARATION
// Extends NativeModule with typed events
// ═══════════════════════════════════════════════════════════════════════════

export declare class MavinPlayerNativeModule extends NativeModule<MavinPlayerEvents> {

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────
  initPlayer(options?: SetupOptions | null): Promise<void>;
  setupPlayer(options?: SetupOptions | null): Promise<void>; // RNTP alias
  release(): Promise<void>;
  destroy(): Promise<void>;   // RNTP alias
  stopService(): Promise<void>;

  // ── PLAYBACK CONTROL ──────────────────────────────────────────────────────
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<void>;
  seekTo(ms: number): Promise<void>;
  seekBy(offsetMs: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  skipToIndex(index: number, initialPositionMs?: number): Promise<void>;
  skip(seconds: number): Promise<void>;
  setVolume(vol: number): Promise<void>;
  setRepeatMode(mode: RepeatMode | number): Promise<void>;
  setShuffleMode(enabled: boolean): Promise<void>;

  // ── ERROR RECOVERY ────────────────────────────────────────────────────────
  retry(): Promise<void>;
  retryWithFallback(fallbackUri: string): Promise<void>;

  // ── QUEUE MANAGEMENT ──────────────────────────────────────────────────────
  load(track: Track): Promise<void>;
  setQueue(tracks: Track[], startIndex?: number): Promise<void>;
  add(tracks: Track | Track[], insertBeforeIndex?: number): Promise<void>;
  addToQueue(track: Track): Promise<void>;
  addToQueueAt(track: Track, index: number): Promise<void>;
  remove(indices: number | number[]): Promise<void>;
  removeTrack(index: number): Promise<void>;
  removeUpcomingTracks(): Promise<void>;
  moveTrack(fromIndex: number, toIndex: number): Promise<void>;
  updateMetadataForTrack(index: number, track: Partial<Track>): Promise<void>;
  updateTrack(index: number, track: Partial<Track>): Promise<void>;
  getTrack(index: number): Promise<Track | null>;
  getQueue(): Promise<Track[]>;
  updateNowPlayingMetadata(track: Partial<Track>): Promise<void>;

  // ── STATE GETTERS ─────────────────────────────────────────────────────────
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getBufferedPosition(): Promise<number>;
  getCurrentTrack(): Promise<Track | null>;
  getActiveTrack(): Promise<Track | null>;
  getActiveTrackIndex(): Promise<number | null>;
  isPlaying(): Promise<boolean>;
  getQueueSize(): Promise<number>;
  getProgress(): Promise<Progress>;
  getPlaybackState(): Promise<PlaybackState>;
  getVolume(): Promise<number>;
  getRepeatMode(): Promise<RepeatMode>;
  getShuffleMode(): Promise<boolean>;
  getAudioFocus(): Promise<boolean>;

  // ── PLAY-WHEN-READY ───────────────────────────────────────────────────────
  setPlayWhenReady(playWhenReady: boolean): Promise<void>;
  getPlayWhenReady(): Promise<boolean>;

  // ── SPEED / PITCH ─────────────────────────────────────────────────────────
  setPlaybackSpeed(speed: number): Promise<void>;
  getPlaybackSpeed(): Promise<number>;
  setPlaybackPitch(pitch: number): Promise<void>;
  getPlaybackPitch(): Promise<number>;
  setPlaybackParameters(speed: number, pitch: number): Promise<void>;
  getRate(): Promise<number>;         // RNTP alias for getPlaybackSpeed
  setRate(rate: number): Promise<void>; // RNTP alias for setPlaybackSpeed

  // ── PRELOADING ────────────────────────────────────────────────────────────
  preload(track: Track): Promise<void>;
  setPreloadStrategy(strategy: PreloadStrategy): Promise<void>;
  getCacheStats(): Promise<CacheStats>;

  // ── EQ: GRAPHIC ───────────────────────────────────────────────────────────
  setEQEnabled(enabled: boolean): Promise<void>;
  isEQEnabled(): Promise<boolean>;
  setEQBand(band: number, gainDb: number): Promise<void>;
  applyEQBands(gains: number[]): Promise<void>;
  setEQPreamp(gainDb: number): Promise<void>;
  setEQBandQ(band: number, q: number): Promise<void>;
  resetEQ(): Promise<void>;
  getEQGains(): Promise<EqBandInfo[]>;
  getEQPreamp(): Promise<number>;
  getEQQValues(): Promise<Array<{ band: number; q: number }>>;

  // ── EQ: MODE & ADVANCED ───────────────────────────────────────────────────
  setEQMode(mode: EqMode): Promise<void>;
  getEQMode(): Promise<EqMode>;
  getLoudnessDb(): Promise<number>;

  // ── EQ: PARAMETRIC ────────────────────────────────────────────────────────
  setParametricBandGain(band: number, gainDb: number): Promise<void>;
  applyParametricBands(gains: number[]): Promise<void>;
  setParametricBandFreq(band: number, freqHz: number): Promise<void>;
  resetParametric(): Promise<void>;
  getParametricGains(): Promise<EqBandInfo[]>;
  getParametricFreqs(): Promise<Array<{ band: number; freqHz: number }>>;

  // ── DITHER / SMOOTHING ────────────────────────────────────────────────────
  setDitherMode(mode: DitherMode): Promise<void>;
  getDitherMode(): Promise<DitherMode>;
  setSmoothingRamp(ms: number): Promise<void>;

  // ── COMPRESSOR (DRC) ──────────────────────────────────────────────────────
  setCompressorEnabled(enabled: boolean): Promise<void>;
  isCompressorEnabled(): Promise<boolean>;
  setCompressorThreshold(db: number): Promise<void>;
  setCompressorRatio(ratio: number): Promise<void>;
  setCompressorAttack(ms: number): Promise<void>;
  setCompressorRelease(ms: number): Promise<void>;
  setCompressorKnee(db: number): Promise<void>;
  setCompressorMakeupGain(db: number): Promise<void>;
  getCompressorReduction(): Promise<number>;
  getCompressorThreshold(): Promise<number>;
  getCompressorRatio(): Promise<number>;
  getCompressorAttack(): Promise<number>;
  getCompressorRelease(): Promise<number>;

  // ── CROSSFADE ─────────────────────────────────────────────────────────────
  setCrossfadeEnabled(enabled: boolean): Promise<void>;
  isCrossfadeEnabled(): Promise<boolean>;
  setCrossfadeDuration(ms: number): Promise<void>;
  getCrossfadeDuration(): Promise<number>;

  // ── CROSSFEED ─────────────────────────────────────────────────────────────
  setCrossfeedEnabled(enabled: boolean): Promise<void>;
  isCrossfeedEnabled(): Promise<boolean>;
  setCrossfeedStrength(strength: number): Promise<void>;
  setCrossfeedCutoff(hz: number): Promise<void>;
  getCrossfeedStrength(): Promise<number>;
  getCrossfeedCutoff(): Promise<number>;
  setCrossfeedDelayMs(ms: number): Promise<void>;
  getCrossfeedDelayMs(): Promise<number>;

  // ── REPLAY GAIN ───────────────────────────────────────────────────────────
  setReplayGainMode(mode: ReplayGainMode): Promise<void>;
  setReplayGainPreamp(gainDb: number): Promise<void>;
  setReplayGainFromMap(tags: Record<string, string>): Promise<void>;
  getReplayGainInfo(): Promise<ReplayGainInfo>;

  // ── PEAK METER ────────────────────────────────────────────────────────────
  setPeakHoldMs(ms: number): Promise<void>;
  setPeakReleaseMs(ms: number): Promise<void>;
  getCurrentPeaks(): Promise<PeakMeter>;
  getHeldPeaks(): Promise<PeakMeter>;
  resetPeaks(): Promise<void>;

  // ── CONVOLUTION ───────────────────────────────────────────────────────────
  loadImpulseResponse(filePath: string): Promise<void>;
  clearImpulseResponse(): Promise<void>;
  isImpulseResponseLoaded(): Promise<boolean>;
  getIrLength(): Promise<number>;
  setConvolutionEnabled(enabled: boolean): Promise<void>;
  isConvolutionEnabled(): Promise<boolean>;

  // ── FX PROCESSOR ──────────────────────────────────────────────────────────
  setFxEnabled(enabled: boolean): Promise<void>;
  isFxEnabled(): Promise<boolean>;
  setFxMode(mode: FxMode): Promise<void>;
  getFxMode(): Promise<FxMode>;
  setFxMix(mix: number): Promise<void>;
  getFxMix(): Promise<number>;
  setFxBypass(bypass: boolean): Promise<void>;
  isFxBypassed(): Promise<boolean>;

  // ── FX: REVERB ────────────────────────────────────────────────────────────
  setReverbRoomSize(value: number): Promise<void>;
  setReverbDecay(value: number): Promise<void>;
  setReverbPreDelay(value: number): Promise<void>;
  setReverbDamping(value: number): Promise<void>;

  // ── FX: DELAY ─────────────────────────────────────────────────────────────
  setDelayTime(value: number): Promise<void>;
  setDelayFeedback(value: number): Promise<void>;
  setDelayLowCut(value: number): Promise<void>;
  setDelayHighCut(value: number): Promise<void>;

  // ── FX: MODULATION ────────────────────────────────────────────────────────
  setModRate(value: number): Promise<void>;
  setModDepth(value: number): Promise<void>;
  setModPhase(value: number): Promise<void>;
  setModFeedback(value: number): Promise<void>;

  // ── PRESETS ───────────────────────────────────────────────────────────────
  applyPreset(name: string): Promise<void>;
  savePreset(name: string): Promise<void>;
  listPresets(): Promise<string[]>;
  deletePreset(name: string): Promise<boolean>;
  exportPreset(name: string): Promise<string | null>;
  importPreset(json: string): Promise<void>;
  assignTrackPreset(mediaId: string, presetName: string | null): Promise<void>;
  getTrackPreset(mediaId: string): Promise<string | null>;
  setAutoSwitchPresets(enabled: boolean): Promise<void>;

  // ── SPECTRUM / AUTO-EQ ────────────────────────────────────────────────────
  getSpectrumMagnitudes(): Promise<Array<{ bin: number; magnitude: number }>>;
  computeAutoEQ(): Promise<Array<{ band: number; gain: number; freqHz: number }>>;

  // ── USB DAC ───────────────────────────────────────────────────────────────
  isUsbDacConnected(): Promise<boolean>;
  getCurrentDacInfo(): Promise<DacInfo | null>;
  getDacCapabilities(): Promise<DacCapabilities | null>;
  enableDirectUsbRouting(enabled: boolean): Promise<boolean>;
  isDirectUsbRoutingEnabled(): Promise<boolean>;
  setPreferredDacSampleRate(rate: number): Promise<boolean>;
  setPreferredDacBitDepth(depth: number): Promise<boolean>;
  rescanUsbDevices(): Promise<void>;

  // ── AUDIO FORMAT ──────────────────────────────────────────────────────────
  getAudioCapabilities(): Promise<AudioCapabilities | null>;
  getOptimalAudioFormat(): Promise<OptimalAudioFormat | null>;
  isHiResAudioCapable(): Promise<boolean>;
  getMaxSampleRate(): Promise<number>;
  getMaxBitDepth(): Promise<number>;

  // ── OFFLINE / 64-BIT ──────────────────────────────────────────────────────
  setOfflineMode(enabled: boolean): Promise<void>;
  isOfflineMode(): Promise<boolean>;
  set64BitProcessingEnabled(enabled: boolean): Promise<void>;
  is64BitProcessingEnabled(): Promise<boolean>;

  // ── CONFIGURATION ─────────────────────────────────────────────────────────
  updateOptions(options: UpdateOptions): Promise<void>;
  setProgressUpdateInterval(ms: number): Promise<void>;
  getProgressUpdateInterval(): Promise<number>;
  setCacheConfig(options: { sizeMB?: number; sizeBytes?: number }): Promise<void>;
  setAudioAttributes(options: { usage?: string; contentType?: string }): Promise<void>;
  setWakeMode(mode: number): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE & SYNC TYPES (for preset management)
// ═══════════════════════════════════════════════════════════════════════════

export interface PresetStorageAdapter {
  initialize(): Promise<void>;
  getAllPresets(): Promise<EqPreset[]>;
  getUserPresets(): Promise<EqPreset[]>;
  getPresetById(id: string): Promise<EqPreset | null>;
  savePreset(preset: EqPreset): Promise<void>;
  deletePreset(id: string): Promise<boolean>;
  updatePreset(id: string, updates: Partial<EqPreset>): Promise<EqPreset | null>;
  toggleFavorite(id: string): Promise<boolean>;
  getFavorites(): Promise<EqPreset[]>;
  setLastUsed(id: string): Promise<void>;
  getLastUsed(): Promise<string | null>;
  exportPresets(): Promise<string>;
  importPresets(jsonString: string): Promise<number>;
}

export interface SupabasePresetRow {
  id: string;
  user_id: string;
  name: string;
  type: 'graphic_31band' | 'biquad' | 'parametric';
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  gains_31?: number[];
  biquad_filters?: EqBiquadFilter[];
  preamp_db?: number;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// REACT HOOK TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface UseProgressOptions {
  intervalMs?: number;
  enabled?: boolean;
}

export interface UsePlaybackStateResult {
  state: PlaybackState;
  isLoading: boolean;
  error: Error | null;
}

export interface UseActiveTrackResult {
  track: Track | null;
  index: number | null;
  isLoading: boolean;
}

export interface UseSpectrumOptions {
  enabled?: boolean;
  intervalMs?: number;
  useAnimationFrame?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export type EventName = MavinEvent | RNTPEvent | string;

export interface EventSubscription {
  remove: () => void;
}

export type Listener<T extends keyof MavinPlayerEvents> = MavinPlayerEvents[T];