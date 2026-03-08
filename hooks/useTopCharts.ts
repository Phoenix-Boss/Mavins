/**
 * useTopCharts Hook
 *
 * chart type routing:
 *   'top50'   → getYouTubeKiosk("MUSIC")  → Kotlin: extractKioskInfo("Music", null, 0)
 *   'viral50' → search("top music videos") → Kotlin: SearchInfo(filter="all")
 *
 * ── Why NOT getTrending() ────────────────────────────────────────────────────
 * getTrending() calls Kotlin extractKioskInfo("Trending", null, serviceId).
 * YouTube's "Trending" kiosk page fails with "Could not get Trending name"
 * because NewPipe cannot resolve the trending kiosk display name at runtime.
 *
 * getYouTubeKiosk("MUSIC") calls Kotlin extractKioskInfo("Music", null, 0),
 * which is the stable YouTube Music kiosk and succeeds reliably.
 *
 * ── Why filter="all" for viral50 ────────────────────────────────────────────
 * "songs" is a YouTube Music-specific content filter not available on the
 * standard YouTube service (serviceId=0). Using "all" avoids a filter
 * rejection error from the Kotlin search handler factory.
 *
 * Only StreamInfoItem fields are consumed — live streams and shorts
 * are filtered out before data leaves this hook.
 */

import { useState, useEffect, useCallback } from 'react';
import { getYouTubeKiosk, search, StreamInfoItem, KioskPage, SearchPage } from '@/modules/mavin-engine';
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
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
  for (const level of priority) {
    const match = thumbnails.find(t => t.resolutionLevel === level);
    if (match?.url) return match.url;
  }
  return thumbnails[0]?.url ?? '';
}

function toChartItem(item: StreamInfoItem, index: number): ChartItem | null {
  if (item.isLive) return null;           // skip live streams
  if (item.isShortFormContent) return null; // skip Shorts
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
 * Calls Kotlin: extractKioskInfo("Music", null, 0)
 * via getYouTubeKiosk("MUSIC", 0).
 *
 * DO NOT use getTrending() here — it maps to the "Trending" kiosk
 * which throws "Could not get Trending name" at runtime.
 */
async function fetchTop50(): Promise<ChartItem[]> {
  const result: KioskPage = await getYouTubeKiosk('MUSIC', YOUTUBE_SERVICE_ID);

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Music kiosk unavailable');
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
 * Calls Kotlin: performSearch("top music videos", "all", null, 0)
 *
 * Filter must be "all" — "songs" is a YouTube Music-specific filter
 * not registered in the standard YouTube service searchQHFactory.
 */
async function fetchViral50(): Promise<ChartItem[]> {
  const result = await search(
    'top music videos',
    'all',            // ← "songs" filter does not exist on serviceId=0
    undefined,
    YOUTUBE_SERVICE_ID,
  ) as SearchPage;

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Music search unavailable');
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
  const [data, setData]       = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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