/**
 * useTrending Hook (FIXED for NewPipeExtractor v0.26.0)
 *
 * CRITICAL: Based on debug output, only these kiosks work:
 * - "trending_music" ✅ (Trending Music Videos)
 * - "trending_movies_and_shows" ✅ (Trending Movie Trailers)
 * 
 * These are BROKEN in v0.26.0 (null pointer exceptions):
 * - "Trending" ❌
 * - "live" ❌  
 * - "trending_gaming" ❌
 * - "trending_podcasts_episodes" ❌
 */

import { useState, useEffect, useCallback } from 'react';
import { search, getYouTubeKiosk, getKioskList, StreamInfoItem, SearchPage, KioskPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ACTUAL working kiosk IDs from debug log (lowercase with underscores)
// NOTE: "Trending", "live", "trending_gaming" are broken in v0.26.0
type WorkingKioskId = 
  | 'trending_music'           // ✅ Works - Trending Music Videos
  | 'trending_movies_and_shows'; // ✅ Works - Trending Movie Trailers

// ─────────────────────────────────────────────
// Public shape
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
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 6;
const CACHE_KEY = 'trending:now';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SEARCH_QUERIES = [
  'trending music',
  'popular songs',
  'viral hits',
  'top music 2024',
  'best new music',
];

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

async function tryKiosk(kioskId: WorkingKioskId): Promise<TrendingItem[] | null> {
  try {
    console.log(`🏪 [useTrending] Trying kiosk: "${kioskId}"`);
    
    // Use direct kiosk ID - getYouTubeKiosk now handles the mapping
    const kioskResult = await getYouTubeKiosk(kioskId, YOUTUBE_SERVICE_ID) as KioskPage;

    console.log(`📊 [useTrending] "${kioskId}" success=${kioskResult.success} items=${kioskResult.items?.length ?? 0}`);

    if (kioskResult.success && kioskResult.items?.length > 0) {
      const streams = kioskResult.items.filter(
        (item): item is StreamInfoItem => item.type === 'stream',
      );

      const items = streams
        .filter(item => !!item.url)
        .map(toTrendingItem)
        .filter((item): item is TrendingItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) {
        console.log(`✅ [useTrending] Got ${items.length} items from "${kioskId}"`);
        return items;
      }
    }

    if (kioskResult.errors?.length) {
      console.warn(`⚠️ [useTrending] "${kioskId}" errors:`, kioskResult.errors);
    }
    return null;
  } catch (e: any) {
    console.warn(`⚠️ [useTrending] "${kioskId}" threw:`, e?.message || String(e));
    return null;
  }
}

/**
 * Debug: List all kiosks and their status
 */
async function debugListKiosks(): Promise<void> {
  try {
    const kioskList = await getKioskList(YOUTUBE_SERVICE_ID);
    console.log('🔍 [useTrending] Available kiosks:', JSON.stringify(kioskList, null, 2));
    
    // Log which ones are working vs broken
    const working = kioskList.kiosks?.filter((k: any) => k.available) || [];
    const broken = kioskList.kiosks?.filter((k: any) => !k.available) || [];
    console.log(`✅ Working kiosks: ${working.map((k: any) => k.id).join(', ')}`);
    console.log(`❌ Broken kiosks: ${broken.map((k: any) => k.id).join(', ')}`);
  } catch (e) {
    console.warn('⚠️ [useTrending] Could not list kiosks:', e);
  }
}

async function fetchTrending(): Promise<TrendingItem[]> {
  let lastError: string = '';

  // Debug: Check available kiosks
  await debugListKiosks();

  // ─────────────────────────────────────────────
  // Strategy 1: Try working kiosks directly by ID
  // Only trending_music and trending_movies_and_shows work in v0.26.0
  // ─────────────────────────────────────────────
  const workingKiosks: WorkingKioskId[] = [
    'trending_music',           // Most relevant for music
    'trending_movies_and_shows', // Fallback (movie trailers)
  ];

  for (const kioskId of workingKiosks) {
    const result = await tryKiosk(kioskId);
    if (result) return result;
  }

  // ─────────────────────────────────────────────
  // Strategy 2: Fall back to search
  // ─────────────────────────────────────────────
  console.log('🔍 [useTrending] Falling back to search queries...');

  for (const query of SEARCH_QUERIES) {
    try {
      console.log(`🔍 [useTrending] Searching: "${query}"`);
      const result = await search(query, 'all', undefined, YOUTUBE_SERVICE_ID) as SearchPage;

      console.log(`📊 [useTrending] success=${result.success} total=${result.results?.length ?? 0}`);

      if (!result.success) {
        lastError = result.errors?.[0] || 'Search failed';
        continue;
      }

      if (!result.results?.length) {
        lastError = 'Empty results';
        continue;
      }

      const streams = result.results.filter(
        (item): item is StreamInfoItem => item.type === 'stream',
      );

      const items = streams
        .filter(item => !!item.url)
        .map(toTrendingItem)
        .filter((item): item is TrendingItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) {
        console.log(`✅ [useTrending] Got ${items.length} items from search`);
        return items;
      }
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.warn(`⚠️ [useTrending] Search failed:`, lastError);
    }
  }

  throw new Error(`No trending music available. Last error: ${lastError}`);
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useTrending = (): UseTrendingResult => {
  const [data, setData] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      console.log('🔍 [useTrending] Fetching...');
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