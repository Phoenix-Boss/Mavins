/**
 * usePodcasts Hook — Supabase DB Edition
 *
 * Data flow:
 * podcast_episodes (title, thumbnail_url, duration_seconds, play_count, metadata)
 *   metadata jsonb contains: creator, video_id, published, creator_id
 *   ordered by play_count DESC, created_at DESC
 *
 * NOTE: The `podcasts` table only has placeholder data (Podcast Show 1/2/3,
 * null cover art, null publisher). All real content lives in `podcast_episodes`.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

export interface PodcastItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;      // mapped from metadata.creator
  thumbnail: string;   // mapped from thumbnail_url
  episodeCount: number;
  type: 'podcast';
}

interface UsePodcastsResult {
  data: PodcastItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MAX_ITEMS = 9;
const CACHE_KEY = 'podcasts:episodes:v2'; // bumped from 'podcasts:featured' — now queries podcast_episodes table
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function fetchPodcasts(): Promise<PodcastItem[]> {
  const { data, error } = await supabase
    .from('podcast_episodes')
    .select('id, podcast_id, title, thumbnail_url, duration_seconds, play_count, episode_number, metadata')
    .order('play_count', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(MAX_ITEMS);

  if (error) throw new Error(`Failed to fetch podcast episodes: ${error.message}`);
  if (!data?.length) throw new Error('No podcast episodes available');

  return data.map(item => {
    const meta     = (item.metadata ?? {}) as Record<string, any>;
    const videoId  = meta.video_id ?? '';
    const creator  = meta.creator  ?? 'Unknown Podcast';

    // Show episode number if available, otherwise derive a count from duration
    // so the card never just says "0 episodes"
    const epNum    = item.episode_number;
    const durSecs  = item.duration_seconds ?? 0;
    const durMins  = Math.round(durSecs / 60);
    const episodeCount = epNum != null ? epNum : (durMins > 0 ? durMins : 0);

    return {
      id: item.id,
      videoId,
      title: item.title ?? 'Unknown Episode',
      artist: creator,
      thumbnail: item.thumbnail_url ?? '',
      episodeCount,
      type: 'podcast' as const,
    };
  });
}

export const usePodcasts = (): UsePodcastsResult => {
  const [data, setData]       = useState<PodcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log('📦 [usePodcasts] Using cached data');
        setData(cached);
        setLoading(false);
        return;
      }
      console.log('🔍 [usePodcasts] Fetching from Supabase...');
      const podcasts = await fetchPodcasts();
      console.log(`✅ [usePodcasts] Received ${podcasts.length} items`);
      await cache.set(CACHE_KEY, podcasts, CACHE_TTL_MS);
      setData(podcasts);
    } catch (err: any) {
      console.error('❌ [usePodcasts] Failed:', err);
      setError(err.message || 'Failed to load podcasts');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
};