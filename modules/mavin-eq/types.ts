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

// ── Preset Categories (BandLab-style) ─────────────────────────────────────────

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
  
  // Player State
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getCurrentTrack(): Promise<MavinTrack | null>;
  isPlaying(): Promise<boolean>;
  getQueueSize(): Promise<number>;
  
  // EQ Control (proxied to EqualizerProcessor)
  setEQEnabled(enabled: boolean): Promise<void>;
  setEQBand(band: number, gainDb: number): Promise<void>;
  applyEQBands(gains: number[]): Promise<void>;
  setEQPreamp(gainDb: number): Promise<void>;
  setEQBandQ(band: number, q: number): Promise<void>;
  resetEQ(): Promise<void>;
  
  // Cleanup
  release(): Promise<void>;
}

// ── Storage Types ───────────────────────────────────────────────────────────────

export interface PresetStorageAdapter {
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