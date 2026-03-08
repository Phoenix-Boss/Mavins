/**
 * useTopCharts Hook - Enhanced with Charts API for top50
 * 
 * chart type routing:
 *   'top50'   → getTrendingWithFallback()  → YouTube Charts API
 *   'viral50' → search("top music videos") → Search fallback
 */

import { useState, useEffect, useCallback } from 'react';
import { getTrendingWithFallback, search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface ChartItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
  position: number;
}

interface UseTopChartsResult {
  data: ChartItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 20;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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

function toChartItem(item: StreamInfoItem, index: number): ChartItem | null {
  if (item.isLive) return null;
  if (item.isShortFormContent) return null;
  if (!item.url) return null;

  return {
    id: item.url,
    videoId: item.url,
    title: item.name?.trim() || 'Unknown Title',
    artist: item.uploaderName?.trim() || 'Unknown Artist',
    duration: Number(item.duration) || 0,
    thumbnail: pickBestThumbnail(item.thumbnails),
    views: Number(item.viewCount) || 0,
    position: index + 1,
  };
}

// ─────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────

/**
 * Fetch top 50 using Charts API (most reliable)
 */
async function fetchTop50(): Promise<ChartItem[]> {
  const result = await getTrendingWithFallback('music', YOUTUBE_SERVICE_ID);
  
  if (!result.success || !result.items?.length) {
    throw new Error(result.message || 'Top 50 unavailable');
  }

  const items = (result.items as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .slice(0, MAX_ITEMS)
    .map((item, idx) => toChartItem(item, idx))
    .filter((item): item is ChartItem => item !== null);

  if (!items.length) {
    throw new Error('No top chart tracks available');
  }

  return items;
}

/**
 * Fetch viral 50 using search (trending/viral content)
 */
async function fetchViral50(): Promise<ChartItem[]> {
  const result = await search(
    'viral music videos trending',
    'all',
    undefined,
    YOUTUBE_SERVICE_ID,
  ) as SearchPage;

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Viral search unavailable');
  }

  const items = (result.results as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .filter(item => !item.isLive && !item.isShortFormContent)
    .slice(0, MAX_ITEMS)
    .map((item, idx) => toChartItem(item, idx))
    .filter((item): item is ChartItem => item !== null);

  if (!items.length) {
    throw new Error('No viral chart tracks available');
  }

  return items;
}

async function fetchCharts(chartType: string): Promise<ChartItem[]> {
  switch (chartType) {
    case 'top50':   return fetchTop50();
    case 'viral50': return fetchViral50();
    default:        return fetchTop50();
  }
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useTopCharts = (chartType: string = 'top50'): UseTopChartsResult => {
  const [data, setData] = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cacheKey = `charts:${chartType}`;

      const cached = await cache.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`📦 [useTopCharts] cache hit — ${chartType}`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useTopCharts] fetching ${chartType}…`);
      const items = await fetchCharts(chartType);

      console.log(`✅ [useTopCharts] ${items.length} items — ${chartType}`);
      await cache.set(cacheKey, items, CACHE_TTL_MS);
      setData(items);

    } catch (e: any) {
      const msg = e?.message || `Failed to load ${chartType} charts`;
      console.error(`❌ [useTopCharts] ${chartType}:`, msg);
      setError(msg);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [chartType]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
};