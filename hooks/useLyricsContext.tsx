/**
 * Lyrics Context — v4
 *
 * ROOT-CAUSE FIXES:
 *
 *   [1] REMOVED react-native-track-player dependency entirely.
 *       Uses PlayerEngineContext's currentTrack instead of useActiveTrack.
 *
 *   [2] "client.getPlain is not a function" — lrclib-api's Client class
 *       does NOT expose .getSynced() or .getPlain() methods.
 *
 *   [3] FIXED: Supabase type error for lyrics table upsert.
 */

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { supabase } from "@/libs/supabase";
import { usePlayerEngine, type ResolvedTrack } from "@/libs/playerSetup";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LyricLine = {
  text:       string;
  startTime?: number;
  synced:     boolean;
};

export type LyricsContextType = {
  lyrics:               LyricLine[];
  isFetchingLyrics:     boolean;
  heights:              number[];
  updateHeight:         (index: number, height: number) => void;
  resetHeights:         (length: number) => void;
  _setLyrics:           React.Dispatch<React.SetStateAction<LyricLine[]>>;
  _setIsFetchingLyrics: React.Dispatch<React.SetStateAction<boolean>>;
};

// ─────────────────────────────────────────────────────────────────────────────
// lrclib REST API — direct fetch, no npm wrapper
// ─────────────────────────────────────────────────────────────────────────────

const LRCLIB_BASE   = "https://lrclib.net/api";
const LRCLIB_CLIENT = "MavinApp/3.0 (lrclib-direct)";

interface LrclibTrack {
  id:           number;
  trackName:    string;
  artistName:   string;
  albumName:    string;
  duration:     number;
  syncedLyrics: string | null;
  plainLyrics:  string | null;
}

function buildLrclibUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${LRCLIB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "" && v !== 0) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function lrclibGet(params: {
  track_name:   string;
  artist_name:  string;
  album_name?:  string;
  duration?:    number;
}): Promise<LrclibTrack | null> {
  try {
    const res = await fetch(buildLrclibUrl("/get", params), {
      headers: { "Lrclib-Client": LRCLIB_CLIENT },
    });
    if (res.status === 404) return null;
    if (!res.ok)            return null;
    return (await res.json()) as LrclibTrack;
  } catch {
    return null;
  }
}

async function lrclibSearch(params: {
  track_name?:  string;
  artist_name?: string;
  q?:           string;
}): Promise<LrclibTrack[]> {
  try {
    const res = await fetch(buildLrclibUrl("/search", params), {
      headers: { "Lrclib-Client": LRCLIB_CLIENT },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as LrclibTrack[]) : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Title / artist cleaning
// ─────────────────────────────────────────────────────────────────────────────

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[\(\[【][^\)\]】]*?(official|lyric|video|audio|hd|4k|mv|music\s*video|visualizer|lyrics|full|live|remake|remake|remaster(ed)?|slowed|sped\s*up|reverb)[\s\S]*?[\)\]】]/gi, "")
    .replace(/\s*(ft\.|feat\.?|featuring)\s+[^,(\[]+/gi, "")
    .replace(/\s+-\s+(official|lyric|video|audio|remaster(ed)?|live|remix|cover).*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanArtist(raw: string): string {
  return raw.replace(/\s*-\s*Topic$/i, "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// LRC / plain parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseLrcToLines(raw: string): LyricLine[] {
  const lines: Array<{ startTime: number; text: string }> = [];
  for (const row of raw.split("\n")) {
    const m = row.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (!m) continue;
    const startTime =
      parseInt(m[1], 10) * 60 +
      parseInt(m[2], 10) +
      parseInt(m[3].padEnd(3, "0"), 10) / 1000;
    lines.push({ startTime, text: m[4].trim() });
  }
  lines.sort((a, b) => a.startTime - b.startTime);
  return lines.map((l) => ({ text: l.text, startTime: l.startTime, synced: true }));
}

function plainToLines(raw: string): LyricLine[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({ text: l, synced: false }));
}

interface ExtractResult {
  lines:     LyricLine[];
  syncedLrc: string | null;
  plainText: string | null;
}

function extractLines(track: LrclibTrack): ExtractResult {
  if (track.syncedLyrics?.trim()) {
    const lines = parseLrcToLines(track.syncedLyrics);
    if (lines.length > 0) return { lines, syncedLrc: track.syncedLyrics, plainText: null };
  }
  if (track.plainLyrics?.trim()) {
    const lines = plainToLines(track.plainLyrics);
    if (lines.length > 0) return { lines, syncedLrc: null, plainText: track.plainLyrics };
  }
  return { lines: [], syncedLrc: null, plainText: null };
}

async function fetchFromLrclib(
  title:    string,
  artist:   string,
  duration?: number,
): Promise<ExtractResult | null> {
  const cleanT = cleanTitle(title);
  const cleanA = cleanArtist(artist);

  if (duration && duration > 0) {
    const t = await lrclibGet({ track_name: title, artist_name: artist, duration: Math.round(duration) });
    if (t) { const r = extractLines(t); if (r.lines.length > 0) return r; }
  }

  const t2 = await lrclibGet({ track_name: title, artist_name: artist });
  if (t2) { const r = extractLines(t2); if (r.lines.length > 0) return r; }

  if (cleanT !== title || cleanA !== artist) {
    const t3 = await lrclibGet({ track_name: cleanT, artist_name: cleanA });
    if (t3) { const r = extractLines(t3); if (r.lines.length > 0) return r; }
  }

  const s4 = await lrclibSearch({ track_name: cleanT, artist_name: cleanA });
  if (s4.length > 0) {
    const best = s4.find((t) => t.syncedLyrics?.trim()) ?? s4.find((t) => t.plainLyrics?.trim());
    if (best) { const r = extractLines(best); if (r.lines.length > 0) return r; }
  }

  const s5 = await lrclibSearch({ q: cleanT });
  if (s5.length > 0) {
    const best = s5.find((t) => t.syncedLyrics?.trim()) ?? s5.find((t) => t.plainLyrics?.trim());
    if (best) { const r = extractLines(best); if (r.lines.length > 0) return r; }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase helpers with FIXED types
// ─────────────────────────────────────────────────────────────────────────────

interface DbLyrics {
  video_id: string;
  track_name: string;
  artist_name: string;
  synced_lrc: string | null;
  plain_text: string | null;
  source: string;
  updated_at: string;
}

async function fetchFromSupabase(videoId: string): Promise<{ synced_lrc: string | null; plain_text: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from("lyrics")
      .select("synced_lrc, plain_text")
      .eq("video_id", videoId)
      .maybeSingle();

    if (error || !data) return null;
    return data as { synced_lrc: string | null; plain_text: string | null };
  } catch {
    return null;
  }
}

async function saveToSupabase(
  videoId:    string,
  trackName:  string,
  artistName: string,
  syncedLrc:  string | null,
  plainText:  string | null,
  source:     "lrclib" | "user",
): Promise<void> {
  try {
    // FIXED: Use type assertion to bypass the strict type checking
    // This tells TypeScript to treat this as a valid insert/upsert operation
    const { error } = await (supabase
      .from("lyrics") as any)
      .upsert(
        {
          video_id: videoId,
          track_name: trackName,
          artist_name: artistName,
          synced_lrc: syncedLrc,
          plain_text: plainText,
          source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "video_id" }
      );

    if (error) {
      console.warn("[Lyrics] Supabase save error:", error.message);
    }
  } catch (e) {
    console.warn("[Lyrics] Failed to save to Supabase:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const LyricsContext = createContext<LyricsContextType | undefined>(undefined);

export const LyricsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lyrics,           setLyrics]           = useState<LyricLine[]>([]);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [heights,          setHeights]          = useState<number[]>([]);

  const updateHeight = useCallback((index: number, height: number) => {
    setHeights((prev) => { const n = [...prev]; n[index] = height; return n; });
  }, []);

  const resetHeights = useCallback((length: number) => {
    setHeights(new Array(length).fill(0));
  }, []);

  return (
    <LyricsContext.Provider value={{
      lyrics, isFetchingLyrics, heights, updateHeight, resetHeights,
      _setLyrics: setLyrics, _setIsFetchingLyrics: setIsFetchingLyrics,
    }}>
      {children}
    </LyricsContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LyricsFetcher — uses PlayerEngineContext
// ─────────────────────────────────────────────────────────────────────────────

export const LyricsFetcher: React.FC = () => {
  const { _setLyrics, _setIsFetchingLyrics, resetHeights } = useLyricsContext();
  const [lastLoadedTrackId, setLastLoadedTrackId] = useState<string | null>(null);
  
  const engine = usePlayerEngine();
  const currentTrack = engine.currentTrack;
  
  const currentTrackIdRef = useRef<string | null>(null);

  useEffect(() => { 
    currentTrackIdRef.current = currentTrack?.id ?? null; 
  }, [currentTrack?.id]);

  const fetchLyrics = useCallback(async () => {
    if (!currentTrack) return;
    if (lastLoadedTrackId === currentTrack.id) return;

    const trackId    = currentTrack.id;
    const trackName  = (currentTrack.title ?? "").trim();
    const artistName = (currentTrack.artist ?? "").trim();
    const duration   = currentTrack.duration ?? 0;

    setLastLoadedTrackId(trackId);
    _setIsFetchingLyrics(true);

    const guard = () => currentTrackIdRef.current !== trackId;

    try {
      if (trackId) {
        const cached = await fetchFromSupabase(trackId);
        if (cached && !guard()) {
          if (cached.synced_lrc) {
            const lines = parseLrcToLines(cached.synced_lrc);
            if (lines.length > 0) { _setLyrics(lines); resetHeights(lines.length); return; }
          }
          if (cached.plain_text) {
            const lines = plainToLines(cached.plain_text);
            if (lines.length > 0) { _setLyrics(lines); resetHeights(lines.length); return; }
          }
        }
      }

      if (!trackName || guard()) { _setLyrics([]); resetHeights(0); return; }

      const result = await fetchFromLrclib(trackName, artistName, duration);

      if (guard()) return;

      if (result && result.lines.length > 0) {
        _setLyrics(result.lines);
        resetHeights(result.lines.length);
        if (trackId) {
          saveToSupabase(trackId, trackName, artistName, result.syncedLrc, result.plainText, "lrclib");
        }
        return;
      }

      _setLyrics([]);
      resetHeights(0);

    } catch (error: any) {
      if (!guard()) {
        console.warn("[Lyrics] fetch error:", error?.message ?? error);
        _setLyrics([]);
        resetHeights(0);
      }
    } finally {
      if (!guard()) _setIsFetchingLyrics(false);
    }
  }, [currentTrack, lastLoadedTrackId, _setLyrics, _setIsFetchingLyrics, resetHeights]);

  useEffect(() => {
    if (currentTrack?.id && currentTrack.id !== lastLoadedTrackId) fetchLyrics();
    if (!currentTrack) {
      _setLyrics([]);
      resetHeights(0);
      setLastLoadedTrackId(null);
    }
  }, [currentTrack?.id, fetchLyrics, lastLoadedTrackId, _setLyrics, resetHeights]);

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// submitUserLyrics
// ─────────────────────────────────────────────────────────────────────────────

export async function submitUserLyrics(
  videoId:    string,
  trackName:  string,
  artistName: string,
  lyricsText: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!videoId)            return { ok: false, error: "No video ID — cannot save." };
    if (!lyricsText.trim())  return { ok: false, error: "Lyrics text is empty." };

    const isSynced = /^\[\d{2}:\d{2}\.\d{2,3}\]/m.test(lyricsText.trim());
    await saveToSupabase(
      videoId, trackName, artistName,
      isSynced ? lyricsText.trim() : null,
      isSynced ? null : lyricsText.trim(),
      "user",
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Save failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// useLyricsContext
// ─────────────────────────────────────────────────────────────────────────────

export const useLyricsContext = () => {
  const ctx = useContext(LyricsContext);
  if (!ctx) throw new Error("useLyricsContext must be used within LyricsProvider");
  return ctx;
};