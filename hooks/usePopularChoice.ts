/**
 * usePopularChoice Hook - Uses Charts API for true popular data
 * 
 * YouTube's mostPopular chart is the authoritative source for popular videos.
 * This hook uses getTrendingWithFallback() to get real popular data.
 */

import { useState, useEffect, useCallback } from 'react';
import { getTrendingWithFallback, StreamInfoItem } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface PopularItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UsePopularChoiceResult {
  data: PopularItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAX_ITEMS = 8;
const CACHE_KEY = 'popular:choice';
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

function toPopularItem(item: StreamInfoItem): PopularItem | null {
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
// Fetcher - Uses Charts API for popular data
// ─────────────────────────────────────────────

async function fetchPopular(): Promise<PopularItem[]> {
  // Use getTrendingWithFallback with 'music' category for popular music videos
  // This calls YouTube's chart=mostPopular API internally
  const result = await getTrendingWithFallback('music', 0);
  
  if (!result.success || !result.items?.length) {
    throw new Error(result.message || 'No popular data available');
  }

  const items = result.items
    .filter((item): item is StreamInfoItem => item.type === 'stream')
    .map(toPopularItem)
    .filter((item): item is PopularItem => item !== null)
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    throw new Error('No valid popular items found');
  }

  console.log(`✅ [usePopularChoice] Got ${items.length} items from ${result.source}`);
  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const usePopularChoice = (): UsePopularChoiceResult => {
  const [data, setData] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPopularChoice = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [usePopularChoice] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      const popular = await fetchPopular();
      
      console.log(`✅ [usePopularChoice] Received ${popular.length} items`);
      await cache.set(CACHE_KEY, popular, CACHE_TTL_MS);
      setData(popular);

    } catch (err: any) {
      console.error('❌ [usePopularChoice] Failed:', err);
      setError(err.message || 'Failed to load popular music');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPopularChoice();
  }, [fetchPopularChoice]);

  return { data, loading, error, refetch: fetchPopularChoice };
};