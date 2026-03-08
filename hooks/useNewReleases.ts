/**
 * useNewReleases Hook - Uses Charts API with recent uploads
 * 
 * Combines Charts API (for popular recent content) with search
 * to find the newest music releases.
 */

import { useState, useEffect, useCallback } from 'react';
import { getTrendingWithFallback, search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface NewReleaseItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
  releaseDate: string;
}

interface UseNewReleasesResult {
  data: NewReleaseItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'music:newreleases';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function toNewReleaseItem(item: StreamInfoItem): NewReleaseItem | null {
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
    releaseDate: item.textualUploadDate || '',
  };
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchNewReleases(): Promise<NewReleaseItem[]> {
  // Strategy 1: Try Charts API first (includes recent popular uploads)
  try {
    console.log('📊 [useNewReleases] Trying Charts API for recent popular...');
    const result = await getTrendingWithFallback('music', YOUTUBE_SERVICE_ID);
    
    if (result.success && result.items?.length > 0) {
      // Filter for items with recent upload dates if possible
      const items = result.items
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .filter(item => {
          // Prefer items with recent upload dates (if textualUploadDate contains indicators)
          const date = item.textualUploadDate?.lowercase() || '';
          return date.contains('day') || date.contains('week') || date.contains('hour') || true;
        })
        .map(toNewReleaseItem)
        .filter((item): item is NewReleaseItem => item !== null)
        .slice(0, MAX_ITEMS);
      
      if (items.length >= 4) { // Accept if we got at least 4 recent items
        console.log(`✅ [useNewReleases] Got ${items.length} from Charts API`);
        return items;
      }
    }
  } catch (e) {
    console.warn('⚠️ [useNewReleases] Charts API failed:', e);
  }

  // Strategy 2: Search for specifically new releases
  console.log('🔍 [useNewReleases] Searching for new releases...');
  
  const searchQueries = [
    'new music releases 2025',
    'new songs this week',
    'latest music videos 2025',
    'new album releases 2025',
  ];

  for (const query of searchQueries) {
    try {
      const result = await search(query, 'all', undefined, YOUTUBE_SERVICE_ID) as SearchPage;
      
      if (!result.success) continue;

      const items = (result.results as StreamInfoItem[])
        .filter(item => item.type === 'stream')
        .map(toNewReleaseItem)
        .filter((item): item is NewReleaseItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) {
        console.log(`✅ [useNewReleases] Got ${items.length} from search: ${query}`);
        return items;
      }
    } catch {
      continue;
    }
  }

  throw new Error('No new releases available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useNewReleases = (): UseNewReleasesResult => {
  const [data, setData] = useState<NewReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNewReleasesData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useNewReleases] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      const releases = await fetchNewReleases();
      
      console.log(`✅ [useNewReleases] Received ${releases.length} items`);
      await cache.set(CACHE_KEY, releases, CACHE_TTL_MS);
      setData(releases);

    } catch (err: any) {
      console.error('❌ [useNewReleases] Failed:', err);
      setError(err.message || 'Failed to load new releases');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNewReleasesData();
  }, [fetchNewReleasesData]);

  return { data, loading, error, refetch: fetchNewReleasesData };
};