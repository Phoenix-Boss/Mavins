/**
 * useLiveStations Hook - Fetches live radio stations
 * Matches: AsyncFunction("getLiveStations") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface LiveStationItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  viewers: number;
  type: 'live';
}

export const useLiveStations = () => {
  const [data, setData] = useState<LiveStationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveStations();
  }, []);

  const fetchLiveStations = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('radio:live');
      if (cached) {
        console.log('📦 [useLiveStations] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useLiveStations] Fetching from native module...');
      
      // ✅ Matches: getLiveStations() with no parameters
      const stations = await MavinEngine.getLiveStations();
      
      if (!stations || stations.length === 0) {
        throw new Error('No live stations available');
      }
      
      console.log(`✅ [useLiveStations] Received ${stations.length} stations`);
      
      await cache.set('radio:live', stations, 6 * 60 * 60 * 1000);
      
      setData(stations);
    } catch (err: any) {
      console.error('❌ [useLiveStations] Failed:', err);
      setError(err.message || 'Failed to load live stations');
    } finally {
      setLoading(false);
    }
  };

  const formatViewers = (viewers: number): string => {
    if (!viewers) return "0";
    if (viewers >= 1_000_000) return (viewers / 1_000_000).toFixed(1) + 'M';
    if (viewers >= 1_000) return (viewers / 1_000).toFixed(1) + 'K';
    return viewers.toString();
  };

  const refetch = () => fetchLiveStations();

  return { data, loading, error, refetch, formatViewers };
};