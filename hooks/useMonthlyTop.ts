/**
 * useMonthlyTop Hook
 *
 * Fetches monthly top chart via MavinEngine.search().
 * Calls Kotlin: performSearch("top songs this month", "songs", null, 0)
 *
 * No getMonthlyTop() exists in Kotlin. Position is derived from
 * result order (1-based index) — NewPipeExtractor returns results
 * in relevance/chart order for music queries.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface MonthlyItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName
  thumbnail: string;
  duration: number; // seconds
  views: number;
  position: number; // 1-based, derived from result order
}

interface UseMonthlyTopResult {
  data: MonthlyItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 10;
const CACHE_KEY = 'top:monthly'; // matches original
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — matches original

// Fallback query chain
const SEARCH_QUERIES = [
  'top songs this month 2025',
  'most played songs this month',
  'monthly music chart 2025',
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

function toMonthlyItem(item: StreamInfoItem, index: number): MonthlyItem | null {
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
    position: index + 1, // 1-based position from result order
  };
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchMonthlyTop(): Promise<MonthlyItem[]> {
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
        .reduce<MonthlyItem[]>((acc, item, index) => {
          const mapped = toMonthlyItem(item, acc.length);
          if (mapped) acc.push(mapped);
          return acc;
        }, [])
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No monthly top chart available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useMonthlyTop = (): UseMonthlyTopResult => {
  const [data, setData]       = useState<MonthlyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchMonthlyTopData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        console.log('📦 [useMonthlyTop] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useMonthlyTop] Fetching from native module...');
      const monthly = await fetchMonthlyTop();

      console.log(`✅ [useMonthlyTop] Received ${monthly.length} items`);
      await cache.set(CACHE_KEY, monthly, CACHE_TTL_MS);
      setData(monthly);

    } catch (err: any) {
      console.error('❌ [useMonthlyTop] Failed:', err);
      setError(err.message || 'Failed to load monthly top chart');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonthlyTopData();
  }, [fetchMonthlyTopData]);

  return { data, loading, error, refetch: fetchMonthlyTopData };
};