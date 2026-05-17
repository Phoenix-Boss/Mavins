/**
 * useCoverSongs Hook — Supabase DB Edition
 *
 * Reads throwback tracks via:
 *   sections (section_type = 'throwbacks')
 *     → section_items (track_id FK → tracks)
 *       → tracks (title, thumbnail_url, video_id)
 *
 * Thumbnail resolution:
 *   1. tracks.thumbnail_url          ← already set to i.ytimg.com/hqdefault
 *   2. i.ytimg.com from video_id     ← constructed if thumbnail_url is missing
 *   3. ''                            ← empty, component handles gracefully
 *
 * Cache: 12 h TTL, versioned key, auto-busts stale non-ytimg URLs.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoverItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  thumbnailFallback: string;
  duration: number;
  views: number;
}

interface UseCoverSongsResult {
  data: CoverItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ITEMS     = 8;
const CACHE_VERSION = 6;
const CACHE_KEY     = `covers:throwbacks:v${CACHE_VERSION}`; // v4 — busts stale v3 entries
const CACHE_TTL_MS  = 12 * 60 * 60 * 1000;

const VALID_THUMB_DOMAINS = ['i.ytimg.com', 'img.youtube.com'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ytThumb(videoId: string, quality: 'hqdefault' | 'mqdefault' = 'hqdefault'): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

function resolveThumbnail(thumbnailUrl: string | null, videoId: string | null): string {
  if (thumbnailUrl) return thumbnailUrl;
  if (videoId)      return ytThumb(videoId, 'hqdefault');
  return '';
}

function resolveFallback(videoId: string | null): string {
  if (videoId) return ytThumb(videoId, 'mqdefault');
  return '';
}

function isCacheValid(cached: CoverItem[]): boolean {
  return cached.every(item => {
    if (!item.thumbnail) return false;
    try {
      const host = new URL(item.thumbnail).hostname;
      return VALID_THUMB_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  });
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchCovers(): Promise<CoverItem[]> {
  // 1. Find the throwbacks section
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('section_type', 'throwbacks')
    .eq('is_visible', true)
    .maybeSingle();

  if (sectionError) {
    console.error('[useCoverSongs] Section fetch error:', sectionError);
    throw new Error(`Failed to find throwbacks section: ${sectionError.message}`);
  }

  if (!section) {
    throw new Error('No throwbacks section found');
  }

  // 2. Get section_items with joined track data in one query
  const { data: items, error: itemsError } = await supabase
    .from('section_items')
    .select(`
      display_order,
      position,
      track_id,
      tracks (
        id,
        title,
        video_id,
        duration_seconds,
        play_count,
        thumbnail_url,
        artist_id,
        artists (
          id,
          name
        )
      )
    `)
    .eq('section_id', section.id)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('position',      { ascending: true, nullsFirst: false })
    .limit(MAX_ITEMS);

  if (itemsError) {
    console.error('[useCoverSongs] Items fetch error:', itemsError);
    throw new Error(`Failed to fetch section items: ${itemsError.message}`);
  }

  if (!items?.length) {
    throw new Error('Throwbacks section has no items');
  }

  // 3. Map to CoverItem
  const mapped = items
    .map((item: any) => {
      const track = item.tracks;
      if (!track) return null;

      const artistName = track.artists?.name ?? 'Unknown Artist';

      return {
        id:                track.id,
        videoId:           track.video_id ?? '',
        title:             track.title    ?? 'Unknown Title',
        artist:            artistName,
        thumbnail:         resolveThumbnail(track.thumbnail_url, track.video_id),
        thumbnailFallback: resolveFallback(track.video_id),
        duration:          track.duration_seconds ?? 0,
        views:             track.play_count       ?? 0,
      } as CoverItem;
    })
    .filter((item): item is CoverItem => item !== null);

  if (!mapped.length) throw new Error('Could not map any tracks from throwbacks section');

  return mapped;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useCoverSongs = (): UseCoverSongsResult => {
  const [data,    setData]    = useState<CoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Try cache
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        if (isCacheValid(cached)) {
          console.log('📦 [useCoverSongs] Using valid cached data');
          setData(cached);
          setLoading(false);
          return;
        }
        console.warn('⚠️ [useCoverSongs] Stale cached thumbnails — busting cache');
        await cache.delete(CACHE_KEY);
      }

      // 2. Fetch fresh
      console.log('🔍 [useCoverSongs] Fetching from Supabase...');
      const covers = await fetchCovers();
      console.log(`✅ [useCoverSongs] Received ${covers.length} items`);

      // 3. Only cache if thumbnails are valid
      if (isCacheValid(covers)) {
        await cache.set(CACHE_KEY, covers, CACHE_TTL_MS);
      } else {
        console.warn('⚠️ [useCoverSongs] Fetched thumbnails invalid — skipping cache');
      }

      setData(covers);
    } catch (err: any) {
      console.error('❌ [useCoverSongs] Failed:', err);
      setError(err.message || 'Failed to load throwback songs');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};
