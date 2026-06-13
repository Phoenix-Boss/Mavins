// libs/playerSetup.ts
//
// SINGLE SOURCE OF TRUTH for all player-related imports.
// This file re-exports everything from MusicPlayerContext and preload,
// plus GestureContext to avoid circular dependencies.
//
// IMPORTANT: All components should import from this file only.
// Do NOT import directly from MusicPlayerContext.tsx or preload.ts.
//
// HMR NOTE: All values from other modules are wrapped in local functions/consts.
// Metro HMR seals ES live bindings with Object.defineProperty({configurable:false}).
// Re-exporting a live binding with `export { x }` causes "property is not configurable"
// on the second hot-reload because Metro tries to re-seal the same binding.
// Local wrapper functions are new declarations each reload — no collision.

// ─────────────────────────────────────────────────────────────────────────────
// Raw imports — ALL aliased with underscore prefix, never re-exported directly
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Song as _Song,
  type RepeatMode as _RepeatMode,
  type ShuffleMode as _ShuffleMode,
  type TrackExtras as _TrackExtras,
  type ResolvedTrack as _ResolvedTrack,
  type PlayerEngineState as _PlayerEngineState,
  type MusicPlayerContextType as _MusicPlayerContextType,
  usePlayerEngine as _usePlayerEngine,
  useMusicPlayer as _useMusicPlayer,
  useTrackExtrasVersion as _useTrackExtrasVersion,
  getTrackExtras as _getTrackExtras,
  storeTrackExtras as _storeTrackExtras,
  MusicPlayerProvider as _MusicPlayerProvider,
  setMasterPlayer as _setMasterPlayer,
} from '@/components/MusicPlayerContext';

import {
  preloadSearchResults as _preloadSearchResults,
  preloadNextTracks as _preloadNextTracks,
  cancelAllPreloads as _cancelAllPreloads,
  getPreloadAbortSignal as _getPreloadAbortSignal,
  getActivePreloadCount as _getActivePreloadCount,
  type PreloadSong as _PreloadSong,
} from '@/libs/preload';

import {
  getCachedTrackExtrasSync as _getCachedTrackExtrasSync,
  extractPersistentMetadata as _extractPersistentMetadata,
  setCachedTrackExtras as _setCachedTrackExtras,
} from '@/services/trackMetadataCache';

import {
  GestureContext as _GestureContext,
  useGestureContext as _useGestureContext,
  type GestureContextValue as _GestureContextValue,
} from '@/libs/gestureContext';

// ─────────────────────────────────────────────────────────────────────────────
// Type re-exports (types are erased at runtime — no live-binding collision)
// ─────────────────────────────────────────────────────────────────────────────

export type Song = _Song;
export type RepeatMode = _RepeatMode;
export type ShuffleMode = _ShuffleMode;
export type TrackExtras = _TrackExtras;
export type ResolvedTrack = _ResolvedTrack;
export type PlayerEngineState = _PlayerEngineState;
export type MusicPlayerContextType = _MusicPlayerContextType;
export type PreloadSong = _PreloadSong;
export type GestureContextValue = _GestureContextValue;

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper exports — local declarations, HMR-safe
// ─────────────────────────────────────────────────────────────────────────────

// Hooks
export const usePlayerEngine: typeof _usePlayerEngine = (...args) => _usePlayerEngine(...args);
export const useMusicPlayer: typeof _useMusicPlayer = (...args) => _useMusicPlayer(...args);
export const useTrackExtrasVersion: typeof _useTrackExtrasVersion = (...args) => _useTrackExtrasVersion(...args);
export const useGestureContext: typeof _useGestureContext = (...args) => _useGestureContext(...args);

// Context / Provider
export const MusicPlayerProvider = _MusicPlayerProvider;
export const GestureContext = _GestureContext;

// Track extras
export function getTrackExtras(id: string): Record<string, any> | null {
  return _getTrackExtras?.(id) ?? null;
}
export function storeTrackExtras(id: string, extras: Record<string, any>): void {
  _storeTrackExtras?.(id, extras);
}
export function getCachedTrackExtrasSync(id: string): Record<string, any> | null {
  return _getCachedTrackExtrasSync?.(id) ?? null;
}
export function extractPersistentMetadata(extras: Record<string, any>): Record<string, any> {
  return _extractPersistentMetadata?.(extras) ?? {};
}
export function setCachedTrackExtras(id: string, extras: Record<string, any>): void {
  _setCachedTrackExtras?.(id, extras);
}

// Player setup
export function setMasterPlayer(player: Parameters<typeof _setMasterPlayer>[0]): void {
  _setMasterPlayer?.(player);
}

// ─────────────────────────────────────────────────────────────────────────────
// setPreferredStreamType / getPreferredStreamType
// These were mavin-player module APIs. Now implemented locally using a
// module-level variable so no native module is needed.
// ─────────────────────────────────────────────────────────────────────────────

let _preferredStreamType: 'audio' | 'video' = 'audio';

export function setPreferredStreamType(type: 'audio' | 'video'): void {
  _preferredStreamType = type;
  (global as any).__MavinPreferredStreamType = type;
}

export function getPreferredStreamType(): 'audio' | 'video' {
  return (global as any).__MavinPreferredStreamType ?? _preferredStreamType;
}

// ─────────────────────────────────────────────────────────────────────────────
// resetSSLFastPath
// Was a mavin-player module API. Implemented as a no-op since expo-video
// handles SSL internally.
// ─────────────────────────────────────────────────────────────────────────────

export function resetSSLFastPath(): void {
  // expo-video manages SSL internally — no-op
  console.log('[PlayerSetup] resetSSLFastPath called (no-op with expo-video)');
}

// ─────────────────────────────────────────────────────────────────────────────
// isLocalTrack / enrichLocalTrackMetadata / extractArtistFromFilename
// These are defined in MusicPlayerContext.tsx as private functions.
// Re-implemented here so all consumers can import from playerSetup only.
// ─────────────────────────────────────────────────────────────────────────────

export function isLocalTrack(
  track: { url?: string; isLocal?: boolean; isDownloaded?: boolean } | null | undefined,
): boolean {
  if (!track) return false;
  const url = track.url || '';
  return (
    url.startsWith('file://') ||
    url.startsWith('/') ||
    url.startsWith('content://') ||
    (track as any).isLocal === true ||
    (track as any).isDownloaded === true
  );
}

export function extractArtistFromFilename(filename: string): string {
  if (!filename) return 'Upcoming Artist';
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  const hyphenSplit = withoutExt.split(/[-–—]/);
  if (hyphenSplit.length >= 2) {
    const left = hyphenSplit[0].trim();
    const right = hyphenSplit[1].trim();
    if (left.length < right.length && left.length < 30) return left;
    if (right.length > 0) return right;
  }
  const featMatch = withoutExt.match(/feat\.?\s+([^)\\]]+)/i);
  if (featMatch?.[1]) return featMatch[1].trim();
  const bracketMatch = withoutExt.match(/\[([^\]]+)\]$/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const parenMatch = withoutExt.match(/\(([^)]+)\)$/);
  if (parenMatch?.[1] && !parenMatch[1].match(/feat|ft|remix|live|acoustic|version/i)) {
    return parenMatch[1].trim();
  }
  return 'Upcoming Artist';
}

export function enrichLocalTrackMetadata(
  song: Song,
  filePath?: string,
  folderName?: string,
): Song {
  const enriched: Song = { ...song };
  const isGenericArtist =
    !enriched.artist ||
    enriched.artist === '' ||
    enriched.artist === 'Unknown Artist' ||
    enriched.artist === 'Upcoming Artist';

  if (isGenericArtist) {
    if (
      enriched.title &&
      (enriched.title.includes('-') || enriched.title.includes('–') || enriched.title.includes('—'))
    ) {
      const parts = enriched.title.split(/[-–—]/);
      if (parts.length >= 2) {
        const left = parts[0].trim();
        const right = parts[1].trim();
        if (left.length < right.length && left.length < 30) {
          enriched.artist = left;
          enriched.title = right;
        } else {
          enriched.artist = right;
          enriched.title = left;
        }
      }
    } else if (filePath) {
      const filename = filePath.split('/').pop() || '';
      enriched.artist = extractArtistFromFilename(filename);
      const withoutExt = filename.replace(/\.[^/.]+$/, '');
      const artistLower = enriched.artist.toLowerCase();
      const sourceLower = withoutExt.toLowerCase();
      if (sourceLower.includes(artistLower) && withoutExt.length > enriched.artist.length) {
        const remaining = withoutExt.substring(
          sourceLower.indexOf(artistLower) + enriched.artist.length,
        );
        const cleanedTitle = remaining.replace(/^[-–—\s]+/, '').trim();
        if (cleanedTitle) enriched.title = cleanedTitle;
      }
    } else if (folderName && folderName !== 'Unknown' && folderName !== '') {
      enriched.artist = folderName;
    } else {
      enriched.artist = 'Upcoming Artist';
    }
  }

  if (!enriched.artist || enriched.artist === '') enriched.artist = 'Upcoming Artist';
  if (enriched.artist.toLowerCase() === 'unknown artist') enriched.artist = 'Upcoming Artist';

  if (!enriched.title || enriched.title === '') {
    if (filePath) {
      const filename = filePath.split('/').pop() || '';
      enriched.title = filename.replace(/\.[^/.]+$/, '');
      if (enriched.artist && enriched.title.toLowerCase().includes(enriched.artist.toLowerCase())) {
        enriched.title = enriched.title
          .replace(new RegExp(enriched.artist, 'i'), '')
          .replace(/^[-–—\s]+/, '')
          .trim();
      }
    } else {
      enriched.title = 'Unknown Track';
    }
  }

  if (!enriched.thumbnail || enriched.thumbnail === '') {
    enriched.thumbnail = undefined;
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureQueueMetadata
// Was a mavin-player module API. Implemented locally as a passthrough.
// ─────────────────────────────────────────────────────────────────────────────

export function ensureQueueMetadata(songs: Song[]): Song[] {
  if (!Array.isArray(songs)) return [];
  return songs.map(song => ({
    ...song,
    artist: song.artist || 'Unknown Artist',
    title: song.title || 'Unknown Track',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Preload utilities
// ─────────────────────────────────────────────────────────────────────────────

export function preloadSearchResults(...args: Parameters<typeof _preloadSearchResults>): ReturnType<typeof _preloadSearchResults> {
  return _preloadSearchResults(...args);
}
export function preloadNextTracks(...args: Parameters<typeof _preloadNextTracks>): ReturnType<typeof _preloadNextTracks> {
  return _preloadNextTracks(...args);
}
export function cancelAllPreloads(): void {
  _cancelAllPreloads?.();
}
export function getPreloadAbortSignal(): AbortSignal {
  return _getPreloadAbortSignal();
}
export function getActivePreloadCount(): number {
  return _getActivePreloadCount?.() ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Create a song object from minimal data
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSongParams {
  id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  url: string;
  videoId?: string;
  duration?: number;
  isLocal?: boolean;
  isDownloaded?: boolean;
}

export function createSong(params: CreateSongParams): Song {
  if (!params.id) throw new Error('createSong: id is required');
  if (!params.title) throw new Error('createSong: title is required');
  if (!params.url) throw new Error('createSong: url is required');
  return {
    id: params.id,
    title: params.title,
    artist: params.artist || 'Unknown Artist',
    thumbnail: params.thumbnail,
    url: params.url,
    videoId: params.videoId,
    duration: params.duration,
    isLocal: params.isLocal,
    isDownloaded: params.isDownloaded,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Normalizer
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeLocalUri(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('content://') || uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatCount(n: number): string {
  if (n <= 0) return '';
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

export function parseArtists(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,&]|\bft\.?\b|\bfeat\.?\b/i).map(a => a.trim()).filter(Boolean);
}

export function formatArtistName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatPlayCount(count: number | undefined | null): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Video ID Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?#]+)/,
    /youtube\.com\/shorts\/([^&?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

export function toWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getNextTrackIndex(
  currentIndex: number,
  queueLength: number,
  repeatMode: 'off' | 'all' | 'one',
): number | null {
  if (queueLength === 0) return null;
  if (repeatMode === 'one') return currentIndex;
  const nextIndex = currentIndex + 1;
  if (nextIndex < queueLength) return nextIndex;
  if (repeatMode === 'all' && queueLength > 0) return 0;
  return null;
}

export function getPreviousTrackIndex(
  currentIndex: number,
  queueLength: number,
  repeatMode: 'off' | 'all' | 'one',
  currentPositionSec: number,
): number | null {
  if (queueLength === 0) return null;
  if (currentPositionSec > 3) return currentIndex;
  const prevIndex = currentIndex - 1;
  if (prevIndex >= 0) return prevIndex;
  if (repeatMode === 'all' && queueLength > 0) return queueLength - 1;
  return null;
}

export function createShuffledQueue(queue: any[], currentIndex: number): any[] {
  if (queue.length <= 1) return [...queue];
  const current = queue[currentIndex];
  const before = queue.slice(0, currentIndex);
  const after = queue.slice(currentIndex + 1);
  const shuffledAfter = [...after];
  for (let i = shuffledAfter.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAfter[i], shuffledAfter[j]] = [shuffledAfter[j], shuffledAfter[i]];
  }
  const shuffledBefore = [...before];
  for (let i = shuffledBefore.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledBefore[i], shuffledBefore[j]] = [shuffledBefore[j], shuffledBefore[i]];
  }
  return [...shuffledBefore, current, ...shuffledAfter];
}

// ─────────────────────────────────────────────────────────────────────────────
// Player State Getters
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerState {
  isPlaying: boolean;
  position: number;
  duration: number;
  isBuffering: boolean;
  volume: number;
  playbackRate: number;
  isMuted: boolean;
}

export function getMasterPlayerState(): PlayerState | null {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (!master) return null;
    return {
      isPlaying: master.playing ?? false,
      position: master.currentTime ?? 0,
      duration: master.duration ?? 0,
      isBuffering: master.isBuffering ?? false,
      volume: master.volume ?? 1.0,
      playbackRate: master.playbackRate ?? 1.0,
      isMuted: master.muted ?? false,
    };
  } catch {
    return null;
  }
}

export function getSlavePlayerState(): PlayerState | null {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    if (!slave) return null;
    return {
      isPlaying: slave.playing ?? false,
      position: slave.currentTime ?? 0,
      duration: slave.duration ?? 0,
      isBuffering: slave.isBuffering ?? false,
      volume: slave.volume ?? 0,
      playbackRate: slave.playbackRate ?? 1.0,
      isMuted: slave.muted ?? true,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct Player Controls
// ─────────────────────────────────────────────────────────────────────────────

export function playMaster(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) { master.play(); return true; }
    return false;
  } catch { return false; }
}

export function pauseMaster(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) { master.pause(); return true; }
    return false;
  } catch { return false; }
}

export function seekMaster(positionSec: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) { master.currentTime = positionSec; return true; }
    return false;
  } catch { return false; }
}

export function setMasterVolume(volume: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) { master.volume = Math.min(Math.max(volume, 0), 1); return true; }
    return false;
  } catch { return false; }
}

export function setMasterPlaybackRate(rate: number): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (master) { master.playbackRate = Math.min(Math.max(rate, 0.5), 16); return true; }
    return false;
  } catch { return false; }
}

export function isAudioPlaying(): boolean {
  try {
    const master = (global as any).__MavinMasterPlayer__;
    if (!master) return false;
    return (master.playing === true && master.volume > 0 && master.muted === false);
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slave Player Controls
// ─────────────────────────────────────────────────────────────────────────────

export function showSlave(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    const master = (global as any).__MavinMasterPlayer__;
    if (slave && master) {
      slave.currentTime = master.currentTime ?? 0;
      slave.muted = true;
      if (master.playing) slave.play();
      return true;
    }
    return false;
  } catch { return false; }
}

export function hideSlave(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    if (slave) { slave.pause(); return true; }
    return false;
  } catch { return false; }
}

export function syncSlaveToMaster(): boolean {
  try {
    const slave = (global as any).__MavinSlavePlayer__;
    const master = (global as any).__MavinMasterPlayer__;
    if (slave && master) {
      const masterPos = master.currentTime ?? 0;
      const diff = Math.abs((slave.currentTime ?? 0) - masterPos);
      if (diff > 0.3) slave.currentTime = masterPos;
      return true;
    }
    return false;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand Player Registration
// ─────────────────────────────────────────────────────────────────────────────

let expandPlayerRegistered = false;
let registeredExpandPlayer: (() => void) | null = null;

export const registerExpandPlayer = (expandFn: () => void): void => {
  registeredExpandPlayer = expandFn;
  expandPlayerRegistered = true;
  console.log('[PlayerSetup] expandPlayer registered successfully');
};

export const getRegisteredExpandPlayer = (): (() => void) | null => registeredExpandPlayer;
export const isExpandPlayerRegistered = (): boolean => expandPlayerRegistered;

// ─────────────────────────────────────────────────────────────────────────────
// Reset SSL Fast Path And Reload
// ─────────────────────────────────────────────────────────────────────────────

export function resetSSLFastPathAndReload(): void {
  resetSSLFastPath();
  console.log('[PlayerSetup] SSL fast path reset');
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Preferred Stream Type
// ─────────────────────────────────────────────────────────────────────────────

export function updatePreferredStreamType(type: 'audio' | 'video'): void {
  setPreferredStreamType(type);
  console.log(`[PlayerSetup] Preferred stream type updated to: ${type}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug Helper
// ─────────────────────────────────────────────────────────────────────────────

export function debugPlayerState(): void {
  const master = getMasterPlayerState();
  const slave = getSlavePlayerState();
  console.log('[PlayerSetup] ========== PLAYER STATE ==========');
  console.log('[PlayerSetup] MASTER:', master);
  console.log('[PlayerSetup] SLAVE:', slave);
  console.log('[PlayerSetup] ===================================');
}