// hooks/usePlayerSearch.ts
/**
 * usePlayerSearch Hook - expo-av compatible (no changes needed)
 * 
 * Searches for a specific track by artist + title via MavinEngine.search().
 * This hook doesn't depend on RNTP or expo-av - it only uses MavinEngine.
 * 
 * ── Why filter="all" ────────────────────────────────────────────────────────
 * "songs" is a YouTube Music-specific content filter not registered
 * in the standard YouTube service (serviceId=0) searchQHFactory.
 * Passing it causes Kotlin to throw an invalid filter error.
 * "all" is always valid on serviceId=0 and returns StreamInfoItems.
 */

import { useState, useCallback } from 'react';
import MavinEngine, { 
  StreamInfoItem, 
  SearchPage, 
  NativeImage 
} from '@/modules/mavin-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerSearchResult {
  items: Array<{
    id: string;
    videoId: string;
    title: string;
    artist: string;
    thumbnail: string;
    duration: number;
    views: number;
  }>;
  query: string;
}

interface TrackData {
  artist: string;
  title: string;
}

interface UsePlayerSearchReturn {
  search: (trackData: TrackData) => Promise<void>;
  results: PlayerSearchResult | null;
  loading: boolean;
  error: string | null;
  clearResults: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickBestThumbnail(thumbnails: NativeImage[]): string {
  if (!thumbnails?.length) return '';
  const priority = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
  for (const level of priority) {
    const match = thumbnails.find(t => t.resolutionLevel === level);
    if (match?.url) return match.url;
  }
  return thumbnails[0]?.url ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const usePlayerSearch = (): UsePlayerSearchReturn => {
  const [results, setResults] = useState<PlayerSearchResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError]     = useState<string | null>(null);

  const searchTracks = useCallback(async (trackData: TrackData) => {
    if (!trackData.artist?.trim() || !trackData.title?.trim()) {
      setError('Track must have artist and title');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = `${trackData.artist.trim()} ${trackData.title.trim()}`;

      // Calls Kotlin: performSearch(query, "all", null, 0)
      // "all" is the only valid filter for standard YouTube (serviceId=0)
      const result = await MavinEngine.search(
        query,
        'all',  // ← was 'songs', invalid on serviceId=0
        undefined,
        0,
      ) as SearchPage;

      if (!result.success || !result.results.length) {
        setError('No results found');
        setResults(null);
        return;
      }

      const mappedItems = result.results
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .filter(item => !item.isLive && !item.isShortFormContent)
        .map(item => ({
          id: item.url,
          videoId: item.url,
          title: item.name?.trim() || 'Unknown Title',
          artist: item.uploaderName?.trim() || 'Unknown Artist',
          thumbnail: pickBestThumbnail(item.thumbnails),
          duration: Number(item.duration) || 0,
          views: Number(item.viewCount) || 0,
        }));

      setResults({
        items: mappedItems,
        query: result.query,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      console.error('❌ [usePlayerSearch] error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
  }, []);

  return {
    search: searchTracks,
    results,
    loading,
    error,
    clearResults,
  };
};