/**
 * useLiveStations Hook
 *
 * Fetches live music streams via MavinEngine.getKioskInfo("Live").
 * Calls Kotlin: extractKioskInfo("Live", null, 0)
 *
 * The YouTube "Live" kiosk is the correct source for live streams —
 * it returns StreamInfoItem results with isLive=true.
 * No getLiveStations() exists in Kotlin.
 *
 * viewCount on a live StreamInfoItem = current concurrent viewers.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface LiveStationItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName — channel broadcasting live
  thumbnail: string;
  viewers: number;  // viewCount = concurrent viewers on a live stream
  type: 'live';
}

interface UseLiveStationsResult {
  data: LiveStationItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  formatViewers: (viewers: number) => string;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'radio:live'; // matches original
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — matches original

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

function toLiveStationItem(item: StreamInfoItem): LiveStationItem | null {
  // Live kiosk should only return live streams, but guard anyway
  if (!item.isLive) return null;
  if (!item.url) return null;

  return {
    id: item.url,
    videoId: item.url,
    title: item.name?.trim() || 'Unknown Station',
    artist: item.uploaderName?.trim() || 'Unknown',
    thumbnail: pickBestThumbnail(item.thumbnails),
    // viewCount on live stream = concurrent viewers
    viewers: Number(item.viewCount) || 0,
    type: 'live',
  };
}

export function formatViewers(viewers: number): string {
  if (!viewers) return '0';
  if (viewers >= 1_000_000) return `${(viewers / 1_000_000).toFixed(1)}M`;
  if (viewers >= 1_000)     return `${(viewers / 1_000).toFixed(1)}K`;
  return String(viewers);
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchLiveStations(): Promise<LiveStationItem[]> {
  // ✅ Calls Kotlin: extractKioskInfo("Live", null, 0)
  // YouTube "Live" kiosk is the dedicated source for live streams
  const result: KioskPage = await MavinEngine.getKioskInfo(
    'Live',
    undefined,
    YOUTUBE_SERVICE_ID,
  );

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Live kiosk unavailable');
  }

  const items = (result.items as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .map(toLiveStationItem)
    .filter((item): item is LiveStationItem => item !== null)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error('No live stations available');
  }

  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useLiveStations = (): UseLiveStationsResult => {
  const [data, setData]       = useState<LiveStationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchLiveStationsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Cache read
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        console.log('📦 [useLiveStations] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
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

  const refetch = () => fetchLiveStationsData();

  return { data, loading, error, refetch, formatViewers };
};