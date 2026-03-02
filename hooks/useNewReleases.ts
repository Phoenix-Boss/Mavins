/**
 * useNewReleases Hook - Fetches new releases using fallback search
 * Matches: AsyncFunction("getNewReleases") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface NewReleaseItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  releaseDate?: string;
  views?: number;
}

export const useNewReleases = () => {
  const [data, setData] = useState<NewReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNewReleases();
  }, []);

  const fetchNewReleases = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('music:newreleases');
      if (cached) {
        console.log('📦 [useNewReleases] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useNewReleases] Fetching from native module...');
      
      // ✅ Matches: getNewReleases() with no parameters
      const releases = await MavinEngine.getNewReleases();
      
      if (!releases || releases.length === 0) {
        throw new Error('No new releases available');
      }
      
      console.log(`✅ [useNewReleases] Received ${releases.length} items`);
      
      await cache.set('music:newreleases', releases, 24 * 60 * 60 * 1000);
      
      setData(releases);
    } catch (err: any) {
      console.error('❌ [useNewReleases] Failed:', err);
      setError(err.message || 'Failed to load new releases');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchNewReleases();

  return { data, loading, error, refetch };
};