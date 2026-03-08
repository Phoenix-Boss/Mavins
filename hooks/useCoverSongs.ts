/**
 * useCoverSongs Hook
 *
 * Fetches cover songs and acoustic versions via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "all", null, 0)
 *
 * filter="all" is correct — it is the only valid filter on standard
 * YouTube (serviceId=0) and returns StreamInfoItems.
 */

import { useState, useEffect, useCallback } from 'react';
import { search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export type { StreamInfoItem as CoverItem } from '@/modules/mavin-engine';

interface UseCoverSongsResult {
  data: StreamInfoItem[];
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
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const SEARCH_QUERIES = [
  'acoustic cover songs',
  'best cover songs 2024',
  'popular acoustic covers',
  'cover songs',
  'acoustic versions',
];

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchCovers(): Promise<StreamInfoItem[]> {
  for (const query of SEARCH_QUERIES) {
    try {
      const result = await search(
        query,
        'all',
        undefined,
        YOUTUBE_SERVICE_ID,
      ) as SearchPage;

      if (!result.success) continue;

      const items = result.results
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .filter(item => !item.isLive && !item.isShortFormContent && item.url)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No cover songs available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useCoverSongs = (): UseCoverSongsResult => {
  const [data, setData]       = useState<StreamInfoItem[]>([]);
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

  return { data, loading, error, refetch: fetchCoverSongs };
};