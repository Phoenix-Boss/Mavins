// components/SearchPreloader.tsx
/**
 * SearchPreloader — Fetches search data at app startup
 * Populates trending, discover songs, playlists, and beats
 * UPDATED: CET (Central European Time) content focus
 */

import { useEffect, useState } from 'react';
import { useSearchStore } from '@/store/search';
import { supabase } from '@/libs/supabase';
import MavinEngine from '@/modules/mavin-engine';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// CET-focused search queries
const CET_QUERIES = {
  discoverSongs: [
    "top 40 pop hits 2025",
    "german pop charts 2025",
    "europop hits 2025",
    "french pop music 2025",
    "italian pop hits 2025",
    "uk top 40 2025",
    "european hit songs 2025"
  ],
  playlists: [
    "official charts playlist 2025",
    "top hits europe 2025",
    "viral 50 global 2025",
    "pop rising 2025",
    "hot hits 2025"
  ],
  beats: [
    "pop type beat 2025",
    "europop instrumental 2025",
    "dance pop beat 2025",
    "trap pop beat 2025",
    "radio pop instrumental 2025"
  ]
};

// Cache version - increment this to force refetch all data
const CACHE_VERSION = 'cet-v4-2025';

export function SearchPreloader() {
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const { 
    setAllData, 
    setLoading, 
    hasAnyData, 
    isDataFresh,
    clearAllData
  } = useSearchStore();

  useEffect(() => {
    const checkAndFetch = async () => {
      try {
        // Check cache version from AsyncStorage
        let cachedVersion = null;
        try {
          cachedVersion = await AsyncStorage.getItem('search_cache_version');
        } catch (error) {
          console.error('Failed to read cache version:', error);
        }
        
        // Force refetch if cache version doesn't match
        const needsVersionUpdate = cachedVersion !== CACHE_VERSION;
        
        if (needsVersionUpdate) {
          console.log('🔍 [SearchPreloader] Cache version mismatch. Expected:', CACHE_VERSION, 'Got:', cachedVersion);
          console.log('🔍 [SearchPreloader] Clearing old cache and refetching...');
          try {
            await AsyncStorage.setItem('search_cache_version', CACHE_VERSION);
            console.log('✅ Cache version saved:', CACHE_VERSION);
          } catch (error) {
            console.error('Failed to save cache version:', error);
          }
          // Clear existing data from store
          clearAllData();
        }
        
        // Skip if already attempted this session AND no version update needed
        if (hasAttemptedFetch && !needsVersionUpdate) {
          console.log('🔍 [SearchPreloader] Skipping - already attempted this session');
          return;
        }
        
        // Skip if persisted data is fresh (less than 30 min old) AND no version update needed
        if (!needsVersionUpdate && hasAnyData() && isDataFresh()) {
          console.log('🔍 [SearchPreloader] Skipping - persisted data is fresh');
          return;
        }

        await fetchSearchData();
      } catch (error) {
        console.error('Error in checkAndFetch:', error);
      }
    };

    const fetchSearchData = async () => {
      console.log('🔍 [SearchPreloader] Starting CET search data fetch...');
      setLoading(true);
      setHasAttemptedFetch(true);

      try {
        // ─── 1. Fetch Trending from global_search_history ───
        console.log('🔍 [SearchPreloader] Fetching trending searches...');
        let trendingItems: any[] = [];
        
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
          console.log('🔍 [SearchPreloader] Trending: 0 items - using fallback CET trends');
          // Fallback CET trends if database is empty
          trendingItems = [
            { id: '1', query: "Taylor Swift", search_count: 1000, thumbnail_url: '', artist_name: 'Taylor Swift', track_uuid: null },
            { id: '2', query: "The Weeknd", search_count: 950, thumbnail_url: '', artist_name: 'The Weeknd', track_uuid: null },
            { id: '3', query: "Dua Lipa", search_count: 900, thumbnail_url: '', artist_name: 'Dua Lipa', track_uuid: null },
            { id: '4', query: "Harry Styles", search_count: 850, thumbnail_url: '', artist_name: 'Harry Styles', track_uuid: null },
            { id: '5', query: "Billie Eilish", search_count: 800, thumbnail_url: '', artist_name: 'Billie Eilish', track_uuid: null }
          ];
        }

        // ─── 2. Fetch Discover Songs (CET Pop Hits) ───
        console.log('🔍 [SearchPreloader] Fetching discover songs (CET pop hits)...');
        let discoverSongs: any[] = [];
        
        for (const query of CET_QUERIES.discoverSongs) {
          try {
            console.log(`🔍 Trying CET query: "${query}"`);
            const songsRes = await MavinEngine.search(query, "", undefined, 0);
            if (songsRes?.results && songsRes.results.length > 0) {
              console.log(`✅ Found ${songsRes.results.length} results with query: "${query}"`);
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
              
              if (songs.length > 0) {
                discoverSongs = songs;
                console.log(`✅ Got ${discoverSongs.length} CET songs from query: "${query}"`);
                if (discoverSongs[0]) {
                  console.log('Sample CET song:', discoverSongs[0].title, 'by', discoverSongs[0].subtitle);
                }
                break; // Exit loop once we have results
              }
            }
          } catch (error) {
            console.error(`Query failed: "${query}"`, error);
          }
        }

        if (discoverSongs.length === 0) {
          console.warn('⚠️ No CET songs found, using fallback data');
          discoverSongs = [
            { id: "1", title: "Beautiful Things", subtitle: "Benson Boone", thumbnail: "", type: "song" as const, url: "" },
            { id: "2", title: "Lose Control", subtitle: "Teddy Swims", thumbnail: "", type: "song" as const, url: "" },
            { id: "3", title: "Espresso", subtitle: "Sabrina Carpenter", thumbnail: "", type: "song" as const, url: "" },
            { id: "4", title: "We Can't Be Friends", subtitle: "Ariana Grande", thumbnail: "", type: "song" as const, url: "" },
            { id: "5", title: "Too Sweet", subtitle: "Hozier", thumbnail: "", type: "song" as const, url: "" }
          ];
        }

        // ─── 3. Fetch Playlists (CET Top Charts) ───
        console.log('🔍 [SearchPreloader] Fetching playlists (CET top charts)...');
        let playlists: any[] = [];
        
        for (const query of CET_QUERIES.playlists) {
          try {
            console.log(`🔍 Trying playlist query: "${query}"`);
            const playlistsRes = await MavinEngine.search(query, "playlists", undefined, 0);
            if (playlistsRes?.results && playlistsRes.results.length > 0) {
              console.log(`✅ Found ${playlistsRes.results.length} playlists with query: "${query}"`);
              const pl = playlistsRes.results.slice(0, 12).map((p: any) => ({
                id: p.url,
                title: p.name,
                subtitle: p.uploaderName || "Various Artists",
                thumbnail: bestThumb(p.thumbnails),
                type: "playlist" as const,
                url: p.url,
              }));
              
              if (pl.length > 0) {
                playlists = pl;
                console.log(`✅ Got ${playlists.length} CET playlists from query: "${query}"`);
                break;
              }
            }
          } catch (error) {
            console.error(`Playlist query failed: "${query}"`, error);
          }
        }

        if (playlists.length === 0) {
          console.warn('⚠️ No CET playlists found, using fallback data');
          playlists = [
            { id: "1", title: "Top 50 Global", subtitle: "Spotify", thumbnail: "", type: "playlist" as const, url: "" },
            { id: "2", title: "Pop Rising", subtitle: "Spotify", thumbnail: "", type: "playlist" as const, url: "" },
            { id: "3", title: "Hot Hits UK", subtitle: "Spotify", thumbnail: "", type: "playlist" as const, url: "" },
            { id: "4", title: "Viral 50", subtitle: "Spotify", thumbnail: "", type: "playlist" as const, url: "" }
          ];
        }

        // ─── 4. Fetch Beats (CET Pop/Trap Beats) ───
        console.log('🔍 [SearchPreloader] Fetching beats (CET pop/trap beats)...');
        let beats: any[] = [];
        
        for (const query of CET_QUERIES.beats) {
          try {
            console.log(`🔍 Trying beat query: "${query}"`);
            const beatsRes = await MavinEngine.search(query, "", undefined, 0);
            if (beatsRes?.results && beatsRes.results.length > 0) {
              console.log(`✅ Found ${beatsRes.results.length} beats with query: "${query}"`);
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
                  key: ["Cm", "Gm", "Am", "Em", "Fm", "Dm", "Bm"][Math.floor(Math.random() * 7)],
                }));
              
              if (beatItems.length > 0) {
                beats = beatItems;
                console.log(`✅ Got ${beats.length} CET beats from query: "${query}"`);
                if (beats[0]) {
                  console.log('Sample CET beat:', beats[0].title);
                }
                break;
              }
            }
          } catch (error) {
            console.error(`Beat query failed: "${query}"`, error);
          }
        }

        if (beats.length === 0) {
          console.warn('⚠️ No CET beats found, using fallback data');
          beats = [
            { id: "1", title: "Pop Beat 2025", subtitle: "Producer Name", thumbnail: "", type: "beat" as const, url: "", bpm: 128, key: "Cm" },
            { id: "2", title: "Dance Pop Instrumental", subtitle: "Producer Name", thumbnail: "", type: "beat" as const, url: "", bpm: 124, key: "Gm" },
            { id: "3", title: "Emotional Pop Beat", subtitle: "Producer Name", thumbnail: "", type: "beat" as const, url: "", bpm: 85, key: "Am" }
          ];
        }

        // ─── 5. Store all data ───
        setAllData({
          trending: trendingItems,
          discoverSongs,
          playlists,
          beats,
        });

        console.log('✅ [SearchPreloader] CET data store complete:', {
          trending: trendingItems.length,
          discoverSongs: discoverSongs.length,
          playlists: playlists.length,
          beats: beats.length,
          timestamp: new Date().toISOString()
        });

        // Log sample of what was stored
        if (discoverSongs.length > 0 && discoverSongs[0]) {
          console.log('📀 Sample CET song:', discoverSongs[0].title, 'by', discoverSongs[0].subtitle);
        }
        if (playlists.length > 0 && playlists[0]) {
          console.log('📋 Sample CET playlist:', playlists[0].title);
        }
        if (beats.length > 0 && beats[0]) {
          console.log('🎵 Sample CET beat:', beats[0].title);
        }

      } catch (error) {
        console.error('❌ [SearchPreloader] Fatal error:', error);
      } finally {
        setLoading(false);
        console.log('🔍 [SearchPreloader] Fetch complete, loading set to false');
      }
    };

    checkAndFetch();
  }, [hasAnyData, isDataFresh, hasAttemptedFetch, setAllData, setLoading, clearAllData]);

  return null;
}