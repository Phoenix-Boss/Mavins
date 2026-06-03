// components/MusicPlayerContext.tsx
//
// CANONICAL PLAYER ENGINE — stream resolution + master-slave playback.
// COMPLETE QUEUE, REPEAT, SHUFFLE IMPLEMENTATION
// ANDROID-ONLY: All iOS-specific code removed
//
// MASTER-SLAVE ARCHITECTURE (Industry standard workaround for Expo limitations):
//   MASTER PLAYER: expo-video instance that plays audio (hidden, never muted)
//   SLAVE PLAYER: expo-video instance for video rendering (muted, visible only on video tab)
//
// This file manages ONLY the MASTER player. The SLAVE player is controlled by playerContent.tsx.
// All playback state comes from the MASTER player. No expo-audio is used.
//
// v11.0 - MANIFEST-FIRST PLAYBACK ARCHITECTURE
//   Uses DASH/HLS manifest URLs from getStreamInfo() as primary source
//   Progressive URLs (MP4/WebM) are NEVER used for streaming - they are IP-bound and cause 403
//   Manifest URLs are stored in TrackExtras for playerContent to consume
//   Slave video player uses video-only DASH manifest from videoOnlyStreams
//
// FIXED: Removed all expo-audio dependencies - using expo-video for everything
// FIXED: Single source of truth (Master player) for position, duration, playing state
// FIXED: No AudioFocus handoff - Master owns focus permanently
// FIXED: Queue, repeat, shuffle fully implemented
// UPDATED: Enhanced retry logic for NewPipeExtractor v0.26.2
// UPDATED: Improved parsing error handling and visitor data management
// UPDATED: Better search fallback strategies with YouTube Music support
// FIXED: Force DASH/HLS manifest URLs for ExoPlayer compatibility (prevents 403 errors)
// FIXED: Wait for player readyToPlay status using event-driven approach (no polling)

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, ToastAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Use legacy API to avoid deprecation warnings
import * as LegacyFileSystem from 'expo-file-system/legacy';

import MavinEngine, {
  StreamInfoItem,
  AudioStream,
  VideoStream,
} from '@/modules/mavin-engine';

import { DownloadedSongMetadata } from '@/store/library';
import { supabase } from '@/libs/supabase';
import { supabaseCache } from '@/libs/cache/supabase-cache';
import type { Song } from '@/types/song';

import {
  useSystemMediaControls,
  type SystemMediaControlsProps,
} from '@/hooks/useSystemMediaControls';

import { useAlert } from '@/contexts/AlertContext';

import { getTrackById, getTracksByAlbum } from '@/db/localDatabase';

import {
  setPlaybackActive,
  setPlaybackInactive,
  preloadNextTracks,
  registerResolveTrack,
  registerStoreTrackExtras,
  cancelAllPreloads,
  getPreloadAbortSignal,
} from '@/libs/preload';

import {
  getCachedTrackExtras,
  getCachedTrackExtrasSync,
  setCachedTrackExtras,
  extractPersistentMetadata,
} from '@/services/trackMetadataCache';

export type { Song };

export type RepeatMode = 'off' | 'all' | 'one';
export type ShuffleMode = 'off' | 'on';

export interface TrackExtras {
  // Manifest URLs for ExoPlayer playback (DASH/HLS - NOT IP-bound)
  dashManifestUrl?: string;      // DASH manifest URL from getStreamInfo().dashMpdUrl
  hlsManifestUrl?: string;       // HLS manifest URL from getStreamInfo().hlsUrl
  videoOnlyManifestUrl?: string; // Video-only DASH stream from videoOnlyStreams (for slave player)
  
  // Progressive URLs (IP-bound - for DOWNLOADS ONLY, NOT for streaming)
  videoUrl?: string;             // Progressive video URL (download only)
  muxedVideoUrl?: string;        // Muxed progressive URL (download only)
  
  videoId?: string;
  uploaderUrl?: string;
  likeCount?: number;
  dislikeCount?: number;
  viewCount?: number;
  commentsCount?: number;
  isLocal?: boolean;
  hasAudio?: boolean;
  hasVideo?: boolean;
  isAudioOnly?: boolean;
  isVideoOnly?: boolean;
}

export interface ResolvedTrack {
  id: string;
  url: string;  // Manifest URL (DASH/HLS) or progressive URL for local/downloaded
  title: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
  videoId?: string;
  isDownloaded?: boolean;
  isLocal?: boolean;
  muxedVideoUrl?: string;      // Progressive URL (download only)
  videoOnlyUrl?: string;       // Progressive URL (download only)
  dashManifestUrl?: string;    // DASH manifest for primary playback
  hlsManifestUrl?: string;     // HLS manifest fallback
  videoOnlyManifestUrl?: string; // Video-only DASH manifest for slave player
  hasAudio: boolean;
  hasVideo: boolean;
  isAudioOnly: boolean;
  isVideoOnly: boolean;
}

const CONFIG = {
  STREAM_TTL_MS: 6 * 60 * 60 * 1000,
  MAX_EXTRAS_CACHE: 50,
  TEMP_PLAYBACK_CACHE_TTL_MS: 3600000,
  RESOLVE_RETRY_MAX_ATTEMPTS: 3,
  RESOLVE_RETRY_BASE_DELAY_MS: 500,
  PLAYBACK_LOCK_TIMEOUT_MS: 30000,
  TIME_UPDATE_EVENT_INTERVAL_SECONDS: 0.25,
  MAX_PLAYBACK_ERROR_RETRIES: 1,
  DEFAULT_VOLUME: 1.0,
  MANIFEST_LOAD_TIMEOUT_MS: 15000,
} as const;

const STORAGE_KEYS = {
  LAST_PLAYING_TRACK: 'last_playing_track',
  LAST_PLAYING_POSITION: 'last_playing_position',
  REPEAT_MODE: 'repeat_mode',
  SHUFFLE_MODE: 'shuffle_mode',
  LAST_ACTIVE_TAB: 'last_active_tab',
  LAST_VIDEO_POSITION: 'last_video_position',
  PLAYBACK_RATE: 'playback_rate',
  VOLUME: 'volume',
  PRESERVE_PITCH: 'preserve_pitch',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL PLAYBACK SESSION STORE
// ─────────────────────────────────────────────────────────────────────────────

interface PlaybackSession {
  currentTrack: Song | null;
  queue: Song[];
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  isLoading: boolean;
  isResolving: boolean;
  optimisticPlaying: boolean | null;
  playGeneration: number;
  currentSongId: string | null;
  originalQueue: Song[];
  originalIndex: number;
  wasPlayingBeforeInterruption: boolean;
  didHandleFinish: boolean;
  bgAbortController: AbortController | null;
  lastError: string | null;
  hasVideoStream: boolean;
  isAudioOnlyTrack: boolean;
  isVideoOnlyTrack: boolean;
  playbackRate: number;
  preservePitch: boolean;
  volume: number;
  videoActive: boolean;
  videoPosition: number;
  videoDuration: number;
  videoIsPlaying: boolean;
  preferredStreamType: 'audio' | 'video';
  bufferedPosition: number;
  sleepTimerEndsAt: number | null;
}

const session: PlaybackSession = {
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  repeatMode: 'off',
  shuffleMode: 'off',
  isLoading: false,
  isResolving: false,
  optimisticPlaying: null,
  playGeneration: 0,
  currentSongId: null,
  originalQueue: [],
  originalIndex: -1,
  wasPlayingBeforeInterruption: false,
  didHandleFinish: false,
  bgAbortController: null,
  lastError: null,
  hasVideoStream: false,
  isAudioOnlyTrack: false,
  isVideoOnlyTrack: false,
  playbackRate: 1.0,
  preservePitch: true,
  volume: 1.0,
  videoActive: false,
  videoPosition: 0,
  videoDuration: 0,
  videoIsPlaying: false,
  preferredStreamType: 'audio',
  bufferedPosition: 0,
  sleepTimerEndsAt: null,
};

const sessionListeners = new Set<() => void>();

function notifySessionChange() {
  sessionListeners.forEach(fn => fn());
}

function setSession<K extends keyof PlaybackSession>(key: K, value: PlaybackSession[K]) {
  (session as any)[key] = value;
  notifySessionChange();
}

function setSessionPartial(updates: Partial<PlaybackSession>) {
  Object.assign(session, updates);
  notifySessionChange();
}

function updateQueue(updater: (prev: Song[]) => Song[]) {
  session.queue = updater(session.queue);
  notifySessionChange();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API FOR TAB-AWARE QUEUE
// ─────────────────────────────────────────────────────────────────────────────

export function setPreferredStreamType(type: 'audio' | 'video') {
  setSession('preferredStreamType', type);
  (global as any).__MavinPreferredStreamType = type;
  console.log(`[MusicPlayer] Preferred stream type set to: ${type}`);
}

export function getPreferredStreamType(): 'audio' | 'video' {
  return session.preferredStreamType;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeLocalUri(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('content://') || uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
const RESTORE_GLOBALS = {
  DONE_KEY: '__MavinRestoreDone__',
  IN_PROGRESS_KEY: '__MavinRestoreInProgress__',
  TRACK_KEY: '__MavinRestoredTrack__',
  POSITION_KEY: '__MavinRestoredPosition__',
  RESOLVED_URL_KEY: '__MavinRestoredResolvedUrl__',
  PLAYER_READY_KEY: '__MavinRestoredPlayerReady__',
  RESTORED_TAB_KEY: '__MavinRestoredTab__',
  RESTORED_VIDEO_POSITION_KEY: '__MavinRestoredVideoPosition__',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILE CACHE
// ─────────────────────────────────────────────────────────────────────────────

async function cacheLocalFileForPlayback(contentUri: string, trackId: string): Promise<string | null> {
  if (!contentUri) return null;
  try {
    const cacheDir = LegacyFileSystem.cacheDirectory + 'temp_playback/';
    const dirInfo = await LegacyFileSystem.getInfoAsync(cacheDir);
    if (!dirInfo.exists) {
      await LegacyFileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    }
    const sanitizedId = trackId.replace(/[^a-zA-Z0-9]/g, '_');
    const cachePath = cacheDir + sanitizedId + '.mp3';
    const existing = await LegacyFileSystem.getInfoAsync(cachePath);
    if (existing.exists && (existing as any).modificationTime) {
      const age = Date.now() - (existing as any).modificationTime;
      if (age < CONFIG.TEMP_PLAYBACK_CACHE_TTL_MS) return cachePath;
    }
    await LegacyFileSystem.copyAsync({ from: contentUri, to: cachePath });
    const files = await LegacyFileSystem.readDirectoryAsync(cacheDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = cacheDir + file;
      const info = await LegacyFileSystem.getInfoAsync(filePath);
      if (info.exists && (info as any).modificationTime) {
        if (now - (info as any).modificationTime > CONFIG.TEMP_PLAYBACK_CACHE_TTL_MS) {
          await LegacyFileSystem.deleteAsync(filePath);
        }
      }
    }
    return cachePath;
  } catch (error) {
    console.error('[MusicPlayer] Failed to cache local file:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// METADATA ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────

function extractArtistFromFilename(filename: string): string {
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

function enrichLocalTrackMetadata(song: Song, filePath?: string, folderName?: string): Song {
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

function isLocalTrack(track: Song | null | undefined): boolean {
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

function ensureQueueMetadata(queue: Song[]): Song[] {
  return queue.map(song => {
    if (isLocalTrack(song)) {
      return enrichLocalTrackMetadata(song, song.url);
    }
    return song;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE HELPERS (for metadata only - NEVER for stream URLs)
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NOT_FOUND_MSG = 'track_stats';

const safeGetTrackStats = async (videoId: string) => {
  try {
    return await supabaseCache.getTrackStats(videoId);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG)) {
      console.warn('[MusicPlayer] getTrackStats error:', e?.message);
    }
    return null;
  }
};

const safeSaveTrackStats = async (params: any) => {
  try {
    await supabaseCache.saveTrackStats(params);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG)) {
      console.warn('[MusicPlayer] saveTrackStats error:', e?.message);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UUID V5 (SHA-1 based)
// ─────────────────────────────────────────────────────────────────────────────

const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid: string): number[] {
  return uuid.replace(/-/g, '').match(/.{2}/g)!.map(h => parseInt(h, 16));
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const H = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
  const msg = Array.from(data);
  const bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  for (let i = 0; i < msg.length; i += 64) {
    const W: number[] = [];
    for (let t = 0; t < 16; t++) {
      W[t] =
        (msg[i + t * 4] << 24) |
        (msg[i + t * 4 + 1] << 16) |
        (msg[i + t * 4 + 2] << 8) |
        msg[i + t * 4 + 3];
    }
    for (let t = 16; t < 80; t++) {
      const v = W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16];
      W[t] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    let [a, b, c, d, e] = H;
    for (let t = 0; t < 80; t++) {
      const rot = ((a << 5) | (a >>> 27)) >>> 0;
      let f: number, k: number;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const temp = (rot + f + e + k + W[t]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  H.forEach((v, i) => {
    out[i * 4] = (v >>> 24) & 0xff; out[i * 4 + 1] = (v >>> 16) & 0xff;
    out[i * 4 + 2] = (v >>> 8) & 0xff; out[i * 4 + 3] = v & 0xff;
  });
  return out;
}

const uuidCache = new Map<string, string>();

async function videoIdToUuid(videoId: string): Promise<string> {
  if (uuidCache.has(videoId)) return uuidCache.get(videoId)!;
  const nsBytes = uuidToBytes(UUID_NAMESPACE);
  const idBytes = Array.from(new TextEncoder().encode(videoId));
  const combined = new Uint8Array([...nsBytes, ...idBytes]);
  const hash = await sha1(combined);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = Array.from(hash.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  uuidCache.set(videoId, uuid);
  return uuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACK EXTRAS STORE
// ─────────────────────────────────────────────────────────────────────────────

const trackExtrasStore = new Map<string, TrackExtras>();
let trackExtrasVersion = 0;
const trackExtrasVersionListeners = new Set<() => void>();

function notifyTrackExtrasChange() {
  trackExtrasVersion++;
  trackExtrasVersionListeners.forEach(fn => fn());
}

export function storeTrackExtras(trackId: string, extras: TrackExtras): void {
  if (trackExtrasStore.size >= CONFIG.MAX_EXTRAS_CACHE) {
    const firstKey = trackExtrasStore.keys().next().value;
    if (firstKey) trackExtrasStore.delete(firstKey);
  }
  trackExtrasStore.set(trackId, extras);
  notifyTrackExtrasChange();

  if (trackId && extras) {
    const persistent = extractPersistentMetadata(extras);
    const hasMeaningfulData =
      (persistent.likeCount !== undefined && persistent.likeCount !== -1) ||
      (persistent.viewCount !== undefined && persistent.viewCount !== -1) ||
      (persistent.commentsCount !== undefined && persistent.commentsCount !== -1) ||
      persistent.uploaderUrl ||
      persistent.videoId;

    if (hasMeaningfulData) {
      setCachedTrackExtras(trackId, persistent).catch(() => {});
    }
  }
}

export function getTrackExtras(trackId: string | undefined | null): TrackExtras | null {
  if (!trackId) return null;
  const memoryResult = trackExtrasStore.get(trackId);
  if (memoryResult) return memoryResult;
  const persistedResult = getCachedTrackExtrasSync(trackId);
  if (persistedResult) {
    trackExtrasStore.set(trackId, persistedResult);
    notifyTrackExtrasChange();
    return persistedResult;
  }
  return null;
}

export function useTrackExtrasVersion(): number {
  const [version, setVersion] = useState(trackExtrasVersion);
  useEffect(() => {
    const listener = () => setVersion(trackExtrasVersion);
    trackExtrasVersionListeners.add(listener);
    return () => { trackExtrasVersionListeners.delete(listener); };
  }, []);
  return version;
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAM PICKING (for progressive URLs only - fallback when manifests unavailable)
// ─────────────────────────────────────────────────────────────────────────────

function pickBestAudio(streams: AudioStream[]): AudioStream | null {
  if (!streams?.length) return null;
  const direct = streams.filter(s => s.isUrl && !s.manifestUrl);
  const pool = direct.length ? direct : streams;
  return pool.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), pool[0]);
}

function pickBestVideo(streams: VideoStream[]): VideoStream | null {
  if (!streams?.length) return null;
  const withVideo = streams.filter(s => s.height > 0 && s.isUrl);
  if (!withVideo.length) return null;
  const p720 = withVideo.find(s => s.height === 720);
  if (p720) return p720;
  return withVideo.reduce((best, s) => (s.height > best.height ? s : best), withVideo[0]);
}

function pickBestVideoOnlyManifest(streams: VideoStream[]): VideoStream | null {
  if (!streams?.length) return null;
  // Prefer DASH/HLS manifests for video-only streams - these are not IP-bound
  const withManifest = streams.filter(s => !s.isUrl && s.manifestUrl);
  if (withManifest.length > 0) {
    // Return the highest resolution manifest-based stream
    return withManifest.reduce((best, s) => (s.height > best.height ? s : best), withManifest[0]);
  }
  // Fallback to progressive if no manifest available (rare)
  const withVideo = streams.filter(s => s.height > 0 && s.isUrl);
  if (!withVideo.length) return null;
  const p720 = withVideo.find(s => s.height === 720);
  if (p720) return p720;
  return withVideo.reduce((best, s) => (s.height > best.height ? s : best), withVideo[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE STREAM CACHE — REMOVED: Manifest URLs are never cached.
// Only metadata is cached. Stream URLs are resolved atomically at playback time.
// Manifest URLs are stable and don't expire like progressive URLs.
// ─────────────────────────────────────────────────────────────────────────────

function buildExtras(
  song: Song,
  info: any,
  dashManifestUrl: string | null,
  hlsManifestUrl: string | null,
  videoOnlyManifestUrl: string | null,
  videoOnlyProgressiveUrl: string | null,
  muxedProgressiveUrl: string | null,
  commentsCount: number,
): TrackExtras {
  return {
    dashManifestUrl: dashManifestUrl ?? undefined,
    hlsManifestUrl: hlsManifestUrl ?? undefined,
    videoOnlyManifestUrl: videoOnlyManifestUrl ?? undefined,
    videoUrl: videoOnlyProgressiveUrl ?? undefined,
    muxedVideoUrl: muxedProgressiveUrl ?? undefined,
    videoId: song.videoId,
    uploaderUrl: (info.uploaderUrl as string | undefined) ?? undefined,
    likeCount: typeof info.likeCount === 'number' && info.likeCount > 0 ? Math.round(info.likeCount) : -1,
    dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
    viewCount: typeof info.viewCount === 'number' && info.viewCount > 0 ? Math.round(info.viewCount) : -1,
    commentsCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED RESOLVE TRACK WITH RETRY (Updated for NewPipeExtractor v0.26.2)
// RETURNS MANIFEST URLS FOR PLAYBACK, PROGRESSIVE URLS FOR DOWNLOADS ONLY
// ─────────────────────────────────────────────────────────────────────────────

async function resolveTrackWithRetry(song: Song, attempt = 1, startTime = Date.now()): Promise<ResolvedTrack | null> {
  try {
    return await resolveTrack(song);
  } catch (error: any) {
    const errorMessage = error?.message || '';
    
    const isParsingError = 
      errorMessage.includes('ParsingException') || 
      errorMessage.includes('null object reference') ||
      errorMessage.includes('Could not get') ||
      errorMessage.includes('Embedded info did not provide') ||
      errorMessage.includes('lockupViewModel') ||
      errorMessage.includes('duration') ||
      errorMessage.includes('fetching duration');
    
    const isSslError = 
      errorMessage.includes('SSLHandshakeException') ||
      errorMessage.includes('SSL') ||
      errorMessage.includes('connection closed') ||
      errorMessage.includes('CertificateException');
    
    const isNetworkError =
      errorMessage.includes('SocketTimeoutException') ||
      errorMessage.includes('ConnectException') ||
      errorMessage.includes('UnknownHostException') ||
      errorMessage.includes('timeout');
    
    const isAccountTerminated = errorMessage.includes('ACCOUNT_TERMINATED');
    const isSignInRequired = errorMessage.includes('Sign in to confirm');
    
    if (isAccountTerminated) {
      console.error(`[MusicPlayer] Account terminated for "${song.title}"`);
      setSessionPartial({ lastError: 'YouTube account terminated. Please check your connection.' });
      return null;
    }
    
    const isRetryable = (isParsingError || isSslError || isNetworkError) && 
                        attempt < CONFIG.RESOLVE_RETRY_MAX_ATTEMPTS &&
                        (Date.now() - startTime) < 80000;
    
    if (isRetryable) {
      if (isParsingError) {
        try {
          await MavinEngine.refreshVisitorData();
          console.log('[MusicPlayer] Refreshed visitor data for retry');
        } catch (e) {}
        console.warn(`[MusicPlayer] Parsing error on attempt ${attempt}, retrying`);
      } else if (isSslError) {
        console.warn(`[MusicPlayer] SSL error on attempt ${attempt}, retrying`);
      } else if (isNetworkError) {
        console.warn(`[MusicPlayer] Network error on attempt ${attempt}, retrying`);
      }
      
      const delayMs = CONFIG.RESOLVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await delay(delayMs);
      return resolveTrackWithRetry(song, attempt + 1, startTime);
    }
    
    if (isSignInRequired) {
      console.warn(`[MusicPlayer] Sign-in required for "${song.title}" - this video may be age-restricted`);
    }
    
    throw error;
  }
}

async function getStreamInfoWithFallback(url: string, videoId?: string, songTitle?: string): Promise<any> {
  const errors: string[] = [];
  
  if (videoId) {
    try {
      console.log(`[MusicPlayer] Trying getStreamInfoById with videoId: ${videoId}`);
      const info = await MavinEngine.getStreamInfoById(videoId, 0);
      if (info.success) {
        console.log(`[MusicPlayer] ✓ getStreamInfoById succeeded`);
        return info;
      }
      errors.push(`getStreamInfoById: ${info.message || 'no success'}`);
    } catch (err: any) {
      errors.push(`getStreamInfoById: ${err?.message || err}`);
      console.warn(`[MusicPlayer] getStreamInfoById failed:`, err?.message);
    }
  }
  
  try {
    console.log(`[MusicPlayer] Trying getStreamInfo with URL`);
    const info = await MavinEngine.getStreamInfo(url, 0);
    if (info.success) {
      console.log(`[MusicPlayer] ✓ getStreamInfo succeeded`);
      return info;
    }
    errors.push(`getStreamInfo: ${info.message || 'no success'}`);
  } catch (err: any) {
    errors.push(`getStreamInfo: ${err?.message || err}`);
    console.warn(`[MusicPlayer] getStreamInfo failed:`, err?.message);
  }
  
  try {
    console.log(`[MusicPlayer] Trying getStreamInfo with serviceId 0 (explicit)`);
    const info = await MavinEngine.getStreamInfo(url, 0);
    if (info.success) {
      console.log(`[MusicPlayer] ✓ getStreamInfo with explicit serviceId succeeded`);
      return info;
    }
  } catch (err: any) {
    errors.push(`getStreamInfo(serviceId=0): ${err?.message || err}`);
  }
  
  if (videoId) {
    try {
      console.log(`[MusicPlayer] Trying getStreamInfoById with fresh visitor data`);
      await MavinEngine.refreshVisitorData();
      const info = await MavinEngine.getStreamInfoById(videoId, 0);
      if (info.success) {
        console.log(`[MusicPlayer] ✓ getStreamInfoById with fresh visitor data succeeded`);
        return info;
      }
    } catch (err: any) {
      errors.push(`getStreamInfoById (fresh visitor data): ${err?.message || err}`);
    }
  }
  
  throw new Error(`All stream info methods failed: ${errors.join('; ')}`);
}

export const resolveTrack = async (song: Song, bypassCache = false): Promise<ResolvedTrack | null> => {
  const url = song.url || '';
  if (!url) {
    console.warn(`[MusicPlayer] Track "${song.title}" has no URL`);
    return null;
  }

  const isLocal =
    url.startsWith('file://') || url.startsWith('/') || url.startsWith('content://') ||
    (song as any).isLocal === true || (song as any).isDownloaded === true;

  if (isLocal) {
    const enrichedSong = enrichLocalTrackMetadata(song, url);
    let finalUrl = enrichedSong.url!;
    if (finalUrl.startsWith('content://')) {
      const cachedPath = await cacheLocalFileForPlayback(finalUrl, enrichedSong.id);
      if (cachedPath) {
        finalUrl = cachedPath;
      } else {
        console.error('[MusicPlayer] Failed to cache content URI, playback may fail');
      }
    } else if (finalUrl.startsWith('/')) {
      finalUrl = `file://${finalUrl}`;
    }
    storeTrackExtras(enrichedSong.id, {
      isLocal: true, videoId: song.videoId,
      likeCount: -1, dislikeCount: -1, viewCount: -1, commentsCount: -1,
      hasAudio: true,
      hasVideo: false,
      isAudioOnly: true,
      isVideoOnly: false,
    });
    return {
      id: enrichedSong.id, url: finalUrl, title: enrichedSong.title,
      artist: enrichedSong.artist, thumbnail: enrichedSong.thumbnail,
      duration: enrichedSong.duration, videoId: enrichedSong.videoId,
      isDownloaded: true, isLocal: true,
      muxedVideoUrl: undefined,
      videoOnlyUrl: undefined,
      dashManifestUrl: undefined,
      hlsManifestUrl: undefined,
      videoOnlyManifestUrl: undefined,
      hasAudio: true,
      hasVideo: false,
      isAudioOnly: true,
      isVideoOnly: false,
    };
  }

  // Load metadata from disk cache (NOT stream URLs)
  if (song.id && !bypassCache) {
    const diskCached = await getCachedTrackExtras(song.id);
    if (diskCached) {
      const existing = trackExtrasStore.get(song.id);
      if (!existing) {
        trackExtrasStore.set(song.id, diskCached);
        notifyTrackExtrasChange();
      }
    }
  }

  // PRIMARY EXTRACTION with enhanced fallback - GET MANIFEST URLS
  try {
    let videoId = song.videoId;
    if (!videoId && song.url) {
      if (song.url.includes('v=')) {
        videoId = song.url.split('v=')[1]?.split('&')[0];
      } else if (song.url.includes('youtu.be/')) {
        videoId = song.url.split('youtu.be/')[1]?.split('?')[0];
      }
    }
    
    try {
      const visitorStatus = await MavinEngine.getVisitorDataStatus();
      if (!visitorStatus.isValid) {
        console.log('[MusicPlayer] Visitor data invalid, refreshing before extraction');
        await MavinEngine.refreshVisitorData();
      }
    } catch (e) {
      console.warn('[MusicPlayer] Could not check visitor data status:', e);
    }
    
    const info = await getStreamInfoWithFallback(song.url, videoId, song.title);
    
    if (!info.success) {
      if (info.error === 'ACCOUNT_TERMINATED') {
        console.warn(`[MusicPlayer] Account terminated for "${song.title}"`);
        setSessionPartial({ lastError: 'Account terminated. Please check your connection.' });
        return null;
      }
      throw new Error(`extraction returned success=false: ${info.message || 'unknown error'}`);
    }

    // Extract manifest URLs (primary playback method - NOT IP-bound)
    const dashManifestUrl: string | null = info.dashMpdUrl?.length > 0 ? info.dashMpdUrl : null;
    const hlsManifestUrl: string | null = info.hlsUrl?.length > 0 ? info.hlsUrl : null;
    
    // Extract video-only manifest URL from videoOnlyStreams (for slave player)
    const videoOnlyStreams: VideoStream[] = info.videoOnlyStreams ?? [];
    const bestVideoOnly = pickBestVideoOnlyManifest(videoOnlyStreams);
    const videoOnlyManifestUrl: string | null = bestVideoOnly?.manifestUrl?.length > 0 ? bestVideoOnly.manifestUrl : null;
    
    // Progressive URLs (for DOWNLOADS ONLY - NOT for streaming)
    const bestAudio = pickBestAudio(info.audioStreams ?? []);
    const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
    const bestMuxed = pickBestVideo(info.videoStreams ?? []);

    let audioProgressiveUrl: string | null = null;
    let videoProgressiveUrl: string | null = null;
    let muxedProgressiveUrl: string | null = null;
    let isAudioOnly = false;
    let isVideoOnly = false;
    let hasAudio = false;
    let hasVideo = false;

    if (bestAudio?.url) { audioProgressiveUrl = bestAudio.url; hasAudio = true; }
    if (bestVideo?.url) { videoProgressiveUrl = bestVideo.url; hasVideo = true; }
    if (bestMuxed?.url) { muxedProgressiveUrl = bestMuxed.url; hasVideo = true; }

    if (!audioProgressiveUrl && (videoProgressiveUrl || muxedProgressiveUrl)) {
      console.log(`[MusicPlayer] Video-only track detected for "${song.title}"`);
      audioProgressiveUrl = muxedProgressiveUrl || videoProgressiveUrl;
      hasAudio = true;
      isVideoOnly = true;
    }

    if (audioProgressiveUrl && !videoProgressiveUrl && !muxedProgressiveUrl) {
      console.log(`[MusicPlayer] Audio-only track detected for "${song.title}"`);
      isAudioOnly = true;
      hasVideo = false;
    }

    if (audioProgressiveUrl && (videoProgressiveUrl || muxedProgressiveUrl)) {
      hasAudio = true; hasVideo = true;
      isAudioOnly = false; isVideoOnly = false;
    }

    if (!audioProgressiveUrl) {
      const lowerQualityAudio = pickBestAudio(info.audioStreams?.filter(s => s.bitrate && s.bitrate < 128) ?? []);
      if (lowerQualityAudio?.url) {
        audioProgressiveUrl = lowerQualityAudio.url;
        hasAudio = true;
        console.log(`[MusicPlayer] Falling back to lower quality audio for "${song.title}"`);
      }
    }

    // PRIMARY PLAYBACK URL: DASH manifest first, HLS as fallback, progressive as last resort
    let primaryPlaybackUrl: string | null = null;
    if (dashManifestUrl) {
      primaryPlaybackUrl = dashManifestUrl;
      console.log(`[MusicPlayer] Using DASH manifest for "${song.title}"`);
    } else if (hlsManifestUrl) {
      primaryPlaybackUrl = hlsManifestUrl;
      console.log(`[MusicPlayer] Using HLS manifest for "${song.title}"`);
    } else if (audioProgressiveUrl) {
      // This should be rare - manifests are almost always available for YouTube
      console.warn(`[MusicPlayer] No manifest available for "${song.title}", falling back to progressive URL (may cause 403)`);
      primaryPlaybackUrl = audioProgressiveUrl;
    }

    if (!primaryPlaybackUrl) {
      console.warn(`[MusicPlayer] No playable URL found for "${song.title}"`);
      return null;
    }

    const duration = info.duration ?? 0;
    const commentsCount = typeof info.commentsCount === 'number' ? info.commentsCount : -1;
    const extras = buildExtras(
      song, info,
      dashManifestUrl,
      hlsManifestUrl,
      videoOnlyManifestUrl,
      videoProgressiveUrl,
      muxedProgressiveUrl,
      commentsCount
    );
    storeTrackExtras(song.id, { ...extras, hasAudio, hasVideo, isAudioOnly, isVideoOnly });
    
    // Save metadata only — NEVER cache stream URLs
    if (song.videoId) {
      safeSaveTrackStats({
        videoId: song.videoId, likeCount: extras.likeCount ?? -1,
        dislikeCount: extras.dislikeCount ?? -1, viewCount: extras.viewCount ?? -1,
        commentsCount, uploaderUrl: extras.uploaderUrl ?? null,
      });
    }

    console.log(`[MusicPlayer] Resolved track "${song.title}":`, { 
      hasAudio, hasVideo, isAudioOnly, isVideoOnly, duration,
      hasDash: !!dashManifestUrl,
      hasHls: !!hlsManifestUrl,
      hasVideoManifest: !!videoOnlyManifestUrl
    });

    return {
      id: song.id,
      url: primaryPlaybackUrl,
      title: info.title ?? song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      duration: duration > 0 ? duration : undefined,
      videoId: song.videoId,
      isDownloaded: false,
      isLocal: false,
      videoOnlyUrl: videoProgressiveUrl ?? undefined,
      muxedVideoUrl: muxedProgressiveUrl ?? undefined,
      dashManifestUrl: dashManifestUrl ?? undefined,
      hlsManifestUrl: hlsManifestUrl ?? undefined,
      videoOnlyManifestUrl: videoOnlyManifestUrl ?? undefined,
      hasAudio,
      hasVideo,
      isAudioOnly,
      isVideoOnly,
    };
  } catch (primaryErr: any) {
    const errorMsg = primaryErr?.message || String(primaryErr);
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, errorMsg);
    
    if (errorMsg === 'ACCOUNT_TERMINATED') {
      return null;
    }
  }

  // SEARCH FALLBACK STRATEGIES - Enhanced for v0.26.2
  const searchStrategies = [
    { query: `${song.title} ${song.artist}`, filter: 'music_songs' as const, priority: 1 },
    { query: `${song.title} ${song.artist} official audio`, filter: 'videos' as const, priority: 2 },
    { query: `${song.title.replace(/[\(\[].*?[\)\]]/g, '').trim()} ${song.artist}`, filter: 'music_songs' as const, priority: 3 },
    { query: `${song.title}`, filter: 'music_songs' as const, priority: 4 },
    { query: `${song.title} ${song.artist}`, filter: 'videos' as const, priority: 5 },
    { query: `${song.title} ${song.artist} song`, filter: 'videos' as const, priority: 6 },
  ];

  searchStrategies.sort((a, b) => a.priority - b.priority);

  for (const strategy of searchStrategies) {
    try {
      console.log(`[MusicPlayer] Search attempt: "${strategy.query}" (filter: ${strategy.filter})`);
      const searchResult = await MavinEngine.search(strategy.query, strategy.filter, undefined, 0);
      
      if (!searchResult.success || !searchResult.results?.length) {
        console.log(`[MusicPlayer] Search returned no results`);
        continue;
      }

      let firstStream = searchResult.results.find(
        (i): i is StreamInfoItem => i.type === 'stream' && !i.isLive && !i.isShortFormContent
      );
      
      if (!firstStream && strategy.filter === 'music_songs') {
        const anyResult = searchResult.results[0];
        if (anyResult && anyResult.type === 'stream') {
          firstStream = anyResult as StreamInfoItem;
        }
      }
      
      if (!firstStream?.url) {
        console.log(`[MusicPlayer] No valid stream URL found`);
        continue;
      }

      console.log(`[MusicPlayer] Found match: "${firstStream.name}" by ${firstStream.uploaderName}`);

      let foundVideoId = firstStream.url.includes('v=') 
        ? firstStream.url.split('v=')[1]?.split('&')[0]
        : firstStream.url.includes('youtu.be/')
          ? firstStream.url.split('youtu.be/')[1]?.split('?')[0]
          : null;

      let info;
      if (foundVideoId) {
        info = await MavinEngine.getStreamInfoById(foundVideoId, 0);
      } else {
        info = await MavinEngine.getStreamInfo(firstStream.url, 0);
      }
      
      if (!info.success) {
        console.log(`[MusicPlayer] Stream info extraction failed for found URL`);
        continue;
      }

      // Extract manifest URLs from search result
      const dashManifestUrl: string | null = info.dashMpdUrl?.length > 0 ? info.dashMpdUrl : null;
      const hlsManifestUrl: string | null = info.hlsUrl?.length > 0 ? info.hlsUrl : null;
      const videoOnlyStreams: VideoStream[] = info.videoOnlyStreams ?? [];
      const bestVideoOnly = pickBestVideoOnlyManifest(videoOnlyStreams);
      const videoOnlyManifestUrl: string | null = bestVideoOnly?.manifestUrl?.length > 0 ? bestVideoOnly.manifestUrl : null;

      // Progressive URLs (for downloads only)
      const bestAudio = pickBestAudio(info.audioStreams ?? []);
      const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
      const bestMuxed = pickBestVideo(info.videoStreams ?? []);

      let audioProgressiveUrl: string | null = null;
      let videoProgressiveUrl: string | null = null;
      let muxedProgressiveUrl: string | null = null;
      let isAudioOnly = false;
      let isVideoOnly = false;
      let hasAudio = false;
      let hasVideo = false;

      if (bestAudio?.url) { audioProgressiveUrl = bestAudio.url; hasAudio = true; }
      if (bestVideo?.url) { videoProgressiveUrl = bestVideo.url; hasVideo = true; }
      if (bestMuxed?.url) { muxedProgressiveUrl = bestMuxed.url; hasVideo = true; }

      if (!audioProgressiveUrl && (videoProgressiveUrl || muxedProgressiveUrl)) { 
        audioProgressiveUrl = muxedProgressiveUrl || videoProgressiveUrl; 
        hasAudio = true; 
        isVideoOnly = true; 
      }
      if (audioProgressiveUrl && !videoProgressiveUrl && !muxedProgressiveUrl) { 
        isAudioOnly = true; 
        hasVideo = false; 
      }
      if (audioProgressiveUrl && (videoProgressiveUrl || muxedProgressiveUrl)) { 
        hasAudio = true; 
        hasVideo = true; 
      }
      if (!audioProgressiveUrl) continue;

      // Primary playback URL: manifest first
      let primaryPlaybackUrl = dashManifestUrl ?? hlsManifestUrl ?? audioProgressiveUrl;
      if (!primaryPlaybackUrl) continue;

      const duration = info.duration ?? 0;
      const extras = buildExtras(
        song, info,
        dashManifestUrl,
        hlsManifestUrl,
        videoOnlyManifestUrl,
        videoProgressiveUrl,
        muxedProgressiveUrl,
        -1
      );
      storeTrackExtras(song.id, { ...extras, hasAudio, hasVideo, isAudioOnly, isVideoOnly });

      console.log(`[MusicPlayer] ✓ Search fallback succeeded for "${song.title}"`);

      return {
        id: song.id,
        url: primaryPlaybackUrl,
        title: info.title ?? song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        duration: duration > 0 ? duration : undefined,
        videoId: song.videoId,
        isDownloaded: false,
        isLocal: false,
        videoOnlyUrl: videoProgressiveUrl ?? undefined,
        muxedVideoUrl: muxedProgressiveUrl ?? undefined,
        dashManifestUrl: dashManifestUrl ?? undefined,
        hlsManifestUrl: hlsManifestUrl ?? undefined,
        videoOnlyManifestUrl: videoOnlyManifestUrl ?? undefined,
        hasAudio,
        hasVideo,
        isAudioOnly,
        isVideoOnly,
      };
    } catch (searchErr: any) {
      console.warn(`[MusicPlayer] Search strategy failed for "${strategy.query}":`, searchErr?.message || searchErr);
    }
  }

  console.warn(`[MusicPlayer] All strategies exhausted for "${song.title}"`);
  return null;
};

// Module-level cache for related songs fallback
let lastRelatedSongsCache: Song[] = [];

const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  if (!songUrl) return [];
  try {
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];
    const related = info.relatedItems
      .filter((i): i is StreamInfoItem => i.type === 'stream')
      .filter(s => !s.isLive && !s.isShortFormContent)
      .slice(0, 20)
      .map(s => {
        const videoId = s.url.includes('v=')
          ? s.url.split('v=')[1]?.split('&')[0]
          : s.url.includes('youtu.be/')
            ? s.url.split('youtu.be/')[1]?.split('?')[0]
            : s.url;
        return {
          id: videoId ?? s.url, title: s.name, artist: s.uploaderName,
          thumbnail:
            s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url ??
            s.thumbnails[0]?.url ?? '',
          url: s.url, videoId: videoId ?? undefined,
        };
      });
    if (related.length > 0) {
      lastRelatedSongsCache = related;
    }
    return related;
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC STORAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function saveLastPlayingState(track: Song | null, position?: number): Promise<void> {
  try {
    if (track && track.id && track.title && track.url) {
      const trackToSave = {
        id: track.id, title: track.title, artist: track.artist || 'Unknown Artist',
        url: track.url, thumbnail: track.thumbnail, duration: track.duration, videoId: track.videoId,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_TRACK, JSON.stringify(trackToSave));
      if (position !== undefined) {
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_POSITION, String(position));
      }
    } else {
      await AsyncStorage.multiRemove([STORAGE_KEYS.LAST_PLAYING_TRACK, STORAGE_KEYS.LAST_PLAYING_POSITION]);
    }
  } catch (error) {
    console.warn('[MusicPlayer] Failed to save last playing state:', error);
  }
}

async function saveLastActiveTab(tab: 'song' | 'video'): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.LAST_ACTIVE_TAB, tab); } catch {}
}

async function saveLastVideoPosition(position: number): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.LAST_VIDEO_POSITION, String(position)); } catch {}
}

async function restoreLastPlayingState(): Promise<{ track: Song | null; position: number }> {
  try {
    const trackJson = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_TRACK);
    const positionStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_POSITION);
    if (!trackJson) return { track: null, position: 0 };
    const parsed = JSON.parse(trackJson);
    if (!parsed.id || !parsed.title || !parsed.url) return { track: null, position: 0 };
    return {
      track: {
        id: parsed.id, title: parsed.title, artist: parsed.artist || 'Unknown Artist',
        url: parsed.url, thumbnail: parsed.thumbnail, duration: parsed.duration, videoId: parsed.videoId,
      },
      position: positionStr ? parseFloat(positionStr) : 0,
    };
  } catch (error) {
    console.warn('[MusicPlayer] Failed to restore state:', error);
    return { track: null, position: 0 };
  }
}

async function restoreLastActiveTab(): Promise<'song' | 'video' | null> {
  try {
    const tab = await AsyncStorage.getItem(STORAGE_KEYS.LAST_ACTIVE_TAB);
    return tab === 'song' || tab === 'video' ? tab : null;
  } catch { return null; }
}

async function restoreLastVideoPosition(): Promise<number> {
  try {
    const pos = await AsyncStorage.getItem(STORAGE_KEYS.LAST_VIDEO_POSITION);
    return pos ? parseFloat(pos) : 0;
  } catch { return 0; }
}

async function saveRepeatMode(mode: RepeatMode): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.REPEAT_MODE, mode); } catch {}
}

async function saveShuffleMode(mode: ShuffleMode): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.SHUFFLE_MODE, mode); } catch {}
}

async function savePlaybackRate(rate: number): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.PLAYBACK_RATE, String(rate)); } catch {}
}

async function saveVolume(volume: number): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.VOLUME, String(volume)); } catch {}
}

async function savePreservePitch(preserve: boolean): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEYS.PRESERVE_PITCH, String(preserve)); } catch {}
}

async function restorePlaybackRate(): Promise<number> {
  try {
    const rate = await AsyncStorage.getItem(STORAGE_KEYS.PLAYBACK_RATE);
    return rate ? parseFloat(rate) : 1.0;
  } catch { return 1.0; }
}

async function restoreVolume(): Promise<number> {
  try {
    const volume = await AsyncStorage.getItem(STORAGE_KEYS.VOLUME);
    return volume ? parseFloat(volume) : CONFIG.DEFAULT_VOLUME;
  } catch { return CONFIG.DEFAULT_VOLUME; }
}

async function restorePreservePitch(): Promise<boolean> {
  try {
    const preserve = await AsyncStorage.getItem(STORAGE_KEYS.PRESERVE_PITCH);
    return preserve ? preserve === 'true' : true;
  } catch { return true; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER ENGINE STATE INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerEngineState {
  currentTrack: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isResolving: boolean;
  position: number;
  duration: number;
  queue: Song[];
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  playbackRate: number;
  preservePitch: boolean;
  volume: number;
  hasVideoStream: boolean;
  isAudioOnlyTrack: boolean;
  isVideoOnlyTrack: boolean;

  play: () => void;
  pause: () => void;
  seekTo: (positionSec: number) => void;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  skipToIndex: (index: number) => Promise<void>;
  togglePlayPause: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleMode: (mode: ShuffleMode) => void;
  addToQueue: (songs: Song[]) => void;
  removeFromQueue: (index: number) => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
}

const PlayerEngineContext = createContext<PlayerEngineState | undefined>(undefined);

export const usePlayerEngine = (): PlayerEngineState => {
  const ctx = useContext(PlayerEngineContext);
  if (!ctx) throw new Error('usePlayerEngine must be used within MusicPlayerProvider');
  return ctx;
};

export interface MusicPlayerContextType {
  currentTrack: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  isResolving: boolean;
  position: number;
  duration: number;
  queue: Song[];
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  playbackRate: number;
  preservePitch: boolean;
  volume: number;
  hasVideoStream: boolean;
  isAudioOnlyTrack: boolean;
  isVideoOnlyTrack: boolean;

  playAudio: (song: Song, playlist?: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playPlaylist: (songs: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playNext: (songs: Song[] | null) => Promise<void>;
  playDownloadedSong: (
    song: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => Promise<void>;
  playAllDownloadedSongs: (
    songs: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => Promise<void>;
  togglePlayPause: () => void;
  seekTo: (position: number) => void;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  skipToIndex: (index: number) => Promise<void>;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleMode: (mode: ShuffleMode) => void;
  addToQueue: (songs: Song[]) => void;
  removeFromQueue: (index: number) => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
  isLocalTrack: (track?: Song | null) => boolean;
  isVideoActive: boolean;
  videoPosition: number;
  videoDuration: number;
  videoIsPlaying: boolean;
  setVideoActive: (active: boolean) => void;
  updateVideoPosition: (position: number) => void;
  updateVideoDuration: (duration: number) => void;
  updateVideoIsPlaying: (isPlaying: boolean) => void;
  setPlaybackRate: (rate: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setPreservePitch: (preserve: boolean) => Promise<void>;
  setSleepTimer: (minutes: number) => void;
  clearSleepTimer: () => void;
  sleepTimerEndsAt: number | null;
  bufferedPosition: number;
  notifyVideoTrackFinished: () => Promise<void>;
  /** @deprecated No-op kept for backward compatibility with Search screen */
  deactivateAudio: () => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// MASTER PLAYER REFERENCE (set by playerContent.tsx)
// ─────────────────────────────────────────────────────────────────────────────

let masterPlayerRef: any = null;

export const setMasterPlayer = (player: any) => {
  masterPlayerRef = player;
  console.log('[MusicPlayer] Master player registered');
};

function getMasterPlayer(): any {
  if (!masterPlayerRef) {
    throw new Error('Master player not registered');
  }
  return masterPlayerRef;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT-DRIVEN WAIT FOR PLAYER READY
// Industry standard: Use statusChange event instead of polling .status property
// ─────────────────────────────────────────────────────────────────────────────

function waitForPlayerReady(
  player: any,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fast path: already ready
    if (player.status === 'readyToPlay') {
      resolve();
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let listener: any = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (listener) {
        try { listener.remove?.(); } catch {}
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Wait for ready aborted'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);

    listener = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'readyToPlay') {
        cleanup();
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
    });

    timeoutId = setTimeout(() => {
      cleanup();
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Player ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL APPSTATE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

let appStateSubscription: any = null;

function initAppStateHandler() {
  if (appStateSubscription) return;

  appStateSubscription = AppState.addEventListener('change', nextAppState => {
    if (nextAppState === 'background') {
      console.log('[MusicPlayer] App backgrounding - saving state');
      saveLastPlayingState(session.currentTrack, session.videoPosition);
      saveLastActiveTab(session.videoActive ? 'video' : 'song');
      if (session.videoActive) {
        saveLastVideoPosition(session.videoPosition);
      }
    } else if (nextAppState === 'active') {
      console.log('[MusicPlayer] App foregrounded');
    }
  });
}

initAppStateHandler();

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL RESTORE IIFE
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  const g = global as any;

  if (g[RESTORE_GLOBALS.DONE_KEY]) return;
  if (g[RESTORE_GLOBALS.IN_PROGRESS_KEY]) {
    console.log('[MusicPlayer] Clearing stale restore lock');
    g[RESTORE_GLOBALS.IN_PROGRESS_KEY] = false;
  }

  g[RESTORE_GLOBALS.IN_PROGRESS_KEY] = true;

  try {
    const { track, position: savedPos } = await restoreLastPlayingState();
    const savedTab = await restoreLastActiveTab();
    const savedVideoPos = await restoreLastVideoPosition();
    const savedPlaybackRate = await restorePlaybackRate();
    const savedVolume = await restoreVolume();
    const savedPreservePitch = await restorePreservePitch();

    if (savedPlaybackRate !== 1.0) {
      setSession('playbackRate', savedPlaybackRate);
    }
    if (savedVolume !== CONFIG.DEFAULT_VOLUME) {
      setSession('volume', savedVolume);
    }
    if (!savedPreservePitch) {
      setSession('preservePitch', savedPreservePitch);
    }

    if (!track?.url) {
      console.log('[MusicPlayer] Module-level restore: no saved track');
      return;
    }

    if (track.id) {
      const diskCached = await getCachedTrackExtras(track.id);
      if (diskCached) {
        trackExtrasStore.set(track.id, diskCached);
        notifyTrackExtrasChange();
        console.log('[MusicPlayer] Pre-loaded disk-cached metadata for restored track');
      }
    }

    console.log('[MusicPlayer] Module-level restore starting:', track.title);

    g[RESTORE_GLOBALS.TRACK_KEY] = track;
    g[RESTORE_GLOBALS.POSITION_KEY] = savedPos;
    g[RESTORE_GLOBALS.PLAYER_READY_KEY] = false;

    if (savedTab) {
      g[RESTORE_GLOBALS.RESTORED_TAB_KEY] = savedTab;
      g[RESTORE_GLOBALS.RESTORED_VIDEO_POSITION_KEY] = savedVideoPos;
    }

    // For restored tracks, re-resolve the stream to get fresh manifest URLs.
    // Manifest URLs are stable but we re-resolve anyway.
    let finalUrl: string | null = null;
    let videoOnlyManifestUrl: string | null = null;

    if (!isLocalTrack(track)) {
      try {
        const resolved = await resolveTrack(track);
        if (resolved?.url) {
          finalUrl = resolved.url;
          videoOnlyManifestUrl = resolved.videoOnlyManifestUrl ?? null;
          console.log('[MusicPlayer] Module-level restore: re-resolved fresh manifest URL');
        }
      } catch (e) {
        console.warn('[MusicPlayer] Module-level restore re-resolve failed:', e);
      }
    } else {
      finalUrl = normalizeLocalUri(track.url);
    }

    if (!finalUrl) {
      console.warn('[MusicPlayer] Module-level restore: could not resolve stream URL');
      return;
    }

    g[RESTORE_GLOBALS.RESOLVED_URL_KEY] = finalUrl;
    if (videoOnlyManifestUrl) {
      g[RESTORE_GLOBALS.VIDEO_ONLY_URL_KEY] = videoOnlyManifestUrl;
    }

    let attempts = 0;
    while (!masterPlayerRef && attempts < 50) {
      await delay(100);
      attempts++;
    }

    if (masterPlayerRef) {
      try {
        await masterPlayerRef.replaceAsync({ uri: finalUrl, useCaching: true });
        await waitForPlayerReady(masterPlayerRef, CONFIG.MANIFEST_LOAD_TIMEOUT_MS);
        
        if (savedPos > 5 && savedPos < (track.duration ?? Infinity)) {
          masterPlayerRef.currentTime = savedPos;
        }
        g[RESTORE_GLOBALS.PLAYER_READY_KEY] = true;
        console.log('[MusicPlayer] Module-level restore complete:', track.title);
      } catch (playerErr) {
        console.warn('[MusicPlayer] Module-level restore: player load failed:', playerErr);
      }
    } else {
      console.warn('[MusicPlayer] Module-level restore: master player not registered');
    }
  } catch (err) {
    console.warn('[MusicPlayer] Module-level restore failed:', err);
  } finally {
    (global as any)[RESTORE_GLOBALS.DONE_KEY] = true;
    (global as any)[RESTORE_GLOBALS.IN_PROGRESS_KEY] = false;
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// MAVIN ENGINE INITIALIZATION (v0.26.2)
// ─────────────────────────────────────────────────────────────────────────────

async function initializeMavinEngine() {
  try {
    console.log('[MavinEngine] Initializing with v0.26.2 features');
    
    const visitorResult = await MavinEngine.refreshVisitorData();
    console.log('[MavinEngine] Visitor data refresh:', visitorResult);
    
    const keyStatus = await MavinEngine.getApiKeyStatus();
    console.log('[MavinEngine] API Key status:', keyStatus);
    
    const visitorStatus = await MavinEngine.getVisitorDataStatus();
    console.log('[MavinEngine] Visitor data status:', visitorStatus);
    
    const config = await MavinEngine.getInnerTubeConfig();
    console.log('[MavinEngine] InnerTube client version:', config.clientVersion);
    
  } catch (err) {
    console.warn('[MavinEngine] Initialization warning:', err);
  }
}

initializeMavinEngine();

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL PLAYBACK ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

// Track skip state to prevent multiple simultaneous skips
let skipInProgress = false;
let lastSkipTime = 0;
const SKIP_DEBOUNCE_MS = 1000;

async function moduleLevelLoadAndPlay(song: Song, generation: number, isRetry = false): Promise<boolean> {
  // CRITICAL: Reset didHandleFinish at the very top of every track load
  session.didHandleFinish = false;
  
  if (generation !== session.playGeneration) {
    console.log('[MusicPlayer] moduleLevelLoadAndPlay skipped (stale generation)');
    return false;
  }

  if (!song || !song.id || !song.url) {
    console.error('[MusicPlayer] Invalid track in moduleLevelLoadAndPlay');
    setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Invalid track', optimisticPlaying: null });
    return false;
  }

  let enrichedSong = song;
  if (isLocalTrack(song)) {
    enrichedSong = enrichLocalTrackMetadata(song, song.url);
  }

  console.log(`[MusicPlayer] Module-level loading: "${enrichedSong.title || 'Unknown'}"`);
  setSessionPartial({
    currentTrack: enrichedSong,
    currentSongId: enrichedSong.id,
    isLoading: true,
    isResolving: true,
    lastError: null,
  });

  if (session.queueIndex >= 0 && session.queue[session.queueIndex]?.id === song.id) {
    const updatedQueue = [...session.queue];
    updatedQueue[session.queueIndex] = enrichedSong;
    setSession('queue', updatedQueue);
  }

  saveLastPlayingState(enrichedSong, 0);
  acquirePlaybackLockWithTimeout();

  try {
    let finalUrl: string | null = null;
    let videoOnlyManifestUrl: string | null = null;

    if (isLocalTrack(enrichedSong)) {
      finalUrl = normalizeLocalUri(enrichedSong.url);
      console.log(`[MusicPlayer] [Local] Direct playback: ${finalUrl.substring(0, 100)}...`);
      
      const master = getMasterPlayer();
      await master.replaceAsync({ uri: finalUrl, useCaching: true });
      await waitForPlayerReady(master, 5000);
      
      releasePlaybackLock();
      await master.play();
      
      setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true });
      return true;
    }

    // NON-LOCAL: Resolve track to get manifest URLs
    if (enrichedSong.id) {
      const diskCached = await getCachedTrackExtras(enrichedSong.id);
      if (diskCached && !trackExtrasStore.has(enrichedSong.id)) {
        trackExtrasStore.set(enrichedSong.id, diskCached);
        notifyTrackExtrasChange();
      }
    }

    // Resolve the track fresh - gets DASH/HLS manifest URLs primarily
    let resolved: ResolvedTrack | null = null;
    try {
      resolved = await resolveTrackWithRetry(enrichedSong);
    } catch (resolveErr: any) {
      console.error(`[MusicPlayer] Failed to resolve track: "${enrichedSong.title}"`, resolveErr?.message);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Failed to resolve stream', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }

    if (!resolved || !resolved.url) {
      console.error(`[MusicPlayer] No URL resolved for: "${enrichedSong.title}"`);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Failed to resolve stream', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }

    finalUrl = resolved.url;
    videoOnlyManifestUrl = resolved.videoOnlyManifestUrl ?? null;

    setSessionPartial({
      hasVideoStream: resolved.hasVideo,
      isAudioOnlyTrack: resolved.isAudioOnly,
      isVideoOnlyTrack: resolved.isVideoOnly,
    });

    const master = getMasterPlayer();
    
    console.log('[MusicPlayer] Loading manifest URL into master player:', finalUrl.substring(0, 100));
    
    try {
      // Load the manifest URL (DASH or HLS) into ExoPlayer
      await master.replaceAsync({ 
        uri: finalUrl, 
        useCaching: true,
        metadata: {
          title: enrichedSong.title,
          artist: enrichedSong.artist || 'Unknown Artist',
        }
      });
      console.log('[MusicPlayer] Master player.replace() done');
    } catch (playError: any) {
      // Manifest 403 is rare but can happen if manifest itself expired
      // We do NOT auto-retry with progressive URLs here - that would cause 403 loops
      if (!isRetry && playError?.message?.includes('403')) {
        console.warn('[MusicPlayer] Manifest 403 - showing error, not retrying with progressive');
        setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Stream expired. Please try again.', optimisticPlaying: null });
        releasePlaybackLock();
        return false;
      } else {
        throw playError;
      }
    }

    // Wait for player ready using event-driven approach (not polling)
    try {
      await waitForPlayerReady(master, CONFIG.MANIFEST_LOAD_TIMEOUT_MS);
      console.log('[MusicPlayer] Player ready (manifest loaded)');
    } catch (readyErr: any) {
      console.warn(`[MusicPlayer] Player not ready: ${readyErr?.message}`);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Player failed to load manifest', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }
    
    console.log('[MusicPlayer] Player ready, calling master.play() — master owns AudioFocus');
    await master.play();
    console.log('[MusicPlayer] ✅ master.play() called — audio should be playing');
    
    releasePlaybackLock();
    setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true });
    return true;

  } catch (error: any) {
    releasePlaybackLock();
    console.error(`[MusicPlayer] Error loading track: ${error?.message || error}`);
    setSessionPartial({ isLoading: false, isResolving: false, lastError: error?.message || 'Unknown error', optimisticPlaying: null });
    return false;
  }
}

async function moduleLevelSkipToNext(): Promise<void> {
  if (skipInProgress) {
    console.log('[MusicPlayer] Skip already in progress, ignoring');
    return;
  }
  
  const now = Date.now();
  if (now - lastSkipTime < SKIP_DEBOUNCE_MS) {
    console.log('[MusicPlayer] Skip debounced, too soon after last skip');
    return;
  }
  
  skipInProgress = true;
  lastSkipTime = now;
  
  try {
    const currentQueue = session.queue;
    const currentQueueIndex = session.queueIndex;
    const repeatMode = session.repeatMode;
    const preferredStreamType = session.preferredStreamType;

    console.log(`[MusicPlayer] Skip to next - index: ${currentQueueIndex}, queue length: ${currentQueue.length}`);

    if (repeatMode === 'one' && session.currentTrack) {
      try {
        const master = getMasterPlayer();
        master.currentTime = 0;
        await master.play();
        setSession('optimisticPlaying', true);
        console.log('[MusicPlayer] Repeated current track (repeat one mode)');
      } catch (error) {
        console.warn('[MusicPlayer] Failed to repeat track:', error);
      }
      return;
    }

    let nextIndex = currentQueueIndex + 1;
    let nextSong: Song | null = null;
    
    if (nextIndex < currentQueue.length) {
      nextSong = currentQueue[nextIndex];
      console.log(`[MusicPlayer] Playing next track: "${nextSong?.title}"`);
    } else if (repeatMode === 'all' && currentQueue.length > 0) {
      nextIndex = 0;
      nextSong = currentQueue[0];
      console.log(`[MusicPlayer] Repeating queue from start: "${nextSong?.title}"`);
    } else {
      console.log('[MusicPlayer] Queue exhausted, playback stopped');
      return;
    }

    if (nextSong) {
      if (preferredStreamType === 'video') {
        const extras = getTrackExtras(nextSong.id);
        const hasVideo = extras?.hasVideo === true || extras?.videoOnlyManifestUrl !== undefined;
        if (!hasVideo) {
          console.log(`[MusicPlayer] Next track "${nextSong.title}" has no video, staying in audio mode`);
        }
      }
      
      if (isLocalTrack(nextSong)) {
        nextSong = enrichLocalTrackMetadata(nextSong, nextSong.url);
        const updatedQueue = [...currentQueue];
        updatedQueue[nextIndex] = nextSong;
        setSession('queue', updatedQueue);
      }
      
      setSessionPartial({ queueIndex: nextIndex });
      const success = await moduleLevelLoadAndPlay(nextSong, ++session.playGeneration);
      if (success) {
        preloadNextTracks(currentQueue, nextIndex, session.bgAbortController?.signal);
      }
    }
  } finally {
    setTimeout(() => {
      skipInProgress = false;
    }, 500);
  }
}

async function moduleLevelSkipToPrevious(): Promise<void> {
  if (skipInProgress) {
    console.log('[MusicPlayer] Skip already in progress, ignoring');
    return;
  }
  
  const now = Date.now();
  if (now - lastSkipTime < SKIP_DEBOUNCE_MS) {
    console.log('[MusicPlayer] Skip debounced, too soon after last skip');
    return;
  }
  
  skipInProgress = true;
  lastSkipTime = now;
  
  try {
    const master = getMasterPlayer();
    const currentPosition = master.currentTime ?? 0;

    if (currentPosition > 3) {
      try {
        master.currentTime = 0;
        console.log('[MusicPlayer] Restarted current track');
      } catch {}
      return;
    }

    let prevIndex = session.queueIndex - 1;
    let prevSong: Song | null = null;
    
    if (prevIndex >= 0) {
      prevSong = session.queue[prevIndex];
    } else if (session.repeatMode === 'all' && session.queue.length > 0) {
      prevIndex = session.queue.length - 1;
      prevSong = session.queue[prevIndex];
    } else {
      try {
        master.currentTime = 0;
      } catch {}
      return;
    }

    if (prevSong) {
      if (isLocalTrack(prevSong)) {
        prevSong = enrichLocalTrackMetadata(prevSong, prevSong.url);
        const updatedQueue = [...session.queue];
        updatedQueue[prevIndex] = prevSong;
        setSession('queue', updatedQueue);
      }
      
      setSessionPartial({ queueIndex: prevIndex });
      const success = await moduleLevelLoadAndPlay(prevSong, ++session.playGeneration);
      if (success) {
        preloadNextTracks(session.queue, prevIndex, session.bgAbortController?.signal);
      }
    }
  } finally {
    setTimeout(() => {
      skipInProgress = false;
    }, 500);
  }
}

async function moduleLevelSkipToIndex(index: number): Promise<void> {
  if (skipInProgress) {
    console.log('[MusicPlayer] Skip already in progress, ignoring');
    return;
  }
  
  if (index < 0 || index >= session.queue.length) return;

  skipInProgress = true;
  
  try {
    let targetSong = session.queue[index];
    
    if (isLocalTrack(targetSong)) {
      targetSong = enrichLocalTrackMetadata(targetSong, targetSong.url);
      const updatedQueue = [...session.queue];
      updatedQueue[index] = targetSong;
      setSession('queue', updatedQueue);
    }
    
    setSessionPartial({ queueIndex: index });
    const success = await moduleLevelLoadAndPlay(targetSong, ++session.playGeneration);
    if (success) {
      preloadNextTracks(session.queue, index, session.bgAbortController?.signal);
    }
  } finally {
    setTimeout(() => {
      skipInProgress = false;
    }, 500);
  }
}

function moduleLevelAddToQueue(songs: Song[]): void {
  const enrichedSongs = ensureQueueMetadata(songs);
  updateQueue(prev => [...prev, ...enrichedSongs]);
}

function moduleLevelRemoveFromQueue(index: number): void {
  if (index < 0 || index >= session.queue.length) return;
  
  // Abort any in-flight background preload before modifying queue
  session.bgAbortController?.abort();
  const newAbortController = new AbortController();
  setSession('bgAbortController', newAbortController);
  
  updateQueue(prev => {
    const newQueue = [...prev];
    newQueue.splice(index, 1);
    if (session.queueIndex > index) {
      setSession('queueIndex', session.queueIndex - 1);
    } else if (session.queueIndex === index && session.currentTrack) {
      const nextIndex = session.queueIndex;
      if (nextIndex < newQueue.length) {
        moduleLevelSkipToIndex(nextIndex);
      } else {
        setSession('queueIndex', -1);
        setSession('currentTrack', null);
      }
    }
    return newQueue;
  });
}

function moduleLevelMoveQueueItem(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  updateQueue(prev => {
    const newQueue = [...prev];
    const [movedItem] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedItem);
    if (session.queueIndex === fromIndex) {
      setSession('queueIndex', toIndex);
    } else if (session.queueIndex > fromIndex && session.queueIndex <= toIndex) {
      setSession('queueIndex', session.queueIndex - 1);
    } else if (session.queueIndex < fromIndex && session.queueIndex >= toIndex) {
      setSession('queueIndex', session.queueIndex + 1);
    }
    return newQueue;
  });
}

function moduleLevelClearQueue(): void {
  updateQueue(() => []);
  setSession('queueIndex', -1);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK LOCK
// ─────────────────────────────────────────────────────────────────────────────

let playbackLockTimeout: ReturnType<typeof setTimeout> | null = null;

function acquirePlaybackLockWithTimeout(): void {
  setPlaybackActive();
  if (playbackLockTimeout) clearTimeout(playbackLockTimeout);
  playbackLockTimeout = setTimeout(() => {
    console.warn('[MusicPlayer] Playback lock auto-released after timeout');
    setPlaybackInactive();
  }, CONFIG.PLAYBACK_LOCK_TIMEOUT_MS);
}

function releasePlaybackLock(): void {
  if (playbackLockTimeout) {
    clearTimeout(playbackLockTimeout);
    playbackLockTimeout = null;
  }
  setPlaybackInactive();
}

// ─────────────────────────────────────────────────────────────────────────────
// SLEEP TIMER
// ─────────────────────────────────────────────────────────────────────────────

function setSleepTimer(minutes: number): void {
  const endsAt = Date.now() + minutes * 60 * 1000;
  setSession('sleepTimerEndsAt', endsAt);
  console.log(`[MusicPlayer] Sleep timer set for ${minutes} minutes, ends at ${new Date(endsAt).toLocaleTimeString()}`);
}

function clearSleepTimer(): void {
  setSession('sleepTimerEndsAt', null);
  console.log('[MusicPlayer] Sleep timer cleared');
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK RATE
// ─────────────────────────────────────────────────────────────────────────────

async function setPlaybackRate(rate: number): Promise<void> {
  const clamped = Math.min(Math.max(rate, 0.25), 3.0);
  try {
    const master = getMasterPlayer();
    master.playbackRate = clamped;
    setSession('playbackRate', clamped);
    await savePlaybackRate(clamped);
    console.log(`[MusicPlayer] Playback rate set to ${clamped}`);
  } catch (e) {
    console.warn('[MusicPlayer] setPlaybackRate error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

const expandPlayerRef: { current: (() => void) | null } = { current: null };
const collapsePlayerRef: { current: (() => void) | null } = { current: null };

export const MusicPlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { showAlert } = useAlert();

  const [, forceUpdate] = useState(0);
  const [masterState, setMasterState] = useState({
    isPlaying: false,
    position: 0,
    duration: 0,
    isBuffering: false,
  });

  useEffect(() => {
    const listener = () => forceUpdate(v => v + 1);
    sessionListeners.add(listener);
    return () => { sessionListeners.delete(listener); };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const master = getMasterPlayer();
        if (master) {
          const newState = {
            isPlaying: master.playing ?? false,
            position: master.currentTime ?? 0,
            duration: master.duration ?? 0,
            isBuffering: master.isBuffering ?? false,
          };
          setMasterState(prev => {
            if (
              prev.isPlaying === newState.isPlaying &&
              prev.isBuffering === newState.isBuffering &&
              Math.abs(prev.position - newState.position) < 0.1 &&
              prev.duration === newState.duration
            ) {
              return prev;
            }
            return newState;
          });

          // Read buffered position from master
          const buffered = master.bufferedPosition ?? 0;
          if (buffered !== session.bufferedPosition) {
            setSession('bufferedPosition', buffered);
          }
          
          // Update session fields that don't need React renders
          if (newState.duration > 0 && session.videoDuration !== newState.duration) {
            session.videoDuration = newState.duration;
          }
          if (newState.position !== session.videoPosition) {
            session.videoPosition = newState.position;
          }
          
          // Sleep timer check
          if (session.sleepTimerEndsAt !== null && Date.now() >= session.sleepTimerEndsAt) {
            console.log('[MusicPlayer] Sleep timer expired, pausing playback');
            master.pause();
            setSession('optimisticPlaying', false);
            setSession('sleepTimerEndsAt', null);
          }
        }
      } catch (e) {}
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const currentTrack = session.currentTrack;
  const queue = session.queue;
  const queueIndex = session.queueIndex;
  const repeatMode = session.repeatMode;
  const shuffleMode = session.shuffleMode;
  const isLoading = session.isLoading;
  const isResolving = session.isResolving;
  const optimisticPlaying = session.optimisticPlaying;
  const playbackRate = session.playbackRate;
  const preservePitch = session.preservePitch;
  const volume = session.volume;
  const hasVideoStream = session.hasVideoStream;
  const isAudioOnlyTrack = session.isAudioOnlyTrack;
  const isVideoOnlyTrack = session.isVideoOnlyTrack;
  const isVideoActive = session.videoActive;
  const videoPosition = session.videoPosition;
  const videoDuration = session.videoDuration;
  const videoIsPlaying = session.videoIsPlaying;
  const bufferedPosition = session.bufferedPosition;
  const sleepTimerEndsAt = session.sleepTimerEndsAt;

  const isPlaying = optimisticPlaying !== null ? optimisticPlaying : masterState.isPlaying;
  const isBuffering = masterState.isBuffering;
  const position = masterState.position;
  const duration = masterState.duration;

  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === masterState.isPlaying) {
      setSession('optimisticPlaying', null);
    }
  }, [masterState.isPlaying, optimisticPlaying]);

  useEffect(() => {
    if (currentTrack && currentTrack.url) {
      saveLastPlayingState(currentTrack, masterState.position);
    }
  }, [currentTrack]);

  useEffect(() => {
    if (isVideoActive) {
      saveLastActiveTab('video');
      saveLastVideoPosition(videoPosition);
    } else {
      saveLastActiveTab('song');
    }
  }, [isVideoActive, videoPosition]);

  useEffect(() => {
    const loadModes = async () => {
      try {
        const savedRepeat = await AsyncStorage.getItem(STORAGE_KEYS.REPEAT_MODE);
        const savedShuffle = await AsyncStorage.getItem(STORAGE_KEYS.SHUFFLE_MODE);
        if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
          setSession('repeatMode', savedRepeat);
        }
        if (savedShuffle === 'off' || savedShuffle === 'on') {
          setSession('shuffleMode', savedShuffle);
        }
      } catch {}
    };
    loadModes();
  }, []);

  useEffect(() => {
    const g = global as any;
    const restoredTrack: Song | null = g[RESTORE_GLOBALS.TRACK_KEY] ?? null;
    const restoredTab: 'song' | 'video' | null = g[RESTORE_GLOBALS.RESTORED_TAB_KEY] ?? null;
    const restoredVideoPos: number = g[RESTORE_GLOBALS.RESTORED_VIDEO_POSITION_KEY] ?? 0;

    if (!restoredTrack) return;

    console.log(`[MusicPlayer] Syncing React state from module-level restore: "${restoredTrack.title}"`);

    setSessionPartial({
      currentTrack: restoredTrack,
      currentSongId: restoredTrack.id,
      queue: [restoredTrack],
      queueIndex: 0,
    });

    if (restoredTab === 'video') {
      setSessionPartial({ videoActive: true, videoPosition: restoredVideoPos });
    }

    delete g[RESTORE_GLOBALS.TRACK_KEY];
    delete g[RESTORE_GLOBALS.POSITION_KEY];
    delete g[RESTORE_GLOBALS.RESTORED_TAB_KEY];
    delete g[RESTORE_GLOBALS.RESTORED_VIDEO_POSITION_KEY];
  }, []);

  const checkIsLocalTrack = useCallback((track?: Song | null): boolean => {
    return isLocalTrack(track);
  }, []);

  const setVideoActive = useCallback((active: boolean) => {
    setSession('videoActive', active);
  }, []);

  const updateVideoPosition = useCallback((position: number) => {
    setSession('videoPosition', position);
  }, []);

  const updateVideoDuration = useCallback((duration: number) => {
    setSession('videoDuration', duration);
  }, []);

  const updateVideoIsPlaying = useCallback((isPlaying: boolean) => {
    setSession('videoIsPlaying', isPlaying);
  }, []);

  const deactivateAudio = useCallback(() => {}, []);

  const notifyVideoTrackFinished = useCallback(async () => {
    if (!session.videoActive) return;
    console.log('[MusicPlayer] Video track finished on video tab — advancing queue');
    session.didHandleFinish = true;
    await moduleLevelSkipToNext();
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!session.currentTrack) {
      showAlert('Nothing to Play', 'Please select a song first.');
      return;
    }

    try {
      const master = getMasterPlayer();
      const isCurrentlyPlaying = master.playing ?? false;
      const willBePlaying = !isCurrentlyPlaying;
      setSession('optimisticPlaying', willBePlaying);

      if (willBePlaying) {
        master.play();
        console.log('[MusicPlayer] Playing');
      } else {
        master.pause();
        console.log('[MusicPlayer] Paused');
      }
    } catch (e) {
      console.warn('[MusicPlayer] togglePlayPause error:', e);
    }
  }, [showAlert]);

  const seekTo = useCallback((positionSec: number) => {
    session.didHandleFinish = false;
    try {
      const master = getMasterPlayer();
      master.currentTime = positionSec;
      setSession('videoPosition', positionSec);
    } catch (e: any) {
      console.warn(`[MusicPlayer] seekTo error: ${e?.message || e}`);
    }
  }, []);

  const skipToNext = useCallback(async () => { await moduleLevelSkipToNext(); }, []);
  const skipToPrevious = useCallback(async () => { await moduleLevelSkipToPrevious(); }, []);

  const skipToIndex = useCallback(async (index: number) => {
    await moduleLevelSkipToIndex(index);
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    setSession('repeatMode', mode);
    saveRepeatMode(mode);
    console.log(`[MusicPlayer] Repeat mode: ${mode}`);
  }, []);

  const setShuffleMode = useCallback((mode: ShuffleMode) => {
    if (mode === 'on' && shuffleMode === 'off') {
      if (queue.length > 0 && queueIndex >= 0) {
        session.originalQueue = [...queue];
        session.originalIndex = queueIndex;

        const current = queue[queueIndex];
        const before = queue.slice(0, queueIndex);
        const after = queue.slice(queueIndex + 1);

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

        const newQueue = [...shuffledBefore, current, ...shuffledAfter];
        setSession('queue', newQueue);
        setSession('queueIndex', shuffledBefore.length);
      }
    } else if (mode === 'off' && shuffleMode === 'on') {
      if (session.originalQueue.length > 0 && session.currentTrack) {
        const originalCurrentIndex = session.originalQueue.findIndex(s => s.id === session.currentTrack!.id);
        setSession('queue', session.originalQueue);
        setSession('queueIndex', originalCurrentIndex >= 0 ? originalCurrentIndex : 0);
        session.originalQueue = [];
        session.originalIndex = -1;
      }
    }

    setSession('shuffleMode', mode);
    saveShuffleMode(mode);
    console.log(`[MusicPlayer] Shuffle mode: ${mode}`);
  }, [shuffleMode, queue, queueIndex]);

  const addToQueue = useCallback((songs: Song[]) => {
    if (!songs?.length) return;
    const enrichedSongs = ensureQueueMetadata(songs);
    
    let songsToAdd = enrichedSongs;
    if (session.shuffleMode === 'on' && enrichedSongs.length > 1) {
      songsToAdd = [...enrichedSongs];
      for (let i = songsToAdd.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songsToAdd[i], songsToAdd[j]] = [songsToAdd[j], songsToAdd[i]];
      }
      console.log(`[MusicPlayer] Shuffled ${songsToAdd.length} newly appended songs`);
    }
    
    const newQueue = [...session.queue, ...songsToAdd];
    setSession('queue', newQueue);
    console.log(`[MusicPlayer] Added ${songsToAdd.length} songs to queue`);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const currentQueue = session.queue;
    if (index < 0 || index >= currentQueue.length) return;

    session.bgAbortController?.abort();
    const newAbortController = new AbortController();
    setSession('bgAbortController', newAbortController);

    const newQueue = [...currentQueue];
    newQueue.splice(index, 1);

    let newQueueIndex = session.queueIndex;
    if (index < session.queueIndex) {
      newQueueIndex--;
    } else if (index === session.queueIndex && newQueue.length > 0) {
      newQueueIndex = Math.min(index, newQueue.length - 1);
      if (newQueue[newQueueIndex]) {
        moduleLevelLoadAndPlay(newQueue[newQueueIndex], ++session.playGeneration);
      }
    }

    setSession('queue', newQueue);
    setSession('queueIndex', newQueueIndex);
    console.log(`[MusicPlayer] Removed from queue at index ${index}`);
  }, []);

  const moveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const currentQueue = session.queue;
    if (fromIndex >= currentQueue.length || toIndex >= currentQueue.length) return;

    const newQueue = [...currentQueue];
    const [moved] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, moved);

    let newQueueIndex = session.queueIndex;
    if (fromIndex === session.queueIndex) newQueueIndex = toIndex;
    else if (fromIndex < session.queueIndex && toIndex >= session.queueIndex) newQueueIndex--;
    else if (fromIndex > session.queueIndex && toIndex <= session.queueIndex) newQueueIndex++;

    setSession('queue', newQueue);
    setSession('queueIndex', newQueueIndex);
    console.log(`[MusicPlayer] Moved queue item from ${fromIndex} to ${toIndex}`);
  }, []);

  const clearQueue = useCallback(() => {
    setSession('queue', []);
    setSession('queueIndex', -1);
    session.originalQueue = [];
    session.originalIndex = -1;
    console.log('[MusicPlayer] Queue cleared');
  }, []);

  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current = expand;
    collapsePlayerRef.current = collapse;
  }, []);

  const expandPlayer = useCallback(() => expandPlayerRef.current?.(), []);
  const collapsePlayer = useCallback(() => collapsePlayerRef.current?.(), []);

  const setVolume = useCallback(async (newVolume: number) => {
    const clamped = Math.min(Math.max(newVolume, 0.0), 1.0);
    try {
      const master = getMasterPlayer();
      master.volume = clamped;
      setSession('volume', clamped);
      await saveVolume(clamped);
    } catch (e) { console.warn('[MusicPlayer] setVolume error:', e); }
  }, []);

  const setPreservePitch = useCallback(async (preserve: boolean) => {
    try {
      const master = getMasterPlayer();
      master.preservesPitch = preserve;
      setSession('preservePitch', preserve);
      await savePreservePitch(preserve);
    } catch (e) { console.warn('[MusicPlayer] setPreservePitch error:', e); }
  }, []);

  const playAudio = useCallback(
    async (songToPlay: Song, playlist?: Song[], expandPlayerFn?: () => void) => {
      if (!songToPlay.url) {
        showAlert('Not Available', `"${songToPlay.title}" is not available.`);
        return;
      }

      let enrichedSong = songToPlay;
      if (isLocalTrack(songToPlay)) {
        enrichedSong = enrichLocalTrackMetadata(songToPlay, songToPlay.url);
      }

      setSessionPartial({
        currentTrack: enrichedSong,
        currentSongId: enrichedSong.id,
        isLoading: true,
        isResolving: true,
      });

      const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
      if (goToPlayer) goToPlayer();

      session.bgAbortController?.abort();
      const newAbortController = new AbortController();
      setSession('bgAbortController', newAbortController);

      const generation = ++session.playGeneration;

      try {
        let newQueue: Song[] = [];
        let startIndex = 0;

        if (playlist && playlist.length > 0) {
          const playlistIndex = playlist.findIndex(s => s.id === songToPlay.id);
          newQueue = ensureQueueMetadata([...playlist]);
          startIndex = playlistIndex >= 0 ? playlistIndex : 0;
        } else {
          newQueue = ensureQueueMetadata([enrichedSong]);
          startIndex = 0;
        }

        setSession('queue', newQueue);
        setSession('queueIndex', startIndex);

        if (shuffleMode === 'on' && newQueue.length > 1) {
          const current = newQueue[startIndex];
          const before = newQueue.slice(0, startIndex);
          const after = newQueue.slice(startIndex + 1);

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

          const finalQueue = [...shuffledBefore, current, ...shuffledAfter];
          setSession('queue', finalQueue);
          setSession('queueIndex', shuffledBefore.length);
        }

        const success = await moduleLevelLoadAndPlay(enrichedSong, generation);

        if (success) {
          preloadNextTracks(newQueue, startIndex, newAbortController.signal);

          if (!checkIsLocalTrack(enrichedSong) && enrichedSong.url && newQueue.length <= 1) {
            fetchRelatedSongs(enrichedSong.url)
              .then(related => {
                if (!newAbortController.signal.aborted &&
                    session.currentSongId === enrichedSong.id &&
                    related.length > 0) {
                  const currentQueue = session.queue;
                  const existingIds = new Set(currentQueue.map(s => s.id));
                  const newSongs = related.filter(s => !existingIds.has(s.id));
                  if (newSongs.length) {
                    let songsToAdd = newSongs;
                    if (session.shuffleMode === 'on' && newSongs.length > 1) {
                      songsToAdd = [...newSongs];
                      for (let i = songsToAdd.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [songsToAdd[i], songsToAdd[j]] = [songsToAdd[j], songsToAdd[i]];
                      }
                    }
                    setSession('queue', [...currentQueue, ...songsToAdd]);
                  }
                } else if (!newAbortController.signal.aborted && related.length === 0 && lastRelatedSongsCache.length > 0) {
                  const cachedFiltered = lastRelatedSongsCache.filter(s => s.id !== enrichedSong.id);
                  if (cachedFiltered.length > 0) {
                    let songsToAdd = cachedFiltered;
                    if (session.shuffleMode === 'on' && cachedFiltered.length > 1) {
                      songsToAdd = [...cachedFiltered];
                      for (let i = songsToAdd.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [songsToAdd[i], songsToAdd[j]] = [songsToAdd[j], songsToAdd[i]];
                      }
                    }
                    setSession('queue', [...session.queue, ...songsToAdd]);
                    console.log('[MusicPlayer] Using cached related songs as fallback');
                  } else {
                    ToastAndroid.show('Autoplay unavailable', ToastAndroid.SHORT);
                  }
                }
              })
              .catch(() => {
                if (lastRelatedSongsCache.length > 0) {
                  const cachedFiltered = lastRelatedSongsCache.filter(s => s.id !== enrichedSong.id);
                  if (cachedFiltered.length > 0) {
                    let songsToAdd = cachedFiltered;
                    if (session.shuffleMode === 'on' && cachedFiltered.length > 1) {
                      songsToAdd = [...cachedFiltered];
                      for (let i = songsToAdd.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [songsToAdd[i], songsToAdd[j]] = [songsToAdd[j], songsToAdd[i]];
                      }
                    }
                    setSession('queue', [...session.queue, ...songsToAdd]);
                  }
                }
              });
          }
        } else {
          showAlert('Playback Error', `Failed to play "${enrichedSong.title}". Please check your connection.`);
        }

      } catch (error: any) {
        console.error(`[MusicPlayer] playAudio error: ${error?.message || error}`);
        showAlert('Playback Error', `Failed to play "${enrichedSong.title}".`);
        setSessionPartial({ isLoading: false, isResolving: false });
      }
    },
    [shuffleMode, checkIsLocalTrack, showAlert],
  );

  const playPlaylist = useCallback(
    async (songs: Song[], expandPlayerFn?: () => void) => {
      if (!songs?.length) {
        showAlert('Playback Error', 'Playlist is empty.');
        return;
      }
      await playAudio(songs[0], songs, expandPlayerFn);
    },
    [playAudio, showAlert],
  );

  const playNext = useCallback(
    async (songsToAdd: Song[] | null) => {
      if (!songsToAdd?.length) return;
      const insertIndex = queueIndex + 1;
      const enrichedSongs = ensureQueueMetadata(songsToAdd);
      const newQueue = [...queue.slice(0, insertIndex), ...enrichedSongs, ...queue.slice(insertIndex)];
      setSession('queue', newQueue);
      console.log(`[MusicPlayer] Added ${enrichedSongs.length} songs to play next`);
    },
    [queue, queueIndex],
  );

  const playDownloadedSong = useCallback(
    async (
      songToPlay: DownloadedSongMetadata,
      playlist?: DownloadedSongMetadata[],
      expandPlayerFn?: () => void,
    ) => {
      if (!songToPlay.id) {
        showAlert('Error', 'Invalid track');
        return;
      }

      const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
      if (goToPlayer) goToPlayer();

      setSessionPartial({ isLoading: true, isResolving: true });

      try {
        let allTracks: any[] = [];

        if (playlist && playlist.length > 0) {
          const resolved = await Promise.all(playlist.map(p => getTrackById(p.id)));
          allTracks = resolved.filter((t): t is any => t !== null);
        } else if (songToPlay.albumId) {
          allTracks = await getTracksByAlbum(songToPlay.albumId);
        }

        if (allTracks.length === 0) {
          const singleTrack = await getTrackById(songToPlay.id);
          if (!singleTrack?.file_uri) {
            showAlert('File Not Found', `"${songToPlay.title}" path is missing from database.`);
            setSessionPartial({ isLoading: false, isResolving: false });
            return;
          }
          allTracks = [singleTrack];
        }

        const startIndex = Math.max(0, allTracks.findIndex(t => t.track_id === songToPlay.id));
        const ordered = [...allTracks.slice(startIndex), ...allTracks.slice(0, startIndex)];

        const queueSongs: Song[] = ordered.map(t => ({
          id: t.track_id,
          title: t.title,
          artist: t.artist,
          thumbnail: t.artwork_uri || t.cached_artwork_path,
          url: normalizeLocalUri(t.file_uri),
          duration: t.duration,
        }));

        if (queueSongs.length === 0) {
          showAlert('Playback Error', 'No tracks found to play.');
          setSessionPartial({ isLoading: false, isResolving: false });
          return;
        }

        const enrichedQueue = ensureQueueMetadata(queueSongs);
        setSession('queue', enrichedQueue);
        setSession('queueIndex', 0);

        storeTrackExtras(enrichedQueue[0].id, {
          isLocal: true,
          likeCount: -1, dislikeCount: -1, viewCount: -1, commentsCount: -1,
          hasAudio: true, hasVideo: false, isAudioOnly: true, isVideoOnly: false,
        });

        const success = await moduleLevelLoadAndPlay(enrichedQueue[0], ++session.playGeneration);

        if (!success) {
          showAlert('Playback Error', `Failed to play "${songToPlay.title}"`);
        }
      } catch (error: any) {
        console.error('[playDownloadedSong] Error:', error);
        showAlert('Playback Error', `Failed to play "${songToPlay.title}"`);
        setSessionPartial({ isLoading: false, isResolving: false });
      }
    },
    [showAlert],
  );

  const playAllDownloadedSongs = useCallback(
    async (songs: DownloadedSongMetadata[], expandPlayerFn?: () => void) => {
      if (!songs?.length) {
        showAlert('Playback Error', 'No downloaded songs found.');
        return;
      }
      await playDownloadedSong(songs[0], songs, expandPlayerFn);
    },
    [playDownloadedSong, showAlert],
  );

  const engineValue: PlayerEngineState = {
    currentTrack,
    isPlaying,
    isBuffering,
    isResolving,
    position,
    duration,
    queue,
    queueIndex,
    repeatMode,
    shuffleMode,
    playbackRate,
    preservePitch,
    volume,
    hasVideoStream,
    isAudioOnlyTrack,
    isVideoOnlyTrack,
    play: () => { 
      setSession('optimisticPlaying', true); 
      try { 
        const master = getMasterPlayer();
        master.play(); 
      } catch (e) {} 
    },
    pause: () => { 
      setSession('optimisticPlaying', false); 
      try { 
        const master = getMasterPlayer();
        master.pause(); 
      } catch (e) {} 
    },
    seekTo,
    skipToNext,
    skipToPrevious,
    skipToIndex,
    togglePlayPause,
    setRepeatMode,
    setShuffleMode,
    addToQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue,
    setPlayerOverlayRefs,
    expandPlayer,
    collapsePlayer,
  };

  const musicPlayerValue: MusicPlayerContextType = {
    currentTrack,
    isPlaying,
    isBuffering,
    isLoading,
    isResolving,
    position,
    duration,
    queue,
    repeatMode,
    shuffleMode,
    playbackRate,
    preservePitch,
    volume,
    hasVideoStream,
    isAudioOnlyTrack,
    isVideoOnlyTrack,
    playAudio,
    playPlaylist,
    playNext,
    playDownloadedSong,
    playAllDownloadedSongs,
    togglePlayPause,
    seekTo,
    skipToNext,
    skipToPrevious,
    skipToIndex,
    setRepeatMode,
    setShuffleMode,
    addToQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue,
    expandPlayer,
    collapsePlayer,
    setPlayerOverlayRefs,
    isLocalTrack: checkIsLocalTrack,
    isVideoActive,
    videoPosition,
    videoDuration,
    videoIsPlaying,
    setVideoActive,
    updateVideoPosition,
    updateVideoDuration,
    updateVideoIsPlaying,
    setPlaybackRate,
    setVolume,
    setPreservePitch,
    setSleepTimer,
    clearSleepTimer,
    sleepTimerEndsAt,
    bufferedPosition,
    notifyVideoTrackFinished,
    deactivateAudio,
  };

  return (
    <PlayerEngineContext.Provider value={engineValue}>
      <MusicPlayerContext.Provider value={musicPlayerValue}>
        {children}
      </MusicPlayerContext.Provider>
    </PlayerEngineContext.Provider>
  );
};

registerResolveTrack(resolveTrack);
registerStoreTrackExtras(storeTrackExtras);

export { cancelAllPreloads, getPreloadAbortSignal };
export default MusicPlayerProvider;