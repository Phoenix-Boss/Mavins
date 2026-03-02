/**
 * useMonthlyTop Hook - Fetches monthly top chart
 * Matches: AsyncFunction("getMonthlyTop") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface MonthlyItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  views: number;
  position: number;
}

export const useMonthlyTop = () => {
  const [data, setData] = useState<MonthlyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMonthlyTop();
  }, []);

  const fetchMonthlyTop = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('top:monthly');
      if (cached) {
        console.log('📦 [useMonthlyTop] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useMonthlyTop] Fetching from native module...');
      
      // ✅ Matches: getMonthlyTop() with no parameters
      const monthly = await MavinEngine.getMonthlyTop();
      
      if (!monthly || monthly.length === 0) {
        throw new Error('No monthly top chart available');
      }
      
      console.log(`✅ [useMonthlyTop] Received ${monthly.length} items`);
      
      await cache.set('top:monthly', monthly, 24 * 60 * 60 * 1000);
      
      setData(monthly);
    } catch (err: any) {
      console.error('❌ [useMonthlyTop] Failed:', err);
      setError(err.message || 'Failed to load monthly top chart');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchMonthlyTop();

  return { data, loading, error, refetch };
};