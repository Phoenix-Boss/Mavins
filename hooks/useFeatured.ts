/**
 * useFeatured Hook
 *
 * Fetches curated featured tracks from the YouTube "Music" kiosk.
 * Calls Kotlin: extractKioskInfo("Music", null, 0) via getYouTubeKiosk("MUSIC")
 *
 * ── Why NOT getTrending() ────────────────────────────────────────────────────
 * getTrending() calls Kotlin extractKioskInfo("Trending", null, serviceId).
 * At runtime, NewPipe fails to resolve the Trending kiosk display name:
 *   ParsingException: "Could not get Trending name"
 *
 * getYouTubeKiosk("MUSIC") maps to extractKioskInfo("Music", null, 0),
 * the YouTube Music kiosk, which is stable and returns music StreamInfoItems.
 *
 * Returns StreamInfoItem[] directly — no custom mapping.
 */

import { useState, useEffect, useCallback } from 'react';
import { getYouTubeKiosk, StreamInfoItem, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export type { StreamInfoItem as FeaturedItem } from '@/modules/mavin-engine';

interface UseFeaturedResult {
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
const CACHE_KEY = 'featured:music';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchFeatured(): Promise<StreamInfoItem[]> {
  // Calls Kotlin: extractKioskInfo("Music", null, 0)
  // DO NOT use getTrending() — maps to broken "Trending" kiosk at runtime
  const result: KioskPage = await getYouTubeKiosk('MUSIC', YOUTUBE_SERVICE_ID);

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Featured music unavailable');
  }

  const items = result.items
    .filter((item): item is StreamInfoItem => item.type === 'stream')
    .filter(item => !item.isLive && !item.isShortFormContent && item.url)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error('No featured music available');
  }

  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useFeatured = (): UseFeaturedResult => {
  const [data, setData]       = useState<StreamInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchFeaturedData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useFeatured] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useFeatured] Fetching from native module...');
      const featured = await fetchFeatured();

      console.log(`✅ [useFeatured] Received ${featured.length} items`);
      await cache.set(CACHE_KEY, featured, CACHE_TTL_MS);
      setData(featured);
    } catch (err: any) {
      console.error('❌ [useFeatured] Failed:', err);
      setError(err.message || 'Failed to load featured music');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeaturedData();
  }, [fetchFeaturedData]);

  return { data, loading, error, refetch: fetchFeaturedData };
};