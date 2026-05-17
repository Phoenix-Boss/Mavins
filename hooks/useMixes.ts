/**
 * useMixes Hook — Supabase DB Edition (Fixed Cover Art + Shuffle)
 * Fetches actual playlists from the database for the Create Mix section
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';
import type { Playlist } from '@/libs/supabase/types';

export interface MixItem {
  id: string;
  playlistId: string;
  title: string;
  artist: string;
  thumbnail: string;
  trackCount: number;
  browseId?: string;
}

interface UseMixesResult {
  data: MixItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
}

const MAX_ITEMS = 10;
const DISPLAY_COUNT = 6; // Show 6 items (3x2 grid)
const CACHE_KEY = 'mixes:create:v5'; // Bumped version to invalidate old cache
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Fisher-Yates shuffle for randomizing playlists
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

async function fetchMixes(): Promise<MixItem[]> {
  try {
    // First, try to find a "Create Mix" section
    const { data: sections, error: sectionError } = await supabase
      .from('sections')
      .select('id')
      .or('name.ilike.%mix%,section_type.eq.create_mix,name.ilike.%playlist%')
      .eq('is_visible', true)
      .limit(1);

    if (!sectionError && sections && sections.length > 0) {
      const sectionId = sections[0].id;
      
      // Get section items with playlist_ids
      const { data: sectionItems, error: itemsError } = await supabase
        .from('section_items')
        .select('playlist_id, display_order, position, custom_title, custom_subtitle, custom_thumbnail_url')
        .eq('section_id', sectionId)
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
            .select('id, name, description, cover_art_url, track_count, browse_id')
            .in('id', playlistIds);

          if (!playlistsError && playlists && playlists.length > 0) {
            // Create a map for quick lookup
            const playlistMap = new Map();
            playlists.forEach(playlist => {
              playlistMap.set(playlist.id, playlist);
            });

            // Build items array - PRIORITIZE playlist cover_art_url over custom
            const items = sectionItems
              .map(item => {
                if (!item.playlist_id) return null;
                const playlist = playlistMap.get(item.playlist_id);
                if (!playlist) return null;

                // 🎯 FIXED: Prioritize playlist.cover_art_url, fallback to custom
                const thumbnail = playlist.cover_art_url && playlist.cover_art_url.trim() !== ''
                  ? playlist.cover_art_url 
                  : (item.custom_thumbnail_url ?? '');

                return {
                  id: playlist.id,
                  playlistId: playlist.id,
                  title: item.custom_title ?? playlist.name ?? 'Untitled Mix',
                  artist: item.custom_subtitle ?? playlist.description ?? 'Curated Playlist',
                  thumbnail: thumbnail,
                  trackCount: playlist.track_count ?? 0,
                  browseId: playlist.browse_id,
                };
              })
              .filter((item): item is MixItem => item !== null && item.thumbnail !== '');

            if (items.length > 0) {
              console.log(`✅ [useMixes] Found ${items.length} playlists with thumbnails from section`);
              return items; // Return all, shuffle happens in useMemo
            }
          }
        }
      }
    }

    // Fallback: Get curated playlists with cover art only
    const { data: curatedPlaylists, error: curatedError } = await supabase
      .from('playlists')
      .select('id, name, description, cover_art_url, track_count, browse_id')
      .eq('is_curated', true)
      .not('cover_art_url', 'is', null) // Only get playlists with cover art
      .neq('cover_art_url', '') // Exclude empty strings
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS * 2);

    if (!curatedError && curatedPlaylists && curatedPlaylists.length > 0) {
      console.log(`✅ [useMixes] Found ${curatedPlaylists.length} curated playlists with thumbnails`);
      const items = curatedPlaylists.map((playlist: Playlist) => ({
        id: playlist.id,
        playlistId: playlist.id,
        title: playlist.name ?? 'Curated Mix',
        artist: playlist.description ?? 'Featured Playlist',
        thumbnail: playlist.cover_art_url ?? '',
        trackCount: playlist.track_count ?? 0,
        browseId: playlist.browse_id,
      })).filter(item => item.thumbnail !== ''); // Only return items with thumbnails
      
      return items;
    }

    // Final fallback: Get all playlists with cover art
    const { data: allPlaylists, error: allError } = await supabase
      .from('playlists')
      .select('id, name, description, cover_art_url, track_count, browse_id')
      .not('cover_art_url', 'is', null)
      .neq('cover_art_url', '')
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS * 2);

    if (!allError && allPlaylists && allPlaylists.length > 0) {
      console.log(`✅ [useMixes] Found ${allPlaylists.length} playlists with thumbnails`);
      const items = allPlaylists.map((playlist: Playlist) => ({
        id: playlist.id,
        playlistId: playlist.id,
        title: playlist.name ?? 'Mix',
        artist: playlist.description ?? 'Personal Playlist',
        thumbnail: playlist.cover_art_url ?? '',
        trackCount: playlist.track_count ?? 0,
        browseId: playlist.browse_id,
      })).filter(item => item.thumbnail !== '');
      
      return items;
    }

    // If no playlists found at all
    console.log('⚠️ [useMixes] No playlists with thumbnails found in database');
    return [];

  } catch (err) {
    console.error('❌ [useMixes] Error:', err);
    return [];
  }
}

export const useMixes = (): UseMixesResult => {
  const [rawData, setRawData] = useState<MixItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  // 🎲 Shuffle and limit to DISPLAY_COUNT (6) items - reshuffles on every load
  const data = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    const shuffled = shuffleArray(rawData);
    return shuffled.slice(0, DISPLAY_COUNT);
  }, [rawData, shuffleKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = await cache.get(CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`📦 [useMixes] Using cached data`);
        setRawData(cached);
        setLoading(false);
        return;
      }

      console.log(`🔍 [useMixes] Fetching playlists from Supabase...`);
      const mixes = await fetchMixes();
      
      if (mixes.length > 0) {
        console.log(`✅ [useMixes] Received ${mixes.length} playlists with thumbnails`);
        await cache.set(CACHE_KEY, mixes, CACHE_TTL_MS);
        setRawData(mixes);
      } else {
        console.log(`⚠️ [useMixes] No playlists with thumbnails found`);
        setRawData([]);
      }
    } catch (err: any) {
      console.error(`❌ [useMixes] Failed:`, err);
      setError(err.message || `Failed to load mixes`);
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 🔄 Refetch reshuffles without hitting API if data exists
  const refetch = useCallback(() => {
    if (rawData.length > 0) {
      console.log('🎲 [useMixes] Reshuffling...');
      setShuffleKey(prev => prev + 1);
    } else {
      fetchData();
    }
  }, [rawData.length, fetchData]);

  return { 
    data, 
    loading, 
    error, 
    refetch,
    isEmpty: data.length === 0 
  };
};
