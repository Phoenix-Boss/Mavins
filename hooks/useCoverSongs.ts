/**
 * useCoverSongs Hook
 *
 * Fetches cover songs and acoustic versions via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "songs", null, 0)
 *
 * "songs" is the YouTube Music content filter in NewPipe extractor —
 * returns music tracks only, no channels or playlists.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface CoverItem {
  id: string;        // stable React key (stream url)
  videoId: string;   // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;    // uploaderName — the performer of the cover
  thumbnail: string;
  duration: number;  // seconds
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

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'covers:popular';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — matches original

// Fallback query chain: try each until results come back
const SEARCH_QUERIES = [
  'cover songs acoustic 2025',
  'best cover songs',
  'acoustic cover versions',
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function pickBestThumbnail(thumbnails: StreamInfoItem['thumbnails']): string {
  if (!thumbnails?.length) return '';
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  for (const level of priority) {
    const match = thumbnails.find(t => t.resolutionLevel === level);
    if (match?.url) return match.url;
  }
  return thumbnails[0]?.url ?? '';
}

function toCoverItem(item: StreamInfoItem): CoverItem | null {
  if (item.isLive) return null;
  if (item.isShortFormContent) return null;
  if (!item.url) return null;

  return {
    id: item.url,
    videoId: item.url,
    title: item.name?.trim() || 'Unknown Title',
    artist: item.uploaderName?.trim() || 'Unknown Artist',
    thumbnail: pickBestThumbnail(item.thumbnails),
    duration: Number(item.duration) || 0,
    views: Number(item.viewCount) || 0,
  };
}

// ─────────────────────────────────────────────
// Fetcher — tries each query until we have items
// ─────────────────────────────────────────────

async function fetchCovers(): Promise<CoverItem[]> {
  for (const query of SEARCH_QUERIES) {
    try {
      // ✅ Calls Kotlin: performSearch(query, "songs", null, 0)
      const result = await MavinEngine.search(
        query,
        'songs',
        undefined,
        YOUTUBE_SERVICE_ID,
      ) as SearchPage;

      if (!result.success) continue;

      const items = (result.results as StreamInfoItem[])
        .filter(item => item.type === 'stream')
        .map(toCoverItem)
        .filter((item): item is CoverItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue; // try next query
    }
  }
  throw new Error('No cover songs available');
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
      // Cache read
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        console.log('📦 [useCoverSongs] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
      console.log('🔍 [useCoverSongs] Fetching from native module...');
      const covers = await fetchCovers();

      console.log(`✅ [useCoverSongs] Received ${covers.length} covers`);
      await cache.set(CACHE_KEY, covers, CACHE_TTL_MS);
      setData(covers);

    } catch (err: any) {
      console.error('❌ [useCoverSongs] Failed:', err);
      setError(err.message || 'Failed to load cover songs');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoverSongs();
  }, [fetchCoverSongs]);

  const refetch = () => fetchCoverSongs();

  return { data, loading, error, refetch };
};