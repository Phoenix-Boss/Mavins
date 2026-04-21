// components/MusicPlayerContext.tsx
//
// CRITICAL FIX: All react-native-track-player imports are DEFERRED to runtime.
// No RNTP code is imported at the top level to prevent CAPABILITY_PLAY null
// errors during Metro static evaluation.
//
// FIXED: Proper typing for dynamic RNTP import using ReturnType

import React, {
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
import type { StreamInsert } from '@/libs/supabase';
import { useHomeStore } from '@/store/home';

// ─────────────────────────────────────────────────────────────────────────────
// LAZY RNTP MODULE TYPE
// ─────────────────────────────────────────────────────────────────────────────

type RNTPModule = {
  Capability: any;
  AppKilledPlaybackBehavior: any;
  Event: any;
  State: any;
  TrackPlayer: {
    setupPlayer: (options?: any) => Promise<void>;
    getPlaybackState: () => Promise<{ state: any }>;
    reset: () => Promise<void>;
    add: (tracks: any | any[]) => Promise<void>;
    load: (track: any) => Promise<void>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    stop: () => Promise<void>;
    skipToNext: () => Promise<void>;
    skipToPrevious: () => Promise<void>;
    seekTo: (position: number) => Promise<void>;
    getPosition: () => Promise<number>;
    getDuration: () => Promise<number>;
    getQueue: () => Promise<any[]>;
    addEventListener: (event: string, listener: (data: any) => void) => { remove: () => void };
    updateOptions: (options: any) => Promise<void>;
  };
};

let _rntpModule: RNTPModule | null = null;

async function getRNTP(): Promise<RNTPModule | null> {
  if (!_rntpModule) {
    try {
      const module = await import('react-native-track-player');
      // The default export IS the TrackPlayer object in RNTP 4.x.
      // module.TrackPlayer does not exist — use module.default instead.
      const player = (module.default ?? module) as unknown as RNTPModule['TrackPlayer'];
      _rntpModule = {
        Capability: module.Capability,
        AppKilledPlaybackBehavior: module.AppKilledPlaybackBehavior,
        Event: module.Event,
        State: module.State,
        TrackPlayer: player,
      };
    } catch (e) {
      console.error('[MusicPlayer] Failed to load RNTP:', e);
      return null;
    }
  }
  return _rntpModule;
}

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
  [key: string]: any;
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

  playAudio: (song: Song, playlist?: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playPlaylist: (songs: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playNext: (songs: Song[] | null) => Promise<void>;
  playDownloadedSong: (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;

  expandPlayer: () => void;
  collapsePlayer: () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Stream Cache Constants
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_TTL_MS = 6 * 60 * 60 * 1000;
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Stream Selection Helpers
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

async function invalidateStreamCache(trackId: string): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    await (supabase as any).from('streams').update({ is_active: false }).eq('track_id', uuid);
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
      return buildTrack(song, cachedAudio.url, cachedVideo, null, cachedAudio.duration, undefined, extras);
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

    return buildTrack(song, audioUrl, videoUrl, muxedVideoUrl, duration, info.title, extras);
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
      console.warn(`[MusicPlayer] search strategy failed:`, searchErr);
    }
  }

  console.warn(`[MusicPlayer] all strategies exhausted for "${song.title}"`);
  return null;
};

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
  const [nativePlaybackState, setNativePlaybackState] = useState<number | string>(0);
  const [currentTrack, setCurrentTrack] = useState<Song | null>(null);
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);
  const [progress, setProgress] = useState({ position: 0, duration: 0, buffered: 0 });
  const [isLoading, setIsLoading] = useState(false);

  // Use both string and number state comparisons for New Architecture compatibility
  // New Arch uses string states ('playing', 'buffering') while old used numbers (3, 6, 7, 8)
  const nativeIsPlaying = nativePlaybackState === 'playing' || nativePlaybackState === 3;
  const isPlaying = optimisticPlaying !== null ? optimisticPlaying : nativeIsPlaying;
  const isBuffering = ['buffering', 'loading', 6, 8, 7].includes(nativePlaybackState as any);

  const currentSongIdRef = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const expandPlayerRef = useRef<(() => void) | null>(null);
  const collapsePlayerRef = useRef<(() => void) | null>(null);
  const isRecoveringRef = useRef(false);
  const isInitializedRef = useRef(false);
  const playerReadyRef = useRef(playerReadyProp);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventUnsubscribersRef = useRef<Array<() => void>>([]);

  const netInfo = useNetInfo();
  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  useEffect(() => {
    playerReadyRef.current = playerReadyProp;
  }, [playerReadyProp]);

  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === nativeIsPlaying) {
      setOptimisticPlaying(null);
    }
  }, [nativeIsPlaying, optimisticPlaying]);

  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current = expand;
    collapsePlayerRef.current = collapse;
  }, []);

  const expandPlayer = useCallback(() => expandPlayerRef.current?.(), []);
  const collapsePlayer = useCallback(() => collapsePlayerRef.current?.(), []);

  // ─── DEFERRED RNTP INITIALIZATION ───────────────────────────────────────────
  useEffect(() => {
    if (!playerReadyProp) return;

    let cancelled = false;

    async function initRNTP() {
      const rntp = await getRNTP();
      if (!rntp || cancelled) return;

      const { Event, State, TrackPlayer } = rntp;

      eventUnsubscribersRef.current.forEach(unsub => unsub());
      eventUnsubscribersRef.current = [];
      
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }

      progressIntervalRef.current = setInterval(async () => {
        if (cancelled) return;
        try {
          const pos = await TrackPlayer.getPosition();
          const dur = await TrackPlayer.getDuration();
          setProgress({ position: pos, duration: dur, buffered: 0 });
        } catch (e) {}
      }, 250);

      const stateSub = TrackPlayer.addEventListener(Event.PlaybackState, ({ state }: any) => {
        if (!cancelled) setNativePlaybackState(state);
      });
      eventUnsubscribersRef.current.push(() => stateSub.remove());

      const trackSub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async ({ track }: any) => {
        try {
          if (track && !cancelled) {
            const song: Song = {
              id: track.id,
              title: track.title || 'Unknown',
              artist: track.artist || 'Unknown',
              thumbnail: typeof track.artwork === 'string' ? track.artwork : '',
              url: track.url || '',
              duration: track.duration || 0,
              videoId: (track as any).videoId,
            };
            setCurrentTrack(song);
            currentSongRef.current = song;
            currentSongIdRef.current = track.id;
            saveLastPlayingState(song, progress.position);
          } else if (!cancelled) {
            setCurrentTrack(null);
            currentSongRef.current = null;
            currentSongIdRef.current = null;
            saveLastPlayingState(null);
          }
        } catch (e) {
          log(`ActiveTrackChanged error: ${e}`);
        }
      });
      eventUnsubscribersRef.current.push(() => trackSub.remove());

      const errorSub = TrackPlayer.addEventListener(Event.PlaybackError, async (event: any) => {
        log(`Playback error: ${event.message || 'unknown'}`);
        if (!cancelled) setNativePlaybackState('error');

        const song = currentSongRef.current;
        if (!song || isRecoveringRef.current) return;

        isRecoveringRef.current = true;
        try {
          await invalidateStreamCache(song.id);
          const track = await resolveTrack(song);
          if (track) {
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
            await TrackPlayer.load(track);
            await TrackPlayer.play();
          }
        } catch (e) {
          log(`Recovery failed: ${e}`);
        } finally {
          isRecoveringRef.current = false;
        }
      });
      eventUnsubscribersRef.current.push(() => errorSub.remove());

      log('RNTP event listeners registered');
    }

    initRNTP();

    return () => {
      cancelled = true;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      eventUnsubscribersRef.current.forEach(unsub => unsub());
      eventUnsubscribersRef.current = [];
    };
  }, [playerReadyProp, log]);

  // ─── AUTO-EXPAND ON APP RESUME ─────────────────────────────────────────────
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active' && isInitializedRef.current && playerReadyRef.current) {
        try {
          const rntp = await getRNTP();
          if (!rntp) return;
          const queue = await rntp.TrackPlayer.getQueue();
          const { state: playbackState } = await rntp.TrackPlayer.getPlaybackState();
          
          if (queue?.length > 0 && (playbackState === 'playing' || playbackState === 3) && expandPlayerRef.current) {
            log('App resumed with active track - auto-expanding player');
            setTimeout(() => expandPlayer(), 100);
          }
        } catch (e) {
          log(`App resume check error: ${e}`);
        }
      }
    });

    return () => subscription.remove();
  }, [expandPlayer, log]);

  // ─── RESTORE PLAYING STATE ON APP START ─────────────────────────────────────
  // playerReadyProp is set true by _layout.tsx after setupPlayerGlobal() resolves.
  // No polling needed — react to the prop flipping, the layout owns readiness.
  useEffect(() => {
    if (!playerReadyProp) return;

    const initializeAndRestore = async () => {
      try {
        const rntp = await getRNTP();
        if (!rntp) return;

        const queue = await rntp.TrackPlayer.getQueue();
        if (queue?.length > 0) {
          log('Active track already exists, skipping restore');
          isInitializedRef.current = true;
          return;
        }

        const { track, position } = await restoreLastPlayingState();

        if (track) {
          log(`Restoring last playing track: ${track.title}`);
          setCurrentTrack(track);
          currentSongRef.current = track;
          currentSongIdRef.current = track.id;

          const resolvedTrack = await resolveTrack(track);
          if (resolvedTrack) {
            await rntp.TrackPlayer.load(resolvedTrack);
            if (position > 5) {
              await rntp.TrackPlayer.seekTo(position);
            }
            await rntp.TrackPlayer.pause();
          }
        }

        isInitializedRef.current = true;
      } catch (e) {
        log(`Restore error: ${e}`);
      }
    };

    initializeAndRestore();
  }, [playerReadyProp, log]);

  useEffect(() => {
    if (currentTrack) {
      saveLastPlayingState(currentTrack, progress.position);
    }
  }, [currentTrack, progress.position]);

  // ─── BACKGROUND PLAYLIST LOADING ───────────────────────────────────────────
  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const rntp = await getRNTP();
      if (!rntp) return;

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
          await rntp.TrackPlayer.add(track);
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

      const rntp = await getRNTP();
      if (!rntp) return;

      const addTrack = async (song: DownloadedSongMetadata): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          await rntp.TrackPlayer.add({
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

      const rntp = await getRNTP();
      if (!rntp) return;

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
        await rntp.TrackPlayer.add(track);
        await delay(200);
      }
    },
    [log],
  );

  // ─── CORE PLAY FUNCTION ────────────────────────────────────────────────────
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

    const rntp = await getRNTP();
    if (!rntp) {
      Alert.alert('Player Error', 'Audio engine failed to load.');
      return;
    }

    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    if (goToPlayer) {
      goToPlayer();
    } else {
      log('ERROR: expandPlayer not registered');
      return;
    }

    currentSongRef.current = songToPlay;
    currentSongIdRef.current = songToPlay.id;
    setCurrentTrack(songToPlay);

    setIsLoading(true);
    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;
    isRecoveringRef.current = false;

    try {
      log(`Play: "${songToPlay.title}"`);

      const cached = await getCachedAudioStream(songToPlay.id);

      if (cached) {
        const track = buildTrack(songToPlay, cached.url, null, null, cached.duration);
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
        await rntp.TrackPlayer.load(track);
        await rntp.TrackPlayer.play();
        log(`Now playing (cached): "${track.title}"`);
        saveQuickActions(track.url, track.id).catch(() => {});
      } else {
        const track = await resolveTrack(songToPlay);
        if (abortSignal.aborted) { setIsLoading(false); return; }

        if (!track) {
          Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable.`);
          setIsLoading(false);
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

        currentSongIdRef.current = track.id;

        await rntp.TrackPlayer.load(track);
        await rntp.TrackPlayer.play();
        log(`Now playing (resolved): "${track.title}"`);

        if (track.url) {
          saveQuickActions(track.url, track.id).catch(() => {});
        }
      }

      if (playlist && playlist.length > 1) {
        addPlaylistTracksInBackground(songToPlay, playlist, abortSignal).catch(() => {});
      } else {
        addUpNextSongs(songToPlay, abortSignal).catch(() => {});
      }
    } catch (error) {
      log(`playAudio error: ${error}`);
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  }, [netInfo.isConnected, addPlaylistTracksInBackground, addUpNextSongs, log]);

  const playPlaylist = useCallback(async (songs: Song[], expandPlayerFn?: () => void) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'Playlist is empty.');
      return;
    }
    await playAudio(songs[0], songs, expandPlayerFn);
  }, [playAudio]);

  const playNext = useCallback(async (songsToAdd: Song[] | null) => {
    if (!songsToAdd?.length) return;
    try {
      const rntp = await getRNTP();
      if (!rntp) return;

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
        await rntp.TrackPlayer.add(track);
      }
    } catch {
      Alert.alert('Playback Error', 'Failed to queue next song(s).');
    }
  }, []);

  const playDownloadedSong = useCallback(async (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => {
    if (!playerReadyRef.current) {
      Alert.alert('Player Not Ready', 'Audio engine is still starting up.');
      return;
    }

    const rntp = await getRNTP();
    if (!rntp) {
      Alert.alert('Player Error', 'Audio engine failed to load.');
      return;
    }

    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    goToPlayer?.();

    try {
      setIsLoading(true);
      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      currentSongRef.current = null;
      currentSongIdRef.current = songToPlay.id;

      await rntp.TrackPlayer.load({
        id: songToPlay.id,
        url: songToPlay.localTrackUri,
        title: songToPlay.title,
        artist: songToPlay.artist,
        artwork: songToPlay.localArtworkUri,
        duration: songToPlay.duration,
      });

      if (abortSignal.aborted) { setIsLoading(false); return; }

      await rntp.TrackPlayer.play();

      if (playlist?.length) {
        addDownloadedPlaylistTracksInBackground(songToPlay, playlist, abortSignal).catch(() => {});
      }
    } catch (error) {
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  }, [addDownloadedPlaylistTracksInBackground]);

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
      const rntp = await getRNTP();
      if (!rntp) {
        Alert.alert('Player Error', 'Audio engine not available.');
        return;
      }

      const queue = await rntp.TrackPlayer.getQueue();
      if (!queue?.length) {
        Alert.alert('Nothing to Play', 'Please select a song first.');
        return;
      }

      const willBePlaying = !isPlaying;
      setOptimisticPlaying(willBePlaying);

      if (isPlaying) {
        await rntp.TrackPlayer.pause();
        log('Paused');
      } else {
        await rntp.TrackPlayer.play();
        log('Playing');
      }
    } catch (error) {
      setOptimisticPlaying(null);
      log(`togglePlayPause error: ${error}`);
    }
  }, [isPlaying, log]);

  const seekTo = useCallback(async (position: number) => {
    try {
      const rntp = await getRNTP();
      if (!rntp) return;
      await rntp.TrackPlayer.seekTo(position);
    } catch (error) {
      log(`seekTo error: ${error}`);
    }
  }, [log]);

  const skipToNext = useCallback(async () => {
    try {
      const rntp = await getRNTP();
      if (!rntp) return;
      await rntp.TrackPlayer.skipToNext();
    } catch (error) {
      log(`skipToNext error: ${error}`);
    }
  }, [log]);

  const skipToPrevious = useCallback(async () => {
    try {
      const rntp = await getRNTP();
      if (!rntp) return;
      await rntp.TrackPlayer.skipToPrevious();
    } catch (error) {
      log(`skipToPrevious error: ${error}`);
    }
  }, [log]);

  const contextValue: MusicPlayerContextType = {
    currentTrack,
    isPlaying,
    isBuffering,
    isLoading,
    position: progress.position,
    duration: progress.duration,
    playAudio,
    playPlaylist,
    playNext,
    playDownloadedSong,
    playAllDownloadedSongs,
    togglePlayPause,
    seekTo,
    skipToNext,
    skipToPrevious,
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