// components/MusicPlayerContext.tsx
//
// CANONICAL PLAYER ENGINE — stream resolution + master-slave playback.
// COMPLETE QUEUE, REPEAT, SHUFFLE IMPLEMENTATION
// ANDROID-ONLY: All iOS-specific code removed
//
// MASTER-SLAVE ARCHITECTURE (Industry standard workaround for Expo limitations):
//   MASTER PLAYER: NewPlayer (MavinPlayer) instance that plays audio with YouTube headers
//   SLAVE PLAYER: expo-video instance for video rendering (muted, visible only on video tab)
//
// This file manages BOTH players. For remote tracks, MavinPlayer handles all audio playback
// with proper YouTube headers (Origin, Referer, Cookie). For local tracks, expo-video master
// is used as fallback.
//
// v12.0 - NEWPLAYER-FIRST PLAYBACK ARCHITECTURE
//   Uses MavinPlayer.playStream(videoId) for ALL remote YouTube tracks
//   Progressive URLs (MP4/WebM) are NEVER used for streaming - they cause 403 without headers
//   MavinPlayer's OkHttpDataSource.Factory injects YouTube headers automatically
//   expo-video master only used for local files (downloaded songs)

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, ToastAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

import MavinEngine, {
  StreamInfoItem,
  AudioStream,
  VideoStream,
  type HttpContextResult,
} from '@/modules/mavin-engine';

import MavinPlayer from '@/modules/mavin-player';

import { DownloadedSongMetadata } from '@/store/library';
import { supabaseCache } from '@/libs/cache/supabase-cache';
import type { Song } from '@/types/song';

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
export type PlayMode = 'IDLE' | 'EMBEDDED_VIDEO' | 'FULLSCREEN_VIDEO' | 'PIP' | 'FULLSCREEN_AUDIO' | 'EMBEDDED_AUDIO';

export interface TrackExtras {
  dashManifestUrl?: string;
  hlsManifestUrl?: string;
  videoOnlyManifestUrl?: string;
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
  dashManifestUrl?: string;
  hlsManifestUrl?: string;
  videoOnlyManifestUrl?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  isAudioOnly: boolean;
  isVideoOnly: boolean;
  /**
   * The HTTP session context captured atomically inside streamInfoToMap at
   * the moment StreamInfo.getInfo() completed. Returned as part of the
   * getStreamInfo/getStreamInfoById response — not a separate call.
   *
   * Industry standard: URLs and the session that produced them are one
   * inseparable package. This field carries that session to loadAndPlay().
   */
  httpContext?: HttpContextResult;
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
  // NewPlayer state
  newPlayerPlaying: boolean;
  newPlayerPosition: number;
  newPlayerDuration: number;
  newPlayerBufferedPercent: number;
  usingNewPlayer: boolean;
  currentVideoId: string | null;
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
  newPlayerPlaying: false,
  newPlayerPosition: 0,
  newPlayerDuration: 0,
  newPlayerBufferedPercent: 0,
  usingNewPlayer: false,
  currentVideoId: null,
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

export function setPreferredStreamType(type: 'audio' | 'video') {
  setSession('preferredStreamType', type);
  (global as any).__MavinPreferredStreamType = type;
  console.log(`[MusicPlayer] Preferred stream type set to: ${type}`);
}

export function getPreferredStreamType(): 'audio' | 'video' {
  return session.preferredStreamType;
}

function normalizeLocalUri(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('content://') || uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const RESTORE_GLOBALS = {
  DONE_KEY: '__MavinRestoreDone__',
  IN_PROGRESS_KEY: '__MavinRestoreInProgress__',
  TRACK_KEY: '__MavinRestoredTrack__',
  POSITION_KEY: '__MavinRestoredPosition__',
  RESOLVED_URL_KEY: '__MavinRestoredResolvedUrl__',
  PLAYER_READY_KEY: '__MavinRestoredPlayerReady__',
  RESTORED_TAB_KEY: '__MavinRestoredTab__',
  RESTORED_VIDEO_POSITION_KEY: '__MavinRestoredVideoPosition__',
  VIDEO_ONLY_URL_KEY: '__MavinRestoredVideoOnlyUrl__',
} as const;

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

export function enrichLocalTrackMetadata(song: Song, filePath?: string, folderName?: string): Song {
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

export function isLocalTrack(track: Song | null | undefined): boolean {
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

export function ensureQueueMetadata(queue: Song[]): Song[] {
  return queue.map(song => {
    if (isLocalTrack(song)) {
      return enrichLocalTrackMetadata(song, song.url);
    }
    return song;
  });
}

const TABLE_NOT_FOUND_MSG = 'track_stats';

const safeSaveTrackStats = async (params: any) => {
  try {
    await supabaseCache.saveTrackStats(params);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG)) {
      console.warn('[MusicPlayer] saveTrackStats error:', e?.message);
    }
  }
};

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
  const withManifest = streams.filter(s => !s.isUrl && s.manifestUrl);
  if (withManifest.length > 0) {
    return withManifest.reduce((best, s) => (s.height > best.height ? s : best), withManifest[0]);
  }
  const withVideo = streams.filter(s => s.height > 0 && s.isUrl);
  if (!withVideo.length) return null;
  const p720 = withVideo.find(s => s.height === 720);
  if (p720) return p720;
  return withVideo.reduce((best, s) => (s.height > best.height ? s : best), withVideo[0]);
}

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

    const dashManifestUrl: string | null = info.dashMpdUrl?.length > 0 ? info.dashMpdUrl : null;
    const hlsManifestUrl: string | null = info.hlsUrl?.length > 0 ? info.hlsUrl : null;
    
    const videoOnlyStreams: VideoStream[] = info.videoOnlyStreams ?? [];
    const bestVideoOnly = pickBestVideoOnlyManifest(videoOnlyStreams);
    const videoOnlyManifestUrl: string | null = bestVideoOnly?.manifestUrl?.length > 0 ? bestVideoOnly.manifestUrl : null;
    
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

    let primaryPlaybackUrl: string | null = null;
    if (dashManifestUrl) {
      primaryPlaybackUrl = dashManifestUrl;
      console.log(`[MusicPlayer] Using DASH manifest for "${song.title}"`);
    } else if (hlsManifestUrl) {
      primaryPlaybackUrl = hlsManifestUrl;
      console.log(`[MusicPlayer] Using HLS manifest for "${song.title}"`);
    } else if (audioProgressiveUrl) {
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

    // Extract the HTTP context that streamInfoToMap captured atomically during
    // StreamInfo.getInfo(). This is the same session that was active during the
    // YouTube extraction — cookie, Origin, Referer, client version.
    // It travels with the resolved URLs as one package to loadAndPlay().
    const httpContext: HttpContextResult | undefined = info.httpContext
      ? {
          cookie:                info.httpContext.cookie               ?? '',
          origin:                info.httpContext.origin               ?? 'https://www.youtube.com',
          referer:               info.httpContext.referer              ?? 'https://www.youtube.com/',
          acceptLanguage:        info.httpContext.acceptLanguage       ?? 'en-US,en;q=0.9',
          xYoutubeClientName:    info.httpContext.xYoutubeClientName   ?? '3',
          xYoutubeClientVersion: info.httpContext.xYoutubeClientVersion ?? '',
          userAgent:             info.httpContext.userAgent            ??
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      : undefined;

    return {
      id: song.id,
      url: primaryPlaybackUrl,
      title: info.title ?? song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      duration: duration > 0 ? duration : undefined,
      // song.videoId may be undefined for queue items built without it.
      // info.id is the canonical video ID returned by NewPipeExtractor — always present.
      videoId: song.videoId || info.id || videoId || undefined,
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
      httpContext,
    };
  } catch (primaryErr: any) {
    const errorMsg = primaryErr?.message || String(primaryErr);
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, errorMsg);
    
    if (errorMsg === 'ACCOUNT_TERMINATED') {
      return null;
    }
  }

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

      const dashManifestUrl: string | null = info.dashMpdUrl?.length > 0 ? info.dashMpdUrl : null;
      const hlsManifestUrl: string | null = info.hlsUrl?.length > 0 ? info.hlsUrl : null;
      const videoOnlyStreams: VideoStream[] = info.videoOnlyStreams ?? [];
      const bestVideoOnly = pickBestVideoOnlyManifest(videoOnlyStreams);
      const videoOnlyManifestUrl: string | null = bestVideoOnly?.manifestUrl?.length > 0 ? bestVideoOnly.manifestUrl : null;

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
        // Use the video ID we found during search if song.videoId was missing.
        videoId: song.videoId || foundVideoId || info.id || undefined,
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
  deactivateAudio: () => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};

let masterPlayerRef: any = null;

export const setMasterPlayer = (player: any) => {
  masterPlayerRef = player;
  console.log('[MusicPlayer] Master player registered');
};

export const resetSSLFastPath = () => {
  console.log('[MusicPlayer] resetSSLFastPath called (no-op)');
};

function getMasterPlayer(): any {
  if (!masterPlayerRef) {
    throw new Error('Master player not registered');
  }
  return masterPlayerRef;
}

function waitForPlayerReady(
  player: any,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
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

// NewPlayer event listeners setup
let newPlayerListenersInitialized = false;
// Bounded retry counter for PlaybackException re-resolve cycles.
// Reset to 0 on every successful loadAndPlay. Capped at 1 so a broken
// progressive URL doesn't loop forever.
let newPlayerErrorRetryCount = 0;

function initNewPlayerListeners() {
  if (newPlayerListenersInitialized) return;
  newPlayerListenersInitialized = true;

  // Listen for playback state changes from NewPlayer
  MavinPlayer.onPlaybackStateChanged((event) => {
    console.log('[MusicPlayer] NewPlayer onPlaybackStateChanged:', event);
    const isPlaying = event.isPlaying;
    setSession('newPlayerPlaying', isPlaying);
    setSession('optimisticPlaying', null);
    
    // When playback starts, mark that we're using NewPlayer
    if (isPlaying && !session.usingNewPlayer) {
      setSession('usingNewPlayer', true);
    }
    
    notifySessionChange();
  });

  // Listen for position changes from NewPlayer
  MavinPlayer.onPositionChanged((event) => {
    const positionSec = event.position / 1000; // Convert ms to seconds
    const durationSec = event.duration / 1000;
    const bufferedPercent = event.bufferedPercent;
    
    setSession('newPlayerPosition', positionSec);
    setSession('newPlayerDuration', durationSec);
    setSession('newPlayerBufferedPercent', bufferedPercent);
    setSession('bufferedPosition', (bufferedPercent / 100) * durationSec);
    
    // Update video position if video active
    if (session.videoActive) {
      setSession('videoPosition', positionSec);
      setSession('videoDuration', durationSec);
    }
    
    notifySessionChange();
  });

  // Listen for track changes
  MavinPlayer.onTrackChanged((event) => {
    console.log('[MusicPlayer] NewPlayer onTrackChanged:', event);
    const videoId = event.item;
    setSession('currentVideoId', videoId);
    notifySessionChange();
  });

  // Listen for errors — bounded re-resolve retry on PlaybackException.
  //
  // When ExoPlayer fails (most commonly: progressive URL 403, codec error,
  // or network timeout), rescueStreamFault fires NoResponse which surfaces
  // here as an onError event. We get one retry: re-resolve the current track
  // with a fresh visitor data refresh, then call loadAndPlay again with the
  // new URLs. If the retry also fails, or if this isn't a retryable error,
  // we clear loading state and stop.
  MavinPlayer.onError((event) => {
    console.error('[MusicPlayer] NewPlayer error:', event.message);
    setSession('lastError', event.message);

    const isPlaybackException =
      event.message?.includes('Playback Exception') ||
      event.message?.includes('rescueStreamFault') ||
      event.message?.includes('HttpDataSourceException') ||
      event.message?.includes('Unable to connect') ||
      event.message?.includes('Response code: 403') ||
      event.message?.includes('Response code: 404');

    const track = session.currentTrack;
    const canRetry =
      isPlaybackException &&
      newPlayerErrorRetryCount < CONFIG.MAX_PLAYBACK_ERROR_RETRIES &&
      track !== null &&
      !isLocalTrack(track);

    if (canRetry) {
      newPlayerErrorRetryCount++;
      const retryGeneration = session.playGeneration;
      console.warn(
        `[MusicPlayer] PlaybackException — re-resolving with fresh visitor data (attempt ${newPlayerErrorRetryCount})`,
      );

      // Re-resolve on a microtask so we don't block the event callback.
      Promise.resolve()
        .then(() => MavinEngine.refreshVisitorData().catch(() => {}))
        .then(() => resolveTrack(track!, /* bypassCache= */ true))
        .then(async (resolved) => {
          // Generation guard: abort if a newer track started while we resolved.
          if (!resolved || !resolved.videoId || retryGeneration !== session.playGeneration) {
            console.log('[MusicPlayer] Retry resolve abandoned (stale generation or no result)');
            setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: null });
            return;
          }
          console.log('[MusicPlayer] Retry resolve succeeded, calling loadAndPlay again');
          const result = await MavinPlayer.loadAndPlay(
            resolved.videoId,
            resolved.dashManifestUrl  ?? null,
            resolved.hlsManifestUrl   ?? null,
            (!resolved.dashManifestUrl && !resolved.hlsManifestUrl) ? (resolved.url ?? null) : null,
            resolved.httpContext ?? null,
          );
          if (result?.success) {
            console.log('[MusicPlayer] Retry loadAndPlay succeeded');
            setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true });
          } else {
            console.error('[MusicPlayer] Retry loadAndPlay returned false');
            setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: null });
          }
        })
        .catch((err) => {
          console.error('[MusicPlayer] Retry resolve/play failed:', err?.message ?? err);
          setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: null });
        });
    } else {
      newPlayerErrorRetryCount = 0;
      setSession('isLoading', false);
      setSession('isResolving', false);
      setSession('optimisticPlaying', null);
      notifySessionChange();
    }
  });

  // Listen for playlist changes
  MavinPlayer.onPlaylistChanged((event) => {
    console.log('[MusicPlayer] NewPlayer playlist changed:', event.playlist?.length);
  });
}

// Module-level restore with NewPlayer
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

    // For remote tracks, use NewPlayer
    if (!isLocalTrack(track) && track.videoId) {
      try {
        initNewPlayerListeners();
        const result = await MavinPlayer.playStream(track.videoId);
        if (result.success) {
          setSession('usingNewPlayer', true);
          setSession('currentVideoId', track.videoId);
          if (savedPos > 5) {
            await MavinPlayer.seekTo(savedPos * 1000);
          }
          g[RESTORE_GLOBALS.PLAYER_READY_KEY] = true;
          console.log('[MusicPlayer] Module-level restore complete with NewPlayer:', track.title);
        }
      } catch (e) {
        console.warn('[MusicPlayer] NewPlayer restore failed:', e);
      }
    } else if (isLocalTrack(track)) {
      // For local tracks, use expo-video master
      let finalUrl = normalizeLocalUri(track.url);
      if (masterPlayerRef) {
        try {
          await masterPlayerRef.replaceAsync({ uri: finalUrl, useCaching: true });
          await waitForPlayerReady(masterPlayerRef, CONFIG.MANIFEST_LOAD_TIMEOUT_MS);
          if (savedPos > 5 && savedPos < (track.duration ?? Infinity)) {
            masterPlayerRef.currentTime = savedPos;
          }
          g[RESTORE_GLOBALS.PLAYER_READY_KEY] = true;
          console.log('[MusicPlayer] Module-level restore complete for local track:', track.title);
        } catch (playerErr) {
          console.warn('[MusicPlayer] Local track restore failed:', playerErr);
        }
      }
    }
  } catch (err) {
    console.warn('[MusicPlayer] Module-level restore failed:', err);
  } finally {
    (global as any)[RESTORE_GLOBALS.DONE_KEY] = true;
    (global as any)[RESTORE_GLOBALS.IN_PROGRESS_KEY] = false;
  }
})();

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

let skipInProgress = false;
let lastSkipTime = 0;
const SKIP_DEBOUNCE_MS = 1000;

async function moduleLevelLoadAndPlay(song: Song, generation: number, isRetry = false): Promise<boolean> {
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
    // For LOCAL tracks: use expo-video master
    if (isLocalTrack(enrichedSong)) {
      let finalUrl = normalizeLocalUri(enrichedSong.url);
      console.log(`[MusicPlayer] [Local] Direct playback: ${finalUrl.substring(0, 100)}...`);
      
      const master = getMasterPlayer();
      await master.replaceAsync({ uri: finalUrl, useCaching: true });
      await waitForPlayerReady(master, 5000);
      
      releasePlaybackLock();
      await master.play();
      
      setSessionPartial({ isLoading: false, isResolving: false, optimisticPlaying: true, usingNewPlayer: false });
      return true;
    }

    // ── REMOTE TRACKS: MavinEngine extracts → MavinPlayer plays ────────────────
    //
    // Industry standard one-cycle architecture:
    //   Phase 1 — Resolution: MavinEngine calls YouTube once, returns URLs + session
    //   Phase 1b — Context read: httpContext field from the resolution result object
    //   Phase 2 — Handoff: bundle (URLs + HTTP context) crosses bridge to Kotlin
    //   Phase 3 — Playback: NewPlayer serves bundle to ExoPlayer, zero YouTube calls
    //
    // httpContext is captured atomically inside streamInfoToMap at extraction time.
    // It travels as a field of the resolved object — same response, same snapshot.
    // OkHttpDataSource.Factory uses it so CDN requests carry that exact session.
    // YouTube sees one continuous authenticated session. No 403.

    // Warm disk-cached extras while resolution is in flight (non-blocking)
    if (enrichedSong.id) {
      const diskCached = await getCachedTrackExtras(enrichedSong.id);
      if (diskCached && !trackExtrasStore.has(enrichedSong.id)) {
        trackExtrasStore.set(enrichedSong.id, diskCached);
        notifyTrackExtrasChange();
      }
    }

    // ── Phase 1: Resolution ───────────────────────────────────────────────────
    // One extraction call. Returns resolved URLs (DASH, HLS, or progressive).
    let resolved: ResolvedTrack | null = null;
    try {
      resolved = await resolveTrackWithRetry(enrichedSong);
    } catch (resolveErr: any) {
      console.error(`[MusicPlayer] Failed to resolve track: "${enrichedSong.title}"`, resolveErr?.message);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Failed to resolve stream', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }

    if (!resolved || !resolved.videoId) {
      console.error(`[MusicPlayer] No videoId resolved for: "${enrichedSong.title}"`);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: 'Failed to get video ID', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }

    // Back-fill videoId onto the queue entry if it was missing.
    // Queue items built from search results or playlist responses often lack videoId.
    // Patching the queue now means skipToNext/skipToPrevious will find it populated.
    if (!enrichedSong.videoId && resolved.videoId) {
      enrichedSong = { ...enrichedSong, videoId: resolved.videoId };
      const idx = session.queueIndex;
      if (idx >= 0 && session.queue[idx]?.id === enrichedSong.id) {
        const updatedQueue = [...session.queue];
        updatedQueue[idx] = enrichedSong;
        setSession('queue', updatedQueue);
      }
    }

    setSessionPartial({
      hasVideoStream: resolved.hasVideo,
      isAudioOnlyTrack: resolved.isAudioOnly,
      isVideoOnlyTrack: resolved.isVideoOnly,
    });

    // ── Phase 1b: Read HTTP context from resolution result ────────────────────
    // httpContext was captured atomically inside streamInfoToMap at the exact
    // moment StreamInfo.getInfo() completed in the Kotlin engine. It is part
    // of the same response object as the resolved URLs.
    //
    // Industry standard: resolver returns one complete package — URLs + the
    // session that produced them. No separate call. No race. No drift.
    // Player receives this field and uses it to build OkHttpDataSource.Factory.
    // CDN segment requests carry the exact same session that extracted the video.
    const httpContext: import('@/modules/mavin-player').PlayerHttpContext | null =
      resolved.httpContext ?? null;
    console.log('[MusicPlayer] HTTP context from resolution — cookiePresent:',
      (httpContext?.cookie?.length ?? 0) > 0);

    // ── Phase 2 + 3: Bundle handoff and playback ──────────────────────────────
    // loadAndPlay stores the bundle atomically in the repository then fires
    // playStream(). NewPlayer reads getStreams() and getHttpDataSourceFactory()
    // from the stored bundle — no YouTube calls from the player side.
    initNewPlayerListeners();

    console.log('[MusicPlayer] Calling MavinPlayer.loadAndPlay for:', resolved.videoId, {
      hasDash:        !!resolved.dashManifestUrl,
      hasHls:         !!resolved.hlsManifestUrl,
      hasProgressive: !resolved.dashManifestUrl && !resolved.hlsManifestUrl && !!resolved.url,
      hasCookie:      (httpContext?.cookie?.length ?? 0) > 0,
    });

    try {
      const result = await MavinPlayer.loadAndPlay(
        resolved.videoId,
        resolved.dashManifestUrl  ?? null,
        resolved.hlsManifestUrl   ?? null,
        // Progressive URL only when no manifests available.
        // resolved.url is the best audio URL in that case.
        (!resolved.dashManifestUrl && !resolved.hlsManifestUrl) ? (resolved.url ?? null) : null,
        httpContext,
      );

      if (!result.success) {
        throw new Error('MavinPlayer.loadAndPlay returned false');
      }

      console.log('[MusicPlayer] MavinPlayer.loadAndPlay succeeded for:', resolved.videoId);

      // Reset the playback-error retry counter — this track loaded cleanly.
      newPlayerErrorRetryCount = 0;

      if (session.playbackRate !== 1.0) {
        await MavinPlayer.setPlaybackSpeed(session.playbackRate).catch(() => {});
      }

      releasePlaybackLock();
      setSessionPartial({
        isLoading: false,
        isResolving: false,
        optimisticPlaying: true,
        usingNewPlayer: true,
        currentVideoId: resolved.videoId,
      });
      return true;

    } catch (playError: any) {
      console.error('[MusicPlayer] MavinPlayer.loadAndPlay failed:', playError?.message);
      setSessionPartial({ isLoading: false, isResolving: false, lastError: playError?.message || 'Playback failed', optimisticPlaying: null });
      releasePlaybackLock();
      return false;
    }

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
      // Repeat one: seek to 0 and continue playing
      if (session.usingNewPlayer && session.currentVideoId) {
        await MavinPlayer.seekTo(0);
        await MavinPlayer.play();
      } else {
        try {
          const master = getMasterPlayer();
          master.currentTime = 0;
          await master.play();
        } catch (error) {
          console.warn('[MusicPlayer] Failed to repeat track:', error);
        }
      }
      setSession('optimisticPlaying', true);
      console.log('[MusicPlayer] Repeated current track (repeat one mode)');
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
    // Check if we're within first 3 seconds to restart vs go previous
    let currentPosition = 0;
    if (session.usingNewPlayer) {
      currentPosition = session.newPlayerPosition;
    } else {
      try {
        const master = getMasterPlayer();
        currentPosition = master.currentTime ?? 0;
      } catch {}
    }

    if (currentPosition > 3) {
      // Restart current track
      if (session.usingNewPlayer && session.currentVideoId) {
        await MavinPlayer.seekTo(0);
        await MavinPlayer.play();
      } else {
        try {
          const master = getMasterPlayer();
          master.currentTime = 0;
          await master.play();
        } catch {}
      }
      console.log('[MusicPlayer] Restarted current track');
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
      // No previous track, restart current
      if (session.usingNewPlayer && session.currentVideoId) {
        await MavinPlayer.seekTo(0);
        await MavinPlayer.play();
      } else {
        try {
          const master = getMasterPlayer();
          master.currentTime = 0;
        } catch {}
      }
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

function setSleepTimer(minutes: number): void {
  const endsAt = Date.now() + minutes * 60 * 1000;
  setSession('sleepTimerEndsAt', endsAt);
  console.log(`[MusicPlayer] Sleep timer set for ${minutes} minutes, ends at ${new Date(endsAt).toLocaleTimeString()}`);
}

function clearSleepTimer(): void {
  setSession('sleepTimerEndsAt', null);
  console.log('[MusicPlayer] Sleep timer cleared');
}

async function setPlaybackRate(rate: number): Promise<void> {
  const clamped = Math.min(Math.max(rate, 0.25), 3.0);
  try {
    if (session.usingNewPlayer) {
      await MavinPlayer.setPlaybackSpeed(clamped);
    } else {
      const master = getMasterPlayer();
      master.playbackRate = clamped;
    }
    setSession('playbackRate', clamped);
    await savePlaybackRate(clamped);
    console.log(`[MusicPlayer] Playback rate set to ${clamped}`);
  } catch (e) {
    console.warn('[MusicPlayer] setPlaybackRate error:', e);
  }
}

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

  // Polling interval that reads from the appropriate source (NewPlayer or expo-video)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        // If using NewPlayer, read from session state (updated by NewPlayer listeners)
        if (session.usingNewPlayer) {
          const newState = {
            isPlaying: session.newPlayerPlaying,
            position: session.newPlayerPosition,
            duration: session.newPlayerDuration,
            isBuffering: false, // NewPlayer doesn't expose buffering directly
          };
          setMasterState(prev => {
            if (
              prev.isPlaying === newState.isPlaying &&
              Math.abs(prev.position - newState.position) < 0.1 &&
              prev.duration === newState.duration
            ) {
              return prev;
            }
            return newState;
          });
          
          // Update buffered position
          const bufferedPercent = session.newPlayerBufferedPercent;
          const bufferedSec = (bufferedPercent / 100) * session.newPlayerDuration;
          if (bufferedSec !== session.bufferedPosition) {
            setSession('bufferedPosition', bufferedSec);
          }
          
          // Check sleep timer
          if (session.sleepTimerEndsAt !== null && Date.now() >= session.sleepTimerEndsAt) {
            console.log('[MusicPlayer] Sleep timer expired, pausing playback');
            MavinPlayer.pause();
            setSession('optimisticPlaying', false);
            setSession('sleepTimerEndsAt', null);
          }
          return;
        }
        
        // Fallback to expo-video master for local files
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

          const buffered = master.bufferedPosition ?? 0;
          if (buffered !== session.bufferedPosition) {
            setSession('bufferedPosition', buffered);
          }
          
          if (newState.duration > 0 && session.videoDuration !== newState.duration) {
            session.videoDuration = newState.duration;
          }
          if (newState.position !== session.videoPosition) {
            session.videoPosition = newState.position;
          }
          
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

  // Use the appropriate playing state based on which player is active
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
      const willBePlaying = !isPlaying;
      setSession('optimisticPlaying', willBePlaying);

      if (session.usingNewPlayer) {
        if (willBePlaying) {
          MavinPlayer.play();
          console.log('[MusicPlayer] Playing via NewPlayer');
        } else {
          MavinPlayer.pause();
          console.log('[MusicPlayer] Paused via NewPlayer');
        }
      } else {
        const master = getMasterPlayer();
        if (willBePlaying) {
          master.play();
          console.log('[MusicPlayer] Playing via expo-video');
        } else {
          master.pause();
          console.log('[MusicPlayer] Paused via expo-video');
        }
      }
    } catch (e) {
      console.warn('[MusicPlayer] togglePlayPause error:', e);
    }
  }, [isPlaying, showAlert]);

  const seekTo = useCallback((positionSec: number) => {
    session.didHandleFinish = false;
    try {
      if (session.usingNewPlayer) {
        MavinPlayer.seekTo(positionSec * 1000);
        setSession('videoPosition', positionSec);
      } else {
        const master = getMasterPlayer();
        master.currentTime = positionSec;
        setSession('videoPosition', positionSec);
      }
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
    if (session.usingNewPlayer) {
      MavinPlayer.setRepeatMode(mode);
    }
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
    if (session.usingNewPlayer) {
      MavinPlayer.setShuffle(mode === 'on');
    }
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
      if (session.usingNewPlayer) {
        // NewPlayer volume control via ExoPlayer
        // MavinPlayer doesn't expose volume directly; will be handled by native
      } else {
        const master = getMasterPlayer();
        master.volume = clamped;
      }
      setSession('volume', clamped);
      await saveVolume(clamped);
    } catch (e) { console.warn('[MusicPlayer] setVolume error:', e); }
  }, []);

  const setPreservePitch = useCallback(async (preserve: boolean) => {
    try {
      if (!session.usingNewPlayer) {
        const master = getMasterPlayer();
        master.preservesPitch = preserve;
      }
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
      if (session.usingNewPlayer) {
        MavinPlayer.play();
      } else {
        try { 
          const master = getMasterPlayer();
          master.play(); 
        } catch (e) {} 
      }
    },
    pause: () => { 
      setSession('optimisticPlaying', false); 
      if (session.usingNewPlayer) {
        MavinPlayer.pause();
      } else {
        try { 
          const master = getMasterPlayer();
          master.pause(); 
        } catch (e) {} 
      }
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