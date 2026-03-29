// ── Track ─────────────────────────────────────────────────────────────────────

export interface MavinTrack {
  /** Unique ID — used as the MediaItem ID in ExoPlayer */
  id: string;
  /** HTTP/HTTPS stream URL or local file:// path */
  uri: string;
  /** Alias for uri — accepted for RNTP migration compatibility */
  url?: string;
  title?: string;
  artist?: string;
  album?: string;
  /** HTTP or local artwork URI */
  artwork?: string;
  /** Duration in milliseconds (optional — ExoPlayer detects it) */
  duration?: number;
  /** Custom HTTP headers for authenticated streams */
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
  /** Current playback position in ms */
  position: number;
  /** Track duration in ms */
  duration: number;
  /** Buffered position in ms */
  buffered: number;
}

// ── Repeat modes (match ExoPlayer constants) ──────────────────────────────────

export const RepeatMode = {
  /** No repeat */
  Off: 0,
  /** Repeat current track */
  One: 1,
  /** Repeat entire queue */
  All: 2,
} as const;

export type RepeatModeValue = typeof RepeatMode[keyof typeof RepeatMode];

// ── EQ ────────────────────────────────────────────────────────────────────────

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