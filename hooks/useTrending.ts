/**
 * useTrending Hook - Fetches trending music using kiosk extractor
 * Matches: AsyncFunction("getTrendingMusic") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface TrendingItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
}

export const useTrending = () => {
  const [data, setData] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrending();
  }, []);

  const fetchTrending = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('trending:now');
      if (cached) {
        console.log('📦 [useTrending] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useTrending] Fetching from native module...');
      
      // ✅ Matches: getTrendingMusic() with no parameters
      const trending = await MavinEngine.getTrendingMusic();
      
      if (!trending || trending.length === 0) {
        throw new Error('No trending music available');
      }
      
      console.log(`✅ [useTrending] Received ${trending.length} items`);
      
      await cache.set('trending:now', trending, 6 * 60 * 60 * 1000);
      
      setData(trending);
    } catch (err: any) {
      console.error('❌ [useTrending] Failed:', err);
      setError(err.message || 'Failed to load trending music');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchTrending();

  return { data, loading, error, refetch };
};