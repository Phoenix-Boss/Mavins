/**
 * usePopularChoice Hook
 *
 * Fetches popular/viral music via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "songs", null, 0)
 *
 * No getPopularChoice() exists in Kotlin — popularity-focused
 * search queries are the correct approach via NewPipe extractor.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface PopularItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName
  thumbnail: string;
  duration: number; // seconds
  views: number;
}

interface UsePopularChoiceResult {
  data: PopularItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'popular:choice'; // matches original
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — matches original

// Fallback query chain
const SEARCH_QUERIES = [
  'most popular songs 2025',
  'viral music hits 2025',
  'top trending songs',
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

function toPopularItem(item: StreamInfoItem): PopularItem | null {
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
// Fetcher — tries each query until items found
// ─────────────────────────────────────────────

async function fetchPopular(): Promise<PopularItem[]> {
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
        .map(toPopularItem)
        .filter((item): item is PopularItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No popular music available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const usePopularChoice = (): UsePopularChoiceResult => {
  const [data, setData]       = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchPopularChoice = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Cache read
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        console.log('📦 [usePopularChoice] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
      console.log('🔍 [usePopularChoice] Fetching from native module...');
      const popular = await fetchPopular();

      console.log(`✅ [usePopularChoice] Received ${popular.length} items`);
      await cache.set(CACHE_KEY, popular, CACHE_TTL_MS);
      setData(popular);

    } catch (err: any) {
      console.error('❌ [usePopularChoice] Failed:', err);
      setError(err.message || 'Failed to load popular music');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPopularChoice();
  }, [fetchPopularChoice]);

  const refetch = () => fetchPopularChoice();

  return { data, loading, error, refetch };
};