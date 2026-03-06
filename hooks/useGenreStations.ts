/**
 * useGenreStations Hook
 *
 * Fetches genre-based music tracks via MavinEngine.search().
 * Calls Kotlin: performSearch("{genre} music", "songs", null, 0)
 *
 * "songs" is the YouTube Music content filter in NewPipe extractor —
 * returns music tracks only, no channels or playlists.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, { StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface GenreItem {
  id: string;       // stable React key (stream url)
  videoId: string;  // full stream url → pass to getStreamUrl() for playback
  title: string;
  artist: string;   // uploaderName
  thumbnail: string;
  duration: number; // seconds
  views: number;
}

interface UseGenreStationsResult {
  data: GenreItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches original

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

function toGenreItem(item: StreamInfoItem): GenreItem | null {
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

async function fetchGenre(genre: string): Promise<GenreItem[]> {
  // ✅ Calls Kotlin: performSearch("{genre} music", "songs", null, 0)
  const result = await MavinEngine.search(
    `${genre} music`,
    'songs',
    undefined,
    YOUTUBE_SERVICE_ID,
  ) as SearchPage;

  if (!result.success) {
    throw new Error(result.errors?.[0] || `No results for ${genre}`);
  }

  const items = (result.results as StreamInfoItem[])
    .filter(item => item.type === 'stream')
    .map(toGenreItem)
    .filter((item): item is GenreItem => item !== null)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error(`No ${genre} tracks available`);
  }

  return items;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useGenreStations = (genre: string): UseGenreStationsResult => {
  const [data, setData]       = useState<GenreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchGenreStations = useCallback(async () => {
    if (!genre?.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const cacheKey = `genre:${genre.toLowerCase().trim()}`;

      // Cache read
      const cached = await cache.get(cacheKey);
      if (cached) {
        console.log(`📦 [useGenreStations] Using cached data for ${genre}`);
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
      console.log(`🔍 [useGenreStations] Fetching ${genre} from native module...`);
      const stations = await fetchGenre(genre);

      console.log(`✅ [useGenreStations] Received ${stations.length} stations for ${genre}`);
      await cache.set(cacheKey, stations, CACHE_TTL_MS);
      setData(stations);

    } catch (err: any) {
      console.error(`❌ [useGenreStations] Failed for ${genre}:`, err);
      setError(err.message || `Failed to load ${genre} stations`);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [genre]);

  useEffect(() => {
    fetchGenreStations();
  }, [fetchGenreStations]);

  const refetch = () => fetchGenreStations();

  return { data, loading, error, refetch };
};