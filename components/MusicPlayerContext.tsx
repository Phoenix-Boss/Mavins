// components/MusicPlayerContext.tsx
//
// CANONICAL PLAYER ENGINE — stream resolution + expo-audio playback.
//
// ARCHITECTURE:
//   • One expo-audio AudioPlayer instance lives here as the audio engine.
//   • Queue / playlist / stream-resolution logic is preserved.
//   • PlayerEngineContext (low-level) and MusicPlayerContext (high-level)
//     are both provided by MusicPlayerProvider.
//   • SystemMediaControlsBridge is rendered as a child so useSystemMediaControls()
//     consumes the populated context (not the default value).
//
// VIDEO STREAMS:
//   videoUrl / muxedVideoUrl are resolved and stored in trackExtrasStore.
//   PlayerContent's expo-video VideoView reads them via getTrackExtras().
//   The audio player here only plays the audio stream URL.
//
// EXPORTS for playerSetup.tsx re-export bridge:
//   ResolvedTrack, PlayerEngineState, TrackExtras,
//   usePlayerEngine, useMusicPlayer, getTrackExtras

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
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

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

// Lockscreen / notification bridge — mounted via SystemMediaControlsBridge
// so it consumes the populated PlayerEngineContext.
import { useSystemMediaControls } from '@/hooks/useSystemMediaControls';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase helpers
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NOT_FOUND_MSG = 'track_stats';

const safeGetTrackStats = async (videoId: string) => {
  try { return await supabaseCache.getTrackStats(videoId); }
  catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG))
      console.warn('[MusicPlayer] getTrackStats error:', e?.message);
    return null;
  }
};

const safeSaveTrackStats = async (
  params: Parameters<typeof supabaseCache.saveTrackStats>[0],
) => {
  try { await supabaseCache.saveTrackStats(params); }
  catch (e: any) {
    if (!e?.message?.includes(TABLE_NOT_FOUND_MSG))
      console.warn('[MusicPlayer] saveTrackStats error:', e?.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UUID helpers
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
      const f   = t<20?((b&c)|((~b>>>0)&d)):t<40?(b^c^d):t<60?((b&c)|(b&d)|(c&d)):(b^c^d);
      const k   = t<20?0x5A827999:t<40?0x6ED9EBA1:t<60?0x8F1BBCDC:0xCA62C1D6;
      const tmp = (rot+f+e+k+W[t])>>>0;
      e=d; d=c; c=((b<<30)|(b>>>2))>>>0; b=a; a=tmp;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0;
    H[3]=(H[3]+d)>>>0; H[4]=(H[4]+e)>>>0;
  }
  const out = new Uint8Array(20);
  H.forEach((v,i) => {
    out[i*4]=(v>>>24)&0xff; out[i*4+1]=(v>>>16)&0xff;
    out[i*4+2]=(v>>>8)&0xff; out[i*4+3]=v&0xff;
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
  hash[6] = (hash[6]&0x0f)|0x50;
  hash[8] = (hash[8]&0x3f)|0x80;
  const h = Array.from(hash.slice(0,16)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const uuid = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  _uuidCache.set(videoId, uuid);
  return uuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type { Song };

export interface TrackExtras {
  videoUrl?:     string;
  muxedVideoUrl?: string;
  videoId?:      string;
  uploaderUrl?:  string;
  likeCount?:    number;
  dislikeCount?: number;
  viewCount?:    number;
  commentsCount?: number;
}

// ResolvedTrack — canonical track type used by PlayerEngine consumers
// and re-exported through playerSetup.tsx.
// Uses `thumbnail` (matching Song) so MiniPlayer and FloatingPlayer
// read the same field name without any mapping layer.
export interface ResolvedTrack {
  id:             string;
  /** Audio stream URL — fed to expo-audio AudioPlayer */
  url:            string;
  title:          string;
  artist?:        string;
  /** Artwork URL — maps directly to Song.thumbnail */
  thumbnail?:     string;
  duration?:      number;
  videoId?:       string;
  [key: string]:  any;
}

// Internal queue entry — pairs a Song with its resolved audio URL
interface QueueEntry {
  song:     Song;
  audioUrl: string;
  duration: number;
}

const MAX_EXTRAS_CACHE = 50;
const trackExtrasStore = new Map<string, TrackExtras>();

// Reactive version counter — incremented each time storeTrackExtras is called.
// playerContent.tsx watches this to re-read getTrackExtras when data arrives.
let _trackExtrasVersion = 0;
const trackExtrasVersionListeners = new Set<() => void>();

function notifyTrackExtrasChange() {
  _trackExtrasVersion++;
  trackExtrasVersionListeners.forEach(fn => fn());
}

function storeTrackExtras(trackId: string, extras: TrackExtras): void {
  trackExtrasStore.set(trackId, extras);
  if (trackExtrasStore.size > MAX_EXTRAS_CACHE) {
    const firstKey = trackExtrasStore.keys().next().value;
    if (firstKey) trackExtrasStore.delete(firstKey);
  }
  notifyTrackExtrasChange();
}

// getTrackExtras is exported so playerContent.tsx can read videoUrl,
// muxedVideoUrl, likeCount etc. without going through context.
// Re-exported via playerSetup.tsx.
export function getTrackExtras(trackId: string | undefined | null): TrackExtras | null {
  if (!trackId) return null;
  return trackExtrasStore.get(trackId) ?? null;
}

// Subscribe to track extras changes — used by playerContent for reactivity
export function useTrackExtrasVersion(): number {
  const [version, setVersion] = useState(_trackExtrasVersion);
  useEffect(() => {
    const listener = () => setVersion(_trackExtrasVersion);
    trackExtrasVersionListeners.add(listener);
    return () => { trackExtrasVersionListeners.delete(listener); };
  }, []);
  return version;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerEngineContext — low-level playback state for UI consumers
// Re-exported via playerSetup.tsx as the canonical usePlayerEngine hook.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerEngineState {
  currentTrack: Song | null;
  isPlaying:    boolean;
  isBuffering:  boolean;
  position:     number;   // seconds
  duration:     number;   // seconds
  play:               () => void;
  pause:              () => void;
  seekTo:             (positionSec: number) => void;
  skipToNext:         () => Promise<void>;
  skipToPrevious:     () => Promise<void>;
  togglePlayPause:    () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
  expandPlayer:       () => void;
  collapsePlayer:     () => void;
}

const PlayerEngineContext = createContext<PlayerEngineState | undefined>(undefined);

export const usePlayerEngine = (): PlayerEngineState => {
  const ctx = useContext(PlayerEngineContext);
  if (!ctx) throw new Error('usePlayerEngine must be used within MusicPlayerProvider');
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// MusicPlayerContext — high-level play actions
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerContextType {
  currentTrack: Song | null;
  isPlaying:    boolean;
  isBuffering:  boolean;
  isLoading:    boolean;
  position:     number;
  duration:     number;

  playAudio:            (song: Song, playlist?: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playPlaylist:         (songs: Song[], expandPlayerFn?: () => void) => Promise<void>;
  playNext:             (songs: Song[] | null) => Promise<void>;
  playDownloadedSong:   (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[], expandPlayerFn?: () => void) => Promise<void>;
  togglePlayPause:      () => void;
  seekTo:               (position: number) => void;
  skipToNext:           () => Promise<void>;
  skipToPrevious:       () => Promise<void>;
  expandPlayer:         () => void;
  collapsePlayer:       () => void;
  setPlayerOverlayRefs: (expand: () => void, collapse: () => void) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// SystemMediaControlsBridge
//
// Rendered as a child inside PlayerEngineContext.Provider so it consumes
// the populated context (not the default value).
// ─────────────────────────────────────────────────────────────────────────────

function SystemMediaControlsBridge() {
  useSystemMediaControls();
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream cache constants
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_TTL_MS = 6 * 60 * 60 * 1000;
const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

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
// Supabase stream cache
// ─────────────────────────────────────────────────────────────────────────────

interface StreamCacheRow { stream_url: string; expiry: string; duration: number | null; }

async function getCachedAudioStream(trackId: string): Promise<{ url: string; duration: number } | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams').select('stream_url, expiry, duration')
      .eq('track_id', uuid).eq('stream_type', 'audio').eq('is_active', true)
      .gt('expiry', new Date().toISOString()).maybeSingle() as { data: StreamCacheRow | null; error: any };
    if (error || !data) return null;
    return { url: data.stream_url, duration: data.duration ?? 0 };
  } catch { return null; }
}

async function getCachedVideoStream(trackId: string): Promise<string | null> {
  try {
    const uuid = await videoIdToUuid(trackId);
    const { data, error } = await (supabase as any)
      .from('streams').select('stream_url, expiry')
      .eq('track_id', uuid).eq('stream_type', 'video').eq('is_active', true)
      .gt('expiry', new Date().toISOString()).maybeSingle() as { data: Pick<StreamCacheRow, 'stream_url'|'expiry'>|null; error: any };
    if (error || !data) return null;
    return data.stream_url;
  } catch { return null; }
}

async function invalidateStreamCache(trackId: string): Promise<void> {
  try {
    const uuid = await videoIdToUuid(trackId);
    await (supabase as any).from('streams').update({ is_active: false }).eq('track_id', uuid);
  } catch (e) { console.warn('[MusicPlayer] invalidateStreamCache error:', e); }
}

async function cacheStreamsToSupabase(
  trackId: string, audioUrl: string, videoUrl: string | null, duration: number,
): Promise<void> {
  try {
    const uuid   = await videoIdToUuid(trackId);
    const expiry = new Date(Date.now() + STREAM_TTL_MS).toISOString();
    const now    = new Date().toISOString();
    const rows = [
      { track_id: uuid, source: 'youtube', stream_url: audioUrl, stream_type: 'audio' as const,
        quality: 'high', format: 'webm', duration: Math.round(duration), expiry,
        is_active: true, health_score: 100, last_accessed: now, access_count: 1 },
      ...(videoUrl ? [{
        track_id: uuid, source: 'youtube', stream_url: videoUrl, stream_type: 'video' as const,
        quality: '720p', format: 'mp4', duration: Math.round(duration), expiry,
        is_active: true, health_score: 100, last_accessed: now, access_count: 1,
      }] : []),
    ];
    const { error } = await (supabase as any).from('streams').upsert(rows, { onConflict: 'track_id,stream_type' });
    if (error) console.warn('[MusicPlayer] stream cache write error:', error?.message);
  } catch (e) { console.warn('[MusicPlayer] cacheStreamsToSupabase error:', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Track resolution
// ─────────────────────────────────────────────────────────────────────────────

function buildExtras(
  song: Song,
  info: any,
  videoUrl: string | null,
  muxedVideoUrl: string | null,
  commentsCount: number,
): TrackExtras {
  return {
    videoUrl:      videoUrl      ?? undefined,
    muxedVideoUrl: muxedVideoUrl ?? undefined,
    videoId:       song.videoId,
    uploaderUrl:   (info.uploaderUrl as string | undefined) ?? undefined,
    likeCount:     typeof info.likeCount    === 'number' && info.likeCount    > 0 ? Math.round(info.likeCount)    : -1,
    dislikeCount:  typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
    viewCount:     typeof info.viewCount    === 'number' && info.viewCount    > 0 ? Math.round(info.viewCount)    : -1,
    commentsCount,
  };
}

const resolveTrack = async (song: Song): Promise<ResolvedTrack | null> => {
  if (!song.url) {
    console.warn(`[MusicPlayer] "${song.title}" has no URL — skipping`);
    return null;
  }

  // Try Supabase audio cache
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
            videoId:       song.videoId,
            uploaderUrl:   cached.uploaderUrl ?? undefined,
            likeCount:     cached.likeCount     > 0 ? cached.likeCount     : -1,
            dislikeCount:  cached.dislikeCount  > 0 ? cached.dislikeCount  : -1,
            viewCount:     cached.viewCount     > 0 ? cached.viewCount     : -1,
            commentsCount: (cached.commentsCount ?? -1) > 0 ? cached.commentsCount! : -1,
          };
        }
      }
      storeTrackExtras(song.id, { ...extras, videoUrl: cachedVideo ?? undefined });
      return {
        id:        song.id,
        url:       cachedAudio.url,
        title:     song.title,
        artist:    song.artist,
        thumbnail: song.thumbnail,
        duration:  cachedAudio.duration > 0 ? cachedAudio.duration : undefined,
        videoId:   extras.videoId,
      };
    }
  } catch (cacheErr) {
    console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
  }

  // Primary extraction via MavinEngine
  try {
    const info = await MavinEngine.getStreamInfo(song.url, 0);
    if (!info.success) throw new Error('extraction returned success=false');

    const bestAudio  = pickBestAudio(info.audioStreams ?? []);
    const bestVideo  = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
    const bestMuxed  = pickBestVideo(info.videoStreams ?? []);

    if (!bestAudio?.url) throw new Error('no audio stream available');

    const audioUrl      = bestAudio.url;
    const videoUrl      = bestVideo?.url  ?? null;
    const muxedVideoUrl = bestMuxed?.url  ?? null;
    const duration      = info.duration   ?? 0;

    let commentsCount = -1;
    if (song.videoId) {
      const cached = await safeGetTrackStats(song.videoId);
      if (cached != null && (cached.commentsCount ?? -1) > 0) commentsCount = cached.commentsCount!;
    }

    const extras = buildExtras(song, info, videoUrl, muxedVideoUrl, commentsCount);
    storeTrackExtras(song.id, extras);

    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});
    if (song.videoId) {
      safeSaveTrackStats({
        videoId:       song.videoId,
        likeCount:     extras.likeCount    ?? -1,
        dislikeCount:  extras.dislikeCount ?? -1,
        viewCount:     extras.viewCount    ?? -1,
        commentsCount,
        uploaderUrl:   extras.uploaderUrl ?? null,
      });

      if (commentsCount === -1) {
        const watchUrl = `https://www.youtube.com/watch?v=${song.videoId}`;
        MavinEngine.getComments(watchUrl, undefined, 0)
          .then((ci: any) => {
            if (ci?.success && typeof ci.commentsCount === 'number' && ci.commentsCount > 0) {
              const stored = trackExtrasStore.get(song.id);
              if (stored) trackExtrasStore.set(song.id, { ...stored, commentsCount: ci.commentsCount });
              supabaseCache.patchCommentsCount(song.videoId!, ci.commentsCount).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    return {
      id:        song.id,
      url:       audioUrl,
      title:     info.title ?? song.title,
      artist:    song.artist,
      thumbnail: song.thumbnail,
      duration:  duration > 0 ? duration : undefined,
      videoId:   song.videoId,
    };
  } catch (primaryErr) {
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, primaryErr);
  }

  // Fallback: getStreamInfoById
  if (song.videoId) {
    try {
      const info = await MavinEngine.getStreamInfoById(song.videoId, 0);
      if (info.success) {
        const bestAudio  = pickBestAudio(info.audioStreams ?? []);
        const bestVideo  = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
        const bestMuxed  = pickBestVideo(info.videoStreams ?? []);
        if (bestAudio?.url) {
          const audioUrl      = bestAudio.url;
          const videoUrl      = bestVideo?.url ?? null;
          const muxedVideoUrl = bestMuxed?.url ?? null;
          const duration      = info.duration  ?? 0;
          const extras        = buildExtras(song, info, videoUrl, muxedVideoUrl, -1);
          storeTrackExtras(song.id, extras);
          cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});
          safeSaveTrackStats({
            videoId:       song.videoId,
            likeCount:     extras.likeCount    ?? -1,
            dislikeCount:  extras.dislikeCount ?? -1,
            viewCount:     extras.viewCount    ?? -1,
            commentsCount: -1,
            uploaderUrl:   extras.uploaderUrl ?? null,
          });
          return {
            id:        song.id,
            url:       audioUrl,
            title:     info.title ?? song.title,
            artist:    song.artist,
            thumbnail: song.thumbnail,
            duration:  duration > 0 ? duration : undefined,
            videoId:   song.videoId,
          };
        }
      }
    } catch (byIdErr) {
      console.warn(`[MusicPlayer] getStreamInfoById failed for "${song.title}":`, byIdErr);
    }
  }

  // Fallback: search
  const searchStrategies = [
    { query: `${song.title} ${song.artist} official audio`, filter: 'videos' },
    { query: `${song.title} ${song.artist}`, filter: '' },
    { query: `${song.title} official audio`, filter: 'videos' },
  ];
  for (const strategy of searchStrategies) {
    try {
      const searchResult = await MavinEngine.search(strategy.query, strategy.filter, undefined, 0);
      const firstStream  = searchResult?.results?.find(
        (i): i is StreamInfoItem => i.type === 'stream' && !i.isLive && !i.isShortFormContent,
      );
      if (!firstStream?.url) continue;

      const info = await MavinEngine.getStreamInfo(firstStream.url, 0);
      if (!info.success) continue;

      const bestAudio  = pickBestAudio(info.audioStreams ?? []);
      const bestVideo  = pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? []);
      const bestMuxed  = pickBestVideo(info.videoStreams ?? []);
      if (!bestAudio?.url) continue;

      const audioUrl      = bestAudio.url;
      const videoUrl      = bestVideo?.url ?? null;
      const muxedVideoUrl = bestMuxed?.url ?? null;
      const duration      = info.duration  ?? 0;
      const extras        = buildExtras(song, info, videoUrl, muxedVideoUrl, -1);
      storeTrackExtras(song.id, extras);
      cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});

      return {
        id:        song.id,
        url:       audioUrl,
        title:     info.title ?? song.title,
        artist:    song.artist,
        thumbnail: song.thumbnail,
        duration:  duration > 0 ? duration : undefined,
        videoId:   song.videoId,
      };
    } catch (searchErr) {
      console.warn(`[MusicPlayer] search strategy failed:`, searchErr);
    }
  }

  console.warn(`[MusicPlayer] all strategies exhausted for "${song.title}"`);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Related songs / quick actions
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
          id:        videoId ?? s.url,
          title:     s.name,
          artist:    s.uploaderName,
          thumbnail: s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url ?? s.thumbnails[0]?.url ?? '',
          url:       s.url,
          videoId:   videoId ?? undefined,
        };
      });
  } catch { return []; }
};

const saveQuickActions = async (songUrl: string, sourceSongId: string): Promise<void> => {
  if (!songUrl) return;
  try {
    const relatedSongs = await fetchRelatedSongs(songUrl);
    if (!relatedSongs.length) return;

    const { data: existing } = await supabase.from('user_quick_actions').select('track_id').limit(100);
    const existingIds = new Set(existing?.map((e: any) => e.track_id) || []);

    let insertedCount = 0;
    for (const song of relatedSongs.slice(0, 20)) {
      if (!existingIds.has(song.id)) {
        const { error } = await supabase.from('user_quick_actions').insert({
          track_id: song.id, title: song.title, artist: song.artist,
          thumbnail: song.thumbnail, video_id: song.videoId, url: song.url,
          duration: song.duration, source_song_id: sourceSongId,
          played_at: new Date().toISOString(),
        } as any);
        if (!error) insertedCount++;
      }
    }

    const { data: updated } = await supabase
      .from('user_quick_actions').select('*')
      .order('played_at', { ascending: false }).limit(30);

    if (updated?.length) {
      const quickSongs = updated.map((item: any) => ({
        id: item.track_id, videoId: item.video_id, title: item.title, artist: item.artist,
        thumbnail: item.thumbnail, url: item.url, duration: item.duration,
        playedAt: new Date(item.played_at).getTime(),
      }));
      useHomeStore.getState().setRecentSongs([...quickSongs].sort(() => Math.random() - 0.5));
    }
  } catch (error) {
    console.error('[MusicPlayer] Failed to save quick actions:', error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// State restoration helpers
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  LAST_PLAYING_TRACK:    'last_playing_track',
  LAST_PLAYING_POSITION: 'last_playing_position',
};

async function saveLastPlayingState(track: Song | null, position?: number): Promise<void> {
  try {
    if (track) {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_TRACK, JSON.stringify(track));
      if (position !== undefined)
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_PLAYING_POSITION, String(position));
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.LAST_PLAYING_TRACK);
      await AsyncStorage.removeItem(STORAGE_KEYS.LAST_PLAYING_POSITION);
    }
  } catch (error) { console.warn('[MusicPlayer] Failed to save last playing state:', error); }
}

async function restoreLastPlayingState(): Promise<{ track: Song | null; position: number }> {
  try {
    const trackJson   = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_TRACK);
    const positionStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_PLAYING_POSITION);
    return { track: trackJson ? JSON.parse(trackJson) : null, position: positionStr ? parseFloat(positionStr) : 0 };
  } catch { return { track: null, position: 0 }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerProviderProps {
  children: ReactNode;
}

export const MusicPlayerProvider: React.FC<MusicPlayerProviderProps> = ({ children }) => {
  // ── expo-audio player — single instance, lives for the app lifetime ────────
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  // ── Queue management ──────────────────────────────────────────────────────
  const queueRef         = useRef<QueueEntry[]>([]);
  const queueIndexRef    = useRef<number>(-1);

  // ── State ─────────────────────────────────────────────────────────────────
  const [currentTrack,       setCurrentTrack]       = useState<Song | null>(null);
  const [isLoading,          setIsLoading]          = useState(false);
  const [optimisticPlaying,  setOptimisticPlaying]  = useState<boolean | null>(null);

  const currentSongRef       = useRef<Song | null>(null);
  const currentSongIdRef     = useRef<string | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const expandPlayerRef      = useRef<(() => void) | null>(null);
  const collapsePlayerRef    = useRef<(() => void) | null>(null);
  const isRecoveringRef      = useRef(false);
  const isInitializedRef     = useRef(false);

  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  // ── Derived playback flags from expo-audio status ─────────────────────────
  const nativeIsPlaying = status?.playing    ?? false;
  const isPlaying       = optimisticPlaying !== null ? optimisticPlaying : nativeIsPlaying;
  const isBuffering     = status?.isBuffering ?? false;

  // Collapse optimistic flag once native state catches up
  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === nativeIsPlaying) setOptimisticPlaying(null);
  }, [nativeIsPlaying, optimisticPlaying]);

  // ── Position / duration from expo-audio status ────────────────────────────
  const position = status?.currentTime ?? 0;
  const duration = status?.duration    ?? 0;

  // ── Persist last-playing state on position change ─────────────────────────
  useEffect(() => {
    if (currentTrack) saveLastPlayingState(currentTrack, position);
  }, [currentTrack, position]);

  // ── Handle track ending — auto-advance queue ──────────────────────────────
  useEffect(() => {
    if (status?.didJustFinish) {
      advanceQueue();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.didJustFinish]);

  // ── Overlay refs ──────────────────────────────────────────────────────────
  const setPlayerOverlayRefs = useCallback((expand: () => void, collapse: () => void) => {
    expandPlayerRef.current  = expand;
    collapsePlayerRef.current = collapse;
  }, []);
  const expandPlayer  = useCallback(() => expandPlayerRef.current?.(),  []);
  const collapsePlayer = useCallback(() => collapsePlayerRef.current?.(), []);

  // ── Load + play a resolved audio URL ─────────────────────────────────────
  const loadAndPlay = useCallback(async (track: ResolvedTrack, song: Song) => {
    log(`Loading: "${track.title}" → ${track.url.slice(0, 60)}…`);
    setCurrentTrack(song);
    currentSongRef.current   = song;
    currentSongIdRef.current = song.id;
    saveLastPlayingState(song, 0);
    player.replace({ uri: track.url });
    player.play();
    setOptimisticPlaying(true);
    log(`Now playing: "${track.title}"`);
  }, [player, log]);

  // ── Queue advance ─────────────────────────────────────────────────────────
  const advanceQueue = useCallback(async () => {
    const nextIndex = queueIndexRef.current + 1;
    if (nextIndex >= queueRef.current.length) {
      log('Queue exhausted');
      return;
    }
    queueIndexRef.current = nextIndex;
    const entry = queueRef.current[nextIndex];

    log(`Auto-advancing to #${nextIndex}: "${entry.song.title}"`);
    if (entry.audioUrl) {
      const resolvedTrack: ResolvedTrack = {
        id:        entry.song.id,
        url:       entry.audioUrl,
        title:     entry.song.title,
        artist:    entry.song.artist,
        thumbnail: entry.song.thumbnail,
        duration:  entry.duration,
        videoId:   entry.song.videoId,
      };
      await loadAndPlay(resolvedTrack, entry.song);
    } else {
      const resolved = await resolveTrack(entry.song);
      if (resolved) await loadAndPlay(resolved, entry.song);
    }
  }, [loadAndPlay, log]);

  // ── App-resume → restore last track (paused) ─────────────────────────────
  useEffect(() => {
    const initializeAndRestore = async () => {
      const { track, position: savedPos } = await restoreLastPlayingState();
      if (!track) { isInitializedRef.current = true; return; }

      log(`Restoring last playing track: ${track.title}`);
      setCurrentTrack(track);
      currentSongRef.current   = track;
      currentSongIdRef.current = track.id;

      const resolved = await resolveTrack(track);
      if (resolved) {
        player.replace({ uri: resolved.url });
        if (savedPos > 5) player.seekTo(savedPos);
        player.pause();
      }
      isInitializedRef.current = true;
    };

    initializeAndRestore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── App-state change: auto-expand if track is playing when foregrounded ───
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && isInitializedRef.current) {
        if (nativeIsPlaying && currentTrack && expandPlayerRef.current) {
          log('App resumed with active track — auto-expanding player');
          setTimeout(() => expandPlayer(), 100);
        }
      }
    });
    return () => sub.remove();
  }, [nativeIsPlaying, currentTrack, expandPlayer, log]);

  // ── Background playlist loader ────────────────────────────────────────────
  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId   = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const enqueueOne = async (song: Song): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track = await resolveTrack(song);
          if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
          if (!track) return true;
          storeTrackExtras(track.id, getTrackExtras(track.id) ?? {});
          queueRef.current.push({ song, audioUrl: track.url, duration: track.duration ?? 0 });
          log(`BG Queue: added "${track.title}"`);
        } catch (e) { log(`BG Queue error on "${song.title}": ${e}`); }
        return true;
      };

      const songsAfter  = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex).reverse();
      for (const s of songsAfter)  { if (!(await enqueueOne(s))) return; await delay(150); }
      for (const s of songsBefore) { if (!(await enqueueOne(s))) return; await delay(150); }
    },
    [log],
  );

  const addUpNextSongs = useCallback(
    async (song: Song, abortSignal: AbortSignal) => {
      if (!song.url) return;
      const songId  = song.id;
      const related = await fetchRelatedSongs(song.url);
      if (abortSignal.aborted || currentSongIdRef.current !== songId) return;

      for (const relSong of related.slice(0, 5)) {
        if (abortSignal.aborted || currentSongIdRef.current !== songId) return;
        const track = await resolveTrack(relSong);
        if (!track) continue;
        queueRef.current.push({ song: relSong, audioUrl: track.url, duration: track.duration ?? 0 });
        await delay(200);
      }
    },
    [log],
  );

  // ── Core play function ────────────────────────────────────────────────────
  const playAudio = useCallback(async (
    songToPlay: Song,
    playlist?: Song[],
    expandPlayerFn?: () => void,
  ) => {
    if (!songToPlay.url) {
      Alert.alert('Not Available', `"${songToPlay.title}" is not available.`);
      return;
    }

    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    if (goToPlayer) {
      goToPlayer();
    } else {
      log('ERROR: expandPlayer not registered');
      return;
    }

    queueRef.current      = [];
    queueIndexRef.current = 0;

    setIsLoading(true);
    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;
    isRecoveringRef.current = false;

    try {
      log(`Play: "${songToPlay.title}"`);

      const cached = await getCachedAudioStream(songToPlay.id);

      if (cached) {
        const resolvedTrack: ResolvedTrack = {
          id:        songToPlay.id,
          url:       cached.url,
          title:     songToPlay.title,
          artist:    songToPlay.artist,
          thumbnail: songToPlay.thumbnail,
          duration:  cached.duration,
          videoId:   songToPlay.videoId,
        };
        queueRef.current.push({ song: songToPlay, audioUrl: cached.url, duration: cached.duration });
        await loadAndPlay(resolvedTrack, songToPlay);
        saveQuickActions(songToPlay.url, songToPlay.id).catch(() => {});
      } else {
        const track = await resolveTrack(songToPlay);
        if (abortSignal.aborted) { setIsLoading(false); return; }
        if (!track) {
          Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable.`);
          setIsLoading(false);
          return;
        }
        queueRef.current.push({ song: songToPlay, audioUrl: track.url, duration: track.duration ?? 0 });
        await loadAndPlay(track, songToPlay);
        if (track.url) saveQuickActions(track.url, track.id).catch(() => {});
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
  }, [loadAndPlay, addPlaylistTracksInBackground, addUpNextSongs, log]);

  const playPlaylist = useCallback(async (songs: Song[], expandPlayerFn?: () => void) => {
    if (!songs?.length) { Alert.alert('Playback Error', 'Playlist is empty.'); return; }
    await playAudio(songs[0], songs, expandPlayerFn);
  }, [playAudio]);

  const playNext = useCallback(async (songsToAdd: Song[] | null) => {
    if (!songsToAdd?.length) return;
    for (const song of songsToAdd) {
      if (song.id === currentSongIdRef.current) continue;
      const track = await resolveTrack(song);
      if (!track) continue;
      const insertAt = queueIndexRef.current + 1;
      queueRef.current.splice(insertAt, 0, { song, audioUrl: track.url, duration: track.duration ?? 0 });
    }
  }, []);

  const playDownloadedSong = useCallback(async (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => {
    const goToPlayer = expandPlayerFn ?? expandPlayerRef.current;
    goToPlayer?.();

    setIsLoading(true);
    bgAbortControllerRef.current?.abort();
    bgAbortControllerRef.current = new AbortController();
    const abortSignal = bgAbortControllerRef.current.signal;

    queueRef.current      = [];
    queueIndexRef.current = 0;

    try {
      const song: Song = {
        id:        songToPlay.id,
        title:     songToPlay.title,
        artist:    songToPlay.artist,
        thumbnail: songToPlay.localArtworkUri ?? '',
        url:       songToPlay.localTrackUri,
        duration:  songToPlay.duration,
      };

      const resolvedTrack: ResolvedTrack = {
        id:        songToPlay.id,
        url:       songToPlay.localTrackUri,
        title:     songToPlay.title,
        artist:    songToPlay.artist,
        thumbnail: songToPlay.localArtworkUri,
        duration:  songToPlay.duration,
      };

      queueRef.current.push({ song, audioUrl: songToPlay.localTrackUri, duration: songToPlay.duration ?? 0 });
      await loadAndPlay(resolvedTrack, song);

      if (abortSignal.aborted) { setIsLoading(false); return; }

      if (playlist?.length) {
        for (const ds of playlist.slice(1)) {
          if (abortSignal.aborted) break;
          queueRef.current.push({
            song:     { id: ds.id, title: ds.title, artist: ds.artist, thumbnail: ds.localArtworkUri ?? '', url: ds.localTrackUri, duration: ds.duration },
            audioUrl: ds.localTrackUri,
            duration: ds.duration ?? 0,
          });
          await delay(30);
        }
      }
    } catch (error) {
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  }, [loadAndPlay]);

  const playAllDownloadedSongs = useCallback(async (
    songs: DownloadedSongMetadata[],
    expandPlayerFn?: () => void,
  ) => {
    if (!songs?.length) { Alert.alert('Playback Error', 'No downloaded songs found.'); return; }
    await playDownloadedSong(songs[0], songs, expandPlayerFn);
  }, [playDownloadedSong]);

  // ── Playback controls ─────────────────────────────────────────────────────
  const togglePlayPause = useCallback(() => {
    if (!currentTrack) { Alert.alert('Nothing to Play', 'Please select a song first.'); return; }
    const willBePlaying = !isPlaying;
    setOptimisticPlaying(willBePlaying);
    if (isPlaying) { player.pause(); log('Paused'); }
    else            { player.play();  log('Playing'); }
  }, [isPlaying, currentTrack, player, log]);

  const seekTo = useCallback((positionSec: number) => {
    try { player.seekTo(positionSec); }
    catch (e) { log(`seekTo error: ${e}`); }
  }, [player, log]);

  const skipToNext = useCallback(async () => {
    try { await advanceQueue(); }
    catch (e) { log(`skipToNext error: ${e}`); }
  }, [advanceQueue, log]);

  const skipToPrevious = useCallback(async () => {
    try {
      if (position > 3) {
        player.seekTo(0);
        return;
      }
      const prevIndex = queueIndexRef.current - 1;
      if (prevIndex < 0) { player.seekTo(0); return; }
      queueIndexRef.current = prevIndex;
      const entry = queueRef.current[prevIndex];
      const resolvedTrack: ResolvedTrack = {
        id:        entry.song.id,
        url:       entry.audioUrl,
        title:     entry.song.title,
        artist:    entry.song.artist,
        thumbnail: entry.song.thumbnail,
        duration:  entry.duration,
        videoId:   entry.song.videoId,
      };
      await loadAndPlay(resolvedTrack, entry.song);
    } catch (e) { log(`skipToPrevious error: ${e}`); }
  }, [player, position, loadAndPlay, log]);

  // ── Engine context value (low-level, for MiniPlayer / FloatingPlayer /
  //    PlayerContent / SystemMediaControlsBridge) ──────────────────────────
  const engineValue: PlayerEngineState = {
    currentTrack,
    isPlaying,
    isBuffering,
    position,
    duration,
    play:               () => { setOptimisticPlaying(true);  player.play();  },
    pause:              () => { setOptimisticPlaying(false); player.pause(); },
    seekTo,
    skipToNext,
    skipToPrevious,
    togglePlayPause,
    expandPlayer,
    collapsePlayer,
    setPlayerOverlayRefs,
  };

  // ── High-level context value ──────────────────────────────────────────────
  const musicPlayerValue: MusicPlayerContextType = {
    currentTrack,
    isPlaying,
    isBuffering,
    isLoading,
    position,
    duration,
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
    <PlayerEngineContext.Provider value={engineValue}>
      <MusicPlayerContext.Provider value={musicPlayerValue}>
        <SystemMediaControlsBridge />
        {children}
      </MusicPlayerContext.Provider>
    </PlayerEngineContext.Provider>
  );
};