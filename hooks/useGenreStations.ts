/**
 * useGenreStations Hook — Supabase DB Edition
 * Fetches actual playlists from the database for Create Mix section
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Playlist } from '@/libs/supabase/types';

export interface GenreItem {
  id: string;
  playlistId: string | null;
  title: string;
  subtitle: string;
  thumbnail: string;
  genre: string;
  trackCount?: number;
  browseId?: string;
  metadata: Record<string, any>;
}

interface UseGenreStationsResult {
  data: GenreItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const MAX_ITEMS = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Fisher-Yates shuffle for randomizing playlists
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

async function fetchGenreStations(genre?: string): Promise<GenreItem[]> {
  try {
    // First, try to find a "Create Mix" or "Mixes" section
    const { data: sections, error: sectionError } = await supabase
      .from('sections')
      .select('id, name')
      .or('name.ilike.%mix%,section_type.eq.create_mix,name.ilike.%playlist%')
      .eq('is_visible', true)
      .limit(1);

    if (!sectionError && sections && sections.length > 0) {
      const section = sections[0];
      
      // Get section items with playlist_ids
      const { data: sectionItems, error: itemsError } = await supabase
        .from('section_items')
        .select('playlist_id, display_order, position, custom_title, custom_subtitle, custom_thumbnail_url, custom_metadata')
        .eq('section_id', section.id)
        .not('playlist_id', 'is', null)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true, nullsFirst: false })
        .limit(MAX_ITEMS * 2);

      if (!itemsError && sectionItems && sectionItems.length > 0) {
        const playlistIds = sectionItems
          .map(item => item.playlist_id)
          .filter((id): id is string => id !== null);

        if (playlistIds.length > 0) {
          // Fetch the actual playlists
          const { data: playlists, error: playlistsError } = await supabase
            .from('playlists')
            .select('id, name, description, cover_art_url, track_count, browse_id, is_curated, metadata')
            .in('id', playlistIds);

          if (!playlistsError && playlists && playlists.length > 0) {
            // Create a map for quick lookup
            const playlistMap = new Map();
            playlists.forEach(playlist => {
              playlistMap.set(playlist.id, playlist);
            });

            // Build items array
            const items = sectionItems
              .map(item => {
                if (!item.playlist_id) return null;
                const playlist = playlistMap.get(item.playlist_id);
                if (!playlist) return null;

                return {
                  id: playlist.id,
                  playlistId: playlist.id,
                  title: item.custom_title ?? playlist.name ?? 'Untitled Mix',
                  subtitle: item.custom_subtitle ?? playlist.description ?? 'Curated playlist',
                  thumbnail: item.custom_thumbnail_url ?? playlist.cover_art_url ?? '',
                  genre: genre ?? 'mix',
                  trackCount: playlist.track_count ?? 0,
                  browseId: playlist.browse_id,
                  metadata: item.custom_metadata ?? playlist.metadata ?? {},
                };
              })
              .filter((item): item is GenreItem => item !== null);

            if (items.length > 0) {
              console.log(`✅ [useGenreStations] Found ${items.length} playlists from section`);
              // Shuffle for variety
              return shuffleArray(items).slice(0, MAX_ITEMS);
            }
          }
        }
      }
    }

    // Fallback 1: Get curated playlists first
    const { data: curatedPlaylists, error: curatedError } = await supabase
      .from('playlists')
      .select('id, name, description, cover_art_url, track_count, browse_id, is_curated, metadata')
      .eq('is_curated', true)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS);

    if (!curatedError && curatedPlaylists && curatedPlaylists.length > 0) {
      console.log(`✅ [useGenreStations] Found ${curatedPlaylists.length} curated playlists`);
      const items = curatedPlaylists.map((playlist: Playlist) => ({
        id: playlist.id,
        playlistId: playlist.id,
        title: playlist.name ?? 'Curated Mix',
        subtitle: playlist.description ?? 'Featured playlist',
        thumbnail: playlist.cover_art_url ?? '',
        genre: genre ?? 'curated',
        trackCount: playlist.track_count ?? 0,
        browseId: playlist.browse_id,
        metadata: playlist.metadata ?? {},
      }));
      
      return shuffleArray(items).slice(0, MAX_ITEMS);
    }

    // Fallback 2: Get all playlists
    const { data: allPlaylists, error: allError } = await supabase
      .from('playlists')
      .select('id, name, description, cover_art_url, track_count, browse_id, metadata')
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS * 2);

    if (!allError && allPlaylists && allPlaylists.length > 0) {
      console.log(`✅ [useGenreStations] Found ${allPlaylists.length} playlists`);
      const items = allPlaylists.map((playlist: Playlist) => ({
        id: playlist.id,
        playlistId: playlist.id,
        title: playlist.name ?? 'Mix',
        subtitle: playlist.description ?? 'Personal playlist',
        thumbnail: playlist.cover_art_url ?? '',
        genre: genre ?? 'personal',
        trackCount: playlist.track_count ?? 0,
        browseId: playlist.browse_id,
        metadata: playlist.metadata ?? {},
      }));
      
      return shuffleArray(items).slice(0, MAX_ITEMS);
    }

    // If no playlists found at all
    console.log('⚠️ [useGenreStations] No playlists found in database');
    return [];

  } catch (err) {
    console.error('❌ [useGenreStations] Error:', err);
    return [];
  }
}

export const useGenreStations = (genre?: string): UseGenreStationsResult => {
  const [data, setData] = useState<GenreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGenreStationsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const cacheKey = `genre:${genre?.toLowerCase().trim() ?? 'all'}`;

    try {
      // Check cache first
      const cached = await cache.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`📦 [useGenreStations] Using cached data for "${genre ?? 'all'}"`);
        setData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useGenreStations] Fetching playlists from Supabase...`);
      const stations = await fetchGenreStations(genre);
      
      if (stations.length > 0) {
        console.log(`✅ [useGenreStations] Received ${stations.length} playlists`);
        await cache.set(cacheKey, stations, CACHE_TTL_MS);
        setData(stations);
      } else {
        console.log(`⚠️ [useGenreStations] No playlists found`);
        setData([]);
      }
    } catch (err: any) {
      console.error(`❌ [useGenreStations] Failed:`, err);
      setError(err.message || `Failed to load mixes`);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [genre]);

  useEffect(() => { fetchGenreStationsData(); }, [fetchGenreStationsData]);

  return { data, loading, error, refetch: fetchGenreStationsData };
};
