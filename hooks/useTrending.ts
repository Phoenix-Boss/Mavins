/**
 * useTrending Hook
 *
 * Fetches trending tracks from the trending_tracks table,
 * then joins to the tracks table (NOT the songs table) to get
 * video_id, thumbnail_url, and duration_seconds.
 *
 * The full YouTube watch URL is constructed here so every
 * downstream consumer (TrendingSongRow → playAudio) receives
 * a valid URL that MavinEngine can extract from.
 *
 * Tracks whose video_id is null (thumbnails from googleusercontent)
 * are included in the list but will be skipped gracefully by
 * MusicPlayerContext when extraction is attempted.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import MavinEngine from '@/modules/mavin-engine';
import type { Song } from '@/types/song';

export interface TrendingItem extends Song {
  duration: number;   // seconds — used for display formatting
  views:    number;   // play count for display
  artwork?: string;   // hi-res artwork URL for player screen
}

interface UseTrendingResult {
  data:     TrendingItem[];   // 3 shuffled items shown in section
  allData:  TrendingItem[];   // full unsliced dataset — for dedup
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
  isEmpty:  boolean;
}

const CACHE_KEY      = 'trending:now:v6';     // bumped — artwork_thumbnail fix
const CACHE_TTL_MS   = 6 * 60 * 60 * 1000;   // 6 hours
const DISPLAY_COUNT  = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const normalizeKey = (str: string): string =>
  str.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '');

const removeDuplicates = (items: TrendingItem[]): TrendingItem[] => {
  const seenVideoIds = new Set<string>();
  const seenSongs    = new Set<string>();

  return items.filter(item => {
    if (item.videoId?.trim()) {
      const vid = item.videoId.trim().toLowerCase();
      if (seenVideoIds.has(vid)) return false;
      seenVideoIds.add(vid);
      return true;
    }
    const key = `${normalizeKey(item.title)}-${normalizeKey(item.artist)}`;
    if (seenSongs.has(key)) return false;
    seenSongs.add(key);
    return true;
  });
};

// ─── YouTube search fallback ──────────────────────────────────────────────────

/**
 * For songs that have no video_id in the DB, search YouTube at runtime
 * to find the best matching video URL. Results are lightweight — we only
 * need the first StreamInfoItem from the results list.
 */
async function resolveVideoIdFromYouTube(
  title: string,
  artist: string,
): Promise<string> {
  try {
    const query = `${title} ${artist} official audio`;
    const results = await MavinEngine.search(query, 'music_songs', undefined, 0);
    const first = results?.results?.find((i: any) => i.type === 'stream' && !i.isLive && !i.isShortFormContent);
    if (first?.url) return first.url;
  } catch (e) {
    console.warn(`[useTrending] YouTube search fallback failed for "${title}":`, e);
  }
  return '';
}

// ─── DB fetch ─────────────────────────────────────────────────────────────────

async function fetchTrendingFromDB(): Promise<TrendingItem[]> {
  console.log('🔍 [useTrending] Fetching from database...');

  // Single query — join trending_tracks to songs directly in Postgres
  // using case-insensitive title match. This is far more reliable than
  // doing the join in JS where normalisation differences cause misses.
  const { data, error } = await supabase.rpc('get_trending_with_songs');

  if (error) {
    // RPC doesn't exist yet — fall back to two-step JS join
    console.warn('[useTrending] RPC not available, using JS join fallback:', error.message);
    return fetchTrendingFromDBFallback();
  }

  if (!data?.length) return [];

  const items: TrendingItem[] = (data as any[]).map(row => ({
    id:        row.song_id    ?? row.id,
    title:     row.title      ?? 'Unknown Title',
    artist:    row.artist_name ?? 'Unknown Artist',
    thumbnail: row.artwork_thumbnail || row.artwork_url || '',
    artwork:   row.artwork_url || row.artwork_thumbnail || '',
    url:       row.video_id ? `https://www.youtube.com/watch?v=${row.video_id}` : '',
    videoId:   row.video_id   ?? undefined,
    duration:  row.duration   ?? 0,
    views:     row.streams    ?? 0,
  }));

  const unique = removeDuplicates(items);
  console.log(`✅ [useTrending] ${unique.length} unique items`);
  return unique;
}

// ─── Fallback: two-step JS join (used if RPC not yet created) ─────────────────

async function fetchTrendingFromDBFallback(): Promise<TrendingItem[]> {
  const { data: trendingRows, error: trendingError } = await supabase
    .from('trending_tracks')
    .select('id, title, artist_name, streams');

  if (trendingError) throw new Error(`trending_tracks error: ${trendingError.message}`);
  if (!trendingRows?.length) return [];

  const { data: songRows, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_url, artwork_thumbnail, duration, play_count');

  if (songsError) throw new Error(`songs error: ${songsError.message}`);

  // Two lookup maps — title+artist and title-only
  const songMapFull  = new Map<string, typeof songRows[0]>();
  const songMapTitle = new Map<string, typeof songRows[0]>();
  songRows?.forEach(s => {
    const titleKey = normalizeKey(s.title ?? '');
    const fullKey  = `${titleKey}-${normalizeKey(s.artist ?? '')}`;
    if (!songMapFull.has(fullKey))   songMapFull.set(fullKey, s);
    if (!songMapTitle.has(titleKey)) songMapTitle.set(titleKey, s);
  });

  const items: TrendingItem[] = [];

  for (const row of trendingRows) {
    const tTitle  = row.title       ?? '';
    const tArtist = row.artist_name ?? '';
    const fullKey  = `${normalizeKey(tTitle)}-${normalizeKey(tArtist)}`;
    const titleKey = normalizeKey(tTitle);

    let song = songMapFull.get(fullKey)
            ?? songMapTitle.get(titleKey)
            ?? (() => {
                 for (const [key, s] of songMapTitle.entries()) {
                   if (key.startsWith(titleKey.slice(0, 8))) return s;
                 }
                 return undefined;
               })();

    const rawVideoId: string | null = song?.video_id ?? null;

    items.push({
      id:        song?.id ?? row.id,
      title:     tTitle  || 'Unknown Title',
      artist:    tArtist || 'Unknown Artist',
      // artwork_thumbnail = hqdefault YouTube image — fast, works for list
      // artwork_url = maxresdefault — hi-res for player screen
      thumbnail: (song as any)?.artwork_thumbnail || song?.artwork_url || '',
      artwork:   song?.artwork_url || (song as any)?.artwork_thumbnail || '',
      url:       rawVideoId ? `https://www.youtube.com/watch?v=${rawVideoId}` : '',
      videoId:   rawVideoId ?? undefined,
      duration:  song?.duration ?? 0,
      views:     Math.max(row.streams ?? 0, song?.play_count ?? 0),
    });
  }

  const unique = removeDuplicates(items);

  // Resolve missing URLs via YouTube search
  const missing = unique.filter(item => !item.url);
  if (missing.length > 0) {
    console.log(`[useTrending] resolving ${missing.length} missing video_ids...`);
    const CONCURRENCY = 5;
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async item => {
        const url = await resolveVideoIdFromYouTube(item.title, item.artist);
        if (url) { item.url = url; item.videoId = url.split('v=')[1]?.split('&')[0]; }
      }));
    }
  }

  console.log(`✅ [useTrending] ${unique.length} unique items`);
  return unique;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useTrending = (): UseTrendingResult => {
  const [rawData,    setRawData]    = useState<TrendingItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  const data = useMemo(() => {
    if (!rawData.length) return [];
    return shuffleArray(rawData).slice(0, DISPLAY_COUNT);
  }, [rawData, shuffleKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useTrending] cache hit');
        setRawData(cached);
        return;
      }
      const items = await fetchTrendingFromDB();
      if (items.length > 0) {
        await cache.set(CACHE_KEY, items, CACHE_TTL_MS);
        setRawData(items);
      } else {
        setRawData([]);
      }
    } catch (err: any) {
      console.error('❌ [useTrending]', err);
      setError(err.message ?? 'Failed to load trending music');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refetch = useCallback(() => {
    if (rawData.length > 0) setShuffleKey(k => k + 1);
    else fetchData();
  }, [rawData.length, fetchData]);

  return {
    data,
    allData: rawData,
    loading,
    error,
    refetch,
    isEmpty: data.length === 0,
  };
};