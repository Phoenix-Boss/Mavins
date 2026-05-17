// libs/supabase/services/podcasts.ts

import { supabase } from '../client';
import type { PodcastEpisode } from '../types';

export async function getPodcastsByIds(ids: string[]): Promise<PodcastEpisode[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('podcast_episodes')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`Failed to fetch podcasts: ${error.message}`);
  const map = new Map((data ?? []).map(p => [p.id, p]));
  return ids.map(id => map.get(id)).filter((p): p is PodcastEpisode => p !== undefined);
}

export async function getAllPodcasts(limit = 20): Promise<PodcastEpisode[]> {
  const { data, error } = await supabase
    .from('podcast_episodes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch podcasts: ${error.message}`);
  return data ?? [];
}
