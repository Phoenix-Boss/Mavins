/**
 * useFeatured Hook — Supabase DB Edition
 *
 * Data flow:
 * sections (section_type = 'featured')
 *   → section_items (track_id)
 *     → songs (title, artist, artwork_url, video_id, play_count, duration)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface FeaturedItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  popularity: number;
}

interface UseFeaturedResult {
  data: FeaturedItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 8;
const CACHE_KEY = 'featured:music';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────
async function fetchFeatured(): Promise<FeaturedItem[]> {
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'featured')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Featured section not found: ${sectionError?.message}`);
  }

  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  if (!sectionItems?.length) throw new Error('Featured section has no items');

  const trackIds = sectionItems.map(si => si.track_id);

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .in('id', trackIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);
  if (!songs?.length) throw new Error('No songs found for featured section');

  const songMap = new Map(songs.map(s => [s.id, s]));

  const items: FeaturedItem[] = sectionItems
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
        popularity: song.popularity ?? 0,
      };
    })
    .filter((item): item is FeaturedItem => item !== null);

  if (!items.length) throw new Error('Could not map any featured songs');
  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useFeatured = (): UseFeaturedResult => {
  const [data, setData]       = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchFeaturedData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useFeatured] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [useFeatured] Fetching from Supabase...');
      const featured = await fetchFeatured();
      console.log(`✅ [useFeatured] Received ${featured.length} items`);
      await cache.set(CACHE_KEY, featured, CACHE_TTL_MS);
      setData(featured);
    } catch (err: any) {
      console.error('❌ [useFeatured] Failed:', err);
      setError(err.message || 'Failed to load featured music');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFeaturedData(); }, [fetchFeaturedData]);

  return { data, loading, error, refetch: fetchFeaturedData };
};