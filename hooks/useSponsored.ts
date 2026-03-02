/**
 * useSponsored Hook - Fetches sponsored content with sponsor flags
 * Matches: AsyncFunction("getSponsoredContent") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface SponsoredItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  sponsored: boolean;
  sponsorName?: string | null;
}

export const useSponsored = () => {
  const [data, setData] = useState<SponsoredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSponsored();
  }, []);

  const fetchSponsored = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('sponsored:content');
      if (cached) {
        console.log('📦 [useSponsored] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useSponsored] Fetching from native module...');
      
      // ✅ Matches: getSponsoredContent() with no parameters
      const sponsored = await MavinEngine.getSponsoredContent();
      
      if (!sponsored || sponsored.length === 0) {
        throw new Error('No sponsored content available');
      }
      
      console.log(`✅ [useSponsored] Received ${sponsored.length} items`);
      
      await cache.set('sponsored:content', sponsored, 12 * 60 * 60 * 1000);
      
      setData(sponsored);
    } catch (err: any) {
      console.error('❌ [useSponsored] Failed:', err);
      setError(err.message || 'Failed to load sponsored content');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchSponsored();

  return { data, loading, error, refetch };
};