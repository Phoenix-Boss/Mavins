// hooks/useSearch.ts
/**
 * useSearch Hook - expo-av compatible (no changes needed)
 * 
 * Searches music with filters using MavinEngine.
 * This hook doesn't depend on RNTP or expo-av.
 */

import { useState, useCallback } from "react";
import MavinEngine from "@/modules/mavin-engine";
import { cache } from "@/libs/cache";

export interface SearchResultItem {
  id: string;
  type: "song" | "playlist" | "artist";
  title?: string;
  name?: string;
  artist?: string;
  thumbnail: string;
  duration?: number;
  views?: number;
  trackCount?: number;
  subscribers?: number;
  verified?: boolean;
  videoId?: string;
}

export const useSearch = () => {
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");

  const search = useCallback(
    async (searchQuery: string, filter?: "song" | "playlist" | "artist") => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setQuery(searchQuery);

        const cacheKey = `search:${searchQuery}:${filter || "all"}`;

        const cached = await cache.get(cacheKey);
        if (cached) {
          console.log(`📦 [useSearch] Using cached results for "${searchQuery}"`);
          setResults(cached);
          setLoading(false);
          return;
        }

        console.log(`🔍 [useSearch] Searching for "${searchQuery}" with filter ${filter || "all"}`);

        // ✅ Matches: searchMusic(query, filter) with two parameters
        const searchResults = await MavinEngine.searchMusic(searchQuery, filter);

        if (!searchResults) {
          setResults([]);
        } else {
          console.log(`✅ [useSearch] Received ${searchResults.length} results`);
          setResults(searchResults);
          await cache.set(cacheKey, searchResults, 60 * 60 * 1000);
        }
      } catch (err: any) {
        console.error("❌ [useSearch] Failed:", err);
        setError(err.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearSearch = useCallback(() => {
    setResults([]);
    setQuery("");
    setError(null);
  }, []);

  return { results, loading, error, query, search, clearSearch };
};