/**
 * usePopularChoice Hook - Fetches popular music
 * Matches: AsyncFunction("getPopularChoice") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface PopularItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  views: number;
}

export const usePopularChoice = () => {
  const [data, setData] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPopularChoice();
  }, []);

  const fetchPopularChoice = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('popular:choice');
      if (cached) {
        console.log('📦 [usePopularChoice] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [usePopularChoice] Fetching from native module...');
      
      // ✅ Matches: getPopularChoice() with no parameters
      const popular = await MavinEngine.getPopularChoice();
      
      if (!popular || popular.length === 0) {
        throw new Error('No popular music available');
      }
      
      console.log(`✅ [usePopularChoice] Received ${popular.length} items`);
      
      await cache.set('popular:choice', popular, 12 * 60 * 60 * 1000);
      
      setData(popular);
    } catch (err: any) {
      console.error('❌ [usePopularChoice] Failed:', err);
      setError(err.message || 'Failed to load popular music');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchPopularChoice();

  return { data, loading, error, refetch };
};