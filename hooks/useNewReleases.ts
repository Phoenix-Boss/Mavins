/**
 * useNewReleases Hook — Supabase DB Edition
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Song } from '@/libs/supabase';

export interface NewReleaseItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  views: number;
}

interface UseNewReleasesResult {
  data: NewReleaseItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MAX_ITEMS    = 8;
const CACHE_KEY    = 'music:newreleases:v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchNewReleases(): Promise<NewReleaseItem[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_thumbnail, artwork_url, video_id, duration, play_count, created_at')
    .not('artwork_thumbnail', 'is', null)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ITEMS);

  if (error) throw new Error(`Failed to fetch new releases: ${error.message}`);
  if (!data?.length) throw new Error('No new releases available');

  return (data as Song[]).map(item => ({
    id:        item.id,
    videoId:   item.video_id ?? '',
    title:     item.title    ?? 'Unknown Title',
    artist:    item.artist   ?? 'Unknown Artist',
    thumbnail: item.artwork_thumbnail ?? item.artwork_url ?? '',
    duration:  item.duration   ?? 0,
    views:     item.play_count ?? 0,
  }));
}

export const useNewReleases = (): UseNewReleasesResult => {
  const [data,    setData]    = useState<NewReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [useNewReleases] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [useNewReleases] Fetching from Supabase...');
      const releases = await fetchNewReleases();
      console.log(`✅ [useNewReleases] Received ${releases.length} items`);
      await cache.set(CACHE_KEY, releases, CACHE_TTL_MS);
      setData(releases);
    } catch (err: any) {
      console.error('❌ [useNewReleases] Failed:', err);
      setError(err.message || 'Failed to load new releases');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};
