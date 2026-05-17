/**
 * useTopCharts Hook — Supabase DB Edition (with duplicate removal)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Song, ChartRanking } from '@/libs/supabase/types';

export interface ChartItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
  position: number;
}

interface UseTopChartsResult {
  data: ChartItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MAX_ITEMS = 20;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Normalize string for comparison
const normalizeKey = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
};

// Remove duplicates - priority: videoId > song_id > title+artist
const removeDuplicates = (items: ChartItem[]): ChartItem[] => {
  const seenVideoIds = new Set<string>();
  const seenIds = new Set<string>();
  const seenSongs = new Set<string>();
  
  return items.filter(item => {
    // Priority 1: videoId
    if (item.videoId?.trim()) {
      const vid = item.videoId.trim().toLowerCase();
      if (seenVideoIds.has(vid)) return false;
      seenVideoIds.add(vid);
      return true;
    }
    
    // Priority 2: song id
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    
    // Priority 3: title + artist (fallback)
    const key = `${normalizeKey(item.title)}-${normalizeKey(item.artist)}`;
    if (seenSongs.has(key)) return false;
    seenSongs.add(key);
    
    return true;
  });
};

async function fetchCharts(chartType: string = 'top50'): Promise<ChartItem[]> {
  // Get latest date
  const { data: latestDateData, error: dateError } = await supabase
    .from('chart_rankings')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dateError) throw new Error(`Failed to get latest chart date: ${dateError.message}`);
  
  const latestDate = latestDateData?.date;
  if (!latestDate) throw new Error('No chart date found');

  // Get rankings for latest date
  const { data: rankings, error: rankingsError } = await supabase
    .from('chart_rankings')
    .select('position, song_id, streams_today')
    .eq('date', latestDate)
    .order('position', { ascending: true });

  if (rankingsError) throw new Error(`Failed to fetch chart rankings: ${rankingsError.message}`);
  if (!rankings?.length) throw new Error(`No rankings found for chart`);

  // 🎯 CRITICAL: Remove duplicate song_ids, keep the one with best position (lowest number)
  const songIdMap = new Map<string, ChartRanking>();
  
  rankings.forEach((ranking: ChartRanking) => {
    const existing = songIdMap.get(ranking.song_id);
    // Keep the one with better (lower) position, or higher streams if same position
    if (!existing || 
        ranking.position < existing.position || 
        (ranking.position === existing.position && (ranking.streams_today ?? 0) > (existing.streams_today ?? 0))) {
      songIdMap.set(ranking.song_id, ranking);
    }
  });

  const uniqueRankings = Array.from(songIdMap.values())
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_ITEMS * 2);

  console.log(`📊 Rankings: ${rankings.length} → Unique: ${uniqueRankings.length} (removed ${rankings.length - uniqueRankings.length} duplicates)`);

  if (!uniqueRankings.length) throw new Error('No unique rankings found');

  const songIds = uniqueRankings.map(r => r.song_id);

  // Fetch songs
  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count')
    .in('id', songIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);

  const songMap = new Map(songs?.map((s: Song) => [s.id, s]));

  // Build items
  const items = uniqueRankings
    .map((ranking) => {
      const song = songMap.get(ranking.song_id);
      if (!song) {
        console.warn(`⚠️ Missing song: ${ranking.song_id}`);
        return null;
      }
      return {
        id: song.id,
        videoId: song.video_id ?? '',
        title: song.title ?? 'Unknown Title',
        artist: song.artist ?? 'Unknown Artist',
        duration: song.duration ?? 0,
        thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
        views: ranking.streams_today ?? song.play_count ?? 0,
        position: ranking.position,
      };
    })
    .filter((item): item is ChartItem => item !== null);

  // Final deduplication safety net
  const uniqueItems = removeDuplicates(items).slice(0, MAX_ITEMS);
  
  console.log(`✅ Final items: ${uniqueItems.length}`);

  return uniqueItems;
}

export const useTopCharts = (chartType: string = 'top50'): UseTopChartsResult => {
  const [data, setData] = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cacheKey = `charts:${chartType}:v2`; // Bumped version to invalidate old cache
    
    try {
      const cached = await cache.get(cacheKey);
      if (cached?.length) {
        console.log(`📦 [useTopCharts] cache hit — ${chartType} (${cached.length} items)`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useTopCharts] fetching ${chartType}…`);
      const items = await fetchCharts(chartType);
      console.log(`✅ [useTopCharts] ${items.length} items — ${chartType}`);
      await cache.set(cacheKey, items, CACHE_TTL_MS);
      setData(items);
    } catch (e: any) {
      console.error(`❌ [useTopCharts] ${chartType}:`, e.message);
      setError(e.message || `Failed to load ${chartType} charts`);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [chartType]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};
