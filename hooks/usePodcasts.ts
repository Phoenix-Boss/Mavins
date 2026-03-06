/**
 * usePodcasts Hook
 *
 * Fetches podcast content via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "all", null, 0)
 *
 * Podcasts on YouTube are playlists — we search with filter "all"
 * so PlaylistInfoItems are included, then keep only playlist-type
 * results that match podcast keywords.
 * No getPodcasts() exists in Kotlin.
 */

import { useState, useEffect, useCallback } from 'react';
import MavinEngine, {
  PlaylistInfoItem,
  InfoItem,
  SearchPage,
} from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

// ─────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────

export interface PodcastItem {
  id: string;          // stable React key (playlist url)
  videoId: string;     // playlist url → pass to getPlaylistInfo() for episodes
  title: string;
  artist: string;      // uploaderName — the podcast creator
  thumbnail: string;
  episodeCount: number; // streamCount from PlaylistInfoItem
  type: 'podcast';
}

interface UsePodcastsResult {
  data: PodcastItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const YOUTUBE_SERVICE_ID = 0;
const MAX_ITEMS = 8;
const CACHE_KEY = 'podcasts:featured'; // matches original
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — matches original

// Fallback query chain
const SEARCH_QUERIES = [
  'music podcast 2025',
  'top music podcasts',
  'hip hop podcast playlist',
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function pickBestThumbnail(thumbnails: PlaylistInfoItem['thumbnails']): string {
  if (!thumbnails?.length) return '';
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  for (const level of priority) {
    const match = thumbnails.find(t => t.resolutionLevel === level);
    if (match?.url) return match.url;
  }
  return thumbnails[0]?.url ?? '';
}

function toPodcastItem(item: PlaylistInfoItem): PodcastItem {
  return {
    id: item.url,
    videoId: item.url,    // pass to getPlaylistInfo() to load episodes
    title: item.name?.trim() || 'Unknown Podcast',
    artist: item.uploaderName?.trim() || 'Unknown Creator',
    thumbnail: pickBestThumbnail(item.thumbnails),
    episodeCount: Number(item.streamCount) || 0,
    type: 'podcast',
  };
}

// ─────────────────────────────────────────────
// Fetcher — tries each query until items found
// ─────────────────────────────────────────────

async function fetchPodcasts(): Promise<PodcastItem[]> {
  for (const query of SEARCH_QUERIES) {
    try {
      // ✅ Calls Kotlin: performSearch(query, "all", null, 0)
      // "all" filter so PlaylistInfoItems (podcasts) are included
      const result = await MavinEngine.search(
        query,
        'all',
        undefined,
        YOUTUBE_SERVICE_ID,
      ) as SearchPage;

      if (!result.success) continue;

      // Keep only playlist-type results — podcasts on YouTube are playlists
      const items = (result.results as InfoItem[])
        .filter((item): item is PlaylistInfoItem => item.type === 'playlist')
        .map(toPodcastItem)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No podcasts available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const usePodcasts = (): UsePodcastsResult => {
  const [data, setData]       = useState<PodcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchPodcastsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Cache read
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        console.log('📦 [usePodcasts] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      // Network fetch
      console.log('🔍 [usePodcasts] Fetching from native module...');
      const podcasts = await fetchPodcasts();

      console.log(`✅ [usePodcasts] Received ${podcasts.length} items`);
      await cache.set(CACHE_KEY, podcasts, CACHE_TTL_MS);
      setData(podcasts);

    } catch (err: any) {
      console.error('❌ [usePodcasts] Failed:', err);
      setError(err.message || 'Failed to load podcasts');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPodcastsData();
  }, [fetchPodcastsData]);

  const refetch = () => fetchPodcastsData();

  return { data, loading, error, refetch };
};