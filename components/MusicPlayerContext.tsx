// components/MusicPlayerContext.tsx
//
// Converted from react-native-track-player to expo-av
// All RNTP code removed, now using expo-av for audio playback
// Uses expo-notifications for lock screen controls
// Includes proper queue management for playlists

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
    // Only save the essential info, not the resolved tracks
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
// ─────────────────────────────────────────────────────────────────────────────

async function updateNowPlayingNotification(track: Song | null, isPlaying: boolean = false) {
  if (!track) {
    await Notifications.dismissAllNotificationsAsync();
    return;
  }

  await Notifications.setNotificationCategoryAsync('MEDIA_PLAYBACK', [
    {
      identifier: 'PREVIOUS',
      buttonTitle: '⏮',
      options: { isDestructive: false },
    },
    {
      identifier: isPlaying ? 'PAUSE' : 'PLAY',
      buttonTitle: isPlaying ? '⏸' : '▶',
      options: { isDestructive: false },
    },
    {
      identifier: 'NEXT',
      buttonTitle: '⏭',
      options: { isDestructive: false },
    },
    {
      identifier: 'STOP',
      buttonTitle: '⏹',
      options: { isDestructive: true },
    },
  ]);

  // Build notification content
  const notificationContent: any = {
    title: track.title,
    body: track.artist || 'Unknown Artist',
    data: { type: 'MEDIA_PLAYBACK', track },
    categoryIdentifier: 'MEDIA_PLAYBACK',
  };

  // Android options
  if (Platform.OS === 'android') {
    notificationContent.android = {
      priority: Notifications.AndroidNotificationPriority.HIGH,
    };
    notificationContent.color = '#1DB954';
  }

  // iOS attachments
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

  // Queue management
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);

  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const currentSongIdRef = useRef<string | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const expandPlayerRef = useRef<(() => void) | null>(null);
  const collapsePlayerRef = useRef<(() => void) | null>(null);
  const isRecoveringRef = useRef(false);
  const isInitializedRef = useRef(false);
  const playerReadyRef = useRef(playerReadyProp);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackStatusSubscriptionRef = useRef<any>(null);

  const netInfo = useNetInfo();
  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  // Configure audio mode on mount
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(console.warn);
  }, []);

  useEffect(() => {
    playerReadyRef.current = playerReadyProp;
  }, [playerReadyProp]);

  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current = expand;
    collapsePlayerRef.current = collapse;
  }, []);

  const expandPlayer = useCallback(() => {
    if (expandPlayerRef.current) {
      expandPlayerRef.current();
    }
  }, []);

  const collapsePlayer = useCallback(() => {
    if (collapsePlayerRef.current) {
      collapsePlayerRef.current();
    }
  }, []);

  // Setup playback status listener
  const setupPlaybackListener = useCallback(async (sound: Audio.Sound) => {
    if (playbackStatusSubscriptionRef.current) {
      playbackStatusSubscriptionRef.current.remove();
    }
    
    playbackStatusSubscriptionRef.current = sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded) {
        setIsPlaying(status.isPlaying);
        setIsBuffering(status.isBuffering);
        setPosition(status.positionMillis / 1000);
        setDuration((status.durationMillis || 0) / 1000);
        setError(null);
        
        // Update notification when play state changes
        if (currentTrack) {
          updateNowPlayingNotification(currentTrack, status.isPlaying).catch(console.warn);
        }
      } else if (status.error) {
        log(`Playback error: ${status.error}`);
        setIsBuffering(false);
        setError(new Error(status.error));
      }
    });
  }, [currentTrack, log]);

  // Cleanup sound
  const cleanupSound = useCallback(async () => {
    if (playbackStatusSubscriptionRef.current) {
      playbackStatusSubscriptionRef.current.remove();
      playbackStatusSubscriptionRef.current = null;
    }
    if (currentSoundRef.current) {
      await currentSoundRef.current.unloadAsync();
      currentSoundRef.current = null;
    }
  }, []);

  // Load a track from queue
  const loadTrackFromQueue = useCallback(async (index: number, startPlaying: boolean = true) => {
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

      let resolvedTrack: ResolvedTrack | null;
      let audioUrl: string;
      let trackDuration: number;

      if (queueItem.isDownloaded) {
        const downloadedSong = queueItem.song as DownloadedSongMetadata;
        audioUrl = downloadedSong.localTrackUri;
        trackDuration = downloadedSong.duration || 0;
        
        setCurrentTrack({
          id: downloadedSong.id,
          title: downloadedSong.title,
          artist: downloadedSong.artist,
          thumbnail: downloadedSong.localArtworkUri || '',
          url: downloadedSong.localTrackUri,
          videoId: undefined,
        });
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
          
          // Update queue with resolved track
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
        trackDuration = resolvedTrack.duration || 0;
        setCurrentTrack(song);
        currentSongRef.current = song;
        currentSongIdRef.current = song.id;
        
        if (resolvedTrack.url) {
          saveQuickActions(resolvedTrack.url, resolvedTrack.id).catch(() => {});
        }
      }

      // Create and play sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: startPlaying, positionMillis: 0 }
      );
      
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);

      await updateNowPlayingNotification(currentTrack, startPlaying);
      
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
  }, [queue, cleanupSound, setupPlaybackListener, currentTrack, log]);

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
  useEffect(() => {
    if (!playerReadyProp) return;

    const initializeAndRestore = async () => {
      try {
        // Try to restore full queue first
        const { queue: savedQueue, currentIndex: savedIndex } = await restoreQueueState();
        
        if (savedQueue.length > 0 && savedIndex >= 0) {
          log(`Restoring queue with ${savedQueue.length} tracks at index ${savedIndex}`);
          setQueue(savedQueue);
          setCurrentQueueIndex(savedIndex);
          await loadTrackFromQueue(savedIndex, false);
        } else {
          // Fall back to single track restore
          const { track, position: savedPosition } = await restoreLastPlayingState();
          if (track && track.url) {
            log(`Restoring last playing track: ${track.title}`);
            setCurrentTrack(track);
            currentSongRef.current = track;
            currentSongIdRef.current = track.id;

            const resolvedTrack = await resolveTrack(track);
            if (resolvedTrack) {
              const { sound } = await Audio.Sound.createAsync(
                { uri: resolvedTrack.url },
                { shouldPlay: false, positionMillis: savedPosition > 5 ? savedPosition * 1000 : 0 }
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
  }, [playerReadyProp, log, setupPlaybackListener, loadTrackFromQueue]);

  // Save queue state when it changes
  useEffect(() => {
    if (queue.length > 0 && currentQueueIndex >= 0) {
      saveQueueState(queue, currentQueueIndex);
    }
  }, [queue, currentQueueIndex]);

  useEffect(() => {
    if (currentTrack) {
      saveLastPlayingState(currentTrack, position);
    }
  }, [currentTrack, position]);

  // ─── BACKGROUND PLAYLIST LOADING ───────────────────────────────────────────
  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      // Build the queue starting from the initial song
      const queueItems: QueueItem[] = [];
      
      // Add songs after the current one
      for (let i = targetIndex; i < fullPlaylist.length; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({
          song: fullPlaylist[i],
          isDownloaded: false,
        });
      }
      
      // Add songs before the current one (for wrap-around)
      for (let i = 0; i < targetIndex; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({
          song: fullPlaylist[i],
          isDownloaded: false,
        });
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
        queueItems.push({
          song: fullPlaylist[i],
          isDownloaded: true,
        });
      }
      
      for (let i = 0; i < targetIndex; i++) {
        if (abortSignal.aborted) return;
        queueItems.push({
          song: fullPlaylist[i],
          isDownloaded: true,
        });
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

      // Only add related songs if queue is empty
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
    if (goToPlayer) {
      goToPlayer();
    }

    // Cancel any background operations
    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;

    // If we have a playlist, create a queue
    if (playlist && playlist.length > 1) {
      await addPlaylistTracksInBackground(songToPlay, playlist, abortSignal);
      await loadTrackFromQueue(0, true);
    } else {
      // Single song - clear queue and just play this one
      setQueue([]);
      setCurrentQueueIndex(-1);
      
      // Resolve and play the single track
      const resolvedTrack = await resolveTrack(songToPlay);
      if (!resolvedTrack) {
        Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable.`);
        return;
      }

      await cleanupSound();
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: resolvedTrack.url },
        { shouldPlay: true }
      );
      
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);
      setCurrentTrack(songToPlay);
      currentSongRef.current = songToPlay;
      currentSongIdRef.current = songToPlay.id;
      
      await updateNowPlayingNotification(songToPlay, true);
      
      // Add up-next suggestions
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
    if (goToPlayer) {
      goToPlayer();
    }

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
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: songToPlay.localTrackUri },
        { shouldPlay: true }
      );
      
      currentSoundRef.current = sound;
      await setupPlaybackListener(sound);
      setCurrentTrack({
        id: songToPlay.id,
        title: songToPlay.title,
        artist: songToPlay.artist,
        thumbnail: songToPlay.localArtworkUri || '',
        url: songToPlay.localTrackUri,
        videoId: undefined,
      });
      currentSongRef.current = null;
      currentSongIdRef.current = songToPlay.id;
      
      await updateNowPlayingNotification({
        id: songToPlay.id,
        title: songToPlay.title,
        artist: songToPlay.artist,
        thumbnail: songToPlay.localArtworkUri || '',
        url: songToPlay.localTrackUri,
        videoId: undefined,
      }, true);
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
        // No sound loaded, try to restore from queue
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
          // Try to reload current track
          const resolvedTrack = await resolveTrack(currentTrack as Song);
          if (resolvedTrack) {
            await cleanupSound();
            const { sound } = await Audio.Sound.createAsync(
              { uri: resolvedTrack.url },
              { shouldPlay: true }
            );
            currentSoundRef.current = sound;
            await setupPlaybackListener(sound);
          }
        }
        return;
      }

      if (status.isPlaying) {
        await currentSoundRef.current.pauseAsync();
        await updateNowPlayingNotification(currentTrack, false);
        log('Paused');
      } else {
        await currentSoundRef.current.playAsync();
        await updateNowPlayingNotification(currentTrack, true);
        log('Playing');
      }
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
        // Loop back to the beginning if we're at the end
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
      // If we're more than 3 seconds in, just seek to start
      if (position > 3) {
        await seekTo(0);
        return;
      }

      // Otherwise go to previous track
      if (queue.length === 0) {
        log('No queue available for skipToPrevious');
        return;
      }

      const prevIndex = currentQueueIndex - 1;
      if (prevIndex >= 0) {
        await loadTrackFromQueue(prevIndex, true);
      } else {
        // Loop to the end if we're at the beginning
        if (queue.length > 0) {
          await loadTrackFromQueue(queue.length - 1, true);
        }
      }
    } catch (error) {
      log(`skipToPrevious error: ${error}`);
    }
  }, [position, queue, currentQueueIndex, loadTrackFromQueue, seekTo, log]);

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