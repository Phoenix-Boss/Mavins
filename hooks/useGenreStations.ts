/**
 * useGenreStations Hook
 *
 * Fetches genre-based music tracks via MavinEngine.search().
 * Calls Kotlin: performSearch("{genre} music", "all", null, 0)
 *
 * ── Why filter="all" ────────────────────────────────────────────────────────
 * "songs" is a YouTube Music-specific content filter not registered
 * in the standard YouTube service (serviceId=0) searchQHFactory.
 * Passing it causes Kotlin to throw an invalid filter error.
 * "all" is always valid on serviceId=0 and returns StreamInfoItems.
 *
 * Returns StreamInfoItem[] directly — no custom mapping.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export type { StreamInfoItem as GenreItem } from '@/modules/mavin-engine';

interface UseGenreStationsResult {
  data: StreamInfoItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchGenre(genre: string): Promise<StreamInfoItem[]> {
  // Calls Kotlin: performSearch("{genre} music", "all", null, 0)
  // "all" is the only valid filter for standard YouTube (serviceId=0)
  const result = await MavinEngine.search(
    `${genre} music`,
    'all',            // ← was 'songs', invalid on serviceId=0
    undefined,
    YOUTUBE_SERVICE_ID,
  ) as SearchPage;

  if (!result.success) {
    throw new Error(result.errors?.[0] || `No results for ${genre}`);
  }

  const items = result.results
    .filter((item): item is StreamInfoItem => item.type === 'stream')
    .filter(item => !item.isLive && !item.isShortFormContent && item.url)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error(`No ${genre} tracks available`);
  }

  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useGenreStations = (genre: string): UseGenreStationsResult => {
  const [data, setData]       = useState<StreamInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchGenreStations = useCallback(async () => {
    if (!genre?.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const cacheKey = `genre:${genre.toLowerCase().trim()}`;

      const cached = await cache.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`📦 [useGenreStations] Using cached data for ${genre}`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useGenreStations] Fetching ${genre} from native module...`);
      const stations = await fetchGenre(genre);

      console.log(`✅ [useGenreStations] Received ${stations.length} stations for ${genre}`);
      await cache.set(cacheKey, stations, CACHE_TTL_MS);
      setData(stations);
    } catch (err: any) {
      console.error(`❌ [useGenreStations] Failed for ${genre}:`, err);
      setError(err.message || `Failed to load ${genre} stations`);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [genre]);

  useEffect(() => {
    fetchGenreStations();
  }, [fetchGenreStations]);

  return { data, loading, error, refetch: fetchGenreStations };
};