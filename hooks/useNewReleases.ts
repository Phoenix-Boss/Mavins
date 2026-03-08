/**
 * useNewReleases Hook
 *
 * Fetches newly released music via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "all", null, 0)
 *
 * No getNewReleases() exists in Kotlin — recency-focused search
 * queries are the correct approach via NewPipe extractor.
 *
 * ── Why filter="all" ────────────────────────────────────────────────────────
 * "songs" is a YouTube Music-specific content filter not registered
 * in the standard YouTube service (serviceId=0) searchQHFactory.
 * Passing it causes Kotlin to throw an invalid filter error.
 * "all" is always valid on serviceId=0 and returns StreamInfoItems.
 */

import { useState, useEffect, useCallback } from 'react';
import { search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface NewReleaseItem {
  id: string;          // stable React key (stream url)
  videoId: string;     // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;      // uploaderName
  thumbnail: string;
  duration: number;    // seconds
  views: number;
  releaseDate: string; // textualUploadDate e.g. "3 days ago"
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

const SEARCH_QUERIES = [
  'new music releases 2025',
  'new songs this week',
  'latest music videos 2025',
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
    // textualUploadDate is the correct StreamInfoItem field e.g. "3 days ago"
    releaseDate: item.textualUploadDate || '',
  };
}

// ─────────────────────────────────────────────
// Fetcher — tries each query until items found
// ─────────────────────────────────────────────

async function fetchNewReleases(): Promise<NewReleaseItem[]> {
  for (const query of SEARCH_QUERIES) {
    try {
      // Calls Kotlin: performSearch(query, "all", null, 0)
      // "all" is the only valid filter for standard YouTube (serviceId=0)
      const result = await search(
        query,
        'all',            // ← was 'songs', invalid on serviceId=0
        undefined,
        YOUTUBE_SERVICE_ID,
      ) as SearchPage;

      if (!result.success) continue;

      const items = (result.results as StreamInfoItem[])
        .filter(item => item.type === 'stream')
        .map(toNewReleaseItem)
        .filter((item): item is NewReleaseItem => item !== null)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
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
  const [data, setData]       = useState<NewReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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

      console.log('🔍 [useNewReleases] Fetching from native module...');
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