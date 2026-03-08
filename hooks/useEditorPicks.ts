/**
 * useEditorPicks Hook
 *
 * Fetches curated/editorial music picks via MavinEngine.search().
 * Calls Kotlin: performSearch(query, "all", null, 0)
 *
 * ── Why filter="all" ────────────────────────────────────────────────────────
 * "songs" is a YouTube Music-specific content filter not registered
 * in the standard YouTube service (serviceId=0) searchQHFactory.
 * Passing it causes Kotlin to throw an invalid filter error.
 * "all" is always valid on serviceId=0 and returns StreamInfoItems.
 *
 * Returns StreamInfoItem[] directly — no custom mapping.
 */

import { useState, useEffect, useCallback } from 'react';
import { search, StreamInfoItem, SearchPage } from '@/modules/mavin-engine';
import { cache } from '@/libs/cache';

export type { StreamInfoItem as EditorPickItem } from '@/modules/mavin-engine';

interface UseEditorPicksResult {
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
const CACHE_KEY = 'editor:picks';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const SEARCH_QUERIES = [
  'best music videos 2025',
  'must listen music 2025',
  'top music picks',
];

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

async function fetchEditorPicks(): Promise<StreamInfoItem[]> {
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

      const items = result.results
        .filter((item): item is StreamInfoItem => item.type === 'stream')
        .filter(item => !item.isLive && !item.isShortFormContent && item.url)
        .slice(0, MAX_ITEMS);

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  throw new Error('No editor picks available');
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export const useEditorPicks = (): UseEditorPicksResult => {
  const [data, setData]       = useState<StreamInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useEditorPicks] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useEditorPicks] Fetching from native module...');
      const picks = await fetchEditorPicks();

      console.log(`✅ [useEditorPicks] Received ${picks.length} items`);
      await cache.set(CACHE_KEY, picks, CACHE_TTL_MS);
      setData(picks);
    } catch (err: any) {
      console.error('❌ [useEditorPicks] Failed:', err);
      setError(err.message || 'Failed to load editor picks');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
};