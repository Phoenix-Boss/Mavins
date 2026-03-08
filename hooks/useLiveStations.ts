/**
 * useLiveStations Hook
 *
 * Fetches live music streams via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "all", null, 0)
 *
 * ── Why NOT getKioskInfo("Live") ────────────────────────────────────────────
 * The "Live" kiosk ID does not exist in the YouTube service registered
 * by NewPipeExtractor. Calling getKioskInfo("Live") throws:
 *   ExtractionException: "No kiosk found with the type: Live"
 *
 * The correct approach is search() with live-music-focused queries,
 * then filter results to item.isLive === true.
 *
 * Note: viewCount on live StreamInfoItems = concurrent viewers.
 */

import { useState, useEffect, useCallback } from 'react';
import { search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export type { StreamInfoItem as LiveStationItem } from '@/modules/mavin-engine';

interface UseLiveStationsResult {
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
const CACHE_KEY = 'radio:live';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Queries targeting live music streams
const SEARCH_QUERIES = [
  'live music stream',
  'live concert stream',
  'music live now',
];

// ─────────────────────────────────────────────
// Helper: format viewers (viewCount on live = concurrent viewers)
// ─────────────────────────────────────────────

export function formatViewers(viewCount: number): string {
  if (!viewCount) return '0';
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchLiveStations(): Promise<StreamInfoItem[]> {
  // getKioskInfo("Live") throws "No kiosk found with the type: Live" on YouTube.
  // Use search() with live-focused queries and filter to isLive === true instead.
  for (const query of SEARCH_QUERIES) {
    try {
      const result = await search(
        query,
        'all',            // "all" is the only valid filter on serviceId=0
        undefined,
        YOUTUBE_SERVICE_ID,
      ) as SearchPage;

      if (!result.success) continue;

      const items = result.results
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .filter(item => item.isLive && item.url)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No live stations available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useLiveStations = (): UseLiveStationsResult => {
  const [data, setData]       = useState<StreamInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchLiveStationsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useLiveStations] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useLiveStations] Fetching from native module...');
      const stations = await fetchLiveStations();

      console.log(`✅ [useLiveStations] Received ${stations.length} stations`);
      await cache.set(CACHE_KEY, stations, CACHE_TTL_MS);
      setData(stations);
    } catch (err: any) {
      console.error('❌ [useLiveStations] Failed:', err);
      setError(err.message || 'Failed to load live stations');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveStationsData();
  }, [fetchLiveStationsData]);

  return { data, loading, error, refetch: fetchLiveStationsData };
};