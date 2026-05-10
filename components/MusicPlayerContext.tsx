// components/MusicPlayerContext.tsx
//
// Converted from react-native-track-player to expo-av
// All RNTP code removed, now using expo-av for audio playback
// Uses expo-notifications for lock screen controls
// Includes proper queue management for playlists
//
// FIXES APPLIED:
// 1. Restore useEffect no longer depends on loadTrackFromQueue (infinite loop fix)
// 2. pickBestAudio prefers M4A/AAC, falls back gracefully to Opus/WebM/manifest
// 3. createAsync uses androidImplementation:'MediaPlayer' for Opus/WebM on Android
// 4. setupPlaybackListener uses currentTrackRef (no stale closure)
// 5. updateNowPlayingNotification receives local track var, not stale state
// 6. Queue save debounced to every 5s (not every 250ms position tick)
// 7. Removed duplicate Audio.setAudioModeAsync (now only in _layout.tsx)
// 8. Removed setNotificationCategoryAsync from updateNowPlayingNotification (registered once in _layout)
// 9. updateNowPlayingNotification only called on play/pause state change, not every tick
// 10. Fixed restore path race condition (queue state not committed before loading)
// 11. Wired up remote notification action callbacks via service.ts
// 12. Removed unused isRecoveringRef

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

import MavinEngine, {
  StreamInfoItem,
  AudioStream,
  VideoStream,
} from '@/modules/mavin-engine';

import { useNetInfo } from '@react-native-community/netinfo';
import { DownloadedSongMetadata } from '@/store/library';
import { supabase } from '@/libs/supabase';
import { supabaseCache } from '@/libs/cache/supabase-cache';
import type { Song } from '@/types/song';
import { useHomeStore } from '@/store/home';
import {
  startPlaybackService,
  registerRemoteActionCallbacks,
  deregisterRemoteActionCallbacks,
} from '@/libs/service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type { Song };

export interface TrackExtras {
  videoUrl?: string;
  muxedVideoUrl?: string;
  videoId?: string;
  uploaderUrl?: string;
  likeCount?: number;
  dislikeCount?: number;
  viewCount?: number;
  commentsCount?: number;
}

export interface ResolvedTrack {
  id: string;
  url: string;
  title: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  mimeType?: string;
  codec?: string;
  bitrate?: number;
  isManifest?: boolean;
  [key: string]: any;
}

// Queue item for expo-av
interface QueueItem {
  song: Song | DownloadedSongMetadata;
  resolvedTrack?: ResolvedTrack;
  isDownloaded: boolean;
}

const MAX_EXTRAS_CACHE = 50;
const trackExtrasStore = new Map<string, TrackExtras>();

function storeTrackExtras(trackId: string, extras: TrackExtras): void {
  trackExtrasStore.set(trackId, extras);
  if (trackExtrasStore.size > MAX_EXTRAS_CACHE) {
    const firstKey = trackExtrasStore.keys().next().value;
    if (firstKey) trackExtrasStore.delete(firstKey);
  }
}

export function getTrackExtras(trackId: string | undefined | null): TrackExtras | null {
  if (!trackId) return null;
  return trackExtrasStore.get(trackId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Type
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerContextType {
  currentTrack: Song | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  position: number;
  duration: number;
  queue: QueueItem[];
  currentQueueIndex: number;

  playAudio: (song: Song, playlist?: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playPlaylist: (songs: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playNext: (songs: Song[] | null) => Promise<void>;
  playDownloadedSong: (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  setQueue: (queue: QueueItem[]) => void;
  setCurrentQueueIndex: (index: number) => void;

  expandPlayer: () => void;
  collapsePlayer: () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Stream Cache Constants
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_TTL_MS = 6 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Stream Selection Helpers
// FIX #2: pickBestAudio now prefers M4A/AAC, falls back to Opus/WebM, then manifest
// ─────────────────────────────────────────────────────────────────────────────

function isM4AOrAAC(s: AudioStream): boolean {
  const mime = (s.mimeType ?? '').toLowerCase();
  const codec = (s.codec ?? '').toLowerCase();
  return (
    mime.includes('mp4') ||
    mime.includes('m4a') ||
    mime.includes('aac') ||
    codec.includes('mp4a') ||
    codec.includes('aac')
  );
}

function isOpusOrWebM(s: AudioStream): boolean {
  const mime = (s.mimeType ?? '').toLowerCase();
  const codec = (s.codec ?? '').toLowerCase();
  return mime.includes('webm') || codec.includes('opus') || codec.includes('vorbis');
}

function pickBestAudio(streams: AudioStream[]): AudioStream | null {
  if (!streams?.length) return null;

  // 1. Direct M4A/AAC URLs — most compatible with Android AudioTrack
  const m4aDirect = streams.filter(s => s.isUrl && !s.manifestUrl && isM4AOrAAC(s));
  if (m4aDirect.length) {
    return m4aDirect.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), m4aDirect[0]);
  }

  // 2. Direct Opus/WebM — works on most devices via MediaPlayer (see createSound helper)
  const opusDirect = streams.filter(s => s.isUrl && !s.manifestUrl && isOpusOrWebM(s));
  if (opusDirect.length) {
    return opusDirect.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), opusDirect[0]);
  }

  // 3. Any other direct URL
  const anyDirect = streams.filter(s => s.isUrl && !s.manifestUrl);
  if (anyDirect.length) {
    return anyDirect.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), anyDirect[0]);
  }

  // 4. Manifest/HLS — ExoPlayer handles these correctly without AudioTrack issues
  return streams[0];
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
// FIX #3: createSound helper — uses MediaPlayer for Opus/WebM on Android
// This avoids the AudioTrack init failed / channel mask 12 error
// ─────────────────────────────────────────────────────────────────────────────

async function createSound(
  uri: string,
  shouldPlay: boolean,
  positionMillis: number = 0,
  resolvedTrack?: ResolvedTrack | null,
): Promise<Audio.Sound> {
  const isOpus =
    isOpusOrWebM({ mimeType: resolvedTrack?.mimeType, codec: resolvedTrack?.codec } as AudioStream) ||
    uri.includes('.webm') ||
    uri.includes('mime=audio%2Fwebm');

  // On Android, Opus/WebM needs MediaPlayer — ExoPlayer's AudioTrack
  // init fails with channel mask 12 on many devices for this format.
  const useMediaPlayer = Platform.OS === 'android' && isOpus;

  console.log(`[MusicPlayer] createSound — format: ${resolvedTrack?.mimeType ?? 'unknown'}, useMediaPlayer: ${useMediaPlayer}`);

  const { sound } = await Audio.Sound.createAsync(
    { uri },
    {
      shouldPlay,
      positionMillis,
      // @ts-ignore — androidImplementation is supported in expo-av ≥13
      ...(useMediaPlayer ? { androidImplementation: 'MediaPlayer' } : {}),
    },
  );

  return sound;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Stream Cache
// ─────────────────────────────────────────────────────────────────────────────

interface StreamCacheRow {
  stream_url: string;
  expiry: string;
  duration: number | null;
}

async function getCachedAudioStream(
  trackId: string,
): Promise<{ url: string; duration: number } | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams')
      .select('stream_url, expiry, duration')
      .eq('track_id', uuid)
      .eq('stream_type', 'audio')
      .eq('is_active', true)
      .gt('expiry', new Date().toISOString())
      .maybeSingle() as { data: StreamCacheRow | null; error: any };
    if (error || !data) return null;
    return { url: data.stream_url, duration: data.duration ?? 0 };
  } catch { return null; }
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
      .maybeSingle() as { data: Pick<StreamCacheRow, 'stream_url' | 'expiry'> | null; error: any };
    if (error || !data) return null;
    return data.stream_url;
  } catch { return null; }
}

async function cacheStreamsToSupabase(
  trackId: string,
  audioUrl: string,
  videoUrl: string | null,
  duration: number,
): Promise<void> {
  try {
    const uuid   = await videoIdToUuid(trackId);
    const expiry = new Date(Date.now() + STREAM_TTL_MS).toISOString();
    const now    = new Date().toISOString();

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
      ...(videoUrl ? [{
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
      }] : []),
    ];

    const { error } = await (supabase as any)
      .from('streams')
      .upsert(rows, { onConflict: 'track_id,stream_type' });

    if (error) {
      console.warn('[MusicPlayer] stream cache write error:', error?.message);
    }
  } catch (e) {
    console.warn('[MusicPlayer] cacheStreamsToSupabase error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Track Building
// ─────────────────────────────────────────────────────────────────────────────

function buildTrack(
  song: Song,
  audioUrl: string,
  videoUrl: string | null,
  muxedVideoUrl: string | null,
  duration: number,
  title?: string,
  extras?: Omit<TrackExtras, 'videoUrl' | 'muxedVideoUrl'>,
  audioStream?: AudioStream | null,
): ResolvedTrack {
  return {
    id: song.id,
    url: audioUrl,
    title: title || song.title,
    artist: song.artist,
    artwork: song.thumbnail,
    duration: duration > 0 ? duration : undefined,
    videoUrl: videoUrl ?? undefined,
    muxedVideoUrl: muxedVideoUrl ?? undefined,
    videoId: extras?.videoId ?? song.videoId,
    uploaderUrl: extras?.uploaderUrl ?? undefined,
    likeCount: extras?.likeCount ?? -1,
    dislikeCount: extras?.dislikeCount ?? -1,
    viewCount: extras?.viewCount ?? -1,
    commentsCount: extras?.commentsCount ?? -1,
    // Carry format info for createSound to use
    mimeType: audioStream?.mimeType,
    codec: audioStream?.codec,
    bitrate: audioStream?.bitrate,
    isManifest: !!(audioStream?.manifestUrl),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Track Resolution
// ─────────────────────────────────────────────────────────────────────────────

const resolveTrack = async (song: Song): Promise<ResolvedTrack | null> => {
  if (!song.url) {
    console.warn(`[MusicPlayer] "${song.title}" has no URL — skipping`);
    return null;
  }

  try {
    const [cachedAudio, cachedVideo] = await Promise.all([
      getCachedAudioStream(song.id),
      getCachedVideoStream(song.id),
    ]);
    if (cachedAudio) {
      let extras: Omit<TrackExtras, 'videoUrl' | 'muxedVideoUrl'> = { videoId: song.videoId };
      if (song.videoId) {
        const cached = await safeGetTrackStats(song.videoId);
        if (cached) {
          extras = {
            videoId: song.videoId,
            uploaderUrl: cached.uploaderUrl ?? undefined,
            likeCount: cached.likeCount > 0 ? cached.likeCount : -1,
            dislikeCount: cached.dislikeCount > 0 ? cached.dislikeCount : -1,
            viewCount: cached.viewCount > 0 ? cached.viewCount : -1,
            commentsCount: cached.commentsCount > 0 ? cached.commentsCount : -1,
          };
        }
      }
      // Cached URLs don't carry stream metadata — pass null so createSound
      // inspects the URL itself for format detection
      return buildTrack(song, cachedAudio.url, cachedVideo, null, cachedAudio.duration, undefined, extras, null);
    }
  } catch (cacheErr) {
    console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
  }

  try {
    const info = await MavinEngine.getStreamInfo(song.url, 0);
    if (!info.success) throw new Error('extraction returned success=false');

    const bestAudio = pickBestAudio(info.audioStreams ?? []);
    const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
    const bestMuxed = pickBestVideo(info.videoStreams ?? []);

    if (!bestAudio?.url) throw new Error('no audio stream available');

    const audioUrl = bestAudio.url;
    const videoUrl = bestVideo?.url ?? null;
    const muxedVideoUrl = bestMuxed?.url ?? null;
    const duration = info.duration ?? 0;

    const extractedStats = {
      likeCount: typeof info.likeCount === 'number' && info.likeCount > 0 ? Math.round(info.likeCount) : -1,
      dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
      viewCount: typeof info.viewCount === 'number' && info.viewCount > 0 ? Math.round(info.viewCount) : -1,
      uploaderUrl: (info.uploaderUrl as string | undefined) ?? null,
    };

    let commentsCount = -1;
    if (song.videoId) {
      const cached = await safeGetTrackStats(song.videoId);
      if (cached && cached.commentsCount > 0) commentsCount = cached.commentsCount;
    }

    const extras: Omit<TrackExtras, 'videoUrl' | 'muxedVideoUrl'> = {
      videoId: song.videoId,
      uploaderUrl: extractedStats.uploaderUrl ?? undefined,
      likeCount: extractedStats.likeCount,
      dislikeCount: extractedStats.dislikeCount,
      viewCount: extractedStats.viewCount,
      commentsCount,
    };

    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});

    if (song.videoId) {
      safeSaveTrackStats({
        videoId: song.videoId,
        likeCount: extractedStats.likeCount,
        dislikeCount: extractedStats.dislikeCount,
        viewCount: extractedStats.viewCount,
        commentsCount,
        uploaderUrl: extractedStats.uploaderUrl,
      });

      if (commentsCount === -1) {
        const watchUrl = `https://www.youtube.com/watch?v=${song.videoId}`;
        MavinEngine.getComments(watchUrl, undefined, 0)
          .then((commentsInfo: any) => {
            if (commentsInfo?.success && typeof commentsInfo.commentsCount === 'number' && commentsInfo.commentsCount > 0) {
              extras.commentsCount = commentsInfo.commentsCount;
              const stored = trackExtrasStore.get(song.id);
              if (stored) {
                trackExtrasStore.set(song.id, { ...stored, commentsCount: commentsInfo.commentsCount });
              }
              supabaseCache.patchCommentsCount(song.videoId!, commentsInfo.commentsCount).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, extras, bestAudio);
  } catch (primaryErr) {
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, primaryErr);
  }

  if (song.videoId) {
    try {
      const info = await MavinEngine.getStreamInfoById(song.videoId, 0);
      if (info.success) {
        const bestAudio = pickBestAudio(info.audioStreams ?? []);
        const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
        if (bestAudio?.url) {
          const audioUrl = bestAudio.url;
          const videoUrl = bestVideo?.url ?? null;
          const muxedVideoUrl = pickBestVideo(info.videoStreams ?? [])?.url ?? null;
          const duration = info.duration ?? 0;

          cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});

          const fbExtras: Omit<TrackExtras, 'videoUrl' | 'muxedVideoUrl'> = {
            videoId: song.videoId,
            uploaderUrl: (info.uploaderUrl as string | undefined) ?? undefined,
            likeCount: typeof info.likeCount === 'number' && info.likeCount > 0 ? Math.round(info.likeCount) : -1,
            dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
            viewCount: typeof info.viewCount === 'number' && info.viewCount > 0 ? Math.round(info.viewCount) : -1,
            commentsCount: -1,
          };

          safeSaveTrackStats({
            videoId: song.videoId,
            likeCount: fbExtras.likeCount!,
            dislikeCount: fbExtras.dislikeCount!,
            viewCount: fbExtras.viewCount!,
            commentsCount: -1,
            uploaderUrl: fbExtras.uploaderUrl ?? null,
          });

          return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, fbExtras, bestAudio);
        }
      }
    } catch (byIdErr) {
      console.warn(`[MusicPlayer] getStreamInfoById failed for "${song.title}":`, byIdErr);
    }
  }

  const searchStrategies = [
    { query: `${song.title} ${song.artist} official audio`, filter: 'videos' },
    { query: `${song.title} ${song.artist}`, filter: '' },
    { query: `${song.title} official audio`, filter: 'videos' },
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
      const bestVideo = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
      const bestMuxed = pickBestVideo(info.videoStreams ?? []);

      if (!bestAudio?.url) continue;

      const audioUrl = bestAudio.url;
      const videoUrl = bestVideo?.url ?? null;
      const muxedVideoUrl = bestMuxed?.url ?? null;
      const duration = info.duration ?? 0;

      cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});

      return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, {
        videoId: song.videoId,
        uploaderUrl: info.uploaderUrl ?? undefined,
        likeCount: typeof info.likeCount === 'number' && info.likeCount > 0 ? Math.round(info.likeCount) : -1,
        dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
        viewCount: typeof info.viewCount === 'number' && info.viewCount > 0 ? Math.round(info.viewCount) : -1,
        commentsCount: -1,
      }, bestAudio);
    } catch (searchErr) {
      console.warn(`[MusicPlayer] search strategy failed:`, searchErr);
    }
  }

  console.warn(`[MusicPlayer] all strategies exhausted for "${song.title}"`);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NOT_FOUND_MSG = 'track_stats';

const safeGetTrackStats = async (videoId: string) => {
  try {
    return await supabaseCache.getTrackStats(videoId);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG))
      console.warn('[MusicPlayer] getTrackStats error:', e?.message);
    return null;
  }
};

const safeSaveTrackStats = async (
  params: Parameters<typeof supabaseCache.saveTrackStats>[0],
) => {
  try {
    await supabaseCache.saveTrackStats(params);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG))
      console.warn('[MusicPlayer] saveTrackStats error:', e?.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UUID Helpers
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
    for (let t = 0; t < 16; t++)
      W[t] = (msg[i+t*4]<<24)|(msg[i+t*4+1]<<16)|(msg[i+t*4+2]<<8)|msg[i+t*4+3];
    for (let t = 16; t < 80; t++) {
      const v = W[t-3]^W[t-8]^W[t-14]^W[t-16];
      W[t] = ((v<<1)|(v>>>31)) >>> 0;
    }
    let [a,b,c,d,e] = H;
    for (let t = 0; t < 80; t++) {
      const rot = (((a<<5)|(a>>>27))>>>0);
      const f   = t<20 ? ((b&c)|((~b>>>0)&d)) : t<40 ? (b^c^d) : t<60 ? ((b&c)|(b&d)|(c&d)) : (b^c^d);
      const k   = t<20 ? 0x5A827999 : t<40 ? 0x6ED9EBA1 : t<60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const tmp = (rot + f + e + k + W[t]) >>> 0;
      e=d; d=c; c=((b<<30)|(b>>>2))>>>0; b=a; a=tmp;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0;
    H[3]=(H[3]+d)>>>0; H[4]=(H[4]+e)>>>0;
  }
  const out = new Uint8Array(20);
  H.forEach((v, i) => {
    out[i*4]   = (v>>>24)&0xff; out[i*4+1] = (v>>>16)&0xff;
    out[i*4+2] = (v>>>8) &0xff; out[i*4+3] =  v      &0xff;
  });
  return out;
}

const _uuidCache = new Map<string, string>();

async function videoIdToUuid(videoId: string): Promise<string> {
  if (_uuidCache.has(videoId)) return _uuidCache.get(videoId)!;
  const nsBytes  = uuidToBytes(UUID_NAMESPACE);
  const idBytes  = Array.from(new TextEncoder().encode(videoId));
  const combined = new Uint8Array([...nsBytes, ...idBytes]);
  const hash     = await sha1(combined);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h    = Array.from(hash.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  _uuidCache.set(videoId, uuid);
  return uuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Related Songs Helper
// ─────────────────────────────────────────────────────────────────────────────

const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  if (!songUrl) return [];
  try {
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];

    return info.relatedItems
      .filter((i): i is StreamInfoItem => i.type === 'stream')
      .filter(s => !s.isLive && !s.isShortFormContent)
      .map(s => {
        const videoId = s.url.includes('v=') ? s.url.split('v=')[1]?.split('&')[0]
          : s.url.includes('youtu.be/') ? s.url.split('youtu.be/')[1]?.split('?')[0]
          : s.url;
        return {
          id: videoId ?? s.url,
          title: s.name,
          artist: s.uploaderName,
          thumbnail: s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url ?? s.thumbnails[0]?.url ?? '',
          url: s.url,
          videoId: videoId ?? undefined,
        };
      });
  } catch { return []; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Save Quick Actions Helper
// ─────────────────────────────────────────────────────────────────────────────

const saveQuickActions = async (songUrl: string, sourceSongId: string): Promise<void> => {
  if (!songUrl) return;

  try {
    console.log('[MusicPlayer] Fetching related songs for Quick Actions...');
    const relatedSongs = await fetchRelatedSongs(songUrl);

    if (relatedSongs.length === 0) return;

    console.log(`[MusicPlayer] Found ${relatedSongs.length} related songs`);

    const { data: existing } = await supabase
      .from('user_quick_actions')
      .select('track_id')
      .limit(100);

    const existingIds = new Set(existing?.map((e: any) => e.track_id) || []);

    let insertedCount = 0;
    for (const song of relatedSongs.slice(0, 20)) {
      if (!existingIds.has(song.id)) {
        const { error } = await supabase
          .from('user_quick_actions')
          .insert({
            track_id: song.id,
            title: song.title,
            artist: song.artist,
            thumbnail: song.thumbnail,
            video_id: song.videoId,
            url: song.url,
            duration: song.duration,
            source_song_id: sourceSongId,
            played_at: new Date().toISOString(),
          } as any);

        if (!error) insertedCount++;
      }
    }

    console.log(`[MusicPlayer] Saved ${insertedCount} new quick actions`);

    const { data: updated } = await supabase
      .from('user_quick_actions')
      .select('*')
      .order('played_at', { ascending: false })
      .limit(30);

    if (updated && updated.length > 0) {
      const quickSongs = updated.map((item: any) => ({
        id: item.track_id,
        videoId: item.video_id,
        title: item.title,
        artist: item.artist,
        thumbnail: item.thumbnail,
        url: item.url,
        duration: item.duration,
        playedAt: new Date(item.played_at).getTime(),
      }));

      const shuffled = [...quickSongs].sort(() => Math.random() - 0.5);
      useHomeStore.getState().setRecentSongs(shuffled);
      console.log(`[MusicPlayer] Updated Quick Actions in store: ${shuffled.length} items`);
    }
  } catch (error) {
    console.error('[MusicPlayer] Failed to save quick actions:', error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// State Restoration Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  LAST_PLAYING_TRACK: 'last_playing_track',
  LAST_PLAYING_POSITION: 'last_playing_position',
  PLAYER_QUEUE: 'player_queue',
  CURRENT_QUEUE_INDEX: 'current_queue_index',
};

async function saveLastPlayingState(track: Song | null, position?: number): Promise<void> {
  try {
    if (track) {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_TRACK, JSON.stringify(track));
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
    
    return {
      track: trackJson ? JSON.parse(trackJson) : null,
      position: positionStr ? parseFloat(positionStr) : 0,
    };
  } catch (error) {
    console.warn('[MusicPlayer] Failed to restore last playing state:', error);
    return { track: null, position: 0 };
  }
}

async function saveQueueState(queue: QueueItem[], currentIndex: number): Promise<void> {
  try {
    const queueToSave = queue.map(item => ({
      song: item.song,
      isDownloaded: item.isDownloaded,
    }));
    await AsyncStorage.setItem(STORAGE_KEYS.PLAYER_QUEUE, JSON.stringify(queueToSave));
    await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_QUEUE_INDEX, String(currentIndex));
  } catch (error) {
    console.warn('[MusicPlayer] Failed to save queue state:', error);
  }
}

async function restoreQueueState(): Promise<{ queue: QueueItem[]; currentIndex: number }> {
  try {
    const queueJson = await AsyncStorage.getItem(STORAGE_KEYS.PLAYER_QUEUE);
    const indexStr = await AsyncStorage.getItem(STORAGE_KEYS.CURRENT_QUEUE_INDEX);
    
    const queue = queueJson ? JSON.parse(queueJson) : [];
    const currentIndex = indexStr ? parseInt(indexStr, 10) : -1;
    
    return { queue, currentIndex };
  } catch (error) {
    console.warn('[MusicPlayer] Failed to restore queue state:', error);
    return { queue: [], currentIndex: -1 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Notification Helper
// FIX #8: Removed setNotificationCategoryAsync — registered once in _layout.tsx
// FIX #9: Now only schedules notification, doesn't re-register category
// ─────────────────────────────────────────────────────────────────────────────

async function updateNowPlayingNotification(track: Song | null, isPlaying: boolean = false) {
  if (!track) {
    await Notifications.dismissAllNotificationsAsync();
    return;
  }

  // NOTE: Category 'MEDIA_PLAYBACK' is registered once in _layout.tsx initPlayer()
  // We do NOT re-register it here — that would be redundant and wasteful.

  const notificationContent: any = {
    title: track.title,
    body: track.artist || 'Unknown Artist',
    data: { type: 'MEDIA_PLAYBACK', track, isPlaying },
    categoryIdentifier: 'MEDIA_PLAYBACK',
  };

  if (Platform.OS === 'android') {
    notificationContent.android = {
      priority: Notifications.AndroidNotificationPriority.HIGH,
    };
    notificationContent.color = '#1DB954';
  }

  if (track.thumbnail && Platform.OS === 'ios') {
    notificationContent.attachments = [
      {
        identifier: 'artwork',
        type: 'image',
        url: track.thumbnail,
      },
    ];
  }

  await Notifications.scheduleNotificationAsync({
    content: notificationContent,
    trigger: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerProviderProps {
  children: ReactNode;
  playerReady?: boolean;
}

export const MusicPlayerProvider: React.FC<MusicPlayerProviderProps> = ({ 
  children, 
  playerReady: playerReadyProp = false 
}) => {
  const [currentTrack, setCurrentTrack] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);

  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const currentSongIdRef = useRef<string | null>(null);
  // FIX #4: ref mirrors currentTrack state so listeners never capture stale closures
  const currentTrackRef = useRef<Song | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const expandPlayerRef = useRef<(() => void) | null>(null);
  const collapsePlayerRef = useRef<(() => void) | null>(null);
  const isInitializedRef = useRef(false);
  const playerReadyRef = useRef(playerReadyProp);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackStatusSubscriptionRef = useRef<any>(null);
  // FIX #1: stable ref to loadTrackFromQueue so restore effect doesn't re-run
  const loadTrackFromQueueRef = useRef<((index: number, startPlaying?: boolean) => Promise<boolean>) | null>(null);
  // FIX #9: Track last play/pause state to only update notification on change
  const lastPlayingStateRef = useRef<boolean>(false);

  const netInfo = useNetInfo();
  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  // Keep currentTrackRef in sync with state (FIX #4)
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // FIX #7: Audio.setAudioModeAsync REMOVED — now only in _layout.tsx
  // The audio session is configured once at app startup. No need to reconfigure here.

  useEffect(() => {
    playerReadyRef.current = playerReadyProp;
  }, [playerReadyProp]);

  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current = expand;
    collapsePlayerRef.current = collapse;
  }, []);

  const expandPlayer = useCallback(() => {
    if (expandPlayerRef.current) expandPlayerRef.current();
  }, []);

  const collapsePlayer = useCallback(() => {
    if (collapsePlayerRef.current) collapsePlayerRef.current();
  }, []);

  // FIX #4: setupPlaybackListener no longer closes over currentTrack state.
  // It reads currentTrackRef.current which is always up to date.
  // FIX #9: Only updates notification when isPlaying state actually changes
  const setupPlaybackListener = useCallback(async (sound: Audio.Sound) => {
    if (playbackStatusSubscriptionRef.current) {
      playbackStatusSubscriptionRef.current.remove();
    }
    
    playbackStatusSubscriptionRef.current = sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded) {
        const newPlayingState = status.isPlaying;
        
        setIsPlaying(newPlayingState);
        setIsBuffering(status.isBuffering);
        setPosition(status.positionMillis / 1000);
        setDuration((status.durationMillis || 0) / 1000);
        setError(null);
        
        // FIX #9: Only update notification when play/pause state changes
        if (newPlayingState !== lastPlayingStateRef.current && currentTrackRef.current) {
          lastPlayingStateRef.current = newPlayingState;
          updateNowPlayingNotification(currentTrackRef.current, newPlayingState).catch(console.warn);
        }
      } else if (status.error) {
        log(`Playback error: ${status.error}`);
        setIsBuffering(false);
        setError(new Error(status.error));
      }
    });
  }, [log]); // no currentTrack dependency — uses ref instead

  // Cleanup sound
  const cleanupSound = useCallback(async () => {
    if (playbackStatusSubscriptionRef.current) {
      playbackStatusSubscriptionRef.current.remove();
      playbackStatusSubscriptionRef.current = null;
    }
    if (currentSoundRef.current) {
      try {
        await currentSoundRef.current.unloadAsync();
      } catch (_) {}
      currentSoundRef.current = null;
    }
  }, []);

  // Load a track from queue
  // FIX #3: uses createSound() helper which picks MediaPlayer for Opus/WebM on Android
  // FIX #5 (notification): passes local song variable, not stale currentTrack state
  const loadTrackFromQueue = useCallback(async (index: number, startPlaying: boolean = true): Promise<boolean> => {
    if (index < 0 || index >= queue.length) {
      log(`Invalid queue index: ${index}`);
      return false;
    }

    const queueItem = queue[index];
    if (!queueItem) return false;

    setIsLoading(true);
    setError(null);

    try {
      await cleanupSound();

      let resolvedTrack: ResolvedTrack | null = null;
      let audioUrl: string;
      let notificationTrack: Song;

      if (queueItem.isDownloaded) {
        const downloadedSong = queueItem.song as DownloadedSongMetadata;
        audioUrl = downloadedSong.localTrackUri;
        
        notificationTrack = {
          id: downloadedSong.id,
          title: downloadedSong.title,
          artist: downloadedSong.artist,
          thumbnail: downloadedSong.localArtworkUri || '',
          url: downloadedSong.localTrackUri,
          videoId: undefined,
        };

        setCurrentTrack(notificationTrack);
        currentSongRef.current = null;
        currentSongIdRef.current = downloadedSong.id;
      } else {
        const song = queueItem.song as Song;
        
        if (queueItem.resolvedTrack) {
          resolvedTrack = queueItem.resolvedTrack;
        } else {
          resolvedTrack = await resolveTrack(song);
          if (!resolvedTrack) {
            Alert.alert('Playback Error', `"${song.title}" is unavailable.`);
            setIsLoading(false);
            return false;
          }
          
          setQueue(prev => {
            const newQueue = [...prev];
            newQueue[index] = { ...newQueue[index], resolvedTrack: resolvedTrack! };
            return newQueue;
          });
          
          storeTrackExtras(resolvedTrack.id, {
            videoUrl: resolvedTrack.videoUrl,
            muxedVideoUrl: resolvedTrack.muxedVideoUrl,
            videoId: resolvedTrack.videoId,
            uploaderUrl: resolvedTrack.uploaderUrl,
            likeCount: resolvedTrack.likeCount,
            dislikeCount: resolvedTrack.dislikeCount,
            viewCount: resolvedTrack.viewCount,
            commentsCount: resolvedTrack.commentsCount,
          });
        }
        
        audioUrl = resolvedTrack.url;
        notificationTrack = song;

        setCurrentTrack(song);
        currentSongRef.current = song;
        currentSongIdRef.current = song.id;
        
        if (resolvedTrack.url) {
          saveQuickActions(resolvedTrack.url, resolvedTrack.id).catch(() => {});
        }
      }

      // FIX #3: createSound picks MediaPlayer for Opus/WebM on Android
      const sound = await createSound(audioUrl, startPlaying, 0, resolvedTrack);
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);

      // Reset last playing state ref
      lastPlayingStateRef.current = startPlaying;
      
      // FIX #5: pass local notificationTrack, not stale currentTrack state
      await updateNowPlayingNotification(notificationTrack, startPlaying);
      
      setCurrentQueueIndex(index);
      await saveQueueState(queue, index);
      
      log(`Loaded track ${index + 1}/${queue.length}: "${queueItem.song.title}"`);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`loadTrackFromQueue error: ${error.message}`);
      setError(error);
      Alert.alert('Playback Error', `Failed to play "${queueItem.song.title}".`);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [queue, cleanupSound, setupPlaybackListener, log]);

  // Keep the ref pointing at the latest version (FIX #1)
  useEffect(() => {
    loadTrackFromQueueRef.current = loadTrackFromQueue;
  }, [loadTrackFromQueue]);

  // ─── Progress tracking interval ───────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      progressIntervalRef.current = setInterval(() => {
        if (currentSoundRef.current) {
          currentSoundRef.current.getStatusAsync().then(status => {
            if (status.isLoaded) {
              setPosition(status.positionMillis / 1000);
              setDuration((status.durationMillis || 0) / 1000);
            }
          }).catch(() => {});
        }
      }, 250);
    } else if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isPlaying]);

  // ─── AUTO-EXPAND ON APP RESUME ─────────────────────────────────────────────
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active' && isInitializedRef.current && playerReadyRef.current) {
        if (currentSoundRef.current && expandPlayerRef.current) {
          const status = await currentSoundRef.current.getStatusAsync();
          if (status.isLoaded && status.isPlaying) {
            log('App resumed with active track - auto-expanding player');
            setTimeout(() => expandPlayer(), 100);
          }
        }
      }
    });

    return () => subscription.remove();
  }, [expandPlayer, log]);

  // ─── RESTORE PLAYING STATE ON APP START ─────────────────────────────────────
  // FIX #1: loadTrackFromQueue is NOT in the dependency array.
  // We call it via loadTrackFromQueueRef.current to get the latest version
  // without causing the effect to re-run every time queue changes.
  // FIX #10: Fixed race condition — wait for queue state to commit before loading
  useEffect(() => {
    if (!playerReadyProp) return;

    const initializeAndRestore = async () => {
      try {
        const { queue: savedQueue, currentIndex: savedIndex } = await restoreQueueState();
        
        if (savedQueue.length > 0 && savedIndex >= 0 && savedIndex < savedQueue.length) {
          log(`Restoring queue with ${savedQueue.length} tracks at index ${savedIndex}`);
          
          // FIX #10: Set queue state first and wait for it to be reflected
          // We do this by using a state setter and then loading in the next tick
          setQueue(savedQueue);
          setCurrentQueueIndex(savedIndex);
          
          // Use setTimeout to allow React state to commit before loading
          setTimeout(async () => {
            await loadTrackFromQueueRef.current?.(savedIndex, false);
          }, 0);
        } else {
          const { track, position: savedPosition } = await restoreLastPlayingState();
          if (track && track.url) {
            log(`Restoring last playing track: ${track.title}`);
            setCurrentTrack(track);
            currentSongRef.current = track;
            currentSongIdRef.current = track.id;

            const resolvedTrack = await resolveTrack(track);
            if (resolvedTrack) {
              // FIX #3: use createSound helper for format-aware init
              const sound = await createSound(
                resolvedTrack.url,
                false,
                savedPosition > 5 ? savedPosition * 1000 : 0,
                resolvedTrack,
              );
              currentSoundRef.current = sound;
              await setupPlaybackListener(sound);
              
              if (savedPosition > 5) {
                setPosition(savedPosition);
              }
            }
          }
        }

        isInitializedRef.current = true;
      } catch (e) {
        log(`Restore error: ${e}`);
      }
    };

    initializeAndRestore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerReadyProp]); // ← ONLY playerReadyProp. log and setupPlaybackListener are stable.

  // Save queue state when it changes
  useEffect(() => {
    if (queue.length > 0 && currentQueueIndex >= 0) {
      saveQueueState(queue, currentQueueIndex);
    }
  }, [queue, currentQueueIndex]);

  // FIX #6: debounced save — was firing every 250ms on position ticks
  useEffect(() => {
    if (!currentTrack) return;
    const timer = setTimeout(() => {
      saveLastPlayingState(currentTrack, position);
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentTrack, position]);

  // ─── BACKGROUND PLAYLIST LOADING ───────────────────────────────────────────
  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const queueItems: QueueItem[] = [];
      
      for (let i = targetIndex; i < fullPlaylist.length; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({ song: fullPlaylist[i], isDownloaded: false });
      }
      
      for (let i = 0; i < targetIndex; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({ song: fullPlaylist[i], isDownloaded: false });
      }

      setQueue(queueItems);
      setCurrentQueueIndex(0);
      await saveQueueState(queueItems, 0);
      log(`Created playlist queue with ${queueItems.length} tracks`);
    },
    [log],
  );

  const addDownloadedPlaylistTracksInBackground = useCallback(
    async (initialSong: DownloadedSongMetadata, fullPlaylist: DownloadedSongMetadata[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const queueItems: QueueItem[] = [];
      
      for (let i = targetIndex; i < fullPlaylist.length; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({ song: fullPlaylist[i], isDownloaded: true });
      }
      
      for (let i = 0; i < targetIndex; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({ song: fullPlaylist[i], isDownloaded: true });
      }

      setQueue(queueItems);
      setCurrentQueueIndex(0);
      await saveQueueState(queueItems, 0);
      log(`Created downloaded playlist queue with ${queueItems.length} tracks`);
    },
    [log],
  );

  const addUpNextSongs = useCallback(
    async (song: Song, abortSignal: AbortSignal) => {
      if (!song.url) return;
      const songId = song.id;
      const related = await fetchRelatedSongs(song.url);
      if (abortSignal.aborted || currentSongIdRef.current !== songId) return;

      if (queue.length === 0 && related.length > 0) {
        const queueItems: QueueItem[] = related.slice(0, 10).map(relSong => ({
          song: relSong,
          isDownloaded: false,
        }));
        setQueue(queueItems);
        await saveQueueState(queueItems, -1);
        log(`Added ${queueItems.length} up-next songs to queue`);
      }
    },
    [queue.length, log],
  );

  // ─── CORE PLAY FUNCTIONS ────────────────────────────────────────────────────
  const playAudio = useCallback(async (
    songToPlay: Song,
    playlist?: Song[],
    expandPlayerFn?: () => void,
  ) => {
    if (!playerReadyRef.current) {
      Alert.alert('Player Not Ready', 'Audio engine is still starting up. Please wait.');
      return;
    }
    if (!netInfo.isConnected) {
      Alert.alert('No Connection', 'Please connect to the internet.');
      return;
    }
    if (!songToPlay.url) {
      Alert.alert('Not Available', `"${songToPlay.title}" is not available.`);
      return;
    }

    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    if (goToPlayer) goToPlayer();

    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;

    if (playlist && playlist.length > 1) {
      await addPlaylistTracksInBackground(songToPlay, playlist, abortSignal);
      await loadTrackFromQueue(0, true);
    } else {
      setQueue([]);
      setCurrentQueueIndex(-1);
      
      const resolvedTrack = await resolveTrack(songToPlay);
      if (!resolvedTrack) {
        Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable.`);
        return;
      }

      await cleanupSound();
      
      // FIX #3: format-aware sound creation
      const sound = await createSound(resolvedTrack.url, true, 0, resolvedTrack);
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);
      setCurrentTrack(songToPlay);
      currentSongRef.current = songToPlay;
      currentSongIdRef.current = songToPlay.id;
      
      // Reset last playing state ref
      lastPlayingStateRef.current = true;
      
      // FIX #5: pass songToPlay directly, not stale currentTrack state
      await updateNowPlayingNotification(songToPlay, true);
      
      addUpNextSongs(songToPlay, abortSignal).catch(() => {});
    }
  }, [netInfo.isConnected, addPlaylistTracksInBackground, addUpNextSongs, cleanupSound, setupPlaybackListener, loadTrackFromQueue, log]);

  const playPlaylist = useCallback(async (songs: Song[], expandPlayerFn?: () => void) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'Playlist is empty.');
      return;
    }
    await playAudio(songs[0], songs, expandPlayerFn);
  }, [playAudio]);

  const playNext = useCallback(async (songsToAdd: Song[] | null) => {
    if (!songsToAdd?.length) return;
    
    const newQueueItems: QueueItem[] = songsToAdd.map(song => ({
      song,
      isDownloaded: false,
    }));
    
    setQueue(prev => [...newQueueItems, ...prev]);
    log(`Added ${newQueueItems.length} songs to play next`);
  }, [log]);

  const playDownloadedSong = useCallback(async (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => {
    if (!playerReadyRef.current) {
      Alert.alert('Player Not Ready', 'Audio engine is still starting up.');
      return;
    }

    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    if (goToPlayer) goToPlayer();

    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;

    if (playlist && playlist.length > 1) {
      await addDownloadedPlaylistTracksInBackground(songToPlay, playlist, abortSignal);
      await loadTrackFromQueue(0, true);
    } else {
      setQueue([]);
      setCurrentQueueIndex(-1);
      
      await cleanupSound();
      
      // Downloaded files are always local — no format detection needed
      const sound = await createSound(songToPlay.localTrackUri, true, 0, null);
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);

      const track: Song = {
        id: songToPlay.id,
        title: songToPlay.title,
        artist: songToPlay.artist,
        thumbnail: songToPlay.localArtworkUri || '',
        url: songToPlay.localTrackUri,
        videoId: undefined,
      };

      setCurrentTrack(track);
      currentSongRef.current = null;
      currentSongIdRef.current = songToPlay.id;
      
      // Reset last playing state ref
      lastPlayingStateRef.current = true;
      
      // FIX #5: pass local track variable
      await updateNowPlayingNotification(track, true);
    }
  }, [addDownloadedPlaylistTracksInBackground, cleanupSound, setupPlaybackListener, loadTrackFromQueue]);

  const playAllDownloadedSongs = useCallback(async (
    songs: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'No downloaded songs found.');
      return;
    }
    await playDownloadedSong(songs[0], songs, expandPlayerFn);
  }, [playDownloadedSong]);

  const togglePlayPause = useCallback(async () => {
    try {
      if (!currentSoundRef.current) {
        if (queue.length > 0 && currentQueueIndex >= 0) {
          await loadTrackFromQueue(currentQueueIndex, true);
        } else {
          Alert.alert('Nothing to Play', 'Please select a song first.');
        }
        return;
      }

      const status = await currentSoundRef.current.getStatusAsync();
      if (!status.isLoaded) {
        if (queue.length > 0 && currentQueueIndex >= 0) {
          await loadTrackFromQueue(currentQueueIndex, true);
        } else if (currentTrack?.url) {
          const resolvedTrack = await resolveTrack(currentTrack as Song);
          if (resolvedTrack) {
            await cleanupSound();
            // FIX #3: format-aware
            const sound = await createSound(resolvedTrack.url, true, 0, resolvedTrack);
            currentSoundRef.current = sound;
            await setupPlaybackListener(sound);
          }
        }
        return;
      }

      if (status.isPlaying) {
        await currentSoundRef.current.pauseAsync();
        // Update notification with paused state (FIX #9: will trigger on change via status callback)
        log('Paused');
      } else {
        await currentSoundRef.current.playAsync();
        log('Playing');
      }
      // Notification update is handled by the playback status listener (FIX #9)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`togglePlayPause error: ${error.message}`);
      setError(error);
    }
  }, [currentTrack, queue, currentQueueIndex, loadTrackFromQueue, cleanupSound, setupPlaybackListener, log]);

  const seekTo = useCallback(async (newPosition: number) => {
    try {
      if (currentSoundRef.current) {
        await currentSoundRef.current.setPositionAsync(newPosition * 1000);
        setPosition(newPosition);
      }
    } catch (error) {
      log(`seekTo error: ${error}`);
    }
  }, [log]);

  const skipToNext = useCallback(async () => {
    try {
      if (queue.length === 0) {
        log('No queue available for skipToNext');
        return;
      }

      const nextIndex = currentQueueIndex + 1;
      if (nextIndex < queue.length) {
        await loadTrackFromQueue(nextIndex, true);
      } else {
        if (queue.length > 0) {
          await loadTrackFromQueue(0, true);
        }
      }
    } catch (error) {
      log(`skipToNext error: ${error}`);
    }
  }, [queue, currentQueueIndex, loadTrackFromQueue, log]);

  const skipToPrevious = useCallback(async () => {
    try {
      if (position > 3) {
        await seekTo(0);
        return;
      }

      if (queue.length === 0) {
        log('No queue available for skipToPrevious');
        return;
      }

      const prevIndex = currentQueueIndex - 1;
      if (prevIndex >= 0) {
        await loadTrackFromQueue(prevIndex, true);
      } else {
        if (queue.length > 0) {
          await loadTrackFromQueue(queue.length - 1, true);
        }
      }
    } catch (error) {
      log(`skipToPrevious error: ${error}`);
    }
  }, [position, queue, currentQueueIndex, loadTrackFromQueue, seekTo, log]);

  // ─── REMOTE NOTIFICATION ACTIONS ──────────────────────────────────────────
  // FIX #11: Wire up remote action callbacks from service.ts
  useEffect(() => {
    // Start the notification listener service
    startPlaybackService();
    
    // Register callbacks that the service will call when user taps notification buttons
    registerRemoteActionCallbacks({
      onPlay: async () => {
        if (!currentSoundRef.current) {
          if (queue.length > 0 && currentQueueIndex >= 0) {
            await loadTrackFromQueue(currentQueueIndex, true);
          }
          return;
        }
        const status = await currentSoundRef.current.getStatusAsync();
        if (!status.isLoaded) {
          if (queue.length > 0 && currentQueueIndex >= 0) {
            await loadTrackFromQueue(currentQueueIndex, true);
          }
        } else if (!status.isPlaying) {
          await currentSoundRef.current.playAsync();
        }
      },
      onPause: async () => {
        if (currentSoundRef.current) {
          const status = await currentSoundRef.current.getStatusAsync();
          if (status.isLoaded && status.isPlaying) {
            await currentSoundRef.current.pauseAsync();
          }
        }
      },
      onStop: async () => {
        if (currentSoundRef.current) {
          await currentSoundRef.current.stopAsync();
        }
      },
      onNext: async () => {
        await skipToNext();
      },
      onPrevious: async () => {
        await skipToPrevious();
      },
    });

    return () => {
      deregisterRemoteActionCallbacks();
    };
  }, [queue, currentQueueIndex, loadTrackFromQueue, skipToNext, skipToPrevious]);

  const contextValue: MusicPlayerContextType = {
    currentTrack,
    isPlaying,
    isBuffering,
    isLoading,
    position,
    duration,
    queue,
    currentQueueIndex,
    playAudio,
    playPlaylist,
    playNext,
    playDownloadedSong,
    playAllDownloadedSongs,
    togglePlayPause,
    seekTo,
    skipToNext,
    skipToPrevious,
    setQueue,
    setCurrentQueueIndex,
    expandPlayer,
    collapsePlayer,
    setPlayerOverlayRefs,
  };

  return (
    <MusicPlayerContext.Provider value={contextValue}>
      {children}
    </MusicPlayerContext.Provider>
  );
};