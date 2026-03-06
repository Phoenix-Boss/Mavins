/**
 * useTrending Hook
 *
 * Fetches trending music via MavinEngine.getTrending().
 * Calls Kotlin: extractKioskInfo("Music", null, 0)
 *
 * No getTrendingMusic() exists in Kotlin — getTrending() maps to
 * the YouTube "Music" kiosk which is the correct source for
 * trending music tracks.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface TrendingItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName
  thumbnail: string;
  duration: number; // seconds
  views: number;
}

interface UseTrendingResult {
  data: TrendingItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 6;
const CACHE_KEY = 'trending:now'; // matches original
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

function toTrendingItem(item: StreamInfoItem): TrendingItem | null {
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
// Fetcher
// ─────────────────────────────────────────────

async function fetchTrending(): Promise<TrendingItem[]> {
  // ✅ Calls Kotlin: extractKioskInfo("Music", null, 0)
  const result: KioskPage = await MavinEngine.getTrending(
    undefined,
    YOUTUBE_SERVICE_ID,
  );

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Trending music unavailable');
  }

  const items = (result.items as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .map(toTrendingItem)
    .filter((item): item is TrendingItem => item !== null)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error('No trending music available');
  }

  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useTrending = (): UseTrendingResult => {
  const [data, setData]       = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchTrendingData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useTrending] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useTrending] Fetching from native module...');
      const trending = await fetchTrending();

      console.log(`✅ [useTrending] Received ${trending.length} items`);
      await cache.set(CACHE_KEY, trending, CACHE_TTL_MS);
      setData(trending);

    } catch (err: any) {
      console.error('❌ [useTrending] Failed:', err);
      setError(err.message || 'Failed to load trending music');
      setData([]);
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
  };
};