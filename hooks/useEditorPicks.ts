/**
 * useEditorPicks Hook — Supabase DB Edition
 *
 * Data flow:
 *   sections (mavins_best) → section_items → songs
 *   Fallback: top songs by popularity
 *
 * Full pool cached — one item shown at a time, always different from last.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Song } from '@/libs/supabase';

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
  data: EditorPickItem[];  // always 1 item — the current featured pick
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const FETCH_COUNT  = 20;           // full pool stored in cache
const CACHE_KEY    = 'editor:picks:v2'; // bumped — pool approach
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Pick 1 item that is NOT the lastShownId. Resets if pool exhausted. */
function pickFresh(
  pool: EditorPickItem[],
  lastShownId: string | null
): EditorPickItem {
  const fresh = pool.filter(item => item.id !== lastShownId);
  const source = fresh.length > 0 ? fresh : pool;
  return shuffleArray(source)[0];
}

async function fetchEditorPicks(): Promise<EditorPickItem[]> {
  // Try mavins_best section first
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .or('name.ilike.%editor%pick%,section_type.eq.mavins_best')
    .eq('is_visible', true)
    .maybeSingle();

  if (sectionError) throw new Error(`Failed to find editor picks section: ${sectionError.message}`);

  // ── Fallback: top songs by popularity ────────────────────
  if (!section) {
    const { data: songs, error: songsError } = await supabase
      .from('songs')
      .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, popularity')
      .not('artwork_thumbnail', 'is', null)
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('play_count', { ascending: false })
      .limit(FETCH_COUNT);

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

  // ── Section items → songs ─────────────────────────────────
  const { data: sectionItems, error: itemsError } = await supabase
    .from('section_items')
    .select('track_id, display_order, position')
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('position', { ascending: true, nullsFirst: false })
    .limit(FETCH_COUNT);

  if (itemsError) throw new Error(`Failed to fetch section items: ${itemsError.message}`);

  // Section exists but has no items — fall through to popular songs fallback
  if (!sectionItems?.length) {
    const { data: songs, error: songsError } = await supabase
      .from('songs')
      .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, popularity')
      .not('artwork_thumbnail', 'is', null)
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('play_count', { ascending: false })
      .limit(FETCH_COUNT);

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

  const trackIds = sectionItems.map(item => item.track_id).filter(Boolean) as string[];

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
    .filter((item): item is EditorPickItem => item !== null);
}

export const useEditorPicks = (): UseEditorPicksResult => {
  const [data, setData]       = useState<EditorPickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Track last shown ID so next pick is always different
  const lastShownId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ── Cache hit ─────────────────────────────────────────
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useEditorPicks] Using cached pool');
        const pick = pickFresh(cached, lastShownId.current);
        lastShownId.current = pick.id;
        setData([pick]);
        setLoading(false);
        return;
      }

      // ── Fresh fetch ───────────────────────────────────────
      console.log('🔍 [useEditorPicks] Fetching from Supabase...');
      const pool = await fetchEditorPicks();
      console.log(`✅ [useEditorPicks] Received ${pool.length} items`);
      await cache.set(CACHE_KEY, pool, CACHE_TTL_MS); // store full pool

      const pick = pickFresh(pool, lastShownId.current);
      lastShownId.current = pick.id;
      setData([pick]);
    } catch (err: any) {
      console.error('❌ [useEditorPicks] Failed:', err);
      setError(err.message || 'Failed to load editor picks');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};