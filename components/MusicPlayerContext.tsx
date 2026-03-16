/**
 * MusicPlayerContext
 *
 * Core music playback logic for the application.
 * All stream resolution uses MavinEngine (NewPipe Extractor v0.26.0).
 *
 * How a Song becomes a playable Track:
 *   Song.url = full YouTube watch URL ("https://www.youtube.com/watch?v=…")
 *   MavinEngine.getStreamUrl(song.url, "audio") → StreamUrlResult.url
 *   That resolved URL is passed to TrackPlayer as Track.url.
 *
 * Up Next suggestions (no explicit playlist):
 *   MavinEngine.getStreamInfo(song.url) → StreamInfo.relatedItems
 *   Filtered to StreamInfoItem, converted to Songs, then resolved + queued.
 *
 * NOTE: This provider deliberately contains NO react-native-track-player hooks
 * (useActiveTrack, usePlaybackState, etc.). Hooks require setupPlayer() to have
 * been called first, but this provider mounts before that completes.
 * All player state is read imperatively via TrackPlayer.*() async methods,
 * which are safe to call after setupPlayer() — and are only ever invoked
 * inside user-triggered callbacks (playAudio, togglePlayPause, etc.), not
 * at render time.
 */

import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  useRef,
  useCallback,
} from "react";
import MavinEngine, {
  StreamInfoItem,
  StreamUrlResult,
} from "@/modules/mavin-engine";
import TrackPlayer, { State, Track } from "react-native-track-player";
import { Alert } from "react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import { DownloadedSongMetadata } from "@/store/library";

// ─────────────────────────────────────────────────────────────────────────────
// Context type
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerContextType {
  isPlaying: boolean;
  isLoading: boolean;
  playAudio: (songToPlay: Song, playlist?: Song[]) => Promise<void>;
  playPlaylist: (songs: Song[]) => Promise<void>;
  playNext: (songs: Song[] | null) => Promise<void>;
  playDownloadedSong: (
    songToPlay: DownloadedSongMetadata,
    playlist?: DownloadedSongMetadata[],
  ) => Promise<void>;
  playAllDownloadedSongs: (songs: DownloadedSongMetadata[]) => Promise<void>;
  togglePlayPause: () => Promise<void>;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(
  undefined,
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve a Song to a TrackPlayer Track via MavinEngine.getStreamUrl().
 * Uses "audio" format — NewPipe selects the highest-quality audio-only stream.
 * Returns null if resolution fails (unavailable, network error, etc.).
 */
const resolveTrack = async (song: Song): Promise<Track | null> => {
  try {
    const result: StreamUrlResult = await MavinEngine.getStreamUrl(
      song.url,
      "audio",
      0,
    );
    if (!result.success || !result.url) return null;
    return {
      id: song.id,
      url: result.url,
      title: result.title || song.title,
      artist: song.artist,
      artwork: song.thumbnail,
      duration: result.duration > 0 ? result.duration : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Fetch related songs for Up Next via MavinEngine.getStreamInfo().
 * relatedItems contains up to 20 items — we keep stream-type only.
 * Returns an empty array on any failure (non-critical path).
 */
const fetchRelatedSongs = async (songUrl: string): Promise<Song[]> => {
  try {
    const info = await MavinEngine.getStreamInfo(songUrl, 0);
    if (!info.success) return [];
    return info.relatedItems
      .filter((i): i is StreamInfoItem => i.type === "stream")
      .map((s) => ({
        id: s.url.split("v=")[1]?.split("&")[0] ?? s.url,
        title: s.name,
        artist: s.uploaderName,
        thumbnail:
          s.thumbnails.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
          s.thumbnails[0]?.url ??
          "",
        url: s.url,
      }));
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useMusicPlayer = () => {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error("useMusicPlayer must be used within a MusicPlayerProvider");
  }
  return context;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicPlayerProviderProps {
  children: ReactNode;
}

export const MusicPlayerProvider: React.FC<MusicPlayerProviderProps> = ({
  children,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // ID of the song that started the current playback session.
  // Background workers check this to self-abort when the session changes.
  const currentSongIdRef = useRef<string | null>(null);

  // ── IMPORTANT ──────────────────────────────────────────────────────────────
  // useActiveTrack() has been intentionally removed from this provider.
  //
  // This provider mounts before TrackPlayer.setupPlayer() completes, so any
  // RNTP hook called here would throw "The player is not initialized."
  //
  // The only place useActiveTrack() was used was in playNext() to read
  // activeTrack?.id — replaced below with TrackPlayer.getActiveTrack(),
  // which is an imperative async call that is safe inside event callbacks
  // (never called at render time, always called after player is ready).
  // ── ────────────────────────────────────────────────────────────────────────

  const netInfo = useNetInfo();

  // Replaced on every new playAudio / playDownloadedSong call to cancel
  // any in-flight background queue work from the previous session.
  const bgAbortControllerRef = useRef<AbortController | null>(null);

  const log = useCallback((msg: string) => {
    console.log(`[MusicPlayer] ${msg}`);
  }, []);

  const resetPlayerState = useCallback(async () => {
    log("Reset: TrackPlayer.reset()");
    await TrackPlayer.reset();
    currentSongIdRef.current = null;
  }, [log]);

  // ── Background queue: online playlist ──────────────────────────────────────

  /**
   * Resolves and enqueues every song in the playlist around the playing song.
   * Songs after the target are appended in order.
   * Songs before the target are inserted at the playing track's position
   * (pushing it forward) so the user can skip back into them.
   */
  const addPlaylistTracksInBackground = useCallback(
    async (
      initialSong: Song,
      fullPlaylist: Song[],
      abortSignal: AbortSignal,
    ) => {
      const initialId = initialSong.id;
      log(`BG Queue (Online): starting for "${initialSong.title}"`);

      const targetIndex = fullPlaylist.findIndex((s) => s.id === initialId);
      if (targetIndex === -1) {
        log(`BG Queue (Online): song not found in playlist, aborting`);
        return;
      }

      const addTrack = async (
        song: Song,
        position: "before" | "after",
      ): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId) {
          return false;
        }
        try {
          const track = await resolveTrack(song);
          if (abortSignal.aborted || currentSongIdRef.current !== initialId)
            return false;
          if (!track) {
            log(`BG Queue (Online): could not resolve "${song.title}", skipping`);
            return true;
          }
          const queue = await TrackPlayer.getQueue();
          if (queue.some((t) => t.id === track.id)) {
            log(`BG Queue (Online): duplicate "${track.title}", skipping`);
            return true;
          }
          if (position === "after") {
            await TrackPlayer.add(track);
            log(`BG Queue (Online): appended "${track.title}"`);
          } else {
            const playingIdx = queue.findIndex((t) => t.id === initialId);
            await TrackPlayer.add(track, playingIdx !== -1 ? playingIdx : undefined);
            log(`BG Queue (Online): inserted "${track.title}" before playing track`);
          }
        } catch (e) {
          log(`BG Queue (Online): error on "${song.title}": ${e}`);
        }
        return true;
      };

      const songsAfter = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex);

      const addAfter = async () => {
        for (const song of songsAfter) {
          if (!(await addTrack(song, "after"))) return;
          await delay(150);
        }
      };

      const addBefore = async () => {
        for (const song of songsBefore) {
          if (!(await addTrack(song, "before"))) return;
          await delay(150);
        }
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
      const initialId = initialSong.id;
      log(`BG Queue (Downloaded): starting for "${initialSong.title}"`);

      const targetIndex = fullPlaylist.findIndex((s) => s.id === initialId);
      if (targetIndex === -1) return;

      const songsAfter  = fullPlaylist.slice(targetIndex + 1);
      const songsBefore = fullPlaylist.slice(0, targetIndex);

      const addTrack = async (
        song: DownloadedSongMetadata,
        position: "before" | "after",
      ): Promise<boolean> => {
        if (abortSignal.aborted || currentSongIdRef.current !== initialId)
          return false;
        try {
          const track: Track = {
            id: song.id,
            url: song.localTrackUri,
            title: song.title,
            artist: song.artist,
            artwork: song.localArtworkUri,
            duration: song.duration,
          };
          const queue = await TrackPlayer.getQueue();
          if (queue.some((t) => t.id === track.id)) return true;

          if (position === "after") {
            await TrackPlayer.add(track);
          } else {
            const playingIdx = queue.findIndex((t) => t.id === initialId);
            await TrackPlayer.add(track, playingIdx !== -1 ? playingIdx : undefined);
          }
          log(`BG Queue (Downloaded): added "${track.title}"`);
        } catch (e) {
          log(`BG Queue (Downloaded): error on "${song.title}": ${e}`);
        }
        return true;
      };

      const addAfter = async () => {
        for (const song of songsAfter) {
          if (!(await addTrack(song, "after"))) return;
          await delay(150);
        }
      };

      const addBefore = async () => {
        for (const song of songsBefore) {
          if (!(await addTrack(song, "before"))) return;
          await delay(150);
        }
      };

      await Promise.all([addAfter(), addBefore()]);
    },
    [log],
  );

  // ── Up Next (online, no playlist context) ──────────────────────────────────

  const addUpNextSongs = useCallback(
    async (song: Song, abortSignal: AbortSignal) => {
      const songId = song.id;
      log(`Up Next: fetching related for "${song.title}"`);

      const related = await fetchRelatedSongs(song.url);
      if (abortSignal.aborted || currentSongIdRef.current !== songId) return;

      log(`Up Next: ${related.length} related songs found`);

      for (const relSong of related.slice(0, 5)) {
        if (abortSignal.aborted || currentSongIdRef.current !== songId) return;
        const track = await resolveTrack(relSong);
        if (!track) continue;

        const queue = await TrackPlayer.getQueue();
        if (queue.some((t) => t.id === track.id)) continue;

        await TrackPlayer.add(track);
        log(`Up Next: queued "${track.title}"`);
        await delay(200);
      }
    },
    [log],
  );

  // ── playAudio ──────────────────────────────────────────────────────────────

  const playAudio = async (songToPlay: Song, playlist?: Song[]) => {
    if (!netInfo.isConnected) {
      Alert.alert(
        "No Connection",
        "You are offline. Please connect to the internet to play songs.",
      );
      return;
    }

    try {
      log(
        `Play request: "${songToPlay.title}"` +
          (playlist ? ` (playlist: ${playlist.length} songs)` : ""),
      );
      setIsLoading(true);

      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      await resetPlayerState();

      const track = await resolveTrack(songToPlay);

      if (abortSignal.aborted) {
        log(`Aborted during stream resolution for "${songToPlay.title}"`);
        setIsLoading(false);
        return;
      }

      if (!track) {
        Alert.alert(
          "Playback Error",
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
        addPlaylistTracksInBackground(songToPlay, playlist, abortSignal).catch(
          (e) => log(`BG playlist error: ${e}`),
        );
      } else if (playlist === undefined) {
        addUpNextSongs(songToPlay, abortSignal).catch(
          (e) => log(`Up Next error: ${e}`),
        );
      }
    } catch (error) {
      log(`playAudio error for "${songToPlay.title}": ${error}`);
      Alert.alert("Playback Error", `Failed to play "${songToPlay.title}".`);
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
      log(
        `Play downloaded: "${songToPlay.title}"` +
          (playlist ? ` (playlist: ${playlist.length})` : ""),
      );
      setIsLoading(true);

      bgAbortControllerRef.current?.abort();
      bgAbortControllerRef.current = new AbortController();
      const abortSignal = bgAbortControllerRef.current.signal;

      await resetPlayerState();

      const track: Track = {
        id: songToPlay.id,
        url: songToPlay.localTrackUri,
        title: songToPlay.title,
        artist: songToPlay.artist,
        artwork: songToPlay.localArtworkUri,
        duration: songToPlay.duration,
      };

      if (abortSignal.aborted) {
        setIsLoading(false);
        return;
      }

      await TrackPlayer.add(track);
      await TrackPlayer.play();
      setIsPlaying(true);
      currentSongIdRef.current = track.id;
      log(`Now playing downloaded: "${track.title}"`);

      if (playlist && playlist.length > 0) {
        addDownloadedPlaylistTracksInBackground(
          songToPlay,
          playlist,
          abortSignal,
        ).catch((e) => log(`BG downloaded playlist error: ${e}`));
      }
    } catch (error) {
      log(`playDownloadedSong error for "${songToPlay.title}": ${error}`);
      Alert.alert("Playback Error", `Failed to play "${songToPlay.title}".`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── playPlaylist ───────────────────────────────────────────────────────────

  const playPlaylist = async (songs: Song[]) => {
    if (!songs || songs.length === 0) {
      Alert.alert("Playback Error", "The playlist is empty.");
      return;
    }
    log(`Play playlist: ${songs.length} songs`);
    await playAudio(songs[0], songs);
  };

  // ── playAllDownloadedSongs ─────────────────────────────────────────────────

  const playAllDownloadedSongs = async (songs: DownloadedSongMetadata[]) => {
    if (!songs || songs.length === 0) {
      Alert.alert("Playback Error", "No downloaded songs found.");
      return;
    }
    log(`Play all downloaded: ${songs.length} songs`);
    await playDownloadedSong(songs[0], songs);
  };

  // ── playNext ───────────────────────────────────────────────────────────────

  /**
   * Resolve and insert songs immediately after the currently playing track.
   * Existing duplicates are removed and re-inserted at the correct position.
   *
   * Uses TrackPlayer.getActiveTrack() imperatively instead of the
   * useActiveTrack() hook — safe to call inside an event callback after
   * setupPlayer() has completed.
   */
  const playNext = async (songsToAdd: Song[] | null) => {
    if (!songsToAdd || songsToAdd.length === 0) {
      log("playNext: no songs provided");
      return;
    }

    try {
      // Imperative read — safe here because this is called from a user action,
      // which can only happen after the player is fully initialised.
      const activeTrackData = await TrackPlayer.getActiveTrack();
      const activeTrackId   = activeTrackData?.id;
      let activeIndex       = await TrackPlayer.getActiveTrackIndex();
      let insertAt: number | undefined =
        typeof activeIndex === "number" ? activeIndex + 1 : undefined;

      for (const song of songsToAdd) {
        if (song.id === activeTrackId) {
          log(`playNext: "${song.title}" is active track, skipping`);
          continue;
        }

        const queue = await TrackPlayer.getQueue();
        const existingIdx = queue.findIndex((t) => t.id === song.id);
        if (existingIdx !== -1) {
          await TrackPlayer.remove(existingIdx);
          if (insertAt !== undefined && existingIdx < insertAt) insertAt--;
          log(`playNext: removed existing "${song.title}" at ${existingIdx}`);
        }

        const track = await resolveTrack(song);
        if (!track) {
          log(`playNext: could not resolve "${song.title}", skipping`);
          continue;
        }

        await TrackPlayer.add(track, insertAt);
        log(
          `playNext: inserted "${track.title}"` +
            (insertAt !== undefined ? ` at index ${insertAt}` : " at end"),
        );
        if (insertAt !== undefined) insertAt++;
      }
    } catch (error) {
      log(`playNext error: ${error}`);
      Alert.alert("Playback Error", "Failed to queue next song(s).");
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
          Alert.alert("Playback Info", "Queue is empty.");
        }
      }
    } catch (error) {
      log(`togglePlayPause error: ${error}`);
      Alert.alert("Playback Error", "Failed to toggle playback.");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <MusicPlayerContext.Provider
      value={{
        isPlaying,
        isLoading,
        playAudio,
        playPlaylist,
        playNext,
        playDownloadedSong,
        playAllDownloadedSongs,
        togglePlayPause,
      }}
    >
      {children}
    </MusicPlayerContext.Provider>
  );
};