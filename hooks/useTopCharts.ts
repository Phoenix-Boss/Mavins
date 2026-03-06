/**
 * useTopCharts Hook
 *
 * chart type routing:
 *   'top50'   → MavinEngine.getTrending()  → Kotlin: KioskInfo("Music", null, 0)
 *   'viral50' → MavinEngine.search()       → Kotlin: SearchInfo(filter="songs")
 *
 * Only StreamInfoItem fields are consumed — live streams and shorts
 * are filtered out before data leaves this hook.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, KioskPage, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape — only what the UI needs
// ─────────────────────────────────────────────

export interface ChartItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;
  duration: number; // seconds
  thumbnail: string;
  views: number;
  position: number; // 1-based
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
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  for (const level of priority) {
    const match = thumbnails.find(t => t.resolutionLevel === level);
    if (match?.url) return match.url;
  }
  return thumbnails[0]?.url ?? '';
}

function toChartItem(item: StreamInfoItem, index: number): ChartItem | null {
  // Music platform: skip live streams and short-form content
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

async function fetchTop50(): Promise<ChartItem[]> {
  // Calls Kotlin: extractKioskInfo("Music", null, 0)
  const result: KioskPage = await MavinEngine.getTrending(YOUTUBE_SERVICE_ID);

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Music kiosk unavailable');
  }

  return (result.items as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .slice(0, MAX_ITEMS)
    .map(toChartItem)
    .filter((item): item is ChartItem => item !== null);
}

async function fetchViral50(): Promise<ChartItem[]> {
  // Calls Kotlin: performSearch("top music videos", "songs", null, 0)
  // "songs" is the YouTube Music content filter in NewPipe extractor
  const result = await MavinEngine.search(
    'top music videos',
    'songs',
    undefined,
    YOUTUBE_SERVICE_ID,
  ) as SearchPage;

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Music search unavailable');
  }

  return (result.results as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .filter(item => !item.isLive && !item.isShortFormContent)
    .slice(0, MAX_ITEMS)
    .map(toChartItem)
    .filter((item): item is ChartItem => item !== null);
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
  const [data, setData]       = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cacheKey = `charts:${chartType}`;

      // Cache read
      const cached = await cache.get(cacheKey);
      if (cached) {
        console.log(`📦 [useTopCharts] cache hit — ${chartType}`);
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
      console.log(`🔍 [useTopCharts] fetching ${chartType}…`);
      const items = await fetchCharts(chartType);

      if (!items.length) {
        throw new Error(`No ${chartType} charts available`);
      }

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