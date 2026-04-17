// modules/mavin-player/types.ts
// Complete TypeScript type definitions for MavinPlayer native module
// MATCHES: MavinPlayerModule.kt exactly

import type { NativeModule, EventSubscription as ExpoEventSubscription } from 'expo-modules-core';

// ═══════════════════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

// ═══════════════════════════════════════════════════════════════════════════
// TRACK TYPES - Must match TrackMetadata in Kotlin exactly
// ═══════════════════════════════════════════════════════════════════════════

export interface Track {
  // Required
  id: string;
  /** @deprecated Use url instead - kept for compatibility */
  uri?: string;
  url: string;

  // Optional metadata
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;       // seconds (native uses seconds)
  genre?: string;
  description?: string;
  date?: string;
  rating?: number;
  isLiveStream?: boolean;

  // Track type hints
  type?: 'default' | 'hls' | 'dash' | 'smoothstreaming';
  
  // Headers and user agent
  headers?: Record<string, string>;
  userAgent?: string;
  contentType?: string;
  pitchAlgorithm?: 'linear' | 'music' | 'voice';

  // DRM configuration
  drm?: {
    type: 'widevine' | 'playready' | 'clearkey';
    licenseServer: string;
    headers?: Record<string, string>;
    multiSession?: boolean;
  };

  // Chapters (v2)
  chapters?: Array<{
    title: string;
    startTime: number;  // seconds
    endTime?: number;   // seconds
    artwork?: string;
  }>;

  // Lyrics (v2)
  lyrics?: Array<{
    text: string;
    time?: number;  // seconds, null for plain lyrics
  }>;
  lyricsUrl?: string;
  waveformUrl?: string;

  // ReplayGain tags (v2)
  trackGain?: number;
  albumGain?: number;
  trackPeak?: number;
  albumPeak?: number;

  // Allow extra fields
  [key: string]: unknown;
}

// Video track (separate from audio Track)
export interface VideoTrack {
  id: string;
  url: string;
  muxedUrl?: string;
  title?: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  uploaderUrl?: string;
  likeCount?: number;
  dislikeCount?: number;
  viewCount?: number;
  commentsCount?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK STATE TYPES - Native uses string state names
// ═══════════════════════════════════════════════════════════════════════════

export type PlaybackStateName = 
  | 'none'
  | 'idle'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'buffering'
  | 'loading'
  | 'connection-error'
  | 'error'
  | 'ended';

export interface PlaybackState {
  state: PlaybackStateName;
  stateCode: number;
  error?: {
    code: string;
    message: string;
  } | null;
}

// Progress in SECONDS (native uses seconds, not milliseconds)
export interface Progress {
  position: number; // seconds
  duration: number; // seconds
  buffered: number; // seconds
  track?: number;   // track index (added in v2)
}

export interface PeakMeter {
  left: number;
  right: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPEAT & SHUFFLE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum RepeatMode {
  Off = 0,
  Track = 1,
  Queue = 2,
}

export type ShuffleMode = boolean;  // Native uses boolean, not string

// ═══════════════════════════════════════════════════════════════════════════
// EQ TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const ISO_FREQ_CENTERS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const;

export type IsoFreqIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
  20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

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

export type EqMode = 'GRAPHIC' | 'PARAMETRIC' | 'PARALLEL';
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
    | 'StopPlaybackAndRemoveNotification';
  alwaysPauseOnInterruption?: boolean;
  stopForegroundGracePeriod?: number; // milliseconds
}

export interface BufferConfig {
  minBuffer?: number;  // milliseconds
  maxBuffer?: number;  // milliseconds
  playBuffer?: number; // milliseconds
  backBuffer?: number; // milliseconds
}

export interface FeedbackOptions {
  isActive: boolean;
  title: string;
}

export interface SetupOptions {
  // Audio attributes
  audioUsage?: string;
  audioContentType?: 'music' | 'speech' | 'movie' | 'sonification' | 'unknown';

  // Buffer config
  bufferConfig?: BufferConfig;
  minBuffer?: number;   // ms (legacy)
  maxBuffer?: number;   // ms (legacy)
  playBuffer?: number;  // ms (legacy)
  playbackBuffer?: number;  // ms (alias)
  playbackBufferAfterRebuffer?: number; // ms
  backBuffer?: number;  // ms (legacy)

  // Wake mode
  wakeMode?: number;

  // Android lifecycle
  android?: AndroidOptions;

  // Cache size in KB (RNTP spec)
  maxCacheSize?: number;  // KB

  // Capabilities
  capabilities?: string[];
  compactCapabilities?: string[];
  notificationCapabilities?: string[];

  // Notification styling
  color?: string; // hex color
  icon?: string;  // drawable resource name
  playIcon?: string;
  pauseIcon?: string;
  stopIcon?: string;
  previousIcon?: string;
  nextIcon?: string;
  rewindIcon?: string;
  forwardIcon?: string;

  // Jump intervals (seconds in JS, converted to ms in native)
  jumpInterval?: number;           // seconds (legacy)
  forwardJumpInterval?: number;    // seconds
  backwardJumpInterval?: number;   // seconds

  // Rating
  ratingType?: number;

  // Progress update interval (seconds in JS, converted to ms in native)
  progressUpdateEventInterval?: number; // seconds

  // Behavior flags
  autoWait?: boolean;
  autoUpdateMetadata?: boolean;
  stopWithApp?: boolean;
  alwaysPauseOnInterruption?: boolean;
  autoHandleInterruptions?: boolean;
  waitForBuffer?: boolean;

  // Feedback options
  likeOptions?: FeedbackOptions;
  dislikeOptions?: FeedbackOptions;
  bookmarkOptions?: FeedbackOptions;

  // v2 features
  gaplessEnabled?: boolean;
  persistQueue?: boolean;
  persistPosition?: boolean;
  outputProfile?: 'headphone' | 'speaker' | 'bluetooth' | 'usb' | 'default';
  dvcEnabled?: boolean;
  resamplerQuality?: 'low' | 'medium' | 'high' | 'ultra';
  targetResampleRateHz?: number;
}

export type Capability =
  | 'play' | 'pause' | 'stop'
  | 'skipToNext' | 'skipToPrevious'
  | 'seekTo' | 'setRating'
  | 'like' | 'dislike' | 'bookmark'
  | 'jumpForward' | 'jumpBackward';

export interface UpdateOptions {
  // Same as SetupOptions but for runtime updates
  [key: string]: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT NAMES - Must match native event names exactly
// ═══════════════════════════════════════════════════════════════════════════

export enum MavinEvent {
  // Playback state events (kebab-case to match native)
  PlaybackState = 'playback-state',
  PlaybackTrackChanged = 'playback-track-changed',
  PlaybackActiveTrackChanged = 'playback-active-track-changed',
  PlaybackQueueEnded = 'playback-queue-ended',
  PlaybackError = 'playback-error',
  PlaybackProgressUpdated = 'playback-progress-updated',
  PlaybackPlayWhenReadyChanged = 'playback-play-when-ready-changed',
  PlaybackSpeedChanged = 'playback-speed-changed',
  PlaybackPitchChanged = 'playback-pitch-changed',
  PlaybackPositionBookmarked = 'playback-position-bookmarked',

  // Metadata events
  PlaybackMetadataReceived = 'playback-metadata-received',
  AudioCommonMetadataReceived = 'audio-common-metadata-received',
  AudioTimedMetadataReceived = 'audio-timed-metadata-received',
  AudioChapterMetadataReceived = 'audio-chapter-metadata-received',
  ChapterChanged = 'chapter-changed',

  // Remote events
  RemotePlay = 'remote-play',
  RemotePause = 'remote-pause',
  RemoteStop = 'remote-stop',
  RemoteNext = 'remote-next',
  RemotePrevious = 'remote-previous',
  RemoteSeek = 'remote-seek',
  RemoteJumpForward = 'remote-jump-forward',
  RemoteJumpBackward = 'remote-jump-backward',
  RemoteSetRating = 'remote-set-rating',
  RemoteLike = 'remote-like',
  RemoteDislike = 'remote-dislike',
  RemoteBookmark = 'remote-bookmark',
  RemoteDuck = 'remote-duck',
  RemoteSkip = 'remote-skip',
  RemoteMute = 'remote-mute',
  RemoteUnmute = 'remote-unmute',
  RemotePlayFromId = 'remote-play-from-id',
  RemotePlayFromSearch = 'remote-play-from-search',

  // DSP events
  PeakMeterUpdate = 'peak-meter-update',

  // Sleep timer
  SleepTimerFired = 'sleep-timer-fired',

  // Audio device events
  BluetoothDeviceConnected = 'bluetooth-device-connected',
  BluetoothDeviceDisconnected = 'bluetooth-device-disconnected',
  HeadphonesConnected = 'headphones-connected',
  HeadphonesDisconnected = 'headphones-disconnected',

  // Network
  NetworkQualityChanged = 'network-quality-changed',

  // Output profile
  OutputProfileChanged = 'output-profile-changed',

  // v3 additions
  WakeUpTimerFired = 'wake-up-timer-fired',
  RmsMeterUpdate = 'rms-meter-update',
  BpmDetected = 'bpm-detected',
  FrcPresetChanged = 'frc-preset-changed',
  SurroundModeChanged = 'surround-mode-changed',
  AutomixTransition = 'automix-transition',
  AbsoluteVolumeChanged = 'absolute-volume-changed',
  PipelineModeChanged = 'pipeline-mode-changed',
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT PAYLOAD TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PlaybackStateChangedEvent {
  state: PlaybackStateName;
  stateCode: number;
}

export interface TrackChangedEvent {
  track?: number | null;      // previous track index
  position: number;           // seconds
  nextTrack?: number | null;  // next track index
}

export interface PlaybackActiveTrackChangedEvent {
  index: number | null;
  track: Track | null;
  lastIndex?: number | null;
  lastTrack?: Track | null;
  lastPosition: number;  // seconds
  nextTrack?: Track | null;
  nextIndex?: number | null;
}

export interface PlaybackQueueEndedEvent {
  track?: Track | null;
  position: number;  // seconds
}

export interface PlaybackErrorEvent {
  code: string;
  message: string;
  isPlaybackError?: boolean;
  isRemoteError?: boolean;
}

export interface ProgressEvent {
  position: number;  // seconds
  duration: number;  // seconds
  buffered: number;  // seconds
  track?: number;    // track index
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

export interface RemoteSeekEvent {
  position: number;  // seconds
}

export interface RemoteSkipEvent {
  index: number;
}

export interface RemoteSetRatingEvent {
  rating: number;  // 0.0 - 1.0 normalised
}

export interface RemoteJumpEvent {
  interval: number;  // seconds
}

export interface RemoteDuckEvent {
  paused: boolean;
  permanent: boolean;
}

export interface MetadataEvent {
  metadata: Record<string, unknown>;
}

export interface ChapterChangedEvent {
  index?: number | null;
  title?: string;
  startTime?: number;  // seconds
  endTime?: number;    // seconds
  artwork?: string;
}

export interface NetworkQualityEvent {
  estimatedBandwidthBps: number;
  quality: 'unknown' | 'poor' | 'fair' | 'good' | 'excellent';
}

export interface PositionBookmarkedEvent {
  trackId: string;
  position: number;  // seconds
}

export interface OutputProfileChangedEvent {
  profile: string;
}

export interface WakeUpTimerFiredEvent {
  trackId?: string | null;
}

export interface RmsMeterEvent {
  rmsLeft: number;
  rmsRight: number;
  peakLeft: number;
  peakRight: number;
  lufs: number;
}

export interface BpmDetectedEvent {
  trackId: string;
  bpm: number;
}

export interface FrcPresetChangedEvent {
  presetName: string | null;
}

export interface SurroundModeChangedEvent {
  mode: string;
}

export interface AutomixTransitionEvent {
  fromTrackId: string;
  toTrackId: string;
  positionSeconds: number;
}

export interface AbsoluteVolumeChangedEvent {
  enabled: boolean;
}

export interface PipelineModeChangedEvent {
  mode: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE MODULE EVENT MAP
// ═══════════════════════════════════════════════════════════════════════════

export type MavinPlayerEvents = {
  // Playback state
  [MavinEvent.PlaybackState]: (event: PlaybackStateChangedEvent) => void;
  [MavinEvent.PlaybackTrackChanged]: (event: TrackChangedEvent) => void;
  [MavinEvent.PlaybackActiveTrackChanged]: (event: PlaybackActiveTrackChangedEvent) => void;
  [MavinEvent.PlaybackQueueEnded]: (event: PlaybackQueueEndedEvent) => void;
  [MavinEvent.PlaybackError]: (event: PlaybackErrorEvent) => void;
  [MavinEvent.PlaybackProgressUpdated]: (event: ProgressEvent) => void;
  [MavinEvent.PlaybackPlayWhenReadyChanged]: (event: { playWhenReady: boolean; reason: string }) => void;
  [MavinEvent.PlaybackSpeedChanged]: (event: { speed: number }) => void;
  [MavinEvent.PlaybackPitchChanged]: (event: { pitch: number }) => void;
  [MavinEvent.PlaybackPositionBookmarked]: (event: PositionBookmarkedEvent) => void;

  // Metadata
  [MavinEvent.PlaybackMetadataReceived]: (event: MetadataEvent) => void;
  [MavinEvent.AudioCommonMetadataReceived]: (event: MetadataEvent) => void;
  [MavinEvent.AudioTimedMetadataReceived]: (event: MetadataEvent) => void;
  [MavinEvent.AudioChapterMetadataReceived]: (event: MetadataEvent) => void;
  [MavinEvent.ChapterChanged]: (event: ChapterChangedEvent) => void;

  // Remote
  [MavinEvent.RemotePlay]: (event: Record<string, never>) => void;
  [MavinEvent.RemotePause]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteStop]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteNext]: (event: Record<string, never>) => void;
  [MavinEvent.RemotePrevious]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteSeek]: (event: RemoteSeekEvent) => void;
  [MavinEvent.RemoteJumpForward]: (event: RemoteJumpEvent) => void;
  [MavinEvent.RemoteJumpBackward]: (event: RemoteJumpEvent) => void;
  [MavinEvent.RemoteSetRating]: (event: RemoteSetRatingEvent) => void;
  [MavinEvent.RemoteLike]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteDislike]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteBookmark]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteDuck]: (event: RemoteDuckEvent) => void;
  [MavinEvent.RemoteSkip]: (event: RemoteSkipEvent) => void;
  [MavinEvent.RemoteMute]: (event: Record<string, never>) => void;
  [MavinEvent.RemoteUnmute]: (event: Record<string, never>) => void;
  [MavinEvent.RemotePlayFromId]: (event: { id: string; extras: Record<string, unknown> }) => void;
  [MavinEvent.RemotePlayFromSearch]: (event: { query: string; extras: Record<string, unknown> }) => void;

  // DSP
  [MavinEvent.PeakMeterUpdate]: (event: PeakMeterEvent) => void;

  // Sleep timer
  [MavinEvent.SleepTimerFired]: (event: Record<string, never>) => void;

  // Audio devices
  [MavinEvent.BluetoothDeviceConnected]: (event: { deviceName: string }) => void;
  [MavinEvent.BluetoothDeviceDisconnected]: (event: { deviceName: string }) => void;
  [MavinEvent.HeadphonesConnected]: (event: Record<string, never>) => void;
  [MavinEvent.HeadphonesDisconnected]: (event: Record<string, never>) => void;

  // Network
  [MavinEvent.NetworkQualityChanged]: (event: NetworkQualityEvent) => void;

  // Output
  [MavinEvent.OutputProfileChanged]: (event: OutputProfileChangedEvent) => void;

  // v3
  [MavinEvent.WakeUpTimerFired]: (event: WakeUpTimerFiredEvent) => void;
  [MavinEvent.RmsMeterUpdate]: (event: RmsMeterEvent) => void;
  [MavinEvent.BpmDetected]: (event: BpmDetectedEvent) => void;
  [MavinEvent.FrcPresetChanged]: (event: FrcPresetChangedEvent) => void;
  [MavinEvent.SurroundModeChanged]: (event: SurroundModeChangedEvent) => void;
  [MavinEvent.AutomixTransition]: (event: AutomixTransitionEvent) => void;
  [MavinEvent.AbsoluteVolumeChanged]: (event: AbsoluteVolumeChangedEvent) => void;
  [MavinEvent.PipelineModeChanged]: (event: PipelineModeChangedEvent) => void;

  // Fallback
  [key: string]: (event: any) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE MODULE CLASS DECLARATION - Must match native methods exactly
// ═══════════════════════════════════════════════════════════════════════════

export declare class MavinPlayerNativeModule extends NativeModule<MavinPlayerEvents> {
  // ── LIFECYCLE ─────────────────────────────────────────────────────────────
  setupPlayer(options?: SetupOptions | null): Promise<void>;
  destroy(): Promise<void>;
  updateOptions(options: UpdateOptions): Promise<void>;
  isServiceRunning(): Promise<boolean>;

  // ── PLAYBACK CONTROL ──────────────────────────────────────────────────────
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<void>;
  seekTo(positionSeconds: number): Promise<void>;
  seekBy(offsetSeconds: number): Promise<void>;
  skipToNext(initialPositionSeconds?: number): Promise<boolean>;
  skipToPrevious(initialPositionSeconds?: number): Promise<boolean>;
  skip(index: number, positionSeconds?: number): Promise<boolean>;  // skipToIndex
  retry(): Promise<void>;

  // ── PLAY-WHEN-READY ───────────────────────────────────────────────────────
  setPlayWhenReady(playWhenReady: boolean): Promise<void>;
  getPlayWhenReady(): Promise<boolean>;

  // ── QUEUE MANAGEMENT ──────────────────────────────────────────────────────
  load(track: Track): Promise<void>;
  setQueue(tracks: Track[], startIndex?: number, startPositionSeconds?: number): Promise<void>;
  add(tracks: Track | Track[], insertBeforeIndex?: number): Promise<number>;
  remove(indices: number | number[]): Promise<void>;
  removeUpcomingTracks(): Promise<void>;
  removePreviousTracks(): Promise<void>;
  move(fromIndex: number, toIndex: number): Promise<void>;
  updateMetadataForTrack(index: number, metadata: Partial<Track>): Promise<void>;
  updateNowPlayingMetadata(metadata: Partial<Track>): Promise<void>;
  clearNowPlayingMetadata(): Promise<void>;
  preloadNextTrack(track: Track): Promise<void>;
  getPersistedQueue(): Promise<{ tracks: Track[]; currentIndex: number }>;
  restorePersistedQueue(): Promise<void>;

  // ── VIDEO ───────────────────────────────────────────────────────────────────
  loadVideoTrack(videoTrack: VideoTrack, playWhenReady?: boolean): Promise<void>;

  // ── STATE GETTERS ─────────────────────────────────────────────────────────
  getState(): Promise<PlaybackStateName>;
  getPlaybackState(): Promise<PlaybackState>;
  getProgress(): Promise<Progress>;
  getDuration(): Promise<number>;  // seconds
  getPosition(): Promise<number>;  // seconds
  getBufferedPosition(): Promise<number>;  // seconds
  isPlaying(): Promise<boolean>;
  isLoading(): Promise<boolean>;
  getCurrentTrack(): Promise<Track | null>;
  getActiveTrack(): Promise<Track | null>;
  getActiveTrackIndex(): Promise<number | null>;
  getCurrentVideoTrack(): Promise<VideoTrack | null>;
  getTrack(index: number): Promise<Track | null>;
  getQueue(): Promise<Track[]>;

  // ── VOLUME & AUDIO SETTINGS ───────────────────────────────────────────────
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  isMuted(): Promise<boolean>;
  getUnmutedVolume(): Promise<number>;
  getRepeatMode(): Promise<RepeatMode>;
  setRepeatMode(mode: RepeatMode | number): Promise<void>;
  getShuffleMode(): Promise<boolean>;
  setShuffleMode(enabled: boolean): Promise<void>;
  getRate(): Promise<number>;
  setRate(rate: number): Promise<void>;
  getPitch(): Promise<number>;
  setPitch(pitch: number): Promise<void>;
  getTempo(): Promise<number>;
  setTempo(tempo: number): Promise<void>;
  setProgressUpdateInterval(intervalSeconds: number): Promise<void>;
  getProgressUpdateInterval(): Promise<number>;
  getCacheSize(): Promise<number>;

  // ── AUDIO PROCESSING ───────────────────────────────────────────────────────
  setBalance(leftGain: number, rightGain: number): Promise<void>;
  getBalance(): Promise<{ left: number; right: number }>;
  setPan(pan: number): Promise<void>;
  getPan(): Promise<number>;
  setStereoExpansion(expansion: number): Promise<void>;
  getStereoExpansion(): Promise<number>;
  setMonoMix(enabled: boolean): Promise<void>;
  isMonoMix(): Promise<boolean>;
  setBassBoost(gainDb: number): Promise<void>;
  getBassBoost(): Promise<number>;
  setTrebleBoost(gainDb: number): Promise<void>;
  getTrebleBoost(): Promise<number>;
  setLimiterEnabled(enabled: boolean): Promise<void>;
  isLimiterEnabled(): Promise<boolean>;
  setLimiterThreshold(thresholdDb: number): Promise<void>;
  getLimiterThreshold(): Promise<number>;
  setLoudnessNormalizationEnabled(enabled: boolean): Promise<void>;
  isLoudnessNormalizationEnabled(): Promise<boolean>;
  setTargetLufs(lufs: number): Promise<void>;
  getTargetLufs(): Promise<number>;
  setHeadroomGuardEnabled(enabled: boolean): Promise<void>;
  isHeadroomGuardEnabled(): Promise<boolean>;
  setHeadroomGuardThreshold(thresholdDb: number): Promise<void>;
  getHeadroomGuardThreshold(): Promise<number>;
  setPhaseInvert(left: boolean, right: boolean): Promise<void>;
  getPhaseInvert(): Promise<{ left: boolean; right: boolean }>;
  setEqProcessingMode(mode: string): Promise<void>;
  getEqProcessingMode(): Promise<string>;
  setGaplessEnabled(enabled: boolean): Promise<void>;
  isGaplessEnabled(): Promise<boolean>;
  setDvcEnabled(enabled: boolean): Promise<void>;
  isDvcEnabled(): Promise<boolean>;
  setResamplerQuality(quality: string): Promise<void>;
  getResamplerQuality(): Promise<string>;
  setTargetResampleRate(hz: number): Promise<void>;
  getTargetResampleRate(): Promise<number>;
  setOutputProfile(profile: string): Promise<void>;
  getCurrentOutputProfile(): Promise<string>;
  setOutputProfilePreset(profile: string, presetName: string | null): Promise<void>;
  getOutputProfilePreset(profile: string): Promise<string | null>;

  // ── EQ: GRAPHIC ───────────────────────────────────────────────────────────
  setEQEnabled(enabled: boolean): Promise<void>;
  getEQEnabled(): Promise<boolean>;
  setEQBand(band: number, gainDb: number): Promise<void>;
  applyEQBands(gainsDb: number[]): Promise<void>;
  setEQPreamp(gainDb: number): Promise<void>;
  resetEQ(): Promise<void>;
  getEQGains(): Promise<Array<{ band: number; gain: number }>>;
  getEQPreamp(): Promise<number>;
  setEQMode(mode: EqMode | string): Promise<void>;
  getEQMode(): Promise<string>;
  setParametricBandGain(band: number, gainDb: number): Promise<void>;
  applyParametricBands(gainsDb: number[]): Promise<void>;
  setParametricBandFreq(band: number, freqHz: number): Promise<void>;
  getParametricGains(): Promise<Array<{ band: number; gain: number }>>;
  getParametricFreqs(): Promise<Array<{ band: number; freqHz: number }>>;
  setDitherMode(mode: DitherMode | string): Promise<void>;
  getDitherMode(): Promise<string>;
  setSmoothingRamp(ms: number): Promise<void>;
  getLoudnessDb(): Promise<number>;
  getSpectrumMagnitudes(): Promise<Array<{ bin: number; magnitude: number }>>;
  computeAutoEQ(): Promise<Array<{ band: number; gain: number; freqHz: number }>>;

  // ── COMPRESSOR (DRC) ──────────────────────────────────────────────────────
  setCompressorEnabled(enabled: boolean): Promise<void>;
  getCompressorEnabled(): Promise<boolean>;
  setCompressorThreshold(thresholdDb: number): Promise<void>;
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

  // ── CROSSFEED ─────────────────────────────────────────────────────────────
  setCrossfeedEnabled(enabled: boolean): Promise<void>;
  getCrossfeedEnabled(): Promise<boolean>;
  setCrossfeedStrength(strength: number): Promise<void>;
  getCrossfeedStrength(): Promise<number>;
  setCrossfeedCutoff(hz: number): Promise<void>;
  getCrossfeedCutoff(): Promise<number>;
  setCrossfeedDelayMs(ms: number): Promise<void>;
  getCrossfeedDelayMs(): Promise<number>;

  // ── PEAK METER ────────────────────────────────────────────────────────────
  setPeakHoldMs(ms: number): Promise<void>;
  setPeakReleaseMs(ms: number): Promise<void>;
  getCurrentPeaks(): Promise<{ left: number; right: number }>;
  getHeldPeaks(): Promise<{ left: number; right: number }>;
  resetPeaks(): Promise<void>;

  // ── REPLAY GAIN ───────────────────────────────────────────────────────────
  setReplayGainMode(mode: ReplayGainMode | string): Promise<void>;
  setReplayGainPreamp(gainDb: number): Promise<void>;
  setReplayGainFromMap(tags: Record<string, string>): Promise<void>;
  getReplayGainInfo(): Promise<ReplayGainInfo>;

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

  // ── CONVOLUTION ───────────────────────────────────────────────────────────
  loadImpulseResponse(filePath: string): Promise<void>;
  clearImpulseResponse(): Promise<void>;
  isImpulseResponseLoaded(): Promise<boolean>;
  getIrLength(): Promise<number>;
  setConvolutionEnabled(enabled: boolean): Promise<void>;
  isConvolutionEnabled(): Promise<boolean>;

  // ── FX PROCESSOR ──────────────────────────────────────────────────────────
  setFxEnabled(enabled: boolean): Promise<void>;
  getFxEnabled(): Promise<boolean>;
  setFxMode(mode: FxMode | string): Promise<void>;
  getFxMode(): Promise<string>;
  setFxMix(mix: number): Promise<void>;
  getFxMix(): Promise<number>;
  setFxBypass(bypass: boolean): Promise<void>;
  isFxBypassed(): Promise<boolean>;
  setReverbRoomSize(value: number): Promise<void>;
  setReverbDecay(value: number): Promise<void>;
  setReverbPreDelay(value: number): Promise<void>;
  setReverbDamping(value: number): Promise<void>;
  setDelayTime(value: number): Promise<void>;
  setDelayFeedback(value: number): Promise<void>;
  setDelayLowCut(value: number): Promise<void>;
  setDelayHighCut(value: number): Promise<void>;
  setModRate(value: number): Promise<void>;
  setModDepth(value: number): Promise<void>;
  setModPhase(value: number): Promise<void>;
  setModFeedback(value: number): Promise<void>;

  // ── SLEEP TIMER ──────────────────────────────────────────────────────────
  setSleepTimer(durationSeconds: number, fadeOutSeconds?: number): Promise<void>;
  setSleepTimerEndAfterCurrentTrack(): Promise<void>;
  cancelSleepTimer(): Promise<void>;
  getSleepTimerState(): Promise<{
    isActive: boolean;
    remainingSeconds: number | null;
    fadeOutSeconds: number;
    endAfterCurrentTrack: boolean;
  }>;

  // ── BOOKMARKS ─────────────────────────────────────────────────────────────
  bookmarkCurrentPosition(): Promise<void>;
  addBookmark(positionSeconds: number): Promise<void>;
  removeBookmark(positionSeconds: number): Promise<void>;
  getBookmarks(): Promise<Array<{ trackId: string; position: number }>>;
  clearBookmarks(): Promise<void>;

  // ── PERSISTENCE ─────────────────────────────────────────────────────────────
  getLastPlayedPosition(trackId: string): Promise<number | null>;
  clearLastPlayedPosition(trackId: string): Promise<void>;
  clearAllPlayedPositions(): Promise<void>;

  // ── NETWORK & VISUALIZATION ───────────────────────────────────────────────
  getNetworkQuality(): Promise<NetworkQualityEvent>;
  getWaveformData(numBuckets?: number): Promise<number[]>;
  getSpectrumData(): Promise<{
    magnitudes: Array<{ bin: number; magnitude: number }>;
    sampleRate: number;
    binCount: number;
  }>;
  importAutoEqPreset(name: string, csv: string): Promise<void>;

  // ── EXTENDED DSP (v2) ───────────────────────────────────────────────────────
  isCrossfadeEnabled(): Promise<boolean>;
  setCrossfadeEnabled(enabled: boolean): Promise<void>;
  getCrossfadeDurationMs(): Promise<number>;
  setCrossfadeDurationMs(durationMs: number): Promise<void>;
  isOfflineMode(): Promise<boolean>;
  setOfflineMode(enabled: boolean): Promise<void>;
  is64BitProcessingEnabled(): Promise<boolean>;
  set64BitProcessingEnabled(enabled: boolean): Promise<void>;
  isUsbDacConnected(): Promise<boolean>;
  isDirectUsbRoutingEnabled(): Promise<boolean>;
  enableDirectUsbRouting(enabled: boolean): Promise<void>;

  // ── PARAMETRIC BAND CONFIG (v3) ────────────────────────────────────────────
  setParametricBandConfig(band: number, config: {
    type?: string;
    freqHz?: number;
    gainDb?: number;
    q?: number;
    channel?: string;
  }): Promise<void>;
  getParametricBandConfig(band: number): Promise<{
    type: string;
    freqHz: number;
    gainDb: number;
    q: number;
    channel: string;
  } | null>;
  getAllParametricBandConfigs(): Promise<Array<{
    band: number;
    type: string;
    freqHz: number;
    gainDb: number;
    q: number;
    channel: string;
  }>>;
  setBassFrequency(hz: number): Promise<void>;
  getBassFrequency(): Promise<number>;
  setBassQ(q: number): Promise<void>;
  getBassQ(): Promise<number>;
  setTrebleFrequency(hz: number): Promise<void>;
  getTrebleFrequency(): Promise<number>;
  setTrebleQ(q: number): Promise<void>;
  getTrebleQ(): Promise<number>;

  // ── FRC (Frequency Response Correction) (v3) ────────────────────────────────
  importFrcPreset(presetMap: {
    name: string;
    gains: number[];
    freqHz: number[];
    qValues: number[];
    description?: string;
    deviceModel?: string;
  }): Promise<void>;
  applyFrcPreset(name: string): Promise<void>;
  clearFrcPreset(): Promise<void>;
  getActiveFrcPreset(): Promise<string | null>;
  listFrcPresets(): Promise<string[]>;
  exportFrcPreset(name: string): Promise<{
    name: string;
    gains: number[];
    freqHz: number[];
    qValues: number[];
    description: string;
    deviceModel: string;
  } | null>;

  // ── SURROUND DSP (v3) ───────────────────────────────────────────────────────
  setSurroundMode(mode: string): Promise<void>;
  getSurroundMode(): Promise<string>;
  setSurroundEnabled(enabled: boolean): Promise<void>;
  isSurroundEnabled(): Promise<boolean>;
  setSurroundWidth(widthPercent: number): Promise<void>;
  getSurroundWidth(): Promise<number>;
  setSurroundDelay(ms: number): Promise<void>;
  getSurroundDelay(): Promise<number>;
  setSurroundRoomSize(ms: number): Promise<void>;
  getSurroundRoomSize(): Promise<number>;
  setOversamplingFilterType(type: string): Promise<void>;
  getOversamplingFilterType(): Promise<string>;

  // ── TUBE SATURATION (v3) ────────────────────────────────────────────────────
  setTubeMode(mode: string): Promise<void>;
  getTubeMode(): Promise<string>;
  setTubeDrive(driveDb: number): Promise<void>;
  getTubeDrive(): Promise<number>;
  setTubeHarmonic2(amount: number): Promise<void>;
  getTubeHarmonic2(): Promise<number>;
  setTubeHarmonic3(amount: number): Promise<void>;
  getTubeHarmonic3(): Promise<number>;

  // ── ALC (Adaptive Loudness Compensation) (v3) ───────────────────────────────
  setAlcEnabled(enabled: boolean): Promise<void>;
  isAlcEnabled(): Promise<boolean>;
  setAlcTarget(lufs: number): Promise<void>;
  getAlcTarget(): Promise<number>;

  // ── RMS METER (v3) ──────────────────────────────────────────────────────────
  getRmsMeter(): Promise<{
    rmsLeft: number;
    rmsRight: number;
    peakLeft: number;
    peakRight: number;
    lufs: number;
  }>;

  // ── BPM & AUTOMIX (v3) ──────────────────────────────────────────────────────
  setTrackBpm(trackId: string, bpm: number): Promise<void>;
  getTrackBpm(trackId: string): Promise<number | null>;
  getCurrentTrackBpm(): Promise<number>;
  setAutomixConfig(config: {
    mode?: string;
    manualCrossfadeOnly?: boolean;
    bpmAutomixEnabled?: boolean;
    bpmInPoint?: number;
    bpmOutPoint?: number;
  }): Promise<void>;
  getAutomixConfig(): Promise<{
    mode: string;
    manualCrossfadeOnly: boolean;
    bpmAutomixEnabled: boolean;
    bpmInPoint: number;
    bpmOutPoint: number;
  }>;
  setManualCrossfadeOnly(enabled: boolean): Promise<void>;
  isManualCrossfadeOnly(): Promise<boolean>;

  // ── WAKE-UP TIMER (v3) ───────────────────────────────────────────────────────
  setWakeUpTimer(epochMs: number, trackId: string | null, fadeInSeconds?: number): Promise<void>;
  cancelWakeUpTimer(): Promise<void>;
  getWakeUpTimerState(): Promise<{
    isSet: boolean;
    remainingSeconds: number | null;
    trackId: string | null;
    volumeFadeInSeconds: number;
  }>;

  // ── QUEUE AUTO-CLEAR (v3) ───────────────────────────────────────────────────
  setQueueAutoClear(enabled: boolean): Promise<void>;
  isQueueAutoClearEnabled(): Promise<boolean>;

  // ── ANDROID 15 COMPAT (v3) ───────────────────────────────────────────────────
  setPipelineMode(mode: string): Promise<void>;
  getPipelineMode(): Promise<string>;
  setAbsoluteVolumeEnabled(enabled: boolean): Promise<void>;
  isAbsoluteVolumeEnabled(): Promise<boolean>;

  // ── MAX BITRATE (v3) ─────────────────────────────────────────────────────────
  setMaxBitrate(kbps: number): Promise<void>;
  getMaxBitrate(): Promise<number>;

  // ── PLAYING DETAIL (v3) ─────────────────────────────────────────────────────
  isPlayingWithDetail(): Promise<{
    playing: boolean | null;
    bufferingDuringPlay: boolean | null;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE & SYNC TYPES
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
// EVENT SUBSCRIPTION TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface EventSubscription {
  remove: () => void;
}

export type EventName = MavinEvent | string;

export type Listener<T extends keyof MavinPlayerEvents> = MavinPlayerEvents[T];