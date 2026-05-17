// components/MusicPlayerContext.tsx
//
// CANONICAL PLAYER ENGINE — stream resolution + expo-audio playback.
// COMPLETE QUEUE, REPEAT, SHUFFLE IMPLEMENTATION
// ANDROID-ONLY: All iOS-specific code removed
//
// ISSUE 1 FIX: Module-level audio player singleton via stable ref pattern.
// The player instance is created once and stored in a ref that survives
// all React remounts, Fast Refresh, and navigation changes.
//
// FIXES INCLUDED:
// - Android-only playback flow
// - Removed all iOS conditionals and iOS-specific replace logic
// - Fixed unsafe .catch on player.replace()
// - Proper content:// caching for Android MediaStore
// - Local file:// normalization
// - Local metadata enrichment
// - Reliable restore state handling
// - Queue, repeat, shuffle, skipToIndex support
// - SystemMediaControlsBridge with explicit typed props
// - No circular dependency with player setup hooks
// - Player instance survives provider remounts via stable ref

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useNetInfo } from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';

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
  [key: string]: any;
}

interface QueueEntry {
  song: Song;
  audioUrl: string;
  duration: number;
  isDownloaded: boolean;
}

const CONFIG = {
  STREAM_TTL_MS: 6 * 60 * 60 * 1000,
  MAX_EXTRAS_CACHE: 50,
  SEEK_DEBOUNCE_MS: 150,
  AUTO_EXPAND_DELAY_MS: 100,
  TEMP_PLAYBACK_CACHE_TTL_MS: 3600000,
} as const;

const STORAGE_KEYS = {
  LAST_PLAYING_TRACK: 'last_playing_track',
  LAST_PLAYING_POSITION: 'last_playing_position',
  REPEAT_MODE: 'repeat_mode',
  SHUFFLE_MODE: 'shuffle_mode',
} as const;

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

async function cacheLocalFileForPlayback(contentUri: string, trackId: string): Promise<string | null> {
  if (!contentUri) return null;

  try {
    const cacheDir = `${FileSystem.cacheDirectory}temp_playback/`;
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);

    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    }

    const sanitizedId = trackId.replace(/[^a-zA-Z0-9]/g, '_');
    const cachePath = `${cacheDir}${sanitizedId}.mp3`;

    const existing = await FileSystem.getInfoAsync(cachePath);
    if (existing.exists && existing.modificationTime) {
      const age = Date.now() - existing.modificationTime;
      if (age < CONFIG.TEMP_PLAYBACK_CACHE_TTL_MS) {
        console.log(`[MusicPlayer] Using cached temp file: ${cachePath}`);
        return cachePath;
      }
    }

    console.log(`[MusicPlayer] Copying content:// URI to temp cache: ${contentUri.substring(0, 100)}...`);
    await FileSystem.copyAsync({ from: contentUri, to: cachePath });

    const files = await FileSystem.readDirectoryAsync(cacheDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = `${cacheDir}${file}`;
      const info = await FileSystem.getInfoAsync(filePath);
      if (info.exists && info.modificationTime) {
        if (now - info.modificationTime > CONFIG.TEMP_PLAYBACK_CACHE_TTL_MS) {
          await FileSystem.deleteAsync(filePath);
          console.log(`[MusicPlayer] Cleaned old temp file: ${file}`);
        }
      }
    }

    console.log(`[MusicPlayer] Cached content URI to: ${cachePath}`);
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
        console.log(
          `[Enricher] Extracted from title: artist="${enriched.artist}", title="${enriched.title}"`,
        );
      }
    } else if (filePath) {
      const filename = filePath.split('/').pop() || '';
      const extractedArtist = extractArtistFromFilename(filename);
      enriched.artist = extractedArtist;

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

      console.log(`[Enricher] Extracted from filename: artist="${enriched.artist}"`);
    } else if (folderName && folderName !== 'Unknown' && folderName !== '') {
      enriched.artist = folderName;
      console.log(`[Enricher] Using folder name as artist: "${enriched.artist}"`);
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
    url.startsWith('file://') === true ||
    url.startsWith('/') === true ||
    url.startsWith('content://') === true ||
    (track as any).isLocal === true ||
    (track as any).isDownloaded === true
  );
}

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
      const f =
        t < 20
          ? (b & c) | ((~b >>> 0) & d)
          : t < 40
            ? b ^ c ^ d
            : t < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = t < 20 ? 0x5A827999 : t < 40 ? 0x6ED9EBA1 : t < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const tmp = (rot + f + e + k + W[t]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = tmp;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
  }

  const out = new Uint8Array(20);
  H.forEach((v, i) => {
    out[i * 4] = (v >>> 24) & 0xff;
    out[i * 4 + 1] = (v >>> 16) & 0xff;
    out[i * 4 + 2] = (v >>> 8) & 0xff;
    out[i * 4 + 3] = v & 0xff;
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

const trackExtrasStore = new Map<string, TrackExtras>();
let trackExtrasVersion = 0;
const trackExtrasVersionListeners = new Set<() => void>();

function notifyTrackExtrasChange() {
  trackExtrasVersion++;
  trackExtrasVersionListeners.forEach(fn => fn());
}

function storeTrackExtras(trackId: string, extras: TrackExtras): void {
  if (trackExtrasStore.size >= CONFIG.MAX_EXTRAS_CACHE) {
    const firstKey = trackExtrasStore.keys().next().value;
    if (firstKey) trackExtrasStore.delete(firstKey);
  }
  trackExtrasStore.set(trackId, extras);
  notifyTrackExtrasChange();
}

export function getTrackExtras(trackId: string | undefined | null): TrackExtras | null {
  if (!trackId) return null;
  return trackExtrasStore.get(trackId) ?? null;
}

export function useTrackExtrasVersion(): number {
  const [version, setVersion] = useState(trackExtrasVersion);
  useEffect(() => {
    const listener = () => setVersion(trackExtrasVersion);
    trackExtrasVersionListeners.add(listener);
    return () => {
      trackExtrasVersionListeners.delete(listener);
    };
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

interface StreamCacheRow {
  stream_url: string;
  expiry: string;
  duration: number | null;
}

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
  } catch {
    return null;
  }
}

async function getCachedVideoStream(trackId: string): Promise<string | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams')
      .select('stream_url, expiry')
      .eq('track_id', uuid)
      .eq('stream_type', 'video')
      .eq('is_active', true)
      .gt('expiry', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return data.stream_url;
  } catch {
    return null;
  }
}

async function cacheStreamsToSupabase(
  trackId: string,
  audioUrl: string,
  videoUrl: string | null,
  duration: number,
): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const expiry = new Date(Date.now() + CONFIG.STREAM_TTL_MS).toISOString();
    const now = new Date().toISOString();

    const rows = [
      {
        track_id: uuid,
        source: 'youtube',
        stream_url: audioUrl,
        stream_type: 'audio' as const,
        quality: 'high',
        format: 'webm',
        duration: Math.round(duration),
        expiry,
        is_active: true,
        health_score: 100,
        last_accessed: now,
        access_count: 1,
      },
      ...(videoUrl
        ? [
            {
              track_id: uuid,
              source: 'youtube',
              stream_url: videoUrl,
              stream_type: 'video' as const,
              quality: '720p',
              format: 'mp4',
              duration: Math.round(duration),
              expiry,
              is_active: true,
              health_score: 100,
              last_accessed: now,
              access_count: 1,
            },
          ]
        : []),
    ];

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
    dislikeCount:
      typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
    viewCount: typeof info.viewCount === 'number' && info.viewCount > 0 ? Math.round(info.viewCount) : -1,
    commentsCount,
  };
}

const resolveTrack = async (song: Song): Promise<ResolvedTrack | null> => {
  const url = song.url || '';
  if (!url) {
    console.warn(`[MusicPlayer] Track "${song.title}" has no URL`);
    return null;
  }

  const isLocal =
    url.startsWith('file://') ||
    url.startsWith('/') ||
    url.startsWith('content://') ||
    (song as any).isLocal === true ||
    (song as any).isDownloaded === true;

  if (isLocal) {
    console.log(`[MusicPlayer] Local track detected: "${song.title}" (URI: ${url.substring(0, 100)}...)`);

    const enrichedSong = enrichLocalTrackMetadata(song, url);
    console.log(`[MusicPlayer] Enriched: "${enrichedSong.title}" by ${enrichedSong.artist}`);

    let finalUrl = enrichedSong.url!;
    if (finalUrl.startsWith('content://')) {
      const cachedPath = await cacheLocalFileForPlayback(finalUrl, enrichedSong.id);
      if (cachedPath) {
        finalUrl = cachedPath;
        console.log(`[MusicPlayer] Converted content:// to cached file: ${finalUrl.substring(0, 100)}...`);
      } else {
        console.error('[MusicPlayer] Failed to cache content URI, playback may fail');
      }
    } else if (finalUrl.startsWith('/')) {
      finalUrl = `file://${finalUrl}`;
      console.log(`[MusicPlayer] Normalized file path: ${finalUrl.substring(0, 100)}...`);
    }

    storeTrackExtras(enrichedSong.id, {
      isLocal: true,
      videoId: song.videoId,
      likeCount: -1,
      dislikeCount: -1,
      viewCount: -1,
      commentsCount: -1,
    });

    return {
      id: enrichedSong.id,
      url: finalUrl,
      title: enrichedSong.title,
      artist: enrichedSong.artist,
      thumbnail: enrichedSong.thumbnail,
      duration: enrichedSong.duration,
      videoId: enrichedSong.videoId,
      isDownloaded: true,
      isLocal: true,
    };
  }

  try {
    const [cachedAudio, cachedVideo] = await Promise.all([
      getCachedAudioStream(song.id),
      getCachedVideoStream(song.id),
    ]);

    if (cachedAudio) {
      let extras: TrackExtras = { videoId: song.videoId };

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
          };
        }
      }

      storeTrackExtras(song.id, { ...extras, videoUrl: cachedVideo ?? undefined });

      return {
        id: song.id,
        url: cachedAudio.url,
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        duration: cachedAudio.duration > 0 ? cachedAudio.duration : undefined,
        videoId: extras.videoId,
        isDownloaded: false,
        isLocal: false,
      };
    }
  } catch (cacheErr) {
    console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
  }

  try {
    const info = await MavinEngine.getStreamInfo(song.url, 0);
    if (!info.success) throw new Error('extraction returned success=false');

    const bestAudio = pickBestAudio(info.audioStreams ?? []);
    const bestVideo =
      pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
    const bestMuxed = pickBestVideo(info.videoStreams ?? []);

    if (!bestAudio?.url) throw new Error('no audio stream available');

    const audioUrl = bestAudio.url;
    const videoUrl = bestVideo?.url ?? null;
    const muxedVideoUrl = bestMuxed?.url ?? null;
    const duration = info.duration ?? 0;

    let commentsCount = -1;
    if (song.videoId) {
      const cached = await safeGetTrackStats(song.videoId);
      if (cached != null && (cached.commentsCount ?? -1) > 0) {
        commentsCount = cached.commentsCount!;
      }
    }

    const extras = buildExtras(song, info, videoUrl, muxedVideoUrl, commentsCount);
    storeTrackExtras(song.id, extras);

    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});
    if (song.videoId) {
      safeSaveTrackStats({
        videoId: song.videoId,
        likeCount: extras.likeCount ?? -1,
        dislikeCount: extras.dislikeCount ?? -1,
        viewCount: extras.viewCount ?? -1,
        commentsCount,
        uploaderUrl: extras.uploaderUrl ?? null,
      });
    }

    return {
      id: song.id,
      url: audioUrl,
      title: info.title ?? song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      duration: duration > 0 ? duration : undefined,
      videoId: song.videoId,
      isDownloaded: false,
      isLocal: false,
    };
  } catch (primaryErr) {
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, primaryErr);
  }

  const searchStrategies = [
    { query: `${song.title} ${song.artist} official audio`, filter: 'videos' as const },
    { query: `${song.title} ${song.artist}`, filter: '' as const },
    { query: `${song.title} official audio`, filter: 'videos' as const },
  ];

  for (const strategy of searchStrategies) {
    try {
      const searchResult = await MavinEngine.search(strategy.query, strategy.filter, undefined, 0);
      const firstStream = searchResult?.results?.find(
        (i): i is StreamInfoItem => i.type === 'stream' && !i.isLive && !i.isShortFormContent,
      );
      if (!firstStream?.url) continue;

      const info = await MavinEngine.getStreamInfo(firstStream.url, 0);
      if (!info.success) continue;

      const bestAudio = pickBestAudio(info.audioStreams ?? []);
      const bestVideo =
        pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
      const bestMuxed = pickBestVideo(info.videoStreams ?? []);
      if (!bestAudio?.url) continue;

      const audioUrl = bestAudio.url;
      const videoUrl = bestVideo?.url ?? null;
      const muxedVideoUrl = bestMuxed?.url ?? null;
      const duration = info.duration ?? 0;
      const extras = buildExtras(song, info, videoUrl, muxedVideoUrl, -1);

      storeTrackExtras(song.id, extras);
      cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});

      return {
        id: song.id,
        url: audioUrl,
        title: info.title ?? song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        duration: duration > 0 ? duration : undefined,
        videoId: song.videoId,
        isDownloaded: false,
        isLocal: false,
      };
    } catch (searchErr) {
      console.warn('[MusicPlayer] search strategy failed:', searchErr);
    }
  }

  console.warn(`[MusicPlayer] all strategies exhausted for "${song.title}"`);
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
          id: videoId ?? s.url,
          title: s.name,
          artist: s.uploaderName,
          thumbnail:
            s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url ??
            s.thumbnails[0]?.url ??
            '',
          url: s.url,
          videoId: videoId ?? undefined,
        };
      });
  } catch {
    return [];
  }
};

async function saveLastPlayingState(track: Song | null, position?: number): Promise<void> {
  try {
    if (track && track.id && track.title && track.url) {
      const trackToSave = {
        id: track.id,
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        url: track.url,
        thumbnail: track.thumbnail,
        duration: track.duration,
        videoId: track.videoId,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_TRACK, JSON.stringify(trackToSave));
      if (position !== undefined) {
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_POSITION, String(position));
      }
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.LAST_PLAYING_TRACK);
      await AsyncStorage.removeItem(STORAGE_KEYS.LAST_PLAYING_POSITION);
    }
  } catch (error) {
    console.warn('[MusicPlayer] Failed to save last playing state:', error);
  }
}

async function restoreLastPlayingState(): Promise<{ track: Song | null; position: number }> {
  try {
    const trackJson = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_TRACK);
    const positionStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_POSITION);

    if (!trackJson) return { track: null, position: 0 };

    const parsed = JSON.parse(trackJson);
    if (!parsed.id || !parsed.title || !parsed.url) return { track: null, position: 0 };

    const safeTrack: Song = {
      id: parsed.id,
      title: parsed.title,
      artist: parsed.artist || 'Unknown Artist',
      url: parsed.url,
      thumbnail: parsed.thumbnail,
      duration: parsed.duration,
      videoId: parsed.videoId,
    };

    return {
      track: safeTrack,
      position: positionStr ? parseFloat(positionStr) : 0,
    };
  } catch (error) {
    console.warn('[MusicPlayer] Failed to restore state:', error);
    return { track: null, position: 0 };
  }
}

async function saveRepeatMode(mode: RepeatMode): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.REPEAT_MODE, mode);
  } catch {}
}

async function saveShuffleMode(mode: ShuffleMode): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SHUFFLE_MODE, mode);
  } catch {}
}

export interface PlayerEngineState {
  currentTrack: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  queue: Song[];
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;

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
  position: number;
  duration: number;
  queue: Song[];
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;

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
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};

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
  } satisfies SystemMediaControlsProps);

  return null;
}

export interface MusicPlayerProviderProps {
  children: ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL PLAYER INSTANCE (ISSUE 1 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// This ref lives outside React. It persists across Fast Refresh, provider
// remounts, and navigation changes. The hook only runs once because this
// module is only evaluated once per app session.
// ─────────────────────────────────────────────────────────────────────────────

const playerInstanceRef: { current: ReturnType<typeof useAudioPlayer> | null } = { current: null };

export const MusicPlayerProvider: React.FC<MusicPlayerProviderProps> = ({ children }) => {
  // Create player instance once and store in module-level ref.
  // On Fast Refresh or remount, this returns the same instance.
  const [player] = useState(() => {
    if (!playerInstanceRef.current) {
      playerInstanceRef.current = useAudioPlayer(null);
      console.log('[MusicPlayerProvider] Created persistent audio player instance');
    }
    return playerInstanceRef.current;
  });

  const status = useAudioPlayerStatus(player);
  const netInfo = useNetInfo();
  const { showAlert } = useAlert();

  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>('off');
  const [shuffleMode, setShuffleModeState] = useState<ShuffleMode>('off');
  const [currentTrack, setCurrentTrack] = useState<Song | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const originalQueueRef = useRef<Song[]>([]);
  const originalIndexRef = useRef<number>(-1);
  const currentSongIdRef = useRef<string | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const expandPlayerRef = useRef<(() => void) | null>(null);
  const collapsePlayerRef = useRef<(() => void) | null>(null);
  const isInitializedRef = useRef(false);
  const playGenerationRef = useRef(0);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const log = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const prefix = '[MusicPlayer]';
    if (level === 'error') console.error(prefix, msg);
    else if (level === 'warn') console.warn(prefix, msg);
    else console.log(prefix, msg);
  }, []);

  const checkIsLocalTrack = useCallback((track?: Song | null): boolean => {
    if (!track) return false;
    const url = track.url || '';
    return (
      url.startsWith('file://') === true ||
      url.startsWith('/') === true ||
      url.startsWith('content://') === true ||
      (track as any).isLocal === true ||
      (track as any).isDownloaded === true
    );
  }, []);

  const nativeIsPlaying = status?.playing ?? false;
  const isPlaying = optimisticPlaying !== null ? optimisticPlaying : nativeIsPlaying;
  const isBuffering = status?.isBuffering ?? false;
  const position = status?.currentTime ?? 0;
  const duration = status?.duration ?? 0;

  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === nativeIsPlaying) setOptimisticPlaying(null);
  }, [nativeIsPlaying, optimisticPlaying]);

  useEffect(() => {
    if (currentTrack && currentTrack.url) saveLastPlayingState(currentTrack, position);
  }, [currentTrack, position]);

  useEffect(() => {
    const loadModes = async () => {
      try {
        const savedRepeat = await AsyncStorage.getItem(STORAGE_KEYS.REPEAT_MODE);
        const savedShuffle = await AsyncStorage.getItem(STORAGE_KEYS.SHUFFLE_MODE);
        if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
          setRepeatModeState(savedRepeat);
        }
        if (savedShuffle === 'off' || savedShuffle === 'on') {
          setShuffleModeState(savedShuffle);
        }
      } catch {}
    };
    loadModes();
  }, []);

  useEffect(() => {
    if (status && !isPlayerReady) {
      setIsPlayerReady(true);
      log('Audio player ready');
    }
  }, [status, isPlayerReady, log]);

  const loadAndPlayTrack = useCallback(
    async (song: Song, generation?: number) => {
      if (generation !== undefined && generation !== playGenerationRef.current) {
        log('loadAndPlayTrack skipped (stale generation)');
        return;
      }

      if (!isPlayerReady) {
        log('Player not ready yet, queueing track', 'warn');
        setTimeout(() => loadAndPlayTrack(song, generation), 100);
        return;
      }

      if (!song || !song.id) {
        log('Invalid track provided to loadAndPlayTrack', 'error');
        showAlert('Playback Error', 'Invalid track information.');
        return;
      }

      if (!song.url) {
        log(`Track "${song.title}" has no URL - cannot play`, 'error');
        showAlert('Cannot Play', `"${song.title || 'Unknown Track'}" has no valid audio source.`);
        return;
      }

      log(`Loading: "${song.title || 'Unknown'}"`);
      setCurrentTrack(song);
      currentSongIdRef.current = song.id;
      saveLastPlayingState(song, 0);

      try {
        const resolved = await resolveTrack(song);
        if (!resolved || !resolved.url) {
          log(`Failed to resolve track: "${song.title}"`, 'error');
          if (!checkIsLocalTrack(song)) {
            showAlert('Playback Error', `Could not load "${song.title}". Please check your connection.`);
          } else {
            showAlert('Playback Error', `Could not play "${song.title}". The file may be corrupted or missing.`);
          }
          return;
        }

        let finalUrl = resolved.url;

        if (checkIsLocalTrack(song)) {
          if (finalUrl.startsWith('content://')) {
            const cachedPath = await cacheLocalFileForPlayback(finalUrl, song.id);
            if (cachedPath) finalUrl = cachedPath;
          } else if (finalUrl.startsWith('/')) {
            finalUrl = `file://${finalUrl}`;
          }
          log(`Local file URI prepared: ${finalUrl.substring(0, 100)}...`);
        }

        await player.replace({ uri: finalUrl });
        await player.play();
        setOptimisticPlaying(true);
        log(`Now playing: "${resolved.title}" by ${resolved.artist || 'Unknown Artist'}`);
      } catch (error: any) {
        log(`Error loading track: ${error?.message || error}`, 'error');
        showAlert('Playback Error', `Failed to play "${song.title}". The file may be corrupted or inaccessible.`);
      }
    },
    [player, log, isPlayerReady, checkIsLocalTrack, showAlert],
  );

  useEffect(() => {
    if (status?.didJustFinish && currentTrack) {
      log('Track finished, handling repeat/shuffle');

      if (repeatMode === 'one') {
        try {
          player.seekTo(0);
          player.play();
          setOptimisticPlaying(true);
        } catch (error) {
          log(`Failed to repeat track: ${error}`, 'warn');
        }
      } else if (repeatMode === 'all' || queue.length > 1) {
        const nextIndex = queueIndex + 1;
        if (nextIndex < queue.length) {
          const nextSong = queue[nextIndex];
          setQueueIndex(nextIndex);
          loadAndPlayTrack(nextSong);
        } else if (repeatMode === 'all' && queue.length > 0) {
          setQueueIndex(0);
          loadAndPlayTrack(queue[0]);
        } else {
          log('Queue exhausted, playback stopped');
        }
      }
    }
  }, [status?.didJustFinish, repeatMode, queue, queueIndex, currentTrack, player, log, loadAndPlayTrack]);

  const setRepeatMode = useCallback(
    (mode: RepeatMode) => {
      setRepeatModeState(mode);
      saveRepeatMode(mode);
      log(`Repeat mode: ${mode}`);
    },
    [log],
  );

  const setShuffleMode = useCallback(
    (mode: ShuffleMode) => {
      if (mode === 'on' && shuffleMode === 'off') {
        if (queue.length > 0 && queueIndex >= 0) {
          originalQueueRef.current = [...queue];
          originalIndexRef.current = queueIndex;

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
          setQueue(newQueue);
          setQueueIndex(shuffledBefore.length);
        }
      } else if (mode === 'off' && shuffleMode === 'on') {
        if (originalQueueRef.current.length > 0 && currentTrack) {
          const originalCurrentIndex = originalQueueRef.current.findIndex(s => s.id === currentTrack.id);
          setQueue(originalQueueRef.current);
          setQueueIndex(originalCurrentIndex >= 0 ? originalCurrentIndex : 0);
          originalQueueRef.current = [];
          originalIndexRef.current = -1;
        }
      }

      setShuffleModeState(mode);
      saveShuffleMode(mode);
      log(`Shuffle mode: ${mode}`);
    },
    [shuffleMode, queue, queueIndex, currentTrack, log],
  );

  const addToQueue = useCallback(
    (songs: Song[]) => {
      if (!songs?.length) return;
      setQueue(prev => [...prev, ...songs]);
      log(`Added ${songs.length} songs to queue`);
    },
    [log],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueue(prev => {
        if (index < 0 || index >= prev.length) return prev;
        const newQueue = [...prev];
        newQueue.splice(index, 1);

        if (index < queueIndex) {
          setQueueIndex(prevIndex => prevIndex - 1);
        } else if (index === queueIndex && newQueue.length > 0) {
          const newIndex = Math.min(index, newQueue.length - 1);
          setQueueIndex(newIndex);
          loadAndPlayTrack(newQueue[newIndex]);
        }

        return newQueue;
      });
      log(`Removed from queue at index ${index}`);
    },
    [queueIndex, loadAndPlayTrack, log],
  );

  const moveQueueItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      setQueue(prev => {
        if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
        const newQueue = [...prev];
        const [moved] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, moved);

        let newQueueIndex = queueIndex;
        if (fromIndex === queueIndex) newQueueIndex = toIndex;
        else if (fromIndex < queueIndex && toIndex >= queueIndex) newQueueIndex--;
        else if (fromIndex > queueIndex && toIndex <= queueIndex) newQueueIndex++;

        setQueueIndex(newQueueIndex);
        return newQueue;
      });
      log(`Moved queue item from ${fromIndex} to ${toIndex}`);
    },
    [queueIndex, log],
  );

  const clearQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(-1);
    originalQueueRef.current = [];
    originalIndexRef.current = -1;
    log('Queue cleared');
  }, [log]);

  const skipToIndex = useCallback(
    async (index: number) => {
      if (index < 0 || index >= queue.length) {
        log(`skipToIndex: invalid index ${index} (queue length: ${queue.length})`, 'warn');
        return;
      }
      log(`Skipping to index ${index}: "${queue[index].title}"`);
      setQueueIndex(index);
      await loadAndPlayTrack(queue[index]);
    },
    [queue, loadAndPlayTrack, log],
  );

  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current = expand;
    collapsePlayerRef.current = collapse;
  }, []);

  const expandPlayer = useCallback(() => expandPlayerRef.current?.(), []);
  const collapsePlayer = useCallback(() => collapsePlayerRef.current?.(), []);

  const playAudio = useCallback(
    async (songToPlay: Song, playlist?: Song[], expandPlayerFn?: () => void) => {
      if (!songToPlay.url) {
        showAlert('Not Available', `"${songToPlay.title}" is not available.`);
        return;
      }

      const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
      if (goToPlayer) {
        goToPlayer();
      } else {
        log('ERROR: expandPlayer not registered', 'error');
        return;
      }

      setIsLoading(true);
      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;
      const generation = ++playGenerationRef.current;

      try {
        log(`Play: "${songToPlay.title}"`);

        let newQueue: Song[] = [];
        let startIndex = 0;

        if (playlist && playlist.length > 0) {
          const playlistIndex = playlist.findIndex(s => s.id === songToPlay.id);
          newQueue = [...playlist];
          startIndex = playlistIndex >= 0 ? playlistIndex : 0;
        } else {
          newQueue = [songToPlay];
          startIndex = 0;

          if (!checkIsLocalTrack(songToPlay) && songToPlay.url) {
            fetchRelatedSongs(songToPlay.url)
              .then(related => {
                if (!abortSignal.aborted && currentSongIdRef.current === songToPlay.id && related.length > 0) {
                  setQueue(prev => {
                    const existingIds = new Set(prev.map(s => s.id));
                    const newSongs = related.filter(s => !existingIds.has(s.id));
                    return [...prev, ...newSongs];
                  });
                }
              })
              .catch(() => {});
          }
        }

        setQueue(newQueue);
        setQueueIndex(startIndex);

        if (shuffleMode === 'on' && newQueue.length > 1) {
          const current = newQueue[startIndex];
          const before = newQueue.slice(0, startIndex);
          const after = newQueue.slice(startIndex + 1);

          const shuffledBefore = [...before];
          for (let i = shuffledBefore.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledBefore[i], shuffledBefore[j]] = [shuffledBefore[j], shuffledBefore[i]];
          }

          const shuffledAfter = [...after];
          for (let i = shuffledAfter.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledAfter[i], shuffledAfter[j]] = [shuffledAfter[j], shuffledAfter[i]];
          }

          const finalQueue = [...shuffledBefore, current, ...shuffledAfter];
          setQueue(finalQueue);
          setQueueIndex(shuffledBefore.length);
        }

        await loadAndPlayTrack(songToPlay, generation);
      } catch (error: any) {
        log(`playAudio error: ${error?.message || error}`, 'error');
        showAlert('Playback Error', `Failed to play "${songToPlay.title}".`);
      } finally {
        setIsLoading(false);
      }
    },
    [loadAndPlayTrack, log, shuffleMode, checkIsLocalTrack, showAlert],
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
      setQueue(prev => [...prev.slice(0, insertIndex), ...songsToAdd, ...prev.slice(insertIndex)]);
      log(`Added ${songsToAdd.length} songs to play next`);
    },
    [queueIndex, log],
  );

  const playDownloadedSong = useCallback(
    async (
      songToPlay: DownloadedSongMetadata,
      playlist?: DownloadedSongMetadata[],
      expandPlayerFn?: () => void,
    ) => {
      if (!songToPlay.localTrackUri) {
        showAlert('Cannot Play', `"${songToPlay.title}" file cannot be found on your device.`);
        return;
      }

      const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
      if (goToPlayer) {
        goToPlayer();
      } else {
        log('ERROR: expandPlayer not registered for downloaded song', 'error');
        return;
      }

      setIsLoading(true);

      let localUri = songToPlay.localTrackUri;
      if (localUri && Platform.OS === 'android') {
        if (localUri.startsWith('content://')) {
          log(`Content URI detected: ${localUri.substring(0, 100)}...`);
        } else if (!localUri.startsWith('file://') && !localUri.startsWith('content://')) {
          localUri = localUri.startsWith('/') ? `file://${localUri}` : localUri;
          log(`Normalized local URI: ${localUri.substring(0, 100)}...`);
        }
      }

      const enrichedSong = enrichLocalTrackMetadata(
        {
          id: songToPlay.id,
          title: songToPlay.title,
          artist: songToPlay.artist,
          thumbnail: songToPlay.localArtworkUri ?? songToPlay.thumbnail ?? '',
          url: localUri,
          duration: songToPlay.duration,
          videoId: undefined,
        } as Song,
        localUri,
        undefined,
      );

      (enrichedSong as any).isLocal = true;
      (enrichedSong as any).isDownloaded = true;

      const newQueue: Song[] = [enrichedSong];
      if (playlist?.length) {
        for (let i = 1; i < playlist.length; i++) {
          const ds = playlist[i];
          if (!ds.localTrackUri) {
            log(`Skipping "${ds.title}" - no local file URI`, 'warn');
            continue;
          }

          let dsUri = ds.localTrackUri;
          if (dsUri && Platform.OS === 'android') {
            if (dsUri.startsWith('content://')) {
              // keep as-is
            } else if (!dsUri.startsWith('file://') && !dsUri.startsWith('content://')) {
              dsUri = dsUri.startsWith('/') ? `file://${dsUri}` : dsUri;
            }
          }

          const enrichedDs = enrichLocalTrackMetadata(
            {
              id: ds.id,
              title: ds.title,
              artist: ds.artist,
              thumbnail: ds.localArtworkUri ?? ds.thumbnail ?? '',
              url: dsUri,
              duration: ds.duration,
              videoId: undefined,
            } as Song,
            dsUri,
            undefined,
          );

          (enrichedDs as any).isLocal = true;
          (enrichedDs as any).isDownloaded = true;
          newQueue.push(enrichedDs);
        }
      }

      setQueue(newQueue);
      setQueueIndex(0);

      storeTrackExtras(enrichedSong.id, {
        isLocal: true,
        likeCount: -1,
        dislikeCount: -1,
        viewCount: -1,
        commentsCount: -1,
      });

      const generation = ++playGenerationRef.current;
      await loadAndPlayTrack(enrichedSong, generation);

      setIsLoading(false);
    },
    [loadAndPlayTrack, log, showAlert],
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
    if (!currentTrack) {
      showAlert('Nothing to Play', 'Please select a song first.');
      return;
    }

    const willBePlaying = !isPlaying;
    setOptimisticPlaying(willBePlaying);

    if (isPlaying) {
      try {
        player.pause();
      } catch (e) {
        log(`Pause error: ${e}`, 'warn');
      }
      log('Paused');
    } else {
      try {
        player.play();
      } catch (e) {
        log(`Play error: ${e}`, 'warn');
      }
      log('Playing');
    }
  }, [isPlaying, currentTrack, player, log, showAlert]);

  const seekTo = useCallback(
    (positionSec: number) => {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = setTimeout(() => {
        try {
          player.seekTo(positionSec);
        } catch (e: any) {
          log(`seekTo error: ${e?.message || e}`, 'warn');
        }
      }, CONFIG.SEEK_DEBOUNCE_MS);
    },
    [player, log],
  );

  const skipToNext = useCallback(async () => {
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      const nextSong = queue[nextIndex];
      setQueueIndex(nextIndex);
      await loadAndPlayTrack(nextSong);
    } else if (repeatMode === 'all' && queue.length > 0) {
      const firstSong = queue[0];
      setQueueIndex(0);
      await loadAndPlayTrack(firstSong);
    } else {
      log('No next track in queue');
    }
  }, [queue, queueIndex, repeatMode, loadAndPlayTrack, log]);

  const skipToPrevious = useCallback(async () => {
    if (position > 3) {
      try {
        player.seekTo(0);
      } catch {}
      return;
    }

    const prevIndex = queueIndex - 1;
    if (prevIndex >= 0) {
      const prevSong = queue[prevIndex];
      setQueueIndex(prevIndex);
      await loadAndPlayTrack(prevSong);
    } else {
      try {
        player.seekTo(0);
      } catch {}
    }
  }, [player, position, queue, queueIndex, loadAndPlayTrack]);

  useEffect(() => {
    const initializeAndRestore = async () => {
      if (isInitializedRef.current) return;
      if (!isPlayerReady) {
        setTimeout(initializeAndRestore, 200);
        return;
      }

      const { track, position: savedPos } = await restoreLastPlayingState();
      if (!track || !track.url) {
        isInitializedRef.current = true;
        return;
      }

      log(`Restoring last playing track: ${track.title}`);
      setCurrentTrack(track);
      currentSongIdRef.current = track.id;
      setQueue([track]);
      setQueueIndex(0);

      try {
        const resolved = await resolveTrack(track);
        if (resolved && resolved.url) {
          await player.replace({ uri: resolved.url });
          if (savedPos > 5 && savedPos < (resolved.duration || Infinity)) {
            await player.seekTo(savedPos);
          }
          await player.pause();
        }
      } catch (error) {
        log(`Failed to restore track: ${error}`, 'warn');
      }

      isInitializedRef.current = true;
    };

    if (isPlayerReady) {
      initializeAndRestore();
    }
  }, [player, log, isPlayerReady]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && isInitializedRef.current) {
        if (nativeIsPlaying && currentTrack && expandPlayerRef.current) {
          log('App resumed with active track — auto-expanding player');
          setTimeout(() => expandPlayer(), CONFIG.AUTO_EXPAND_DELAY_MS);
        }
      }
    });

    return () => sub.remove();
  }, [nativeIsPlaying, currentTrack, expandPlayer, log]);

  // ─────────────────────────────────────────────────────────────────────────────
  // CLEANUP: Only save state, NEVER destroy the player instance.
  // The player lives for the entire app lifetime.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      bgAbortControllerRef.current?.abort();
      if (currentTrack && currentTrack.url) saveLastPlayingState(currentTrack, position);
      log('MusicPlayerProvider unmounted — player instance preserved');
    };
  }, [currentTrack, position, log]);

  const engineValue: PlayerEngineState = {
    currentTrack,
    isPlaying,
    isBuffering,
    position,
    duration,
    queue,
    queueIndex,
    repeatMode,
    shuffleMode,
    play: () => {
      setOptimisticPlaying(true);
      try {
        player.play();
      } catch (e) {}
    },
    pause: () => {
      setOptimisticPlaying(false);
      try {
        player.pause();
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
    position,
    duration,
    queue,
    repeatMode,
    shuffleMode,
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
            setOptimisticPlaying(true);
            try {
              player.play();
            } catch (e) {}
          }}
          onPause={() => {
            setOptimisticPlaying(false);
            try {
              player.pause();
            } catch (e) {}
          }}
          onSkipNext={skipToNext}
          onSkipPrevious={skipToPrevious}
          onSeek={seekTo}
          onSetRepeatMode={setRepeatMode}
          onExpandPlayer={expandPlayer}
        />
        {children}
      </MusicPlayerContext.Provider>
    </PlayerEngineContext.Provider>
  );
};

export default MusicPlayerProvider;