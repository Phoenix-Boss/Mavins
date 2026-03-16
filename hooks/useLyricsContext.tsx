/**
 * Lyrics Context
 *
 * Split into two components to respect RNTP's initialization requirement:
 *
 *   LyricsProvider  — holds all lyrics state. Contains NO RNTP hooks.
 *                     Safe to mount at app startup, wraps the entire tree
 *                     so every screen can call useLyricsContext().
 *
 *   LyricsFetcher   — the only component that calls useActiveTrack().
 *                     Renders null (no UI). Must be mounted ONLY after
 *                     TrackPlayer.setupPlayer() has resolved. Place it
 *                     inside LyricsProvider, gated behind playerReady.
 *
 * Usage in _layout.tsx:
 *
 *   <LyricsProvider>          ← wraps Stack + all screens
 *     <Stack ... />
 *     {playerReady && <LyricsFetcher />}   ← gated
 *   </LyricsProvider>
 */

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useActiveTrack } from "react-native-track-player";
import { Client, Query } from "lrclib-api";

const client = new Client();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LyricLine = {
  text: string;
  startTime?: number;
};

export type LyricsContextType = {
  // Public API consumed by screens
  lyrics: LyricLine[];
  isFetchingLyrics: boolean;
  heights: number[];
  updateHeight: (index: number, height: number) => void;
  resetHeights: (length: number) => void;
  // Internal setters — used only by LyricsFetcher, not by screens
  _setLyrics: React.Dispatch<React.SetStateAction<LyricLine[]>>;
  _setIsFetchingLyrics: React.Dispatch<React.SetStateAction<boolean>>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const LyricsContext = createContext<LyricsContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// LyricsProvider — NO RNTP hooks. Safe to mount before setupPlayer().
// ─────────────────────────────────────────────────────────────────────────────

export const LyricsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [heights, setHeights] = useState<number[]>([]);

  const updateHeight = useCallback((index: number, height: number) => {
    setHeights((prev) => {
      const updated = [...prev];
      updated[index] = height;
      return updated;
    });
  }, []);

  const resetHeights = useCallback((length: number) => {
    setHeights(new Array(length).fill(0));
  }, []);

  return (
    <LyricsContext.Provider
      value={{
        lyrics,
        isFetchingLyrics,
        heights,
        updateHeight,
        resetHeights,
        // Expose setters so LyricsFetcher can write into this context
        _setLyrics: setLyrics,
        _setIsFetchingLyrics: setIsFetchingLyrics,
      }}
    >
      {children}
    </LyricsContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LyricsFetcher — calls useActiveTrack(). Mount ONLY after playerReady.
// Renders nothing — exists solely to drive fetch side-effects.
// ─────────────────────────────────────────────────────────────────────────────

export const LyricsFetcher: React.FC = () => {
  const { _setLyrics, _setIsFetchingLyrics, resetHeights } = useLyricsContext();

  const [lastLoadedTrackId, setLastLoadedTrackId] = useState<string | null>(null);

  // Safe: this component only ever mounts after setupPlayer() resolves
  const activeTrack = useActiveTrack();
  const activeTrackIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    activeTrackIdRef.current = activeTrack?.id;
  }, [activeTrack?.id]);

  const fetchLyrics = useCallback(async () => {
    if (!activeTrack) return;
    if (lastLoadedTrackId === activeTrack.id) return;

    setLastLoadedTrackId(activeTrack.id);
    _setIsFetchingLyrics(true);

    try {
      if (activeTrack.title && activeTrack.artist) {
        const searchParams: Query = {
          track_name: activeTrack.title,
          artist_name: activeTrack.artist,
        };

        if (activeTrack.duration) {
          searchParams.duration = activeTrack.duration * 1000;
        }

        const syncedLyrics = await client.getSynced(searchParams);

        // Guard against track changing mid-fetch
        if (activeTrackIdRef.current !== activeTrack.id) return;

        if (syncedLyrics && syncedLyrics.length > 0) {
          const sorted = [...syncedLyrics].sort(
            (a, b) => (a.startTime || 0) - (b.startTime || 0)
          );
          _setLyrics(sorted);
          resetHeights(sorted.length);
        } else {
          _setLyrics([{ text: "No lyrics available", startTime: 0 }]);
          resetHeights(1);
        }
      } else {
        _setLyrics([{ text: "No lyrics available", startTime: 0 }]);
        resetHeights(1);
      }
    } catch (error) {
      console.error("Error fetching lyrics:", error);
      if (activeTrackIdRef.current === activeTrack.id) {
        _setLyrics([{ text: "Error loading lyrics", startTime: 0 }]);
        resetHeights(1);
      }
    } finally {
      if (activeTrackIdRef.current === activeTrack.id) {
        _setIsFetchingLyrics(false);
      }
    }
  }, [activeTrack, lastLoadedTrackId, _setLyrics, _setIsFetchingLyrics, resetHeights]);

  useEffect(() => {
    if (activeTrack?.id && activeTrack.id !== lastLoadedTrackId) {
      fetchLyrics();
    }

    if (!activeTrack) {
      _setLyrics([]);
      resetHeights(0);
      setLastLoadedTrackId(null);
    }
  }, [activeTrack?.id, fetchLyrics, lastLoadedTrackId, _setLyrics, resetHeights]);

  return null; // no UI — drives side-effects only
};

// ─────────────────────────────────────────────────────────────────────────────
// useLyricsContext — public hook for screens
// ─────────────────────────────────────────────────────────────────────────────

export const useLyricsContext = () => {
  const context = useContext(LyricsContext);
  if (!context) {
    throw new Error("useLyricsContext must be used within LyricsProvider");
  }
  return context;
};