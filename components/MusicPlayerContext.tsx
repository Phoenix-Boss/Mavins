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
// FIXED: Removed all expo-audio dependencies - using expo-video for everything
// FIXED: Single source of truth (Master player) for position, duration, playing state
// FIXED: No AudioFocus handoff - Master owns focus permanently
// FIXED: Queue, repeat, shuffle fully implemented
// UPDATED: Enhanced retry logic for NewPipeExtractor v0.26.2
// UPDATED: Improved parsing error handling and visitor data management
// UPDATED: Better search fallback strategies with YouTube Music support

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';
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
  videoUrl?: string;
  muxedVideoUrl?: string;
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
  url: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
  videoId?: string;
  isDownloaded?: boolean;
  isLocal?: boolean;
  muxedVideoUrl?: string;
  videoOnlyUrl?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE HELPERS
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
// STREAM PICKING
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

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE STREAM CACHE
// ─────────────────────────────────────────────────────────────────────────────

async function getCachedAudioStream(trackId: string): Promise<{ url: string; duration: number } | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams')
      .select('stream_url, expiry, duration')
      .eq('track_id', uuid)
      .eq('stream_type', 'audio')
      .eq('is_active', true)
      .gt('expiry', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return { url: data.stream_url, duration: data.duration ?? 0 };
  } catch { return null; }
}

async function getCachedVideoStream(trackId: string): Promise<string | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams')
      .select('stream_url')
      .eq('track_id', uuid)
      .eq('stream_type', 'video')
      .eq('is_active', true)
      .gt('expiry', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return data.stream_url;
  } catch { return null; }
}

async function invalidateStreamCache(trackId: string, streamType?: 'audio' | 'video'): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    let query = (supabase as any)
      .from('streams')
      .update({ is_active: false })
      .eq('track_id', uuid);
    if (streamType) {
      query = query.eq('stream_type', streamType);
    }
    const { error } = await query;
    if (error) console.warn('[MusicPlayer] invalidateStreamCache error:', error?.message);
  } catch (e) {
    console.warn('[MusicPlayer] invalidateStreamCache failed:', e);
  }
}

async function cacheStreamsToSupabase(
  trackId: string,
  audioUrl: string,
  videoUrl: string | null,
  muxedVideoUrl: string | null,
  duration: number,
): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const expiry = new Date(Date.now() + CONFIG.STREAM_TTL_MS).toISOString();
    const now = new Date().toISOString();

    const rows = [
      {
        track_id: uuid, source: 'youtube', stream_url: audioUrl, stream_type: 'audio',
        quality: 'high', format: 'webm', duration: Math.round(duration), expiry,
        is_active: true, health_score: 100, last_accessed: now, access_count: 1,
      },
    ];

    const bestVideoUrl = muxedVideoUrl || videoUrl;
    if (bestVideoUrl) {
      rows.push({
        track_id: uuid, source: 'youtube', stream_url: bestVideoUrl, stream_type: 'video',
        quality: '720p', format: 'mp4', duration: Math.round(duration), expiry,
        is_active: true, health_score: 100, last_accessed: now, access_count: 1,
      });
    }

    const { error } = await (supabase as any).from('streams').upsert(rows, {
      onConflict: 'track_id,stream_type',
    });
    if (error) console.warn('[MusicPlayer] stream cache write error:', error?.message);
  } catch (e) {
    console.warn('[MusicPlayer] cacheStreamsToSupabase error:', e);
  }
}

function buildExtras(
  song: Song,
  info: any,
  videoUrl: string | null,
  muxedVideoUrl: string | null,
  commentsCount: number,
): TrackExtras {
  return {
    videoUrl: videoUrl ?? undefined,
    muxedVideoUrl: muxedVideoUrl ?? undefined,
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
        await invalidateStreamCache(song.id);
        try {
          await MavinEngine.refreshVisitorData();
          console.log('[MusicPlayer] Refreshed visitor data for retry');
        } catch (e) {}
        console.warn(`[MusicPlayer] Parsing error on attempt ${attempt}, clearing cache and retrying`);
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
      hasAudio: true,
      hasVideo: false,
      isAudioOnly: true,
      isVideoOnly: false,
    };
  }

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

  if (!bypassCache) {
    try {
      const [cachedAudio, cachedVideo] = await Promise.all([
        getCachedAudioStream(song.id),
        getCachedVideoStream(song.id),
      ]);
      if (cachedAudio) {
        let extras: TrackExtras = {
          videoId: song.videoId,
          hasAudio: true,
          hasVideo: !!cachedVideo,
          isAudioOnly: !cachedVideo,
          isVideoOnly: false,
        };
        if (song.videoId) {
          const cached = await safeGetTrackStats(song.videoId);
          if (cached) {
            extras = {
              videoId: song.videoId,
              uploaderUrl: cached.uploaderUrl ?? undefined,
              likeCount: cached.likeCount > 0 ? cached.likeCount : -1,
              dislikeCount: cached.dislikeCount > 0 ? cached.dislikeCount : -1,
              viewCount: cached.viewCount > 0 ? cached.viewCount : -1,
              commentsCount: (cached.commentsCount ?? -1) > 0 ? cached.commentsCount! : -1,
              hasAudio: true,
              hasVideo: !!cachedVideo,
              isAudioOnly: !cachedVideo,
              isVideoOnly: false,
            };
          }
        }
        storeTrackExtras(song.id, { ...extras, videoUrl: cachedVideo ?? undefined });
        return {
          id: song.id, url: cachedAudio.url, title: song.title, artist: song.artist,
          thumbnail: song.thumbnail,
          duration: cachedAudio.duration > 0 ? cachedAudio.duration : undefined,
          videoId: extras.videoId, isDownloaded: false, isLocal: false,
          videoOnlyUrl: cachedVideo ?? undefined,
          muxedVideoUrl: undefined,
          hasAudio: true,
          hasVideo: !!cachedVideo,
          isAudioOnly: !cachedVideo,
          isVideoOnly: false,
        };
      }
    } catch (cacheErr) {
      console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
    }
  }

  // PRIMARY EXTRACTION with enhanced fallback
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

    const bestAudio = pickBestAudio(info.audioStreams ?? []);
    const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
    const bestMuxed = pickBestVideo(info.videoStreams ?? []);

    let audioUrl: string | null = null;
    let videoUrl: string | null = null;
    let muxedVideoUrl: string | null = null;
    let isAudioOnly = false;
    let isVideoOnly = false;
    let hasAudio = false;
    let hasVideo = false;

    if (bestAudio?.url) { audioUrl = bestAudio.url; hasAudio = true; }
    if (bestVideo?.url) { videoUrl = bestVideo.url; hasVideo = true; }
    if (bestMuxed?.url) { muxedVideoUrl = bestMuxed.url; hasVideo = true; }

    if (!audioUrl && (videoUrl || muxedVideoUrl)) {
      console.log(`[MusicPlayer] Video-only track detected for "${song.title}"`);
      audioUrl = muxedVideoUrl || videoUrl;
      hasAudio = true;
      isVideoOnly = true;
    }

    if (audioUrl && !videoUrl && !muxedVideoUrl) {
      console.log(`[MusicPlayer] Audio-only track detected for "${song.title}"`);
      isAudioOnly = true;
      hasVideo = false;
    }

    if (audioUrl && (videoUrl || muxedVideoUrl)) {
      hasAudio = true; hasVideo = true;
      isAudioOnly = false; isVideoOnly = false;
    }

    if (!audioUrl) {
      const lowerQualityAudio = pickBestAudio(info.audioStreams?.filter(s => s.bitrate && s.bitrate < 128) ?? []);
      if (lowerQualityAudio?.url) {
        audioUrl = lowerQualityAudio.url;
        hasAudio = true;
        console.log(`[MusicPlayer] Falling back to lower quality audio for "${song.title}"`);
      }
    }

    if (!audioUrl) {
      console.warn(`[MusicPlayer] No audio stream found for "${song.title}"`);
      return null;
    }

    const duration = info.duration ?? 0;
    const commentsCount = typeof info.commentsCount === 'number' ? info.commentsCount : -1;
    const extras = buildExtras(song, info, videoUrl, muxedVideoUrl, commentsCount);
    storeTrackExtras(song.id, { ...extras, hasAudio, hasVideo, isAudioOnly, isVideoOnly });
    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, muxedVideoUrl, duration).catch(() => {});
    if (song.videoId) {
      safeSaveTrackStats({
        videoId: song.videoId, likeCount: extras.likeCount ?? -1,
        dislikeCount: extras.dislikeCount ?? -1, viewCount: extras.viewCount ?? -1,
        commentsCount, uploaderUrl: extras.uploaderUrl ?? null,
      });
    }

    console.log(`[MusicPlayer] Resolved track "${song.title}":`, { hasAudio, hasVideo, isAudioOnly, isVideoOnly, duration });

    return {
      id: song.id, url: audioUrl, title: info.title ?? song.title, artist: song.artist,
      thumbnail: song.thumbnail, duration: duration > 0 ? duration : undefined,
      videoId: song.videoId, isDownloaded: false, isLocal: false,
      videoOnlyUrl: videoUrl ?? undefined,
      muxedVideoUrl: muxedVideoUrl ?? undefined,
      hasAudio, hasVideo, isAudioOnly, isVideoOnly,
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

      const bestAudio = pickBestAudio(info.audioStreams ?? []);
      const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
      const bestMuxed = pickBestVideo(info.videoStreams ?? []);

      let audioUrl: string | null = null;
      let videoUrl: string | null = null;
      let muxedVideoUrl: string | null = null;
      let isAudioOnly = false;
      let isVideoOnly = false;
      let hasAudio = false;
      let hasVideo = false;

      if (bestAudio?.url) { audioUrl = bestAudio.url; hasAudio = true; }
      if (bestVideo?.url) { videoUrl = bestVideo.url; hasVideo = true; }
      if (bestMuxed?.url) { muxedVideoUrl = bestMuxed.url; hasVideo = true; }

      if (!audioUrl && (videoUrl || muxedVideoUrl)) { 
        audioUrl = muxedVideoUrl || videoUrl; 
        hasAudio = true; 
        isVideoOnly = true; 
      }
      if (audioUrl && !videoUrl && !muxedVideoUrl) { 
        isAudioOnly = true; 
        hasVideo = false; 
      }
      if (audioUrl && (videoUrl || muxedVideoUrl)) { 
        hasAudio = true; 
        hasVideo = true; 
      }
      if (!audioUrl) continue;

      const duration = info.duration ?? 0;
      const extras = buildExtras(song, info, videoUrl, muxedVideoUrl, -1);
      storeTrackExtras(song.id, { ...extras, hasAudio, hasVideo, isAudioOnly, isVideoOnly });
      cacheStreamsToSupabase(song.id, audioUrl, videoUrl, muxedVideoUrl, duration).catch(() => {});

      console.log(`[MusicPlayer] ✓ Search fallback succeeded for "${song.title}"`);

      return {
        id: song.id, url: audioUrl, title: info.title ?? song.title, artist: song.artist,
        thumbnail: song.thumbnail, duration: duration > 0 ? duration : undefined,
        videoId: song.videoId, isDownloaded: false, isLocal: false,
        videoOnlyUrl: videoUrl ?? undefined, muxedVideoUrl: muxedVideoUrl ?? undefined,
        hasAudio, hasVideo, isAudioOnly, isVideoOnly,
      };
    } catch (searchErr: any) {
      console.warn(`[MusicPlayer] Search strategy failed for "${strategy.query}":`, searchErr?.message || searchErr);
    }
  }

  console.warn(`[MusicPlayer] All strategies exhausted for "${song.title}"`);
  return null;
};

const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  if (!songUrl) return [];
  try {
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];
    return info.relatedItems
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
  notifyVideoTrackFinished: () => Promise<void>;
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

    const resolved = await resolveTrack(track);
    if (!resolved?.url) {
      console.warn('[MusicPlayer] Module-level restore: could not resolve stream URL');
      return;
    }

    g[RESTORE_GLOBALS.RESOLVED_URL_KEY] = resolved.url;

    let attempts = 0;
    while (!masterPlayerRef && attempts < 50) {
      await delay(100);
      attempts++;
    }

    if (masterPlayerRef) {
      try {
        await masterPlayerRef.replaceAsync(resolved.url);
        if (savedPos > 5 && savedPos < (resolved.duration ?? Infinity)) {
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

async function moduleLevelLoadAndPlay(song: Song, generation: number, isRetry = false): Promise<boolean> {
  if (generation !== session.playGeneration) {
    console.log('[MusicPlayer] moduleLevelLoadAndPlay skipped (stale generation)');
    return false;
  }

  if (!song || !song.id || !song.url) {
    console.error('[MusicPlayer] Invalid track in moduleLevelLoadAndPlay');
    setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Invalid track' });
    return false;
  }

  console.log(`[MusicPlayer] Module-level loading: "${song.title || 'Unknown'}"`);
  setSessionPartial({
    currentTrack: song,
    currentSongId: song.id,
    isLoading: true,
    isResolving: true,
    lastError: null,
  });

  saveLastPlayingState(song, 0);
  acquirePlaybackLockWithTimeout();

  try {
    let finalUrl = song.url;

    if (isLocalTrack(song)) {
      finalUrl = normalizeLocalUri(finalUrl);
      console.log(`[MusicPlayer] [Local] Direct playback: ${finalUrl.substring(0, 100)}...`);
      
      const master = getMasterPlayer();
      await master.replaceAsync(finalUrl);
      
      releasePlaybackLock();
      await master.play();
      
      setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true });
      return true;
    }

    if (song.id) {
      const diskCached = await getCachedTrackExtras(song.id);
      if (diskCached && !trackExtrasStore.has(song.id)) {
        trackExtrasStore.set(song.id, diskCached);
        notifyTrackExtrasChange();
      }
    }

    let resolved: ResolvedTrack | null = null;
    resolved = await resolveTrackWithRetry(song);
    releasePlaybackLock();

    if (!resolved || !resolved.url) {
      console.error(`[MusicPlayer] Failed to resolve track: "${song.title}"`);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Failed to resolve stream' });
      return false;
    }
    finalUrl = resolved.url;

    setSessionPartial({
      hasVideoStream: resolved.hasVideo,
      isAudioOnlyTrack: resolved.isAudioOnly,
      isVideoOnlyTrack: resolved.isVideoOnly,
    });

    const master = getMasterPlayer();
    
    console.log('[MusicPlayer] Loading audio URL into master player...');
    try {
      await master.replaceAsync(finalUrl);
      console.log('[MusicPlayer] Master player.replace() done');
    } catch (playError: any) {
      if (!isRetry && playError?.message?.includes('403')) {
        console.log('[MusicPlayer] 403 on first play, retrying with cache bypass');
        await invalidateStreamCache(song.id);
        return moduleLevelLoadAndPlay(song, generation, true);
      }
      throw playError;
    }

    console.log('[MusicPlayer] Calling master.play() — master owns AudioFocus');
    await master.play();
    console.log('[MusicPlayer] ✅ master.play() called — audio should be playing');
    
    setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true });
    return true;

  } catch (error: any) {
    releasePlaybackLock();
    console.error(`[MusicPlayer] Error loading track: ${error?.message || error}`);
    setSessionPartial({ isLoading: false, isResolving: false, lastError: error?.message || 'Unknown error' });
    return false;
  }
}

async function moduleLevelSkipToNext(): Promise<void> {
  const currentQueue = session.queue;
  const currentQueueIndex = session.queueIndex;
  const repeatMode = session.repeatMode;

  if (repeatMode === 'one' && session.currentTrack) {
    try {
      const master = getMasterPlayer();
      master.currentTime = 0;
      master.play();
      setSession('optimisticPlaying', true);
    } catch (error) {
      console.warn('[MusicPlayer] Failed to repeat track:', error);
    }
    return;
  }

  const nextIndex = currentQueueIndex + 1;
  if (nextIndex < currentQueue.length) {
    const nextSong = currentQueue[nextIndex];
    setSessionPartial({ queueIndex: nextIndex });
    const success = await moduleLevelLoadAndPlay(nextSong, session.playGeneration);
    if (success) preloadNextTracks(currentQueue, nextIndex, session.bgAbortController?.signal);
  } else if (repeatMode === 'all' && currentQueue.length > 0) {
    const firstSong = currentQueue[0];
    setSessionPartial({ queueIndex: 0 });
    const success = await moduleLevelLoadAndPlay(firstSong, session.playGeneration);
    if (success) preloadNextTracks(currentQueue, 0, session.bgAbortController?.signal);
  } else {
    console.log('[MusicPlayer] Queue exhausted, playback stopped');
  }
}

async function moduleLevelSkipToPrevious(): Promise<void> {
  const master = getMasterPlayer();
  const currentPosition = master.currentTime ?? 0;

  if (currentPosition > 3) {
    try {
      master.currentTime = 0;
    } catch {}
    return;
  }

  const prevIndex = session.queueIndex - 1;
  if (prevIndex >= 0) {
    const prevSong = session.queue[prevIndex];
    setSessionPartial({ queueIndex: prevIndex });
    const success = await moduleLevelLoadAndPlay(prevSong, session.playGeneration);
    if (success) preloadNextTracks(session.queue, prevIndex, session.bgAbortController?.signal);
  } else if (session.repeatMode === 'all' && session.queue.length > 0) {
    const lastIndex = session.queue.length - 1;
    const lastSong = session.queue[lastIndex];
    setSessionPartial({ queueIndex: lastIndex });
    const success = await moduleLevelLoadAndPlay(lastSong, session.playGeneration);
    if (success) preloadNextTracks(session.queue, lastIndex, session.bgAbortController?.signal);
  } else {
    try {
      master.currentTime = 0;
    } catch {}
  }
}

async function moduleLevelSkipToIndex(index: number): Promise<void> {
  if (index < 0 || index >= session.queue.length) return;

  const targetSong = session.queue[index];
  setSessionPartial({ queueIndex: index });
  const success = await moduleLevelLoadAndPlay(targetSong, session.playGeneration);
  if (success) preloadNextTracks(session.queue, index, session.bgAbortController?.signal);
}

function moduleLevelAddToQueue(songs: Song[]): void {
  updateQueue(prev => [...prev, ...songs]);
}

function moduleLevelRemoveFromQueue(index: number): void {
  if (index < 0 || index >= session.queue.length) return;
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
// SYSTEM MEDIA CONTROLS BRIDGE
// ─────────────────────────────────────────────────────────────────────────────

interface BridgeProps {
  currentTrack: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  repeatMode: RepeatMode;
  onPlay: () => void;
  onPause: () => void;
  onSkipNext: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSeek: (positionSec: number) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onExpandPlayer: () => void;
  isVideoActive: boolean;
  videoPosition: number;
  videoDuration: number;
  videoIsPlaying: boolean;
  onVideoSeek: (positionSec: number) => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onAppBackground: () => void;
  onAppForeground: () => void;
}

function SystemMediaControlsBridge({
  currentTrack,
  isPlaying,
  isBuffering,
  position,
  duration,
  repeatMode,
  onPlay,
  onPause,
  onSkipNext,
  onSkipPrevious,
  onSeek,
  onSetRepeatMode,
  onExpandPlayer,
  isVideoActive,
  videoPosition,
  videoDuration,
  videoIsPlaying,
  onVideoSeek,
  onVideoPlay,
  onVideoPause,
  onAppBackground,
  onAppForeground,
}: BridgeProps) {
  useSystemMediaControls({
    track: currentTrack
      ? {
          title: currentTrack.title,
          artist: currentTrack.artist ?? 'Unknown Artist',
          artwork: currentTrack.thumbnail,
          videoId: currentTrack.videoId,
          duration: duration || undefined,
        }
      : undefined,
    isPlaying: isVideoActive ? videoIsPlaying : isPlaying,
    isBuffering,
    position: isVideoActive ? videoPosition : position,
    duration: isVideoActive ? videoDuration : duration,
    repeatMode,
    onPlay: isVideoActive ? onVideoPlay : onPlay,
    onPause: isVideoActive ? onVideoPause : onPause,
    onSkipNext,
    onSkipPrevious,
    onSeek: isVideoActive ? onVideoSeek : onSeek,
    onSetRepeatMode,
    onExpandPlayer,
    onAppBackground,
    onAppForeground,
  } as SystemMediaControlsProps);

  return null;
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
          setMasterState(newState);
          
          if (newState.duration > 0 && session.videoDuration !== newState.duration) {
            setSession('videoDuration', newState.duration);
          }
          if (newState.position !== session.videoPosition) {
            setSession('videoPosition', newState.position);
          }
        }
      } catch (e) {
        // Master not ready yet
      }
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
      saveLastPlayingState(currentTrack, position);
    }
  }, [currentTrack, position]);

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

  useEffect(() => {
    if (!masterState.isPlaying && masterState.duration > 0 && 
        masterState.position >= masterState.duration - 1 && !session.didHandleFinish) {
      setSession('didHandleFinish', true);
      console.log('[MusicPlayer] Track reached end, advancing queue');
      moduleLevelSkipToNext();
    } else if (masterState.isPlaying && masterState.position < masterState.duration - 1) {
      setSession('didHandleFinish', false);
    }
  }, [masterState.isPlaying, masterState.position, masterState.duration]);

  const checkIsLocalTrack = useCallback((track?: Song | null): boolean => {
    return isLocalTrack(track);
  }, []);

  const setVideoActive = useCallback((active: boolean) => {
    setSession('videoActive', active);
    if (!active) {
      console.log('[MusicPlayer] Video tab deactivated');
    }
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

  const notifyVideoTrackFinished = useCallback(async () => {
    if (!session.videoActive) return;
    console.log('[MusicPlayer] Video track finished on video tab — advancing queue');
    session.didHandleFinish = true;
    await moduleLevelSkipToNext();
  }, []);

  const setPlaybackRate = useCallback(async (rate: number) => {
    const clamped = Math.min(Math.max(rate, 0.5), 16.0);
    try {
      const master = getMasterPlayer();
      master.playbackRate = clamped;
      setSession('playbackRate', clamped);
      await savePlaybackRate(clamped);
    } catch (e) { console.warn('[MusicPlayer] setPlaybackRate error:', e); }
  }, []);

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

      setSessionPartial({
        currentTrack: songToPlay,
        currentSongId: songToPlay.id,
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
          newQueue = [...playlist];
          startIndex = playlistIndex >= 0 ? playlistIndex : 0;
        } else {
          newQueue = [songToPlay];
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

        const success = await moduleLevelLoadAndPlay(songToPlay, generation);

        if (success) {
          preloadNextTracks(newQueue, startIndex, newAbortController.signal);

          if (!checkIsLocalTrack(songToPlay) && songToPlay.url && newQueue.length <= 1) {
            fetchRelatedSongs(songToPlay.url)
              .then(related => {
                if (!newAbortController.signal.aborted &&
                    session.currentSongId === songToPlay.id &&
                    related.length > 0) {
                  const currentQueue = session.queue;
                  const existingIds = new Set(currentQueue.map(s => s.id));
                  const newSongs = related.filter(s => !existingIds.has(s.id));
                  if (newSongs.length) {
                    setSession('queue', [...currentQueue, ...newSongs]);
                  }
                }
              })
              .catch(() => {});
          }
        } else {
          showAlert('Playback Error', `Failed to play "${songToPlay.title}". Please check your connection.`);
        }

      } catch (error: any) {
        console.error(`[MusicPlayer] playAudio error: ${error?.message || error}`);
        showAlert('Playback Error', `Failed to play "${songToPlay.title}".`);
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
      const newQueue = [...queue.slice(0, insertIndex), ...songsToAdd, ...queue.slice(insertIndex)];
      setSession('queue', newQueue);
      console.log(`[MusicPlayer] Added ${songsToAdd.length} songs to play next`);
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

        setSession('queue', queueSongs);
        setSession('queueIndex', 0);

        storeTrackExtras(queueSongs[0].id, {
          isLocal: true,
          likeCount: -1, dislikeCount: -1, viewCount: -1, commentsCount: -1,
          hasAudio: true, hasVideo: false, isAudioOnly: true, isVideoOnly: false,
        });

        const success = await moduleLevelLoadAndPlay(queueSongs[0], ++session.playGeneration);

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

  const togglePlayPause = useCallback(() => {
    if (!session.currentTrack) {
      showAlert('Nothing to Play', 'Please select a song first.');
      return;
    }

    try {
      const master = getMasterPlayer();
      const willBePlaying = !masterState.isPlaying;
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
  }, [masterState.isPlaying, showAlert]);

  const seekTo = useCallback((positionSec: number) => {
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
    if (index < 0 || index >= queue.length) {
      console.warn(`[MusicPlayer] skipToIndex: invalid index ${index}`);
      return;
    }
    console.log(`[MusicPlayer] Skipping to index ${index}: "${queue[index].title}"`);
    setSession('queueIndex', index);
    const success = await moduleLevelLoadAndPlay(queue[index], ++session.playGeneration);
    if (success) {
      preloadNextTracks(queue, index, session.bgAbortController?.signal);
    }
  }, [queue]);

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
    const newQueue = [...session.queue, ...songs];
    setSession('queue', newQueue);
    console.log(`[MusicPlayer] Added ${songs.length} songs to queue`);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const currentQueue = session.queue;
    if (index < 0 || index >= currentQueue.length) return;

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

  const onVideoPlay = useCallback(() => {
    const videoPlayFn = (global as any).__mavinMasterPlay;
    if (videoPlayFn && typeof videoPlayFn === 'function') { videoPlayFn(); }
  }, []);

  const onVideoPause = useCallback(() => {
    const videoPauseFn = (global as any).__mavinMasterPause;
    if (videoPauseFn && typeof videoPauseFn === 'function') { videoPauseFn(); }
  }, []);

  const onVideoSeek = useCallback((pos: number) => {
    const videoSeekFn = (global as any).__mavinMasterSeek;
    if (videoSeekFn && typeof videoSeekFn === 'function') { videoSeekFn(pos); }
  }, []);

  const handleAppBackground = useCallback(() => {
    saveLastPlayingState(session.currentTrack, masterState.position);
    saveLastActiveTab(session.videoActive ? 'video' : 'song');
    if (session.videoActive) {
      saveLastVideoPosition(session.videoPosition);
    }
  }, [masterState.position]);

  const handleAppForeground = useCallback(() => {}, []);

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
    notifyVideoTrackFinished,
  };

  return (
    <PlayerEngineContext.Provider value={engineValue}>
      <MusicPlayerContext.Provider value={musicPlayerValue}>
        <SystemMediaControlsBridge
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          position={position}
          duration={duration}
          repeatMode={repeatMode}
          onPlay={() => { 
            setSession('optimisticPlaying', true); 
            try { 
              const master = getMasterPlayer();
              master.play(); 
            } catch (e) {} 
          }}
          onPause={() => { 
            setSession('optimisticPlaying', false); 
            try { 
              const master = getMasterPlayer();
              master.pause(); 
            } catch (e) {} 
          }}
          onSkipNext={skipToNext}
          onSkipPrevious={skipToPrevious}
          onSeek={seekTo}
          onSetRepeatMode={setRepeatMode}
          onExpandPlayer={expandPlayer}
          isVideoActive={isVideoActive}
          videoPosition={videoPosition}
          videoDuration={videoDuration}
          videoIsPlaying={videoIsPlaying}
          onVideoSeek={onVideoSeek}
          onVideoPlay={onVideoPlay}
          onVideoPause={onVideoPause}
          onAppBackground={handleAppBackground}
          onAppForeground={handleAppForeground}
        />
        {children}
      </MusicPlayerContext.Provider>
    </PlayerEngineContext.Provider>
  );
};

registerResolveTrack(resolveTrack);
registerStoreTrackExtras(storeTrackExtras);

export { cancelAllPreloads, getPreloadAbortSignal };
export default MusicPlayerProvider;