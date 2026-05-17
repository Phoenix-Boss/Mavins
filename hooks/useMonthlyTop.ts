/**
 * useMonthlyTop Hook — Supabase DB Edition
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { ChartRanking } from '@/libs/supabase';

export interface MonthlyItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  position: number;
}

interface UseMonthlyTopResult {
  data: MonthlyItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MAX_ITEMS = 10;
const CACHE_KEY = 'top:monthly';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function fetchMonthlyTop(): Promise<MonthlyItem[]> {
  const { data: latestDateData, error: dateError } = await supabase
    .from('chart_rankings')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dateError) throw new Error(`Failed to get latest chart date: ${dateError.message}`);

  const latestDate = latestDateData?.date;

  let query = supabase
    .from('chart_rankings')
    .select(`position, song_id, streams_today`)
    .order('position', { ascending: true })
    .limit(MAX_ITEMS);

  if (latestDate) {
    query = query.eq('date', latestDate);
  }

  const { data: rankings, error: rankingsError } = await query;

  if (rankingsError) throw new Error(`Failed to fetch chart rankings: ${rankingsError.message}`);
  if (!rankings?.length) throw new Error('No monthly top chart available');

  const songIds = rankings.map(r => r.song_id);

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count')
    .in('id', songIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);

  const songMap = new Map(songs?.map(song => [song.id, song]));

  const items = rankings
    .map((ranking: ChartRanking) => {
      const song = songMap.get(ranking.song_id);
      if (!song) return null;
      return {
        id: song.id,
        videoId: song.video_id ?? '',
        title: song.title ?? 'Unknown Title',
        artist: song.artist ?? 'Unknown Artist',
        thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
        duration: song.duration ?? 0,
        views: ranking.streams_today ?? song.play_count ?? 0,
        position: ranking.position,
      };
    })
    .filter((item): item is MonthlyItem => item !== null);

  return shuffleArray(items);
}

export const useMonthlyTop = (): UseMonthlyTopResult => {
  const [data, setData] = useState<MonthlyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useMonthlyTop] Using cached data');
        setData(shuffleArray(cached));
        setLoading(false);
        return;
      }
      console.log('🔍 [useMonthlyTop] Fetching from Supabase...');
      const monthly = await fetchMonthlyTop();
      console.log(`✅ [useMonthlyTop] Received ${monthly.length} items`);
      await cache.set(CACHE_KEY, monthly, CACHE_TTL_MS);
      setData(monthly);
    } catch (err: any) {
      console.error('❌ [useMonthlyTop] Failed:', err);
      setError(err.message || 'Failed to load monthly top chart');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};
