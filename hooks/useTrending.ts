/**
 * useTrending Hook - Supabase DB Edition
 *
 * Data flow:
 * sections (section_type = 'trending')
 *   → section_items (track_id)
 *     → songs (title, artist, artwork_url, video_id, play_count, duration)
 *
 * Cache layers:
 * 1. In-memory cache (libs/cache) — 6 hours TTL
 * 2. Supabase DB — source of truth
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface TrendingItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UseTrendingResult {
  data: TrendingItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
  source: string | null; // 'supabase' | 'cache' | null
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 10;
const CACHE_KEY = 'trending:now';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─────────────────────────────────────────────
// Fetch from Supabase
// ─────────────────────────────────────────────
async function fetchFromSupabase(): Promise<{ items: TrendingItem[]; source: string }> {
  // Step 1: Get the trending section id
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'trending')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Trending section not found: ${sectionError?.message}`);
  }

  // Step 2: Get section_items for that section, ordered by display_order
  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsError) {
    throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  }

  if (!sectionItems || sectionItems.length === 0) {
    throw new Error('Trending section has no items');
  }

  const trackIds = sectionItems.map(si => si.track_id);

  // Step 3: Fetch the songs for those track IDs
  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select(`
      id,
      title,
      artist,
      artwork_url,
      artwork_thumbnail,
      video_id,
      play_count,
      duration,
      popularity
    `)
    .in('id', trackIds);

  if (songsError) {
    throw new Error(`Failed to fetch songs: ${songsError.message}`);
  }

  if (!songs || songs.length === 0) {
    throw new Error('No songs found for trending section');
  }

  // Step 4: Re-order songs to match section display_order
  const songMap = new Map(songs.map(s => [s.id, s]));

  const items: TrendingItem[] = sectionItems
    .map(si => {
      const song = songMap.get(si.track_id);
      if (!song) return null;
      return {
        id: song.id,
        videoId: song.video_id ?? '',
        title: song.title ?? 'Unknown Title',
        artist: song.artist ?? 'Unknown Artist',
        thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
        duration: song.duration ?? 0,
        views: song.play_count ?? 0,
      };
    })
    .filter((item): item is TrendingItem => item !== null);

  if (items.length === 0) {
    throw new Error('Could not map any trending songs');
  }

  console.log(`✅ [useTrending] Loaded ${items.length} items from Supabase`);
  return { items, source: 'supabase' };
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useTrending = (): UseTrendingResult => {
  const [data, setData] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const fetchTrendingData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Layer 1: Check local cache first
      const cached = await cache.get(CACHE_KEY);
      if (cached?.items?.length > 0) {
        console.log('📦 [useTrending] Using cached data');
        setData(cached.items);
        setSource('cache');
        setLoading(false);
        return;
      }

      // Layer 2: Fetch from Supabase
      const result = await fetchFromSupabase();

      // Store in local cache
      await cache.set(CACHE_KEY, { items: result.items, source: result.source }, CACHE_TTL_MS);

      setData(result.items);
      setSource(result.source);
    } catch (err: any) {
      console.error('❌ [useTrending] Failed:', err);
      setError(err.message || 'Could not load trending music');
      setData([]);
      setSource(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrendingData();
  }, [fetchTrendingData]);

  return {
    data,
    loading,
    error,
    refetch: fetchTrendingData,
    isEmpty: data.length === 0,
    source,
  };
};