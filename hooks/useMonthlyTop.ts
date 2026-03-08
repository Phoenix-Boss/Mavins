/**
 * useMonthlyTop Hook - Uses Charts API for accurate monthly data
 * 
 * The YouTube Charts API provides historical trending data that can be
 * filtered by time range, making it ideal for monthly top charts.
 */

import { useState, useEffect, useCallback } from 'react';
import { getTrendingWithFallback, search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface MonthlyItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  position: number;
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
const CACHE_KEY = 'top:monthly';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function pickBestThumbnail(thumbnails: StreamInfoItem['thumbnails']): string {
  if (!thumbnails?.length) return '';
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
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
    position: index + 1,
  };
}

// ─────────────────────────────────────────────
// Fetcher - Uses Charts API first, then search
// ─────────────────────────────────────────────

async function fetchMonthlyTop(): Promise<MonthlyItem[]> {
  // Strategy 1: Try Charts API for trending (most reliable for popular content)
  try {
    console.log('📊 [useMonthlyTop] Trying Charts API...');
    const result = await getTrendingWithFallback('music', YOUTUBE_SERVICE_ID);
    
    if (result.success && result.items?.length > 0) {
      const items = result.items
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .map((item, idx) => toMonthlyItem(item, idx))
        .filter((item): item is MonthlyItem => item !== null)
        .slice(0, MAX_ITEMS);
      
      if (items.length > 0) {
        console.log(`✅ [useMonthlyTop] Got ${items.length} from Charts API`);
        return items;
      }
    }
  } catch (e) {
    console.warn('⚠️ [useMonthlyTop] Charts API failed:', e);
  }

  // Strategy 2: Search fallback with monthly-focused queries
  console.log('🔍 [useMonthlyTop] Falling back to search...');
  
  const searchQueries = [
    'top songs this month 2025',
    'most played songs this month',
    'monthly music chart 2025',
    'billboard hot 100 this month',
  ];

  for (const query of searchQueries) {
    try {
      const result = await search(query, 'all', undefined, YOUTUBE_SERVICE_ID) as SearchPage;
      
      if (!result.success) continue;

      const items = (result.results as StreamInfoItem[])
        .filter(item => item.type === 'stream')
        .reduce<MonthlyItem[]>((acc, item) => {
          const mapped = toMonthlyItem(item, acc.length);
          if (mapped) acc.push(mapped);
          return acc;
        }, [])
        .slice(0, MAX_ITEMS);

      if (items.length > 0) {
        console.log(`✅ [useMonthlyTop] Got ${items.length} from search: ${query}`);
        return items;
      }
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
  const [data, setData] = useState<MonthlyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMonthlyTopData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useMonthlyTop] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

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