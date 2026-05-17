// libs/supabase/services/artists.ts

import { supabase } from '../client';
import type { Artist } from '../types';

export async function getArtistsByIds(ids: string[]): Promise<Artist[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('artists')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`Failed to fetch artists: ${error.message}`);
  const map = new Map((data ?? []).map(a => [a.id, a]));
  return ids.map(id => map.get(id)).filter((a): a is Artist => a !== undefined);
}

export async function getAllArtists(limit = 50): Promise<Artist[]> {
  const { data, error } = await supabase
    .from('artists')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch artists: ${error.message}`);
  return data ?? [];
}

export async function searchArtists(query: string, limit = 20): Promise<Artist[]> {
  const { data, error } = await supabase
    .from('artists')
    .select('*')
    .ilike('name', `%${query}%`)
    .limit(limit);
  if (error) throw new Error(`Failed to search artists: ${error.message}`);
  return data ?? [];
}
