/**
 * MusicPlayerContext
 *
 * Changes from original:
 *
 * 1. resolveTrack now uses a 3-step strategy:
 *    a. Check Supabase streams table for a cached, non-expired audio stream
 *    b. If found → use directly, skip engine call
 *    c. If not found → call MavinEngine.getStreamInfo(url) which returns
 *       BOTH audioStreams and videoStreams in a single extraction call
 *    d. Pick best audio stream (highest bitrate) + best video stream (720p or highest)
 *    e. Store BOTH on the Track object (videoUrl is a custom field RNTP ignores)
 *    f. Fire-and-forget: write both streams to Supabase streams table
 *
 * 2. The Track object now carries `videoUrl` so PlayerScreen can read it
 *    via useActiveTrack() for the audio/video toggle without any extra state.
 *
 * 3. Tracks with url === '' (video_id is null in DB) return null from
 *    resolveTrack and are skipped gracefully with a user-facing alert.
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
import type { Song } from '@/types/song';

// Re-export Song so callers that currently import it from here continue to work
export type { Song };

// ─────────────────────────────────────────────────────────────────────────────
// Context type
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerContextType {
  isPlaying:             boolean;
  isLoading:             boolean;
  playAudio:             (songToPlay: Song, playlist?: Song[]) => Promise<void>;
  playPlaylist:          (songs: Song[]) => Promise<void>;
  playNext:              (songs: Song[] | null) => Promise<void>;
  playDownloadedSong:    (song: DownloadedSongMetadata, playlist?: DownloadedSongMetadata[]) => Promise<void>;
  playAllDownloadedSongs:(songs: DownloadedSongMetadata[]) => Promise<void>;
  togglePlayPause:       () => Promise<void>;
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
 * Pick the best audio stream: highest bitrate, prefer non-manifest delivery.
 */
function pickBestAudio(streams: AudioStream[]): AudioStream | null {
  if (!streams?.length) return null;
  const direct = streams.filter(s => s.isUrl && !s.manifestUrl);
  const pool   = direct.length ? direct : streams;
  return pool.reduce((best, s) => (s.bitrate > best.bitrate ? s : best), pool[0]);
}

/**
 * Pick best video stream from the given list.
 *
 * Per NewPipe v0.26.0 javadoc:
 *   getVideoOnlyStreams() = ADAPTIVE_FORMATS = DASH, NO embedded audio, HD (720p/1080p)
 *   getVideoStreams()     = FORMATS          = muxed WITH audio, typically ≤480p on YouTube
 *
 * Callers must pass videoOnlyStreams as the primary list and videoStreams as fallback:
 *   pickBestVideo(info.videoOnlyStreams ?? []) ?? pickBestVideo(info.videoStreams ?? [])
 *
 * Excludes streams with height === 0 (audio-only entries that sometimes appear in the list).
 * Prefers 720p — best balance of quality vs bandwidth for the video toggle panel.
 */
function pickBestVideo(streams: VideoStream[]): VideoStream | null {
  if (!streams?.length) return null;
  // Only direct URL streams with actual video dimensions
  const withVideo = streams.filter(s => s.height > 0 && s.isUrl);
  if (!withVideo.length) return null;
  // 720p preferred — falls back to highest available
  const p720 = withVideo.find(s => s.height === 720);
  if (p720) return p720;
  return withVideo.reduce((best, s) => (s.height > best.height ? s : best), withVideo[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase stream cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check the streams table for a cached, active, non-expired audio URL.
 * Returns the stream_url string or null if not found / expired.
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
 *
 * Uses upsert on (track_id, stream_type) unique constraint.
 * stream_type column added by migration.sql.
 */
async function cacheStreamsToSupabase(
  trackId:   string,
  audioUrl:  string,
  videoUrl:  string | null,
  duration:  number,
): Promise<void> {
  try {
    const expiry = new Date(Date.now() + STREAM_TTL_MS).toISOString();
    const now    = new Date().toISOString();

    const rows: any[] = [
      {
        track_id:    trackId,
        source:      'youtube',
        stream_url:  audioUrl,
        stream_type: 'audio',
        quality:     'high',
        format:      'webm',
        duration:    Math.round(duration),
        expiry,
        is_active:   true,
        health_score: 100,
        last_accessed: now,
        access_count:  1,
      },
    ];

    if (videoUrl) {
      rows.push({
        track_id:    trackId,
        source:      'youtube',
        stream_url:  videoUrl,
        stream_type: 'video',
        quality:     '720p',
        format:      'mp4',
        duration:    Math.round(duration),
        expiry,
        is_active:   true,
        health_score: 100,
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
// resolveTrack
//
// Strategy:
//   1. If song.url is empty (no video_id in DB) → return null immediately
//   2. Check streams table for cached audio URL → use it if fresh
//   3. Also check for cached video URL → attach if fresh
//   4. If audio not cached → extract both streams via getStreamInfo()
//   5. Fire-and-forget write to streams table
//   6. Return Track with videoUrl attached as custom field
// ─────────────────────────────────────────────────────────────────────────────

const resolveTrack = async (song: Song): Promise<Track | null> => {
  // Guard: no YouTube URL means we cannot extract anything
  if (!song.url) {
    console.warn(`[MusicPlayer] "${song.title}" has no video_id — skipping`);
    return null;
  }

  try {
    // ── Step 1: Check cache ────────────────────────────────────────────────
    const [cachedAudio, cachedVideo] = await Promise.all([
      getCachedAudioStream(song.id),
      getCachedVideoStream(song.id),
    ]);

    if (cachedAudio) {
      console.log(`[MusicPlayer] cache hit for "${song.title}"`);
      return {
        id:       song.id,
        url:      cachedAudio,
        title:    song.title,
        artist:   song.artist,
        artwork:  song.thumbnail,
        // Custom field — RNTP ignores it, PlayerScreen reads it
        videoUrl: cachedVideo ?? undefined,
      } as Track & { videoUrl?: string };
    }

    // ── Step 2: Extract via MavinEngine ────────────────────────────────────
    console.log(`[MusicPlayer] extracting streams for "${song.title}"...`);
    const info = await MavinEngine.getStreamInfo(song.url, 0);

    if (!info.success) {
      console.warn(`[MusicPlayer] extraction failed for "${song.title}"`);
      return null;
    }

    // Audio: audioStreams = audio-only streams, no video — pick highest bitrate
    const bestAudio = pickBestAudio(info.audioStreams ?? []);

    // Video: per NewPipe v0.26.0 javadoc:
    //   videoOnlyStreams = ADAPTIVE_FORMATS = DASH, NO embedded audio, HD (720p/1080p)
    //   videoStreams     = FORMATS          = muxed WITH audio, typically ≤480p on YouTube
    // Always prefer videoOnlyStreams (HD DASH). Fall back to muxed videoStreams.
    const bestVideo = pickBestVideo(info.videoOnlyStreams ?? [])
                   ?? pickBestVideo(info.videoStreams ?? []);

    if (!bestAudio?.url) {
      console.warn(`[MusicPlayer] no audio stream for "${song.title}"`);
      return null;
    }

    const audioUrl = bestAudio.url;
    const videoUrl = bestVideo?.url ?? null;
    const duration = info.duration ?? 0;

    // ── Step 3: Write to Supabase (fire-and-forget) ────────────────────────
    cacheStreamsToSupabase(song.id, audioUrl, videoUrl, duration).catch(
      e => console.warn('[MusicPlayer] bg cache error:', e),
    );

    // ── Step 4: Return Track ───────────────────────────────────────────────
    return {
      id:       song.id,
      url:      audioUrl,
      // StreamInfo.title (not .name) — confirmed against index.ts StreamInfo interface
      title:    info.title || song.title,
      artist:   song.artist,
      artwork:  song.thumbnail,
      duration: duration > 0 ? duration : undefined,
      // Custom field — RNTP ignores it, PlayerScreen reads via useActiveTrack()
      videoUrl: videoUrl ?? undefined,
    } as Track & { videoUrl?: string };

  } catch (e) {
    console.warn(`[MusicPlayer] resolveTrack error for "${song.title}":`, e);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// fetchRelatedSongs — unchanged from original
// ─────────────────────────────────────────────────────────────────────────────

const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  if (!songUrl) return [];
  try {
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];
    return info.relatedItems
      .filter((i): i is StreamInfoItem => i.type === 'stream')
      .map(s => ({
        id:        s.url.split('v=')[1]?.split('&')[0] ?? s.url,
        title:     s.name,
        artist:    s.uploaderName,
        thumbnail: s.thumbnails.find(t => t.resolutionLevel === 'MEDIUM')?.url
                    ?? s.thumbnails[0]?.url
                    ?? '',
        url:       s.url,
        videoId:   s.url.split('v=')[1]?.split('&')[0],
      }));
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

  const currentSongIdRef       = useRef<string | null>(null);
  const bgAbortControllerRef   = useRef<AbortController | null>(null);
  const netInfo                = useNetInfo();

  const log = useCallback((msg: string) => console.log(`[MusicPlayer] ${msg}`), []);

  const resetPlayerState = useCallback(async () => {
    log('Reset: TrackPlayer.reset()');
    await TrackPlayer.reset();
    currentSongIdRef.current = null;
  }, [log]);

  // ── Background queue: online playlist ──────────────────────────────────────

  const addPlaylistTracksInBackground = useCallback(
    async (initialSong: Song, fullPlaylist: Song[], abortSignal: AbortSignal) => {
      const initialId   = initialSong.id;
      const targetIndex = fullPlaylist.findIndex(s => s.id === initialId);
      if (targetIndex === -1) return;

      const addTrack = async (song: Song, position: 'before' | 'after'): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track = await resolveTrack(song);
          if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
          if (!track) return true;
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

      const addAfter  = async () => { for (const s of songsAfter)  { if (!(await addTrack(s, 'after')))  return; await delay(150); } };
      const addBefore = async () => { for (const s of songsBefore) { if (!(await addTrack(s, 'before'))) return; await delay(150); } };

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

      const addTrack = async (song: DownloadedSongMetadata, position: 'before' | 'after'): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) return false;
        try {
          const track: Track = {
            id:      song.id,
            url:     song.localTrackUri,
            title:   song.title,
            artist:  song.artist,
            artwork: song.localArtworkUri,
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

      const addAfter  = async () => { for (const s of songsAfter)  { if (!(await addTrack(s, 'after')))  return; await delay(150); } };
      const addBefore = async () => { for (const s of songsBefore) { if (!(await addTrack(s, 'before'))) return; await delay(150); } };

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

    // Guard: track has no video_id
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
        Alert.alert('Playback Error', `"${songToPlay.title}" is unavailable. Please try again.`);
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
        id:      songToPlay.id,
        url:     songToPlay.localTrackUri,
        title:   songToPlay.title,
        artist:  songToPlay.artist,
        artwork: songToPlay.localArtworkUri,
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
    if (!songs?.length) { Alert.alert('Playback Error', 'The playlist is empty.'); return; }
    await playAudio(songs[0], songs);
  };

  // ── playAllDownloadedSongs ─────────────────────────────────────────────────

  const playAllDownloadedSongs = async (songs: DownloadedSongMetadata[]) => {
    if (!songs?.length) { Alert.alert('Playback Error', 'No downloaded songs found.'); return; }
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