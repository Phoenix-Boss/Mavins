/**
 * useGenreStations Hook — Supabase DB Edition
 *
 * Data flow (genre filter provided):
 * sections (section_type = 'navigation_buttons')
 *   → section_items (genre_id, playlist_id, custom_title matching genre)
 *     → playlists (title, thumbnail, custom_metadata)
 *
 * Data flow (no genre filter — returns all moods & genres):
 * sections (section_type = 'navigation_buttons')
 *   → section_items (all items ordered by display_order)
 *     → genre details via custom_title + custom_subtitle
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface GenreItem {
  id: string;
  playlistId: string | null;
  title: string;
  subtitle: string;
  thumbnail: string;
  genre: string;
  metadata: Record<string, any>;
}

interface UseGenreStationsResult {
  data: GenreItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────
async function fetchGenreStations(genre?: string): Promise<GenreItem[]> {
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'navigation_buttons')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Moods & Genres section not found: ${sectionError?.message}`);
  }

  // Build query — filter by genre title if provided
  let query = supabase
    .from('section_items')
    .select(`
      id,
      playlist_id,
      genre_id,
      display_order,
      custom_title,
      custom_subtitle,
      custom_thumbnail_url,
      custom_metadata
    `)
    .eq('section_id', section.id)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  // If genre param given, filter to matching custom_title (case-insensitive)
  if (genre?.trim()) {
    query = query.ilike('custom_title', `%${genre.trim()}%`);
  }

  const { data: items, error: itemsError } = await query;

  if (itemsError) throw new Error(`Failed to fetch genre items: ${itemsError.message}`);
  if (!items?.length) throw new Error(`No genre stations found${genre ? ` for "${genre}"` : ''}`);

  return items.map(item => ({
    id: item.id,
    playlistId: item.playlist_id ?? null,
    title: item.custom_title ?? 'Unknown Genre',
    subtitle: item.custom_subtitle ?? '',
    thumbnail: item.custom_thumbnail_url ?? '',
    genre: item.custom_subtitle ?? item.custom_title ?? '',
    metadata: item.custom_metadata ?? {},
  }));
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useGenreStations = (genre?: string): UseGenreStationsResult => {
  const [data, setData]       = useState<GenreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchGenreStationsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const cacheKey = `genre:${genre?.toLowerCase().trim() ?? 'all'}`;

    try {
      const cached = await cache.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`📦 [useGenreStations] Using cached data for "${genre ?? 'all'}"`);
        setData(cached);
        setLoading(false);
        return;
      }
      console.log(`🔍 [useGenreStations] Fetching "${genre ?? 'all'}" from Supabase...`);
      const stations = await fetchGenreStations(genre);
      console.log(`✅ [useGenreStations] Received ${stations.length} items`);
      await cache.set(cacheKey, stations, CACHE_TTL_MS);
      setData(stations);
    } catch (err: any) {
      console.error(`❌ [useGenreStations] Failed for "${genre ?? 'all'}":`, err);
      setError(err.message || `Failed to load ${genre ?? 'genre'} stations`);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [genre]);

  useEffect(() => { fetchGenreStationsData(); }, [fetchGenreStationsData]);

  return { data, loading, error, refetch: fetchGenreStationsData };
};