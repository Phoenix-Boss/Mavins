/**
 * useMusicChannels Hook — Supabase DB Edition
 * Fetches artists as "Music Channels" with shuffle
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/libs/supabase';
import { cache } from '@/libs/cache';

export interface MusicChannelItem {
  id: string;
  artistId: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  subscriberCount?: number;
  monthlyListeners?: number;
  isVerified?: boolean;
  browseId?: string;
}

interface UseMusicChannelsResult {
  data: MusicChannelItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isEmpty: boolean;
}

const DISPLAY_COUNT = 6; // Show 6 artists (3x2 grid)
const CACHE_KEY = 'music:channels:v1';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Fisher-Yates shuffle
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

async function fetchMusicChannels(): Promise<MusicChannelItem[]> {
  try {
    // First, try to find a "Music Channels" section
    const { data: sections, error: sectionError } = await supabase
      .from('sections')
      .select('id, name')
      .or('section_type.eq.music_channels,name.ilike.%music%channel%,name.ilike.%artist%channel%')
      .eq('is_visible', true)
      .limit(1);

    if (!sectionError && sections && sections.length > 0) {
      const sectionId = sections[0].id;
      
      // Get section items with artist_ids
      const { data: sectionItems, error: itemsError } = await supabase
        .from('section_items')
        .select('artist_id, display_order, position, custom_title, custom_subtitle, custom_thumbnail_url')
        .eq('section_id', sectionId)
        .not('artist_id', 'is', null)
        .order('display_order', { ascending: true, nullsFirst: false })
        .limit(20);

      if (!itemsError && sectionItems && sectionItems.length > 0) {
        const artistIds = sectionItems
          .map(item => item.artist_id)
          .filter((id): id is string => id !== null);

        if (artistIds.length > 0) {
          // Fetch the actual artists
          const { data: artists, error: artistsError } = await supabase
            .from('artists')
            .select('id, name, thumbnail_url, browse_id, is_verified, subscriber_count, monthly_listeners')
            .in('id', artistIds);

          if (!artistsError && artists && artists.length > 0) {
            const artistMap = new Map();
            artists.forEach(artist => {
              artistMap.set(artist.id, artist);
            });

            // Build items - prioritize section custom data, fallback to artist data
            const items = sectionItems
              .map(item => {
                if (!item.artist_id) return null;
                const artist = artistMap.get(item.artist_id);
                if (!artist) return null;

                // Prioritize custom thumbnail, fallback to artist thumbnail
                const thumbnail = item.custom_thumbnail_url && item.custom_thumbnail_url.trim() !== ''
                  ? item.custom_thumbnail_url
                  : (artist.thumbnail_url ?? '');

                // Skip if no thumbnail
                if (!thumbnail) return null;

                return {
                  id: artist.id,
                  artistId: artist.id,
                  title: item.custom_title ?? artist.name ?? 'Unknown Artist',
                  subtitle: item.custom_subtitle ?? (artist.is_verified ? 'Verified Artist' : 'Artist Channel'),
                  thumbnail: thumbnail,
                  subscriberCount: artist.subscriber_count ?? 0,
                  monthlyListeners: artist.monthly_listeners ?? 0,
                  isVerified: artist.is_verified ?? false,
                  browseId: artist.browse_id ?? undefined,
                };
              })
              .filter((item): item is MusicChannelItem => item !== null);

            if (items.length > 0) {
              console.log(`✅ [useMusicChannels] Found ${items.length} artists from section`);
              return items;
            }
          }
        }
      }
    }

    // Fallback: Get popular artists (verified first, then by monthly listeners)
    const { data: artists, error: artistsError } = await supabase
      .from('artists')
      .select('id, name, thumbnail_url, browse_id, is_verified, subscriber_count, monthly_listeners')
      .not('thumbnail_url', 'is', null)
      .neq('thumbnail_url', '')
      .order('is_verified', { ascending: false })
      .order('monthly_listeners', { ascending: false })
      .limit(20);

    if (!artistsError && artists && artists.length > 0) {
      console.log(`✅ [useMusicChannels] Found ${artists.length} artists from database`);
      const items = artists.map(artist => ({
        id: artist.id,
        artistId: artist.id,
        title: artist.name ?? 'Unknown Artist',
        subtitle: artist.is_verified ? 'Verified Artist' : 'Artist Channel',
        thumbnail: artist.thumbnail_url ?? '',
        subscriberCount: artist.subscriber_count ?? 0,
        monthlyListeners: artist.monthly_listeners ?? 0,
        isVerified: artist.is_verified ?? false,
        browseId: artist.browse_id ?? undefined,
      })).filter(item => item.thumbnail !== '');

      return items;
    }

    console.log('⚠️ [useMusicChannels] No artists with thumbnails found');
    return [];

  } catch (err) {
    console.error('❌ [useMusicChannels] Error:', err);
    return [];
  }
}

export const useMusicChannels = (): UseMusicChannelsResult => {
  const [rawData, setRawData] = useState<MusicChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shuffleKey, setShuffleKey] = useState(0);

  // Shuffle and limit to DISPLAY_COUNT (6) items
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
        console.log('📦 [useMusicChannels] Using cached data');
        setRawData(cached);
        setLoading(false);
        return;
      }

      console.log('🔍 [useMusicChannels] Fetching artists...');
      const channels = await fetchMusicChannels();
      
      if (channels.length > 0) {
        console.log(`✅ [useMusicChannels] Received ${channels.length} artists`);
        await cache.set(CACHE_KEY, channels, CACHE_TTL_MS);
        setRawData(channels);
      } else {
        console.log('⚠️ [useMusicChannels] No artists found');
        setRawData([]);
      }
    } catch (err: any) {
      console.error('❌ [useMusicChannels] Failed:', err);
      setError(err.message || 'Failed to load music channels');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refetch reshuffles without hitting API if data exists
  const refetch = useCallback(() => {
    if (rawData.length > 0) {
      console.log('🎲 [useMusicChannels] Reshuffling...');
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
    isEmpty: data.length === 0,
  };
};
