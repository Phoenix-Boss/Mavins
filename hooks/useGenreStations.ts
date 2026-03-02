/**
 * useGenreStations Hook - Fetches genre-based stations
 * Matches: AsyncFunction("getGenreStations") { genre: String, promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface StationItem {
  id: string;
  title: string;
  thumbnail: string;
  trackCount?: number;
  uploader?: string;
}

export const useGenreStations = (genre: string) => {
  const [data, setData] = useState<StationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGenreStations();
  }, [genre]);

  const fetchGenreStations = async () => {
    try {
      setLoading(true);
      setError(null);

      const cacheKey = `genre:${genre}`;

      const cached = await cache.get(cacheKey);
      if (cached) {
        console.log(`📦 [useGenreStations] Using cached data for ${genre}`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useGenreStations] Fetching ${genre} from native module...`);
      
      // ✅ Matches: getGenreStations(genre) with string parameter
      const stations = await MavinEngine.getGenreStations(genre);
      
      if (!stations || stations.length === 0) {
        throw new Error(`No stations found for ${genre}`);
      }
      
      console.log(`✅ [useGenreStations] Received ${stations.length} stations for ${genre}`);
      
      await cache.set(cacheKey, stations, 7 * 24 * 60 * 60 * 1000);
      
      setData(stations);
    } catch (err: any) {
      console.error(`❌ [useGenreStations] Failed for ${genre}:`, err);
      setError(err.message || `Failed to load ${genre} stations`);
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchGenreStations();

  return { data, loading, error, refetch };
};