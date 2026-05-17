// components/SearchPreloader.tsx
/**
 * SearchPreloader — Fetches search data at app startup
 * Populates trending, discover songs, playlists, and beats
 */

import { useEffect, useState } from 'react';
import { useSearchStore } from '@/store/search';
import { supabase } from '@/libs/supabase';
import MavinEngine from '@/modules/mavin-engine';

const bestThumb = (thumbs: { url: string; resolutionLevel: string }[]): string =>
  thumbs.find(t => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find(t => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ?? "";

const extractVideoId = (url: string): string => {
  if (!url) return '';
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return url;
};

export function SearchPreloader() {
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const { 
    setAllData, 
    setLoading, 
    hasAnyData, 
    isDataFresh 
  } = useSearchStore();

  useEffect(() => {
    // Skip if already attempted this session
    if (hasAttemptedFetch) {
      console.log('🔍 [SearchPreloader] Skipping - already attempted this session');
      return;
    }
    
    // Skip if persisted data is fresh (less than 30 min old)
    if (hasAnyData() && isDataFresh()) {
      console.log('🔍 [SearchPreloader] Skipping - persisted data is fresh');
      return;
    }

    const fetchSearchData = async () => {
      console.log('🔍 [SearchPreloader] Starting search data fetch...');
      setLoading(true);
      setHasAttemptedFetch(true);

      try {
        // ─── 1. Fetch Trending from global_search_history ───
        console.log('🔍 [SearchPreloader] Fetching trending searches...');
        let trendingItems: any[] = [];
        
        // FIXED: Changed from 'track_id' to 'track_uuid' to match Supabase schema
        const { data: trendingData, error: trendingError } = await supabase
          .from('global_search_history')
          .select('id, query, thumbnail_url, artist_name, track_uuid, search_count, last_searched')
          .order('search_count', { ascending: false })
          .limit(20);

        if (trendingError) {
          console.error('Trending error:', trendingError);
        } else if (trendingData && trendingData.length > 0) {
          console.log(`🔍 [SearchPreloader] Trending: ${trendingData.length} items`);
          trendingItems = trendingData;
        } else {
          console.log('🔍 [SearchPreloader] Trending: 0 items');
        }

        // ─── 2. Fetch Discover Songs (Afrobeats/Afrobeat hits) ───
        console.log('🔍 [SearchPreloader] Fetching discover songs...');
        let discoverSongs: any[] = [];
        
        try {
          const songsRes = await MavinEngine.search("afrobeats 2024", "", undefined, 0);
          if (songsRes?.results) {
            const songs = songsRes.results
              .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
              .slice(0, 20)
              .map((s: any) => ({
                id: extractVideoId(s.url) || s.url,
                title: s.name,
                subtitle: s.uploaderName,
                thumbnail: bestThumb(s.thumbnails),
                type: "song" as const,
                url: s.url,
              }));
            discoverSongs = songs;
            console.log(`🔍 [SearchPreloader] Discover songs: ${discoverSongs.length} items`);
          }
        } catch (error) {
          console.error('Discover songs fetch error:', error);
        }

        // ─── 3. Fetch Playlists ───
        console.log('🔍 [SearchPreloader] Fetching playlists...');
        let playlists: any[] = [];
        
        try {
          const playlistsRes = await MavinEngine.search("popular playlist", "playlists", undefined, 0);
          if (playlistsRes?.results) {
            const pl = playlistsRes.results.slice(0, 12).map((p: any) => ({
              id: p.url,
              title: p.name,
              subtitle: p.uploaderName || "Various Artists",
              thumbnail: bestThumb(p.thumbnails),
              type: "playlist" as const,
              url: p.url,
            }));
            playlists = pl;
            console.log(`🔍 [SearchPreloader] Playlists: ${playlists.length} items`);
          }
        } catch (error) {
          console.error('Playlists fetch error:', error);
        }

        // ─── 4. Fetch Beats ───
        console.log('🔍 [SearchPreloader] Fetching beats...');
        let beats: any[] = [];
        
        try {
          const beatsRes = await MavinEngine.search("type beat", "", undefined, 0);
          if (beatsRes?.results) {
            const beatItems = beatsRes.results
              .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
              .slice(0, 12)
              .map((b: any) => ({
                id: extractVideoId(b.url) || b.url,
                title: b.name,
                subtitle: b.uploaderName,
                thumbnail: bestThumb(b.thumbnails),
                type: "beat" as const,
                url: b.url,
                bpm: Math.floor(Math.random() * 60) + 80,
                key: ["Cm", "Gm", "Am", "Em", "Fm"][Math.floor(Math.random() * 5)],
              }));
            beats = beatItems;
            console.log(`🔍 [SearchPreloader] Beats: ${beats.length} items`);
          }
        } catch (error) {
          console.error('Beats fetch error:', error);
        }

        // ─── 5. Store all data ───
        setAllData({
          trending: trendingItems,
          discoverSongs,
          playlists,
          beats,
        });

        console.log('🔍 [SearchPreloader] Store update complete:', {
          trending: trendingItems.length,
          discoverSongs: discoverSongs.length,
          playlists: playlists.length,
          beats: beats.length,
        });

      } catch (error) {
        console.error('❌ [SearchPreloader] Fatal error:', error);
      } finally {
        setLoading(false);
        console.log('🔍 [SearchPreloader] Fetch complete, loading set to false');
      }
    };

    fetchSearchData();
  }, [hasAnyData, isDataFresh, hasAttemptedFetch, setAllData, setLoading]);

  return null;
}