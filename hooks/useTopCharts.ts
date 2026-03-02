/**
 * useTopCharts Hook - Fetches top charts by type
 * Matches: AsyncFunction("getTopCharts") { chartType: String, promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface ChartItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
  position?: number;
}

export const useTopCharts = (chartType: string = 'top50') => {
  const [data, setData] = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTopCharts();
  }, [chartType]);

  const fetchTopCharts = async () => {
    try {
      setLoading(true);
      setError(null);

      const cacheKey = `charts:${chartType}`;

      const cached = await cache.get(cacheKey);
      if (cached) {
        console.log(`📦 [useTopCharts] Using cached data for ${chartType}`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useTopCharts] Fetching ${chartType} from native module...`);
      
      // ✅ Matches: getTopCharts(chartType) with string parameter
      const charts = await MavinEngine.getTopCharts(chartType);
      
      if (!charts || charts.length === 0) {
        throw new Error(`No ${chartType} charts available`);
      }

      console.log(`✅ [useTopCharts] Received ${charts.length} items for ${chartType}`);
      
      await cache.set(cacheKey, charts, 12 * 60 * 60 * 1000);
      
      setData(charts);
    } catch (err: any) {
      console.error(`❌ [useTopCharts] Failed for ${chartType}:`, err);
      setError(err.message || `Failed to load ${chartType} charts`);
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchTopCharts();

  return { data, loading, error, refetch };
};