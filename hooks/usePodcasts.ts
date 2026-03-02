/**
 * usePodcasts Hook - Fetches podcast content
 * Matches: AsyncFunction("getPodcasts") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface PodcastItem {
  id: string;
  title: string;
  thumbnail: string;
  episodeCount?: number;
  uploader?: string;
  type: 'podcast';
}

export const usePodcasts = () => {
  const [data, setData] = useState<PodcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPodcasts();
  }, []);

  const fetchPodcasts = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('podcasts:featured');
      if (cached) {
        console.log('📦 [usePodcasts] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [usePodcasts] Fetching from native module...');
      
      // ✅ Matches: getPodcasts() with no parameters
      const podcasts = await MavinEngine.getPodcasts();
      
      if (!podcasts || podcasts.length === 0) {
        throw new Error('No podcasts available');
      }
      
      console.log(`✅ [usePodcasts] Received ${podcasts.length} items`);
      
      await cache.set('podcasts:featured', podcasts, 12 * 60 * 60 * 1000);
      
      setData(podcasts);
    } catch (err: any) {
      console.error('❌ [usePodcasts] Failed:', err);
      setError(err.message || 'Failed to load podcasts');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchPodcasts();

  return { data, loading, error, refetch };
};