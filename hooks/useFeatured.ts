/**
 * useFeatured Hook
 *
 * Replaces the fabricated useSponsored hook.
 *
 * getSponsoredContent() does not exist in Kotlin/NewPipeExtractor.
 * NewPipeExtractor has no concept of sponsored or promoted content —
 * it is a YouTube frontend; ad/sponsor metadata is not exposed via
 * any documented InfoItem field.
 *
 * Replacement: fetches curated featured tracks from the YouTube
 * "Music" kiosk via MavinEngine.getTrending().
 * Calls Kotlin: extractKioskInfo("Music", null, 0)
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface FeaturedItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName
  thumbnail: string;
  duration: number; // seconds
  views: number;
}

interface UseFeaturedResult {
  data: FeaturedItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'featured:music'; // replaces "sponsored:content"
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — same as original

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

function toFeaturedItem(item: StreamInfoItem): FeaturedItem | null {
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

async function fetchFeatured(): Promise<FeaturedItem[]> {
  // ✅ Calls Kotlin: extractKioskInfo("Music", null, 0)
  // YouTube "Music" kiosk — curated music picks
  const result: KioskPage = await MavinEngine.getTrending(
    undefined,
    YOUTUBE_SERVICE_ID,
  );

  if (!result.success) {
    throw new Error(result.errors?.[0] || 'Featured music unavailable');
  }

  const items = (result.items as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .map(toFeaturedItem)
    .filter((item): item is FeaturedItem => item !== null)
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
  const [data, setData]       = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchFeaturedData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
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

  const refetch = () => fetchFeaturedData();

  return { data, loading, error, refetch };
};