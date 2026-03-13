/**
 * useCoverSongs Hook — Supabase DB Edition
 * 
 * NOTE: The "Covers" section has been renamed to "Throwbacks" in the DB.
 * This hook now fetches from section_type = 'throwbacks'.
 *
 * Data flow:
 * sections (section_type = 'throwbacks')
 *   → section_items (track_id)
 *     → songs (title, artist, artwork_url, video_id, play_count, duration)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface CoverItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UseCoverSongsResult {
  data: CoverItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 8;
const CACHE_KEY = 'covers:throwbacks';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────
async function fetchCovers(): Promise<CoverItem[]> {
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'throwbacks')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Throwbacks section not found: ${sectionError?.message}`);
  }

  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  if (!sectionItems?.length) throw new Error('Throwbacks section has no items');

  const trackIds = sectionItems.map(si => si.track_id);

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration')
    .in('id', trackIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);
  if (!songs?.length) throw new Error('No songs found for throwbacks section');

  const songMap = new Map(songs.map(s => [s.id, s]));

  const items: CoverItem[] = sectionItems
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
    .filter((item): item is CoverItem => item !== null);

  if (!items.length) throw new Error('Could not map any throwback songs');
  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useCoverSongs = (): UseCoverSongsResult => {
  const [data, setData]       = useState<CoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchCoverSongs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useCoverSongs] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [useCoverSongs] Fetching from Supabase...');
      const covers = await fetchCovers();
      console.log(`✅ [useCoverSongs] Received ${covers.length} items`);
      await cache.set(CACHE_KEY, covers, CACHE_TTL_MS);
      setData(covers);
    } catch (err: any) {
      console.error('❌ [useCoverSongs] Failed:', err);
      setError(err.message || 'Failed to load throwback songs');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCoverSongs(); }, [fetchCoverSongs]);

  return { data, loading, error, refetch: fetchCoverSongs };
};