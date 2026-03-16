/**
 * useTrending Hook - Supabase DB Edition (Fixed)
 *
 * Fetches trending tracks with proper duration and play counts
 * Removes duplicates and returns only 3 shuffled items
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

export interface TrendingItem {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  videoId?: string;
}

interface UseTrendingResult {
  data: TrendingItem[];       // 3 shuffled items shown in section
  allData: TrendingItem[];    // full unsliced dataset — use for dedup in other sections
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
}

const CACHE_KEY = 'trending:now:v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DISPLAY_COUNT = 3;

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Normalize string for comparison
const normalizeKey = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
};

// Remove duplicates - priority: videoId > title+artist
const removeDuplicates = (items: TrendingItem[]): TrendingItem[] => {
  const seenVideoIds = new Set<string>();
  const seenSongs = new Set<string>();

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

async function fetchTrendingFromDB(): Promise<TrendingItem[]> {
  console.log('🔍 [useTrending] Fetching from database...');

  const { data: trendingTracks, error: trendingError } = await supabase
    .from('trending_tracks')
    .select('id, title, artist_name, streams');

  if (trendingError) {
    console.error('Error fetching trending tracks:', trendingError);
    throw new Error(`Failed to fetch trending: ${trendingError.message}`);
  }

  if (!trendingTracks || trendingTracks.length === 0) {
    console.log('No trending tracks found');
    return [];
  }

  console.log(`Found ${trendingTracks.length} trending tracks`);

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, duration, play_count, video_id');

  if (songsError) {
    console.error('Error fetching songs:', songsError);
    throw new Error(`Failed to fetch songs: ${songsError.message}`);
  }

  const songMap = new Map<string, typeof songs[0]>();

  songs?.forEach(song => {
    const key = `${normalizeKey(song.title)}-${normalizeKey(song.artist)}`;
    const existing = songMap.get(key);
    if (!existing || (song.play_count ?? 0) > (existing.play_count ?? 0)) {
      songMap.set(key, song);
    }
  });

  const items: TrendingItem[] = [];

  for (const track of trendingTracks) {
    const trackTitle = track.title ?? '';
    const trackArtist = track.artist_name ?? '';

    let song = songMap.get(`${normalizeKey(trackTitle)}-${normalizeKey(trackArtist)}`);

    if (!song) {
      for (const [key, s] of songMap.entries()) {
        if (key.includes(normalizeKey(trackTitle)) || normalizeKey(trackTitle).includes(key.split('-')[0])) {
          song = s;
          break;
        }
      }
    }

    const trendingStreams = track.streams ?? 0;
    const songPlays = song?.play_count ?? 0;

    items.push({
      id: track.id,
      title: trackTitle || 'Unknown Title',
      artist: trackArtist || 'Unknown Artist',
      thumbnail: song?.artwork_thumbnail || song?.artwork_url || '',
      duration: song?.duration ?? 0,
      views: Math.max(trendingStreams, songPlays),
      videoId: song?.video_id || undefined,
    });
  }

  const uniqueItems = removeDuplicates(items);
  console.log(`✅ Processed ${uniqueItems.length} unique items (removed ${items.length - uniqueItems.length} duplicates)`);

  return uniqueItems;
}

export const useTrending = (): UseTrendingResult => {
  const [rawData, setRawData] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  // 3 shuffled items shown in the section
  const data = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    const shuffled = shuffleArray(rawData);
    return shuffled.slice(0, DISPLAY_COUNT);
  }, [rawData, shuffleKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useTrending] Using cached data');
        setRawData(cached);
        setLoading(false);
        return;
      }

      const items = await fetchTrendingFromDB();

      if (items.length > 0) {
        console.log(`✅ [useTrending] Fetched ${items.length} unique items`);
        await cache.set(CACHE_KEY, items, CACHE_TTL_MS);
        setRawData(items);
      } else {
        console.log('⚠️ [useTrending] No items found');
        setRawData([]);
      }
    } catch (err: any) {
      console.error('❌ [useTrending] Failed:', err);
      setError(err.message || 'Failed to load trending music');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    if (rawData.length > 0) {
      console.log('🎲 [useTrending] Reshuffling...');
      setShuffleKey(prev => prev + 1);
    } else {
      fetchData();
    }
  }, [rawData.length, fetchData]);

  return {
    data,
    allData: rawData, // full dataset for dedup — never sliced or shuffled
    loading,
    error,
    refetch,
    isEmpty: data.length === 0,
  };
};