// libs/supabase/services/playlists.ts

import { supabase } from '../client';
import type { Playlist } from '../types';

export async function getPlaylistsByIds(ids: string[]): Promise<Playlist[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`Failed to fetch playlists: ${error.message}`);
  const map = new Map((data ?? []).map(p => [p.id, p]));
  return ids.map(id => map.get(id)).filter((p): p is Playlist => p !== undefined);
}

export async function getAllPlaylists(limit = 30): Promise<Playlist[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch playlists: ${error.message}`);
  return data ?? [];
}