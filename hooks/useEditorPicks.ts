/**
 * useEditorPicks Hook - Fetches editor curated picks
 * Matches: AsyncFunction("getEditorPicks") { promise: Promise -> }
 */
import { useState, useEffect } from 'react';
import MavinEngine from '@/modules/modules/mavin-engine';
import { cache } from '@/libs/cache';

export interface EditorPickItem {
  id: string;
  title: string;
  thumbnail: string;
  trackCount?: number;
  uploader?: string;
}

export const useEditorPicks = () => {
  const [data, setData] = useState<EditorPickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEditorPicks();
  }, []);

  const fetchEditorPicks = async () => {
    try {
      setLoading(true);
      setError(null);

      const cached = await cache.get('editor:picks');
      if (cached) {
        console.log('📦 [useEditorPicks] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useEditorPicks] Fetching from native module...');
      
      // ✅ Matches: getEditorPicks() with no parameters
      const picks = await MavinEngine.getEditorPicks();
      
      if (!picks || picks.length === 0) {
        throw new Error('No editor picks available');
      }
      
      console.log(`✅ [useEditorPicks] Received ${picks.length} items`);
      
      await cache.set('editor:picks', picks, 7 * 24 * 60 * 60 * 1000);
      
      setData(picks);
    } catch (err: any) {
      console.error('❌ [useEditorPicks] Failed:', err);
      setError(err.message || 'Failed to load editor picks');
    } finally {
      setLoading(false);
    }
  };

  const refetch = () => fetchEditorPicks();

  return { data, loading, error, refetch };
};