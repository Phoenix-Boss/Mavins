/**
 * useCoverSongs Hook - Fetches cover songs
 * Matches: AsyncFunction("getCoverSongs") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface CoverItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  views: number;
}

export const useCoverSongs = () => {
  const [data, setData] = useState<CoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCoverSongs();
  }, []);

  const fetchCoverSongs = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('covers:popular');
      if (cached) {
        console.log('📦 [useCoverSongs] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useCoverSongs] Fetching from native module...');
      
      // ✅ Matches: getCoverSongs() with no parameters
      const covers = await MavinEngine.getCoverSongs();
      
      if (!covers || covers.length === 0) {
        throw new Error('No cover songs available');
      }
      
      console.log(`✅ [useCoverSongs] Received ${covers.length} covers`);
      
      await cache.set('covers:popular', covers, 12 * 60 * 60 * 1000);
      
      setData(covers);
    } catch (err: any) {
      console.error('❌ [useCoverSongs] Failed:', err);
      setError(err.message || 'Failed to load cover songs');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchCoverSongs();

  return { data, loading, error, refetch };
};