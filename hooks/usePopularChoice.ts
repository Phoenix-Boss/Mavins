/**
 * usePopularChoice Hook — Supabase DB Edition (FIXED with shuffle + deduplication)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Song } from '@/libs/supabase';

export interface PopularItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UsePopularChoiceOptions {
  excludeIds?: string[]; // IDs to exclude (e.g., from Trending section)
  shuffle?: boolean;     // Whether to shuffle results
}

interface UsePopularChoiceResult {
  data: PopularItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
}

const MAX_ITEMS = 20; // Fetch more to account for exclusions
const DISPLAY_COUNT = 8; // Show 8 items
const CACHE_KEY = 'popular:choice:v2'; // Bumped version
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Fisher-Yates shuffle
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

async function fetchPopular(excludeIds: string[] = []): Promise<PopularItem[]> {
  // Build query excluding specific IDs
  let query = supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, popularity')
    .not('artwork_thumbnail', 'is', null);

  // Exclude IDs already shown in other sections
  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`);
  }

  const { data, error } = await query
    .order('popularity', { ascending: false, nullsFirst: false })
    .order('play_count', { ascending: false, nullsFirst: false })
    .limit(MAX_ITEMS);

  if (error) throw new Error(`Failed to fetch popular songs: ${error.message}`);
  if (!data?.length) {
    console.log('⚠️ [usePopularChoice] No popular songs found');
    return [];
  }

  const items = (data as Song[]).map(song => ({
    id: song.id,
    videoId: song.video_id ?? '',
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    duration: song.duration ?? 0,
    views: song.play_count ?? 0,
  })).filter(item => item.thumbnail !== ''); // Only items with thumbnails

  console.log(`✅ [usePopularChoice] Fetched ${items.length} items (excluded ${excludeIds.length})`);
  return items;
}

export const usePopularChoice = (options: UsePopularChoiceOptions = {}): UsePopularChoiceResult => {
  const { excludeIds = [], shuffle = true } = options;
  const [rawData, setRawData] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  // Apply shuffle and limit
  const data = useMemo(() => {
    if (!rawData.length) return [];
    let result = shuffle ? shuffleArray(rawData) : rawData;
    return result.slice(0, DISPLAY_COUNT);
  }, [rawData, shuffle, shuffleKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check cache (but don't use cache if we have exclusions that might have changed)
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0 && excludeIds.length === 0) {
        console.log('📦 [usePopularChoice] Using cached data');
        setRawData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [usePopularChoice] Fetching from Supabase...');
      const popular = await fetchPopular(excludeIds);
      
      if (popular.length > 0) {
        // Only cache if no exclusions (otherwise cache would be polluted)
        if (excludeIds.length === 0) {
          await cache.set(CACHE_KEY, popular, CACHE_TTL_MS);
        }
        setRawData(popular);
      } else {
        setRawData([]);
      }
    } catch (err: any) {
      console.error('❌ [usePopularChoice] Failed:', err);
      setError(err.message || 'Failed to load popular music');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, [excludeIds]);

  useEffect(() => { load(); }, [load]);

  // Reshuffle without refetching
  const refetch = useCallback(() => {
    if (rawData.length > 0 && shuffle) {
      console.log('🎲 [usePopularChoice] Reshuffling...');
      setShuffleKey(prev => prev + 1);
    } else {
      load();
    }
  }, [rawData.length, shuffle, load]);

  return { 
    data, 
    loading, 
    error, 
    refetch,
    isEmpty: data.length === 0 
  };
};