/**
 * MusicPlayerContext
 *
 * KEY FIXES IN THIS VERSION:
 *
 *  FIX 1 — Buffering state no longer sets isPlaying = true
 *  FIX 2 — isPlaying is now purely event-driven
 *  FIX 3 — TrackExtrasStore properly maintained (50 tracks)
 *  FIX 4 — Error recovery enhanced
 *  FIX 5 — Background queue additions properly store extras
 *  FIX 6 — togglePlayPause validates player state before toggling
 *  FIX 7 — ALL player methods now use default export (TrackPlayer) consistently
 *  FIX 8 — Event listeners use correct named export addEventListener
 *  FIX 9 — Removed setupPlayerGlobal() call from error recovery
 *  FIX 10 — Bypass cache for testing to ensure fresh stream URLs
 *  FIX 11 — Strip extras before calling TrackPlayer.add()
 *  FIX 12 — 🔥 REMOVED destructive reset() calls - pipeline stays hot
 */

import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
} from 'react';

import MavinEngine, {
  StreamInfoItem,
  AudioStream,
  VideoStream,
} from '@/modules/mavin-engine';

// Named function exports from the wrapper (NOT methods on the default export)
import {
  MavinEvent,
  addEventListener,
  load,
  play,
  pause,
  add,
  getQueue,
  getQueueSize,
  getActiveTrack,
  getPlaybackState,
  type Track,
} from '@/modules/mavin-eq';

// Local alias so existing call sites keep working without changes
const TrackPlayer = {
  load,
  play,
  pause,
  add,
  getQueue,
  getQueueSize,
  getActiveTrack,
  getPlaybackState,
};

import { Alert, Platform } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { DownloadedSongMetadata } from '@/store/library';
import { supabase } from '@/libs/supabase';
import { supabaseCache } from '@/libs/cache/supabase-cache';
import type { Song } from '@/types/song';
import type { StreamInsert } from '@/libs/supabase';

const streamsTable = () => (supabase as any).from('streams');

// ─────────────────────────────────────────────────────────────────────────────
// UUID / SHA-1 helpers
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
// Supabase helpers (silent on missing-table errors)
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

const safePatchCommentsCount = async (videoId: string, count: number) => {
  try {
    await supabaseCache.patchCommentsCount(videoId, count);
  } catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG))
      console.warn('[MusicPlayer] patchCommentsCount error:', e?.message);
  }
};

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

export type ResolvedTrack = Track & TrackExtras;

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

export interface MusicPlayerContextType {
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  playAudio: (song: Song, playlist?: Song[], navigate?: () => void) => Promise<void>;
  playPlaylist: (songs: Song[], navigate?: () => void) => Promise<void>;
  playNext: (songs: Song[] | null) => Promise<void>;
  playDownloadedSong: (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[], navigate?: () => void) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[], navigate?: () => void) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  setNavigateToPlayer: (fn: () => void) => void;
  setPlayerReady: (ready: boolean) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Stream cache constants
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_TTL_MS = 6 * 60 * 60 * 1000;
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Stream selection helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickBestAudio(streams: AudioStream[]): AudioStream | null {
  if (!streams?.length) return null;
  const direct = streams.filter(s => s.isUrl && !s.manifestUrl);
  const pool   = direct.length ? direct : streams;
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
// Supabase stream cache read/write
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
    const { data, error }: { data: StreamCacheRow | null; error: unknown } =
      await streamsTable()
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
    const { data, error }: { data: StreamCacheRow | null; error: unknown } =
      await streamsTable()
        .select('stream_url, expiry')
        .eq('track_id', uuid)
        .eq('stream_type', 'video')
        .eq('is_active', true)
        .gt('expiry', new Date().toISOString())
        .maybeSingle();
    if (error || !data) return null;
    return data.stream_url;
  } catch { return null; }
}

async function invalidateStreamCache(trackId: string): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    await streamsTable().update({ is_active: false }).eq('track_id', uuid);
    console.log(`[MusicPlayer] invalidated stream cache for track ${trackId}`);
  } catch (e) {
    console.warn('[MusicPlayer] invalidateStreamCache error:', e);
  }
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
    ] satisfies StreamInsert[];

    const { error }: { error: unknown } = await streamsTable()
      .upsert(rows, { onConflict: 'track_id,stream_type' });

    if (error) {
      console.warn('[MusicPlayer] stream cache write error:', (error as any)?.message);
    } else {
      console.log(`[MusicPlayer] cached streams for track ${trackId}`);
    }
  } catch (e) {
    console.warn('[MusicPlayer] cacheStreamsToSupabase error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Track building
// ─────────────────────────────────────────────────────────────────────────────

function buildTrack(
  song: Song,
  audioUrl: string,
  videoUrl: string | null,
  muxedVideoUrl: string | null,
  duration: number,
  title?: string,
  extras?: Omit<TrackExtras, 'videoUrl' | 'muxedVideoUrl'>,
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
  } as ResolvedTrack;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean track for native module (removes extras that Kotlin can't deserialize)
// ─────────────────────────────────────────────────────────────────────────────

function cleanTrackForNative(track: ResolvedTrack): Track {
  return {
    id: track.id,
    url: track.url,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork,
    duration: track.duration,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Track resolution (cache → primary → by-id → search)
// ─────────────────────────────────────────────────────────────────────────────

// 🔥 Force fresh extraction flag for testing
const FORCE_FRESH_EXTRACTION = true;

const resolveTrack = async (song: Song): Promise<ResolvedTrack | null> => {
  if (!song.url) {
    console.warn(`[MusicPlayer] "${song.title}" has no URL — skipping`);
    return null;
  }

  // Skip cache entirely when FORCE_FRESH_EXTRACTION is true
  if (!FORCE_FRESH_EXTRACTION) {
    try {
      const [cachedAudio, cachedVideo] = await Promise.all([
        getCachedAudioStream(song.id),
        getCachedVideoStream(song.id),
      ]);
      if (cachedAudio) {
        console.log(`[MusicPlayer] cache hit for "${song.title}"`);
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
        return buildTrack(song, cachedAudio.url, cachedVideo, null, cachedAudio.duration, undefined, extras);
      }
    } catch (cacheErr) {
      console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
    }
  } else {
    console.log(`[MusicPlayer] 🧪 TEST MODE: Forcing fresh extraction for "${song.title}"`);
  }

  try {
    console.log(`[MusicPlayer] extracting streams for "${song.title}"…`);
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

    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(e => console.warn('[MusicPlayer] bg cache error:', e));

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
              safePatchCommentsCount(song.videoId!, commentsInfo.commentsCount);
            }
          })
          .catch(() => {});
      }
    }

    console.log(
      `[MusicPlayer] ✅ resolved "${song.title}" — ` +
      `audio: ${bestAudio.bitrate}bps, ` +
      `duration: ${duration}s`
    );
    return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, extras);
  } catch (primaryErr) {
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, primaryErr);
  }

  if (song.videoId) {
    try {
      console.log(`[MusicPlayer] trying getStreamInfoById("${song.videoId}") for "${song.title}"…`);
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

          console.log(`[MusicPlayer] ✅ getStreamInfoById succeeded for "${song.title}"`);
          return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, fbExtras);
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
      });
    } catch (searchErr) {
      console.warn(`[MusicPlayer] search strategy "${strategy.query}" failed:`, searchErr);
    }
  }

  console.warn(`[MusicPlayer] all strategies exhausted for "${song.title}" — cannot resolve`);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Related songs helper
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

export interface MusicPlayerProviderProps { children: ReactNode }

export const MusicPlayerProvider: React.FC<MusicPlayerProviderProps> = ({ children }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const currentSongIdRef = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const navigateToPlayerRef = useRef<(() => void) | null>(null);
  const isRecoveringRef = useRef(false);
  const playerReadyRef = useRef(false);
  const netInfo = useNetInfo();

  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  const setNavigateToPlayer = useCallback((fn: () => void) => {
    navigateToPlayerRef.current = fn;
  }, []);

  const setPlayerReady = useCallback((ready: boolean) => {
    playerReadyRef.current = ready;
    log(`Player ready state set to: ${ready}`);
  }, [log]);

  // ── Event-driven state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const stateSub = addEventListener(MavinEvent.PlaybackState, (e: any) => {
      const s = e?.state;
      if (s === 'buffering' || s === 'loading') {
        setIsBuffering(true);
      } else {
        setIsBuffering(false);
      }
      if (s === 'playing') {
        setIsPlaying(true);
      } else if (s === 'paused' || s === 'stopped' || s === 'idle' || s === 'ended' || s === 'error' || s === 'ready') {
        setIsPlaying(false);
      }
    });

    const errorSub = addEventListener(MavinEvent.PlaybackError, () => {
      setIsPlaying(false);
      setIsBuffering(false);
    });

    return () => {
      stateSub.remove();
      errorSub.remove();
    };
  }, []);

  // ── Playback error recovery ────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const errorSub = addEventListener(MavinEvent.PlaybackError, async (e: any) => {
      const song = currentSongRef.current;
      if (!song || isRecoveringRef.current) return;

      log(`Playback error: ${e?.message ?? 'unknown'} — attempting recovery for "${song.title}"`);
      isRecoveringRef.current = true;
      setIsBuffering(true);

      try {
        await invalidateStreamCache(song.id);

        const track = await resolveTrack(song);
        if (!track) {
          Alert.alert('Playback Error', `"${song.title}" could not be recovered.`);
          setIsBuffering(false);
          isRecoveringRef.current = false;
          return;
        }

        storeTrackExtras(track.id, {
          videoUrl: track.videoUrl,
          muxedVideoUrl: track.muxedVideoUrl,
          videoId: track.videoId,
          uploaderUrl: track.uploaderUrl,
          likeCount: track.likeCount,
          dislikeCount: track.dislikeCount,
          viewCount: track.viewCount,
          commentsCount: track.commentsCount,
        });

        try {
          await TrackPlayer.getQueue();
        } catch {
          Alert.alert('Playback Error', 'Audio engine disconnected. Please restart the app.');
          setIsBuffering(false);
          isRecoveringRef.current = false;
          return;
        }

        // 🔥 FIX 12: No reset() - just load and play
        await TrackPlayer.load(cleanTrackForNative(track));
        await TrackPlayer.play();
        log(`Recovery succeeded for "${song.title}"`);
        setIsBuffering(false);
      } catch (recoveryErr) {
        log(`Recovery failed: ${recoveryErr}`);
        Alert.alert('Playback Error', `"${song.title}" failed to play.`);
        setIsBuffering(false);
      } finally {
        isRecoveringRef.current = false;
      }
    });

    return () => errorSub.remove();
  }, [log]);

  // ── Background playlist loading ───────────────────────────────────────────

  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const addTrack = async (song: Song): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track = await resolveTrack(song);
          if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
          if (!track) return true;
          storeTrackExtras(track.id, {
            videoUrl: track.videoUrl,
            muxedVideoUrl: track.muxedVideoUrl,
            videoId: track.videoId,
            uploaderUrl: track.uploaderUrl,
            likeCount: track.likeCount,
            dislikeCount: track.dislikeCount,
            viewCount: track.viewCount,
            commentsCount: track.commentsCount,
          });
          await TrackPlayer.add(cleanTrackForNative(track));
          log(`BG Queue: added "${track.title}"`);
        } catch (e) {
          log(`BG Queue error on "${song.title}": ${e}`);
        }
        return true;
      };

      const songsAfter = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex).reverse();

      for (const s of songsAfter) { if (!(await addTrack(s))) return; await delay(150); }
      for (const s of songsBefore) { if (!(await addTrack(s))) return; await delay(150); }
    },
    [log],
  );

  const addDownloadedPlaylistTracksInBackground = useCallback(
    async (initialSong: DownloadedSongMetadata, fullPlaylist: DownloadedSongMetadata[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const addTrack = async (song: DownloadedSongMetadata): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          await TrackPlayer.add({
            id: song.id,
            url: song.localTrackUri,
            title: song.title,
            artist: song.artist,
            artwork: song.localArtworkUri,
            duration: song.duration,
          });
        } catch (e) {
          log(`BG Downloaded Queue error on "${song.title}": ${e}`);
        }
        return true;
      };

      const songsAfter = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex).reverse();

      for (const s of songsAfter) { if (!(await addTrack(s))) return; await delay(150); }
      for (const s of songsBefore) { if (!(await addTrack(s))) return; await delay(150); }
    },
    [log],
  );

  const addUpNextSongs = useCallback(
    async (song: Song, abortSignal: AbortSignal) => {
      if (!song.url) return;
      const songId = song.id;
      const related = await fetchRelatedSongs(song.url);
      if (abortSignal.aborted || currentSongIdRef.current !== songId) return;

      for (const relSong of related.slice(0, 5)) {
        if (abortSignal.aborted || currentSongIdRef.current !== songId) return;
        const track = await resolveTrack(relSong);
        if (!track) continue;
        storeTrackExtras(track.id, {
          videoUrl: track.videoUrl,
          muxedVideoUrl: track.muxedVideoUrl,
          videoId: track.videoId,
          uploaderUrl: track.uploaderUrl,
          likeCount: track.likeCount,
          dislikeCount: track.dislikeCount,
          viewCount: track.viewCount,
          commentsCount: track.commentsCount,
        });
        await TrackPlayer.add(cleanTrackForNative(track));
        await delay(200);
      }
    },
    [log],
  );

  // ── playAudio ─────────────────────────────────────────────────────────────

  const playAudio = async (songToPlay: Song, playlist?: Song[], navigate?: () => void) => {
    if (!playerReadyRef.current) {
      Alert.alert('Player Not Ready', 'The audio engine is still starting up. Please wait a moment and try again.');
      return;
    }

    if (!netInfo.isConnected) {
      Alert.alert('No Connection', 'Please connect to the internet to play songs.');
      return;
    }
    if (!songToPlay.url) {
      Alert.alert('Not Available', `"${songToPlay.title}" is not available for streaming yet.`);
      return;
    }

    const goToPlayer = navigate ?? navigateToPlayerRef.current;
    goToPlayer?.();

    try {
      log(`Play: "${songToPlay.title}"${playlist ? ` (queue: ${playlist.length})` : ''}`);
      setIsLoading(true);
      setIsBuffering(true);

      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      const track = await resolveTrack(songToPlay);
      if (abortSignal.aborted) { setIsLoading(false); setIsBuffering(false); return; }

      if (!track) {
        Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable.`);
        setIsLoading(false);
        setIsBuffering(false);
        return;
      }

      storeTrackExtras(track.id, {
        videoUrl: track.videoUrl,
        muxedVideoUrl: track.muxedVideoUrl,
        videoId: track.videoId,
        uploaderUrl: track.uploaderUrl,
        likeCount: track.likeCount,
        dislikeCount: track.dislikeCount,
        viewCount: track.viewCount,
        commentsCount: track.commentsCount,
      });

      currentSongRef.current = songToPlay;
      currentSongIdRef.current = track.id;
      isRecoveringRef.current = false;

      // 🔥 FIX 12: NO reset() - pipeline is already hot from warm-up
      // The silent track from warm-up is replaced by this load() call
      // without tearing down the AudioTrack
      await TrackPlayer.load(cleanTrackForNative(track));
      await TrackPlayer.play();
      log(`Now playing: "${track.title}"`);

      if (playlist && playlist.length > 1) {
        addPlaylistTracksInBackground(songToPlay, playlist, abortSignal).catch(e => log(`BG playlist error: ${e}`));
      } else {
        addUpNextSongs(songToPlay, abortSignal).catch(e => log(`Up Next error: ${e}`));
      }
    } catch (error) {
      log(`playAudio error: ${error}`);
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
      setIsBuffering(false);
    } finally {
      setIsLoading(false);
    }
  };

  // ── playDownloadedSong ────────────────────────────────────────────────────

  const playDownloadedSong = async (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
    navigate?: () => void,
  ) => {
    if (!playerReadyRef.current) {
      Alert.alert('Player Not Ready', 'The audio engine is still starting up. Please wait a moment and try again.');
      return;
    }

    const goToPlayer = navigate ?? navigateToPlayerRef.current;
    goToPlayer?.();

    try {
      setIsLoading(true);
      setIsBuffering(true);
      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      currentSongRef.current = null;
      currentSongIdRef.current = songToPlay.id;
      isRecoveringRef.current = false;

      // 🔥 FIX 12: NO reset() - pipeline is already hot
      await TrackPlayer.load({
        id: songToPlay.id,
        url: songToPlay.localTrackUri,
        title: songToPlay.title,
        artist: songToPlay.artist,
        artwork: songToPlay.localArtworkUri,
        duration: songToPlay.duration,
      });

      if (abortSignal.aborted) { setIsLoading(false); setIsBuffering(false); return; }

      await TrackPlayer.play();

      if (playlist?.length) {
        addDownloadedPlaylistTracksInBackground(songToPlay, playlist, abortSignal).catch(e => log(`BG downloaded playlist error: ${e}`));
      }
    } catch (error) {
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
      setIsBuffering(false);
    } finally {
      setIsLoading(false);
    }
  };

  // ── playPlaylist ──────────────────────────────────────────────────────────

  const playPlaylist = async (songs: Song[], navigate?: () => void) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'The playlist is empty.');
      return;
    }
    await playAudio(songs[0], songs, navigate);
  };

  // ── playAllDownloadedSongs ────────────────────────────────────────────────

  const playAllDownloadedSongs = async (songs: DownloadedSongMetadata[], navigate?: () => void) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'No downloaded songs found.');
      return;
    }
    await playDownloadedSong(songs[0], songs, navigate);
  };

  // ── playNext ──────────────────────────────────────────────────────────────

  const playNext = async (songsToAdd: Song[] | null) => {
    if (!songsToAdd?.length) return;
    try {
      for (const song of songsToAdd) {
        if (song.id === currentSongIdRef.current) continue;
        const track = await resolveTrack(song);
        if (!track) continue;
        storeTrackExtras(track.id, {
          videoUrl: track.videoUrl,
          muxedVideoUrl: track.muxedVideoUrl,
          videoId: track.videoId,
          uploaderUrl: track.uploaderUrl,
          likeCount: track.likeCount,
          dislikeCount: track.dislikeCount,
          viewCount: track.viewCount,
          commentsCount: track.commentsCount,
        });
        await TrackPlayer.add(cleanTrackForNative(track));
      }
    } catch {
      Alert.alert('Playback Error', 'Failed to queue next song(s).');
    }
  };

  // ── togglePlayPause ───────────────────────────────────────────────────────

  const togglePlayPause = useCallback(async () => {
    try {
      const currentTrack = await TrackPlayer.getActiveTrack();
      const queueSize = await TrackPlayer.getQueueSize();
      if (!currentTrack || queueSize === 0) {
        Alert.alert('Nothing to Play', 'Please select a song to start playback.');
        return;
      }

      const playbackState = await TrackPlayer.getPlaybackState();
      if (playbackState.state === 'error' || playbackState.state === 'none') {
        Alert.alert('Playback Error', 'The player is not ready. Please try again.');
        return;
      }

      if (isPlaying) {
        await TrackPlayer.pause();
        log('Paused playback');
      } else {
        await TrackPlayer.play();
        log('Started playback');
      }
    } catch (error: any) {
      log(`togglePlayPause error: ${error?.message || error}`);
      Alert.alert('Playback Error', 'Failed to toggle playback.');
    }
  }, [isPlaying, log]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <MusicPlayerContext.Provider value={{
      isPlaying,
      isBuffering,
      isLoading,
      playAudio,
      playPlaylist,
      playNext,
      playDownloadedSong,
      playAllDownloadedSongs,
      togglePlayPause,
      setNavigateToPlayer,
      setPlayerReady,
    }}>
      {children}
    </MusicPlayerContext.Provider>
  );
};