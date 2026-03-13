// libs/supabase/services/songs.ts

import { supabase } from '../client';
import type { Song } from '../types';

// ─────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────

/** Fetch songs by an array of IDs, preserving a given order */
export async function getSongsByIds(ids: string[]): Promise<Song[]> {
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, featured_artists, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .in('id', ids);

  if (error) throw new Error(`Failed to fetch songs: ${error.message}`);
  if (!data?.length) return [];

  // Re-order to match the caller's id order (section display_order)
  const map = new Map(data.map(s => [s.id, s]));
  return ids.map(id => map.get(id)).filter((s): s is Song => s !== undefined);
}

/** Fetch a single song by ID */
export async function getSongById(id: string): Promise<Song | null> {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

/** Fetch top N songs by play_count */
export async function getTopSongs(limit = 20): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .order('play_count', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch top songs: ${error.message}`);
  return data ?? [];
}

/** Fetch recently added songs */
export async function getNewReleases(limit = 20): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch new releases: ${error.message}`);
  return data ?? [];
}

/** Search songs by title or artist */
export async function searchSongs(query: string, limit = 20): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, artwork_url, artwork_thumbnail, video_id, play_count, duration, popularity')
    .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
    .order('popularity', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to search songs: ${error.message}`);
  return data ?? [];
}