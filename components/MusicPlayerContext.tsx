/**
 * MusicPlayerContext
 *
 * Provides audio/video stream resolution and playback management.
 * Built on react-native-track-player + MavinEngine (NewPipe v0.26.0).
 *
 * ── v10.1.0 architecture alignment ──────────────────────────────────────────
 *
 * [A] resolveTrack error handling — still correct from v10.0.0:
 *     Fallback strategies (getStreamInfoById, search) are tried unconditionally
 *     on ANY extraction failure — not keyed to specific error message strings.
 *     The underlying infrastructure errors (consent, Content-Type, visitorData)
 *     are now resolved at the Kotlin Downloader level:
 *       - SOCS consent cookie → getCookieHeader() per-request in execute()
 *         (official v0.26.0 Javadoc method; replaces the broken CookieJar /
 *         Cookie.Builder approach that threw IllegalArgumentException on init)
 *       - InnerTube POST 400/415 → Content-Type is "application/json"
 *       - visitorData → prefetched on background thread at init
 *
 * [B] getCookieHeader() injection pattern (v10.1.0 fix):
 *     YoutubeParsingHelper.getCookieHeader() is called in MavinDownloader.execute()
 *     BEFORE forwarding extractor headers, and only when the extractor has not
 *     already provided a Cookie header. This is the official TeamNewPipe pattern
 *     (DownloaderImpl PR #11969, merged Jan 31 2025).
 *     The old SimpleCookieJar / Cookie.Builder approach is completely removed —
 *     it crashed at init with: IllegalArgumentException: unexpected domain: .youtube.com
 *
 * [C] Stream field mapping corrected:
 *     StreamInfo.title field is "title" not "name" — confirmed against the
 *     MavinEngine.ts StreamInfo interface (info.title, not info.name).
 *
 * [D] fetchRelatedSongs: relatedItems items use item.name (StreamInfoItem.name)
 *     not item.title — confirmed against the MavinEngine.ts StreamInfoItem
 *     interface. StreamInfoItem is an InfoItem with type "stream"; it inherits
 *     `name` from the NewPipe InfoItem base class.
 *     videoId extraction handles both ?v= and youtu.be/ URL formats.
 *
 * [E] search() filter corrected:
 *     'videos' is the correct NewPipe filter token for standard video results.
 *     '' (empty string) means no filter (all content types).
 *     'all' is not a valid NewPipe token — never used here.
 *
 * ── Original design (retained) ───────────────────────────────────────────────
 *
 * 1. resolveTrack 3-step strategy:
 *    a. Check Supabase streams table (audio + video) for a cached non-expired URL
 *    b. Hit → use directly, skip engine call
 *    c. Miss → call MavinEngine.getStreamInfo() for both streams in one call
 *    d. Pick best audio (highest bitrate, direct URL) + best video (720p DASH preferred)
 *    e. Fire-and-forget: write both streams to Supabase streams table
 *    f. Return Track with videoUrl as a custom field RNTP ignores
 *
 * 2. Track.videoUrl carries the video stream URL so PlayerScreen can read it
 *    via useActiveTrack() for the audio/video toggle without extra state.
 *
 * 3. Tracks with url === '' return null and are skipped with a user-facing alert.
 *
 * 4. Song type imported from @/types/song (shared canonical definition).
 */

import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  useRef,
  useCallback,
} from 'react';
import MavinEngine, {
  StreamInfoItem,
  AudioStream,
  VideoStream,
} from '@/modules/mavin-engine';
import TrackPlayer, { State, Track } from 'react-native-track-player';
import { Alert } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { DownloadedSongMetadata } from '@/store/library';
import { supabase } from '@/libs/supabase';
import { supabaseCache } from '@/libs/cache/supabase-cache';
import type { Song } from '@/types/song';

// Re-export Song so callers that currently import it from here continue to work
export type { Song };

// ─────────────────────────────────────────────────────────────────────────────
// Context type
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerContextType {
  isPlaying:              boolean;
  isLoading:              boolean;
  playAudio:              (songToPlay: Song, playlist?: Song[]) => Promise<void>;
  playPlaylist:           (songs: Song[]) => Promise<void>;
  playNext:               (songs: Song[] | null) => Promise<void>;
  playDownloadedSong:     (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[]) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[]) => Promise<void>;
  togglePlayPause:        () => Promise<void>;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Stream URL expiry — YouTube signed URLs last ~6 hours
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pick the best audio stream: highest bitrate, prefer direct URL over manifest.
 *
 * Per NewPipe v0.26.0:
 *   audioStreams = audio-only streams, no video.
 *   isUrl === true means a direct playable URL (not a DASH/HLS manifest pointer).
 *   getBitrate() returns Int.
 */
function pickBestAudio(streams: AudioStream[]): AudioStream | null {
  if (!streams?.length) return null;
  const direct = streams.filter(s => s.isUrl && !s.manifestUrl);
  const pool   = direct.length ? direct : streams;
  return pool.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), pool[0]);
}

/**
 * Pick the best video stream from the given list.
 *
 * Per NewPipe v0.26.0 javadoc:
 *   videoOnlyStreams = ADAPTIVE_FORMATS = DASH, NO embedded audio, HD (720p/1080p)
 *   videoStreams     = FORMATS          = muxed WITH audio, typically ≤480p on YouTube
 *
 * Callers should pass videoOnlyStreams first, fall back to videoStreams:
 *   pickBestVideo(info.videoOnlyStreams) ?? pickBestVideo(info.videoStreams)
 *
 * Excludes height === 0 entries (audio-only rows that sometimes appear in the list).
 * Prefers exactly 720p — best balance of quality vs bandwidth for the video panel.
 */
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

/**
 * Check the streams table for a cached, active, non-expired audio URL.
 */
async function getCachedAudioStream(trackId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('streams')
      .select('stream_url, expiry')
      .eq('track_id', trackId)
      .eq('stream_type', 'audio')
      .eq('is_active', true)
      .gt('expiry', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return data.stream_url;
  } catch {
    return null;
  }
}

/**
 * Check the streams table for a cached, active, non-expired video URL.
 */
async function getCachedVideoStream(trackId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('streams')
      .select('stream_url, expiry')
      .eq('track_id', trackId)
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

/**
 * Write both audio and video stream URLs to the streams table.
 * Fire-and-forget — never awaited on the critical path.
 * Uses upsert on (track_id, stream_type) unique constraint.
 */
async function cacheStreamsToSupabase(
  trackId:  string,
  audioUrl: string,
  videoUrl: string | null,
  duration: number,
): Promise<void> {
  try {
    const expiry = new Date(Date.now() + STREAM_TTL_MS).toISOString();
    const now    = new Date().toISOString();

    const rows: any[] = [
      {
        track_id:      trackId,
        source:        'youtube',
        stream_url:    audioUrl,
        stream_type:   'audio',
        quality:       'high',
        format:        'webm',
        duration:      Math.round(duration),
        expiry,
        is_active:     true,
        health_score:  100,
        last_accessed: now,
        access_count:  1,
      },
    ];

    if (videoUrl) {
      rows.push({
        track_id:      trackId,
        source:        'youtube',
        stream_url:    videoUrl,
        stream_type:   'video',
        quality:       '720p',
        format:        'mp4',
        duration:      Math.round(duration),
        expiry,
        is_active:     true,
        health_score:  100,
        last_accessed: now,
        access_count:  1,
      });
    }

    const { error } = await supabase
      .from('streams')
      .upsert(rows, { onConflict: 'track_id,stream_type' });

    if (error) {
      console.warn('[MusicPlayer] stream cache write error:', error.message);
    } else {
      console.log(`[MusicPlayer] cached streams for track ${trackId}`);
    }
  } catch (e) {
    console.warn('[MusicPlayer] cacheStreamsToSupabase error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildTrack — shared shape for all resolveTrack return paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extra fields stored on the RNTP Track object.
 * RNTP ignores unknown fields; PlayerScreen reads them via useActiveTrack().
 */
export interface TrackExtras {
  videoUrl?:      string;   // DASH video stream URL for the video toggle
  videoId?:       string;   // bare 11-char YouTube ID for artist page routing
  uploaderUrl?:   string;   // YouTube channel URL for artist page routing
  likeCount?:     number;   // -1 = hidden/unavailable
  dislikeCount?:  number;   // -1 = hidden/unavailable
  viewCount?:     number;   // -1 = unavailable
  commentsCount?: number;   // -1 = disabled/unavailable
}

function buildTrack(
  song:     Song,
  audioUrl: string,
  videoUrl: string | null,
  duration: number,
  title?:   string,
  extras?:  Omit<TrackExtras, 'videoUrl'>,
): Track & TrackExtras {
  return {
    id:       song.id,
    url:      audioUrl,
    title:    title || song.title,
    artist:   song.artist,
    artwork:  song.thumbnail,
    duration: duration > 0 ? duration : undefined,
    videoUrl: videoUrl ?? undefined,
    videoId:        extras?.videoId       ?? song.videoId,
    uploaderUrl:    extras?.uploaderUrl   ?? undefined,
    likeCount:      extras?.likeCount     ?? -1,
    dislikeCount:   extras?.dislikeCount  ?? -1,
    viewCount:      extras?.viewCount     ?? -1,
    commentsCount:  extras?.commentsCount ?? -1,
  } as Track & TrackExtras;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTrack
//
// Strategy:
//   1. No URL → return null immediately (no video_id in DB)
//   2. Check Supabase streams table — use cached audio+video if fresh
//   3. Extract via MavinEngine.getStreamInfo() (Android/iOS client, fix [B])
//   4. On any failure → try getStreamInfoById() then 3 search strategies
//   5. Fire-and-forget write to streams table on every successful extraction
// ─────────────────────────────────────────────────────────────────────────────

const resolveTrack = async (song: Song): Promise<Track | null> => {
  // Guard: no YouTube URL means nothing to extract
  if (!song.url) {
    console.warn(`[MusicPlayer] "${song.title}" has no URL — skipping`);
    return null;
  }

  // ── Step 1: Supabase stream cache ──────────────────────────────────────────
  try {
    const [cachedAudio, cachedVideo] = await Promise.all([
      getCachedAudioStream(song.id),
      getCachedVideoStream(song.id),
    ]);

    if (cachedAudio) {
      console.log(`[MusicPlayer] cache hit for "${song.title}"`);
      return buildTrack(song, cachedAudio, cachedVideo, 0);
    }
  } catch (cacheErr) {
    // Cache read failure is non-fatal — fall through to live extraction
    console.warn(`[MusicPlayer] cache read error for "${song.title}":`, cacheErr);
  }

  // ── Step 2: Primary extraction — getStreamInfo ─────────────────────────────
  //
  // [B] serviceId 0 → MavinEngineModule.kt uses getDefaultService() which
  // routes to the YouTube Android/iOS client (not WEB). This is the v0.26.0
  // SABR fix that ensures audioStreams/videoStreams are populated.
  try {
    console.log(`[MusicPlayer] extracting streams for "${song.title}"...`);
    const info = await MavinEngine.getStreamInfo(song.url, 0);

    if (!info.success) {
      console.warn(`[MusicPlayer] getStreamInfo returned success=false for "${song.title}"`);
      throw new Error('extraction returned success=false');
    }

    // audioStreams = audio-only (no video), pick highest bitrate
    const bestAudio = pickBestAudio(info.audioStreams ?? []);

    // videoOnlyStreams = DASH HD (no embedded audio) — preferred
    // videoStreams     = muxed SD (audio + video)    — fallback
    const bestVideo =
      pickBestVideo(info.videoOnlyStreams ?? []) ??
      pickBestVideo(info.videoStreams ?? []);

    if (!bestAudio?.url) {
      console.warn(`[MusicPlayer] no usable audio stream for "${song.title}"`);
      throw new Error('no audio stream available');
    }

    const audioUrl = bestAudio.url;
    const videoUrl = bestVideo?.url ?? null;
    const duration = info.duration ?? 0;

    // ── Stats: check Supabase cache first, then use extraction result ──────────
    // getStreamInfo already returned likeCount / dislikeCount / viewCount / uploaderUrl
    // for free — store them now so the player screen gets them instantly on the
    // next play without any extra network call.
    const extractedStats = {
      likeCount:    typeof info.likeCount    === 'number' && info.likeCount    > 0 ? Math.round(info.likeCount)    : -1,
      dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
      viewCount:    typeof info.viewCount    === 'number' && info.viewCount    > 0 ? Math.round(info.viewCount)    : -1,
      uploaderUrl:  (info.uploaderUrl as string | undefined) ?? null,
    };

    // Check Supabase for a fresh cached commentsCount (avoids getComments call
    // when the DB already has it from a recent play).
    let commentsCount = -1;
    if (song.videoId) {
      const cached = await supabaseCache.getTrackStats(song.videoId).catch(() => null);
      if (cached && cached.commentsCount > 0) {
        commentsCount = cached.commentsCount;
        console.log(`[MusicPlayer] commentsCount from cache: ${commentsCount}`);
      }
    }

    const extras: Omit<TrackExtras, 'videoUrl'> = {
      videoId:       song.videoId,
      uploaderUrl:   extractedStats.uploaderUrl ?? undefined,
      likeCount:     extractedStats.likeCount,
      dislikeCount:  extractedStats.dislikeCount,
      viewCount:     extractedStats.viewCount,
      commentsCount,
    };

    // Fire-and-forget — never block playback on a cache write
    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(
      e => console.warn('[MusicPlayer] bg cache error:', e),
    );

    // Save stats to Supabase track_stats table (fire-and-forget)
    if (song.videoId) {
      supabaseCache.saveTrackStats({
        videoId:       song.videoId,
        likeCount:     extractedStats.likeCount,
        dislikeCount:  extractedStats.dislikeCount,
        viewCount:     extractedStats.viewCount,
        commentsCount,
        uploaderUrl:   extractedStats.uploaderUrl,
      }).catch(e => console.warn('[MusicPlayer] saveTrackStats error:', e));

      // Fetch commentsCount in background only if not already cached
      if (commentsCount === -1) {
        const watchUrl = `https://www.youtube.com/watch?v=${song.videoId}`;
        MavinEngine.getComments(watchUrl, null, 0)
          .then((commentsInfo: any) => {
            if (commentsInfo?.success && typeof commentsInfo.commentsCount === 'number' && commentsInfo.commentsCount > 0) {
              extras.commentsCount = commentsInfo.commentsCount;
              // Patch just the commentsCount — no need to re-upsert everything
              supabaseCache.patchCommentsCount(song.videoId!, commentsInfo.commentsCount)
                .catch(() => {});
            }
          })
          .catch(() => { /* non-critical */ });
      }
    }

    console.log(`[MusicPlayer] resolved "${song.title}" — audio: ${bestAudio.bitrate}bps, video: ${bestVideo?.height ?? 'none'}p`);
    return buildTrack(song, audioUrl, videoUrl, duration, info.title, extras);

  } catch (primaryErr) {
    // [A] In v10.0.0, consent/Content-Type/visitorData errors no longer reach
    // here — they are resolved inside MavinDownloader. Any error that does
    // reach here is a genuine extraction failure (geo-block, age restriction,
    // video unavailable, etc.) and warrants trying alternative strategies.
    console.warn(`[MusicPlayer] primary extraction failed for "${song.title}":`, primaryErr);
  }

  // ── Step 3: Fallback A — getStreamInfoById ─────────────────────────────────
  //
  // Uses service.streamLHFactory.fromId(videoId) — a different code path
  // from fromUrl(). Sometimes succeeds when getStreamInfo(url) fails because
  // the ID-based handler skips URL normalisation edge cases.
  if (song.videoId) {
    try {
      console.log(`[MusicPlayer] trying getStreamInfoById("${song.videoId}") for "${song.title}"...`);
      const info = await MavinEngine.getStreamInfoById(song.videoId, 0);

      if (info.success) {
        const bestAudio = pickBestAudio(info.audioStreams ?? []);
        const bestVideo =
          pickBestVideo(info.videoOnlyStreams ?? []) ??
          pickBestVideo(info.videoStreams ?? []);

        if (bestAudio?.url) {
          const audioUrl = bestAudio.url;
          const videoUrl = bestVideo?.url ?? null;
          const duration = info.duration ?? 0;
          cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});
          const fbExtras: Omit<TrackExtras, 'videoUrl'> = {
            videoId:      song.videoId,
            uploaderUrl:  (info.uploaderUrl as string | undefined) ?? undefined,
            likeCount:    typeof info.likeCount    === 'number' && info.likeCount    > 0 ? Math.round(info.likeCount)    : -1,
            dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
            viewCount:    typeof info.viewCount    === 'number' && info.viewCount    > 0 ? Math.round(info.viewCount)    : -1,
            commentsCount: -1,
          };
          if (song.videoId) {
            supabaseCache.saveTrackStats({
              videoId:      song.videoId,
              likeCount:    fbExtras.likeCount!,
              dislikeCount: fbExtras.dislikeCount!,
              viewCount:    fbExtras.viewCount!,
              commentsCount: -1,
              uploaderUrl:  fbExtras.uploaderUrl ?? null,
            }).catch(() => {});
          }
          console.log(`[MusicPlayer] getStreamInfoById succeeded for "${song.title}"`);
          return buildTrack(song, audioUrl, videoUrl, duration, info.title, fbExtras);
        }
      }
    } catch (byIdErr) {
      console.warn(`[MusicPlayer] getStreamInfoById failed for "${song.title}":`, byIdErr);
    }
  }

  // ── Step 4: Fallback B — search strategies ─────────────────────────────────
  //
  // [E] Filter tokens:
  //   'videos' = standard YouTube video results (NewPipe standard filter)
  //   ''       = all content types — no filter applied
  //   'all'    is NOT a valid NewPipe token — never used here.
  //
  // Tries in order of specificity. Stops at first result that yields a
  // usable audio stream.
  const searchStrategies = [
    { query: `${song.title} ${song.artist} official audio`, filter: 'videos' },
    { query: `${song.title} ${song.artist}`,                filter: ''       },
    { query: `${song.title} official audio`,                filter: 'videos' },
  ];

  for (const strategy of searchStrategies) {
    try {
      console.log(`[MusicPlayer] search fallback: "${strategy.query}" (filter: '${strategy.filter}')...`);

      const searchResult = await MavinEngine.search(
        strategy.query,
        strategy.filter,
        undefined,
        0,
      );

      // response key is "results" (not "items") — per MavinEngine.ts SearchPage
      const firstStream = searchResult?.results?.find(
        (i): i is StreamInfoItem =>
          i.type === 'stream' && !i.isLive && !i.isShortFormContent,
      );

      if (!firstStream?.url) continue;

      console.log(`[MusicPlayer] search hit → ${firstStream.url}`);

      const info = await MavinEngine.getStreamInfo(firstStream.url, 0);
      if (!info.success) continue;

      const bestAudio = pickBestAudio(info.audioStreams ?? []);
      const bestVideo =
        pickBestVideo(info.videoOnlyStreams ?? []) ??
        pickBestVideo(info.videoStreams ?? []);

      if (!bestAudio?.url) continue;

      const audioUrl = bestAudio.url;
      const videoUrl = bestVideo?.url ?? null;
      const duration = info.duration ?? 0;

      cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(() => {});
      console.log(`[MusicPlayer] search fallback succeeded for "${song.title}" via "${strategy.query}"`);
      return buildTrack(song, audioUrl, videoUrl, duration, info.title, {
        videoId:      song.videoId,
        uploaderUrl:  info.uploaderUrl ?? undefined,
        likeCount:    typeof info.likeCount    === 'number' && info.likeCount    > 0 ? Math.round(info.likeCount)    : -1,
        dislikeCount: typeof info.dislikeCount === 'number' && info.dislikeCount > 0 ? Math.round(info.dislikeCount) : -1,
        viewCount:    typeof info.viewCount    === 'number' && info.viewCount    > 0 ? Math.round(info.viewCount)    : -1,
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
// fetchRelatedSongs
//
// Used by the "Up Next" feature — populates the queue after a song starts
// playing using the relatedItems from that song's StreamInfo.
// ─────────────────────────────────────────────────────────────────────────────

const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  if (!songUrl) return [];
  try {
    // [B] serviceId 0 → Android/iOS client (SABR fix)
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];

    return info.relatedItems
      .filter((i): i is StreamInfoItem => i.type === 'stream')
      .filter(s => !s.isLive && !s.isShortFormContent)
      .map(s => {
        // [D] videoId: handle both youtube.com?v= and youtu.be/ URL formats
        const videoId =
          s.url.includes('v=')
            ? s.url.split('v=')[1]?.split('&')[0]
            : s.url.includes('youtu.be/')
            ? s.url.split('youtu.be/')[1]?.split('?')[0]
            : s.url;
        return {
          // [D] StreamInfoItem uses `name` (NewPipe InfoItem base), not `title`
          id:        videoId ?? s.url,
          title:     s.name,
          artist:    s.uploaderName,
          thumbnail:
            s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url ??
            s.thumbnails.find(t => t.resolutionLevel === 'HIGH')?.url ??
            s.thumbnails[0]?.url ?? '',
          url:       s.url,
          videoId:   videoId ?? undefined,
        };
      });
  } catch {
    return [];
  }
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
  const [isLoading, setIsLoading] = useState(false);

  const currentSongIdRef     = useRef<string | null>(null);
  const bgAbortControllerRef = useRef<AbortController | null>(null);
  const netInfo              = useNetInfo();

  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  const resetPlayerState = useCallback(async () => {
    log('Reset: TrackPlayer.reset()');
    await TrackPlayer.reset();
    currentSongIdRef.current = null;
  }, [log]);

  // ── Background queue: online playlist ──────────────────────────────────────

  const addPlaylistTracksInBackground = useCallback(
    async (
      initialSong: Song,
      fullPlaylist: Song[],
      abortSignal: AbortSignal,
    ) => {
      const initialId   = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const addTrack = async (
        song: Song,
        position: 'before' | 'after',
      ): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track = await resolveTrack(song);
          if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
          if (!track) return true; // skip unresolvable, continue queue
          const queue = await TrackPlayer.getQueue();
          if (queue.some(t => t.id === track.id)) return true;
          if (position === 'after') {
            await TrackPlayer.add(track);
          } else {
            const playingIdx = queue.findIndex(t => t.id === initialId);
            await TrackPlayer.add(track, playingIdx !== -1 ? playingIdx : undefined);
          }
          log(`BG Queue: ${position} "${track.title}"`);
        } catch (e) {
          log(`BG Queue error on "${song.title}": ${e}`);
        }
        return true;
      };

      const songsAfter  = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex);

      const addAfter  = async () => {
        for (const s of songsAfter)  { if (!(await addTrack(s, 'after')))  return; await delay(150); }
      };
      const addBefore = async () => {
        for (const s of songsBefore) { if (!(await addTrack(s, 'before'))) return; await delay(150); }
      };

      if (abortSignal.aborted || currentSongIdRef.current !== initialId) return;
      await Promise.all([addAfter(), addBefore()]);
    },
    [log],
  );

  // ── Background queue: downloaded playlist ──────────────────────────────────

  const addDownloadedPlaylistTracksInBackground = useCallback(
    async (
      initialSong: DownloadedSongMetadata,
      fullPlaylist: DownloadedSongMetadata[],
      abortSignal: AbortSignal,
    ) => {
      const initialId   = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const addTrack = async (
        song: DownloadedSongMetadata,
        position: 'before' | 'after',
      ): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track: Track = {
            id:       song.id,
            url:      song.localTrackUri,
            title:    song.title,
            artist:   song.artist,
            artwork:  song.localArtworkUri,
            duration: song.duration,
          };
          const queue = await TrackPlayer.getQueue();
          if (queue.some(t => t.id === track.id)) return true;
          if (position === 'after') {
            await TrackPlayer.add(track);
          } else {
            const playingIdx = queue.findIndex(t => t.id === initialId);
            await TrackPlayer.add(track, playingIdx !== -1 ? playingIdx : undefined);
          }
        } catch (e) {
          log(`BG Downloaded Queue error on "${song.title}": ${e}`);
        }
        return true;
      };

      const songsAfter  = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex);

      const addAfter  = async () => {
        for (const s of songsAfter)  { if (!(await addTrack(s, 'after')))  return; await delay(150); }
      };
      const addBefore = async () => {
        for (const s of songsBefore) { if (!(await addTrack(s, 'before'))) return; await delay(150); }
      };

      await Promise.all([addAfter(), addBefore()]);
    },
    [log],
  );

  // ── Up Next ────────────────────────────────────────────────────────────────

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
        const queue = await TrackPlayer.getQueue();
        if (queue.some(t => t.id === track.id)) continue;
        await TrackPlayer.add(track);
        await delay(200);
      }
    },
    [log],
  );

  // ── playAudio ──────────────────────────────────────────────────────────────

  const playAudio = async (songToPlay: Song, playlist?: Song[]) => {
    if (!netInfo.isConnected) {
      Alert.alert('No Connection', 'Please connect to the internet to play songs.');
      return;
    }

    if (!songToPlay.url) {
      Alert.alert(
        'Not Available',
        `"${songToPlay.title}" is not available for streaming yet.`,
      );
      return;
    }

    try {
      log(`Play: "${songToPlay.title}"${playlist ? ` (queue: ${playlist.length})` : ''}`);
      setIsLoading(true);

      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      await resetPlayerState();

      const track = await resolveTrack(songToPlay);

      if (abortSignal.aborted) { setIsLoading(false); return; }

      if (!track) {
        Alert.alert(
          'Playback Error',
          `"${songToPlay.title}" is unavailable. Please try again.`,
        );
        setIsLoading(false);
        return;
      }

      await TrackPlayer.add(track);
      await TrackPlayer.play();
      setIsPlaying(true);
      currentSongIdRef.current = track.id;
      log(`Now playing: "${track.title}"`);

      if (playlist && playlist.length > 0) {
        addPlaylistTracksInBackground(songToPlay, playlist, abortSignal)
          .catch(e => log(`BG playlist error: ${e}`));
      } else if (playlist === undefined) {
        // No playlist provided → auto-populate Up Next from relatedItems
        addUpNextSongs(songToPlay, abortSignal)
          .catch(e => log(`Up Next error: ${e}`));
      }
    } catch (error) {
      log(`playAudio error: ${error}`);
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── playDownloadedSong ─────────────────────────────────────────────────────

  const playDownloadedSong = async (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
  ) => {
    try {
      setIsLoading(true);
      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;
      await resetPlayerState();

      const track: Track = {
        id:       songToPlay.id,
        url:      songToPlay.localTrackUri,
        title:    songToPlay.title,
        artist:   songToPlay.artist,
        artwork:  songToPlay.localArtworkUri,
        duration: songToPlay.duration,
      };

      if (abortSignal.aborted) { setIsLoading(false); return; }

      await TrackPlayer.add(track);
      await TrackPlayer.play();
      setIsPlaying(true);
      currentSongIdRef.current = track.id;

      if (playlist?.length) {
        addDownloadedPlaylistTracksInBackground(songToPlay, playlist, abortSignal)
          .catch(e => log(`BG downloaded playlist error: ${e}`));
      }
    } catch (error) {
      Alert.alert('Playback Error', `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── playPlaylist ───────────────────────────────────────────────────────────

  const playPlaylist = async (songs: Song[]) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'The playlist is empty.');
      return;
    }
    await playAudio(songs[0], songs);
  };

  // ── playAllDownloadedSongs ─────────────────────────────────────────────────

  const playAllDownloadedSongs = async (songs: DownloadedSongMetadata[]) => {
    if (!songs?.length) {
      Alert.alert('Playback Error', 'No downloaded songs found.');
      return;
    }
    await playDownloadedSong(songs[0], songs);
  };

  // ── playNext ───────────────────────────────────────────────────────────────

  const playNext = async (songsToAdd: Song[] | null) => {
    if (!songsToAdd?.length) return;
    try {
      const activeTrackData = await TrackPlayer.getActiveTrack();
      const activeTrackId   = activeTrackData?.id;
      let activeIndex       = await TrackPlayer.getActiveTrackIndex();
      let insertAt: number | undefined =
        typeof activeIndex === 'number' ? activeIndex + 1 : undefined;

      for (const song of songsToAdd) {
        if (song.id === activeTrackId) continue;
        const queue       = await TrackPlayer.getQueue();
        const existingIdx = queue.findIndex(t => t.id === song.id);
        if (existingIdx !== -1) {
          await TrackPlayer.remove(existingIdx);
          if (insertAt !== undefined && existingIdx < insertAt) insertAt--;
        }
        const track = await resolveTrack(song);
        if (!track) continue;
        await TrackPlayer.add(track, insertAt);
        if (insertAt !== undefined) insertAt++;
      }
    } catch (error) {
      Alert.alert('Playback Error', 'Failed to queue next song(s).');
    }
  };

  // ── togglePlayPause ────────────────────────────────────────────────────────

  const togglePlayPause = async () => {
    try {
      const { state: currentState } = await TrackPlayer.getPlaybackState();
      if (currentState === State.Playing || currentState === State.Buffering) {
        await TrackPlayer.pause();
        setIsPlaying(false);
      } else {
        const queue = await TrackPlayer.getQueue();
        if (queue.length > 0) {
          await TrackPlayer.play();
          setIsPlaying(true);
        } else {
          Alert.alert('Playback Info', 'Queue is empty.');
        }
      }
    } catch (error) {
      Alert.alert('Playback Error', 'Failed to toggle playback.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <MusicPlayerContext.Provider value={{
      isPlaying,
      isLoading,
      playAudio,
      playPlaylist,
      playNext,
      playDownloadedSong,
      playAllDownloadedSongs,
      togglePlayPause,
    }}>
      {children}
    </MusicPlayerContext.Provider>
  );
};