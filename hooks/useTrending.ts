/**
 * useTrending Hook - PRODUCTION READY (NewPipeExtractor only, Nigeria-focused)
 *
 * Layers in order of priority:
 * 1. NewPipe Kiosk → 'trending_music' (primary) → 'trending_movies_and_shows' (secondary)
 * 2. Targeted search fallback using Nigeria/Afrobeats trending-relevant queries
 *
 * Goal: Get recent/hot music videos even when kiosks return empty results
 */
import { useState, useEffect, useCallback } from 'react';
import { search, getYouTubeKiosk, StreamInfoItem, SearchPage, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface TrendingItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UseTrendingResult {
  data: TrendingItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
  source: string | null; // 'kiosk_trending_music' | 'kiosk_trending_movies_and_shows' | 'search' | 'cache' | null
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 6;
const CACHE_KEY = 'trending:now_ng';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Updated March 2026 Nigeria-relevant search queries
// Ordered roughly from most specific → broader
const NIGERIA_SEARCH_QUERIES = [
  'Mavo official music video',
  'Mofe Mavo official',
  'Aura Salad Mavo',
  'Big Bum Bum Kidd Carder',
  'ODUMODUBLVCK official video',
  'Wizkid new release 2026',
  'Asake official music video',
  'Afrobeats new release Nigeria',
  'Naija music video March 2026',
  'new Nigerian music video',
  'Afrobeats 2026 official',
];

// Working kiosks (from your logs)
const WORKING_KIOSKS: readonly string[] = ['trending_music', 'trending_movies_and_shows'];

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

function toTrendingItem(item: StreamInfoItem): TrendingItem | null {
  if (!item.url || !item.name?.trim()) return null;
  return {
    id: item.url,
    videoId: item.url.split('v=')[1] || item.url,
    title: item.name.trim(),
    artist: item.uploaderName?.trim() || 'Unknown Artist',
    thumbnail: pickBestThumbnail(item.thumbnails),
    duration: Number(item.duration) || 0,
    views: Number(item.viewCount) || 0,
  };
}

// ─────────────────────────────────────────────
// Fetch logic
// ─────────────────────────────────────────────
async function fetchFromNewPipe(): Promise<{ items: TrendingItem[]; source: string }> {
  let items: TrendingItem[] = [];
  let source = 'unknown';

  // ── Layer 1: Try kiosks ────────────────────────────────────────
  for (const kioskId of WORKING_KIOSKS) {
    try {
      console.log(`🏪 [useTrending] Trying kiosk: "${kioskId}"`);
      const kioskResult = await getYouTubeKiosk(kioskId, YOUTUBE_SERVICE_ID) as KioskPage;

      if (kioskResult.success && kioskResult.items?.length > 0) {
        items = kioskResult.items
          .filter((it): it is StreamInfoItem => it.type === 'stream' && !it.isLive)
          .map(toTrendingItem)
          .filter((it): it is TrendingItem => !!it)
          .slice(0, MAX_ITEMS);

        if (items.length > 0) {
          source = `kiosk_${kioskId}`;
          console.log(`✅ [useTrending] Success from kiosk "${kioskId}" → ${items.length} items`);
          return { items, source };
        }
      } else {
        console.log(`📊 [useTrending] kiosk "${kioskId}" returned ${kioskResult.items?.length ?? 0} items`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [useTrending] kiosk "${kioskId}" failed:`, err?.message || String(err));
    }
  }

  // ── Layer 2: Search fallback ───────────────────────────────────
  console.log('🔍 [useTrending] All kiosks empty → falling back to search');

  // First try with 'video' filter (preferred)
  for (const query of NIGERIA_SEARCH_QUERIES) {
    try {
      console.log(`🔎 Searching: "${query}"  (filter: video)`);
      const result = await search(query, 'video', undefined, YOUTUBE_SERVICE_ID) as SearchPage;

      if (result.success && result.results?.length > 0) {
        items = result.results
          .filter((it): it is StreamInfoItem => it.type === 'stream' && !it.isLive)
          .map(toTrendingItem)
          .filter((it): it is TrendingItem => !!it)
          .slice(0, MAX_ITEMS);

        if (items.length > 0) {
          source = 'search';
          console.log(`✅ Found ${items.length} items from "${query}"`);
          return { items, source };
        }
      }
    } catch (err: any) {
      console.warn(`Search "${query}" (video) failed:`, err?.message || String(err));
    }
  }

  // Last resort: try broader 'all' filter on the first few queries
  console.log('🔍 [useTrending] No results with "video" filter → trying broader "all" filter');
  for (const query of NIGERIA_SEARCH_QUERIES.slice(0, 4)) {  // only first 4 to avoid too many calls
    try {
      console.log(`🔎 Searching (all): "${query}"`);
      const result = await search(query, 'all', undefined, YOUTUBE_SERVICE_ID) as SearchPage;

      if (result.success && result.results?.length > 0) {
        items = result.results
          .filter((it): it is StreamInfoItem => it.type === 'stream' && !it.isLive)
          .map(toTrendingItem)
          .filter((it): it is TrendingItem => !!it)
          .slice(0, MAX_ITEMS);

        if (items.length > 0) {
          source = 'search_broad';
          console.log(`✅ Found ${items.length} items from broad search "${query}"`);
          return { items, source };
        }
      }
    } catch (err: any) {
      console.warn(`Broad search "${query}" failed:`, err?.message || String(err));
    }
  }

  throw new Error('No trending music items could be retrieved (kiosks and all search attempts empty)');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────
export const useTrending = (): UseTrendingResult => {
  const [data, setData] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const fetchTrendingData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached?.items?.length > 0) {
        console.log('📦 [useTrending] Using cached data');
        setData(cached.items);
        setSource(cached.source || 'cache');
        setLoading(false);
        return;
      }

      const result = await fetchFromNewPipe();

      const payload = { items: result.items, source: result.source };
      await cache.set(CACHE_KEY, payload, CACHE_TTL_MS);

      setData(result.items);
      setSource(result.source);
    } catch (err: any) {
      console.error('❌ [useTrending] Complete failure:', err);
      setError(err.message || 'Could not load trending music — all sources returned empty');
      setData([]);
      setSource(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrendingData();
  }, [fetchTrendingData]);

  return {
    data,
    loading,
    error,
    refetch: fetchTrendingData,
    isEmpty: data.length === 0,
    source,
  };
};