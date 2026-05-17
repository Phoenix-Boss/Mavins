/**
 * useFeatured Hook — Supabase DB Edition (FIXED with types)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Song } from '@/libs/supabase';

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

const MAX_ITEMS = 8;
const CACHE_KEY = 'featured:music';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function fetchFeatured(): Promise<FeaturedItem[]> {
  // Find the featured section
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .or('name.ilike.%featured%,section_type.eq.featured')
    .eq('is_visible', true)
    .maybeSingle();

  if (sectionError) throw new Error(`Failed to find featured section: ${sectionError.message}`);
  
  // If no section, fallback to popular songs
  if (!section) {
    const { data: songs, error: songsError } = await supabase
      .from('songs')
      .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, popularity')
      .not('artwork_thumbnail', 'is', null)
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('play_count', { ascending: false })
      .limit(MAX_ITEMS);

    if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);
    if (!songs?.length) throw new Error('No songs found');

    return songs.map((song: Song) => ({
      id: song.id,
      videoId: song.video_id ?? '',
      title: song.title ?? 'Unknown Title',
      artist: song.artist ?? 'Unknown Artist',
      thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
      duration: song.duration ?? 0,
      views: song.play_count ?? 0,
      popularity: song.popularity ?? 0,
    }));
  }

  // Get section items with track_ids
  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order, position')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('position', { ascending: true, nullsFirst: false })
    .limit(MAX_ITEMS);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  if (!sectionItems?.length) throw new Error('Featured section has no items');

  const trackIds = sectionItems.map(item => item.track_id).filter(Boolean) as string[];

  // Fetch the actual songs
  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, popularity')
    .in('id', trackIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);
  
  const songMap = new Map(songs?.map(song => [song.id, song]));

  return sectionItems
    .map(item => {
      const song = songMap.get(item.track_id!);
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
}

export const useFeatured = (): UseFeaturedResult => {
  const [data, setData] = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
