// libs/supabase/services/sections.ts
// All section + section_items query logic lives here.
// Hooks call these — never query Supabase directly from a hook.

import { supabase } from '../client';
import type { Section, SectionItem, SectionType } from '../types';

// ─────────────────────────────────────────────
// Section queries
// ─────────────────────────────────────────────

/** Get a single visible section by its type */
export async function getSectionByType(type: SectionType): Promise<Section> {
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .eq('section_type', type)
    .eq('is_visible', true)
    .single();

  if (error || !data) {
    throw new Error(`Section "${type}" not found: ${error?.message}`);
  }
  return data;
}

/** Get all visible sections ordered for home screen */
export async function getAllSections(): Promise<Section[]> {
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .eq('is_visible', true)
    .order('display_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch sections: ${error.message}`);
  return data ?? [];
}

// ─────────────────────────────────────────────
// Section items queries
// ─────────────────────────────────────────────

/** Get raw section_items rows for a section */
export async function getSectionItems(
  sectionId: string,
  limit = 20
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('*')
    .eq('section_id', sectionId)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch section items: ${error.message}`);
  return data ?? [];
}

/** Get section_items that have a track_id (song-based sections) */
export async function getTrackItems(
  sectionId: string,
  limit = 20
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('id, section_id, track_id, display_order, custom_title, custom_subtitle, custom_thumbnail_url, custom_metadata')
    .eq('section_id', sectionId)
    .not('track_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch track items: ${error.message}`);
  return data ?? [];
}

/** Get section_items that have a playlist_id */
export async function getPlaylistItems(
  sectionId: string,
  limit = 20
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('id, section_id, playlist_id, display_order, custom_title, custom_subtitle, custom_thumbnail_url, custom_metadata')
    .eq('section_id', sectionId)
    .not('playlist_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch playlist items: ${error.message}`);
  return data ?? [];
}

/** Get section_items that have an artist_id */
export async function getArtistItems(
  sectionId: string,
  limit = 50
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('id, section_id, artist_id, display_order, custom_title, custom_thumbnail_url')
    .eq('section_id', sectionId)
    .not('artist_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch artist items: ${error.message}`);
  return data ?? [];
}

/** Get section_items that have a podcast_id */
export async function getPodcastItems(
  sectionId: string,
  limit = 20
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('id, section_id, podcast_id, display_order, custom_title, custom_thumbnail_url')
    .eq('section_id', sectionId)
    .not('podcast_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch podcast items: ${error.message}`);
  return data ?? [];
}

/** Get section_items that have a radio_station_id */
export async function getRadioItems(
  sectionId: string,
  limit = 20
): Promise<SectionItem[]> {
  const { data, error } = await supabase
    .from('section_items')
    .select('id, section_id, radio_station_id, display_order, custom_title, custom_thumbnail_url')
    .eq('section_id', sectionId)
    .not('radio_station_id', 'is', null)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch radio items: ${error.message}`);
  return data ?? [];
}

/** Get navigation/genre items (custom_title based) with optional genre filter */
export async function getGenreItems(
  sectionId: string,
  genre?: string,
  limit = 20
): Promise<SectionItem[]> {
  let query = supabase
    .from('section_items')
    .select('id, section_id, genre_id, playlist_id, display_order, custom_title, custom_subtitle, custom_thumbnail_url, custom_metadata')
    .eq('section_id', sectionId)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (genre?.trim()) {
    query = query.ilike('custom_title', `%${genre.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch genre items: ${error.message}`);
  return data ?? [];
}