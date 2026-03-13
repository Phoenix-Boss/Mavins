/**
 * useEditorPicks Hook — Supabase DB Edition
 *
 * Data flow:
 * sections (section_type = 'mavins_best')
 *   → section_items (track_id)
 *     → songs (title, artist, artwork_url, video_id, play_count, duration)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface EditorPickItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  popularity: number;
}

interface UseEditorPicksResult {
  data: EditorPickItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ITEMS = 8;
const CACHE_KEY = 'editor:picks';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────
async function fetchEditorPicks(): Promise<EditorPickItem[]> {
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'mavins_best')
    .eq('is_visible', true)
    .single();

  if (sectionError || !section) {
    throw new Error(`Mavin's Best section not found: ${sectionError?.message}`);
  }

  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  if (!sectionItems?.length) throw new Error("Mavin's Best section has no items");

  const trackIds = sectionItems.map(si => si.track_id);

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .in('id', trackIds);

  if (songsError) throw new Error(`Failed to fetch songs: ${songsError.message}`);
  if (!songs?.length) throw new Error("No songs found for Mavin's Best section");

  const songMap = new Map(songs.map(s => [s.id, s]));

  const items: EditorPickItem[] = sectionItems
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
    .filter((item): item is EditorPickItem => item !== null);

  if (!items.length) throw new Error("Could not map any Mavin's Best songs");
  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useEditorPicks = (): UseEditorPicksResult => {
  const [data, setData]       = useState<EditorPickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useEditorPicks] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [useEditorPicks] Fetching from Supabase...');
      const picks = await fetchEditorPicks();
      console.log(`✅ [useEditorPicks] Received ${picks.length} items`);
      await cache.set(CACHE_KEY, picks, CACHE_TTL_MS);
      setData(picks);
    } catch (err: any) {
      console.error('❌ [useEditorPicks] Failed:', err);
      setError(err.message || "Failed to load Mavin's Best");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};