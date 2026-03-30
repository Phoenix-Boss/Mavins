// mavin-eq/types.ts

// ── Track ─────────────────────────────────────────────────────────────────────

export interface MavinTrack {
  id: string;
  uri: string;
  url?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
  headers?: Record<string, string>;
}

// ── Playback state ────────────────────────────────────────────────────────────

export type PlaybackState = 'idle' | 'buffering' | 'ready' | 'ended' | 'unknown';

export interface PlaybackStateEvent {
  state: PlaybackState;
}

export interface TrackChangedEvent {
  index: number;
}

export interface PlayerError {
  message: string;
  code: string;
}

export interface ProgressEvent {
  position: number;
  duration: number;
  buffered: number;
}

// ── Repeat modes ──────────────────────────────────────────────────────────────

export const RepeatMode = {
  Off: 0,
  One: 1,
  All: 2,
} as const;

export type RepeatModeValue = typeof RepeatMode[keyof typeof RepeatMode];

// ── EQ Core Types ─────────────────────────────────────────────────────────────

export const ISO_FREQ_CENTERS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

export type EQGains = [
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number, number
];

export type EqBandGains = number[] | EQGains;

// ── Biquad Filter Types ───────────────────────────────────────────────────────

export interface EqBiquadFilter {
  type: 'peaking' | 'lowpass' | 'highpass' | 'lowshelf' | 'highshelf' | 'notch' | 'bandpass';
  frequency: number;
  gainDb: number;
  q: number;
}

// ── FX Types ──────────────────────────────────────────────────────────────────

export type FxMode = 'REVERB' | 'DELAY' | 'CHORUS' | 'FLANGER' | 'PHASER';

export interface FxState {
  enabled: boolean;
  mode: FxMode;
  mix: number;
  bypass: boolean;
  // Reverb
  reverbRoomSize: number;
  reverbDecay: number;
  reverbPreDelay: number;
  reverbDamping: number;
  // Delay
  delayTime: number;
  delayFeedback: number;
  delayLowCut: number;
  delayHighCut: number;
  // Modulation (Chorus/Flanger/Phaser)
  modRate: number;
  modDepth: number;
  modPhase: number;
  modFeedback: number;
}

// ── Preset Categories ─────────────────────────────────────────────────────────

export type PresetCategory = 
  | 'builtin'
  | 'user'
  | 'supabase'
  | 'artist'
  | 'genre'
  | 'device';

export type PresetTag = 
  | 'bass' | 'vocal' | 'treble' | 'balanced' | 'warm' | 'bright' 
  | 'electronic' | 'rock' | 'classical' | 'jazz' | 'hiphop' | 'podcast'
  | 'gaming' | 'movie' | 'audiophile' | 'loudness' | 'flat' | 'custom';

// ── Preset Interface ──────────────────────────────────────────────────────────

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
  
  gains_31?: EqBandGains;
  biquad_filters?: EqBiquadFilter[];
  parametric_gains?: number[];
  parametric_freqs?: number[];
  q_values?: number[];
  eq_mode?: string;
  preamp_db?: number;
  
  source: 'local' | 'supabase' | 'imported';
  supabaseId?: string;
  
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

// ── Preset Group for UI ───────────────────────────────────────────────────────

export interface PresetGroup {
  id: PresetCategory;
  title: string;
  icon: string;
  presets: EqPreset[];
  isExpanded?: boolean;
  sortOrder: number;
}

// ── EQ State ───────────────────────────────────────────────────────────────────

export interface EqState {
  isSetup: boolean;
  isEnabled: boolean;
  gains: number[];
  preampDb: number;
  activePreset: EqPreset | null;
  isLoading: boolean;
  error: string | null;
}

// ── USB DAC Types ─────────────────────────────────────────────────────────────

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

// ── Audio Format Types ────────────────────────────────────────────────────────

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
  encoding: number;
  isFloat: boolean;
  isHiRes: boolean;
  channelCount: number;
}

// ── Native Module Interface (MavinPlayerModule) ───────────────────────────────

export interface MavinPlayerNativeModule {
  // Player Lifecycle
  initPlayer(): Promise<void>;
  load(track: MavinTrack): Promise<void>;
  setQueue(tracks: MavinTrack[], startIndex?: number): Promise<void>;
  addToQueue(track: MavinTrack): Promise<void>;
  
  // Playback Control
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  skipToIndex(index: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setRepeatMode(mode: number): Promise<void>;
  setShuffleMode(enabled: boolean): Promise<void>;
  
  // Player State
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getCurrentTrack(): Promise<MavinTrack | null>;
  isPlaying(): Promise<boolean>;
  getQueueSize(): Promise<number>;
  
  // EQ Control - Graphic
  setEQEnabled(enabled: boolean): Promise<void>;
  setEQBand(band: number, gainDb: number): Promise<void>;
  applyEQBands(gains: number[]): Promise<void>;
  setEQPreamp(gainDb: number): Promise<void>;
  setEQBandQ(band: number, q: number): Promise<void>;
  resetEQ(): Promise<void>;
  
  // EQ Control - Parametric
  setParametricBandGain(band: number, gainDb: number): Promise<void>;
  applyParametricBands(gains: number[]): Promise<void>;
  setParametricBandFreq(band: number, freqHz: number): Promise<void>;
  resetParametric(): Promise<void>;
  
  // EQ Mode
  setEQMode(mode: string): Promise<void>;
  getEQMode(): Promise<string>;
  
  // Dither Mode
  setDitherMode(mode: string): Promise<void>;
  getDitherMode(): Promise<string>;
  
  // Smoothing
  setSmoothingRamp(ms: number): Promise<void>;
  
  // Compressor (DRC)
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
  
  // Crossfeed
  setCrossfeedEnabled(enabled: boolean): Promise<void>;
  isCrossfeedEnabled(): Promise<boolean>;
  setCrossfeedStrength(strength: number): Promise<void>;
  setCrossfeedCutoff(hz: number): Promise<void>;
  getCrossfeedStrength(): Promise<number>;
  getCrossfeedCutoff(): Promise<number>;
  
  // Peak Meter (VU)
  getCurrentPeaks(): Promise<{ left: number; right: number }>;
  getHeldPeaks(): Promise<{ left: number; right: number }>;
  resetPeaks(): Promise<void>;
  setPeakHoldMs(ms: number): Promise<void>;
  setPeakReleaseMs(ms: number): Promise<void>;
  
  // Playback Speed
  setPlaybackSpeed(speed: number): Promise<void>;
  getPlaybackSpeed(): Promise<number>;
  
  // Crossfade
  setCrossfadeEnabled(enabled: boolean): Promise<void>;
  isCrossfadeEnabled(): Promise<boolean>;
  setCrossfadeDuration(durationMs: number): Promise<void>;
  getCrossfadeDuration(): Promise<number>;
  
  // Offline Mode (Zero Telemetry)
  setOfflineMode(enabled: boolean): Promise<void>;
  isOfflineMode(): Promise<boolean>;
  
  // 64-bit Processing
  set64BitProcessingEnabled(enabled: boolean): Promise<void>;
  is64BitProcessingEnabled(): Promise<boolean>;
  
  // Convolution Processor (Impulse Responses)
  loadImpulseResponse(filePath: string): Promise<void>;
  clearImpulseResponse(): Promise<void>;
  isImpulseResponseLoaded(): Promise<boolean>;
  getIrLength(): Promise<number>;
  setConvolutionEnabled(enabled: boolean): Promise<void>;
  isConvolutionEnabled(): Promise<boolean>;
  
  // FX Processor
  setFxEnabled(enabled: boolean): Promise<void>;
  isFxEnabled(): Promise<boolean>;
  setFxMode(mode: string): Promise<void>;
  getFxMode(): Promise<string>;
  setFxMix(mix: number): Promise<void>;
  getFxMix(): Promise<number>;
  setFxBypass(bypass: boolean): Promise<void>;
  isFxBypassed(): Promise<boolean>;
  
  // Reverb Parameters
  setReverbRoomSize(value: number): Promise<void>;
  setReverbDecay(value: number): Promise<void>;
  setReverbPreDelay(value: number): Promise<void>;
  setReverbDamping(value: number): Promise<void>;
  
  // Delay Parameters
  setDelayTime(value: number): Promise<void>;
  setDelayFeedback(value: number): Promise<void>;
  setDelayLowCut(value: number): Promise<void>;
  setDelayHighCut(value: number): Promise<void>;
  
  // Modulation Parameters
  setModRate(value: number): Promise<void>;
  setModDepth(value: number): Promise<void>;
  setModPhase(value: number): Promise<void>;
  setModFeedback(value: number): Promise<void>;
  
  // USB DAC Control
  isUsbDacConnected(): Promise<boolean>;
  getCurrentDacInfo(): Promise<DacInfo | null>;
  getDacCapabilities(): Promise<DacCapabilities | null>;
  enableDirectUsbRouting(enabled: boolean): Promise<boolean>;
  isDirectUsbRoutingEnabled(): Promise<boolean>;
  setPreferredDacSampleRate(rate: number): Promise<boolean>;
  setPreferredDacBitDepth(depth: number): Promise<boolean>;
  rescanUsbDevices(): Promise<void>;
  
  // Audio Format Detection
  getAudioCapabilities(): Promise<AudioCapabilities | null>;
  getOptimalAudioFormat(): Promise<OptimalAudioFormat | null>;
  isHiResAudioCapable(): Promise<boolean>;
  getMaxSampleRate(): Promise<number>;
  getMaxBitDepth(): Promise<number>;
  
  // Cleanup
  release(): Promise<void>;
}

// ── Storage Types ─────────────────────────────────────────────────────────────

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

// ── Supabase Types ────────────────────────────────────────────────────────────

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