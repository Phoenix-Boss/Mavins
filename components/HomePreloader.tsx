// components/HomePreloader.tsx
/**
 * HomePreloader — Fetches home data at app startup
 * PRIMARY: MavinEngine search API (CET/European trending)
 * FALLBACK: Supabase tables (when MavinEngine fails or returns empty)
 * 
 * Quick Actions ONLY from user_quick_actions table - NO FALLBACK
 * Quick Picks from campaigns table (with dummy data fallback)
 * Radio FM from supabase radio_stations table ONLY
 * Top 10 Month section REMOVED entirely
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useHomeStore, CampaignCard } from '@/store/home';
import { supabase } from '@/libs/supabase';
import MavinEngine from '@/modules/mavin-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING — daily shuffle (persisted locally, independent of the home store)
//
// The store previously exposed a `setTrendingWithDailyShuffle` action that no
// longer exists, which crashed `fetchAllData` every run. Instead of depending
// on a store action, the "shuffle once per calendar day" behavior is handled
// right here: the order from today's first shuffle is cached in AsyncStorage
// and reused for any later fetch that happens on the same day. New items that
// weren't part of the cached order (e.g. freshly trending songs) are appended
// to the end rather than being dropped.
// ─────────────────────────────────────────────────────────────────────────────

const TRENDING_SHUFFLE_DATE_KEY = '@mavin_trending_shuffle_date';
const TRENDING_SHUFFLE_ORDER_KEY = '@mavin_trending_shuffle_order';

const getTodayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};

async function getDailyShuffledTrending(trending: any[]): Promise<any[]> {
  const todayKey = getTodayKey();

  try {
    const [storedDate, storedOrderJson] = await Promise.all([
      AsyncStorage.getItem(TRENDING_SHUFFLE_DATE_KEY),
      AsyncStorage.getItem(TRENDING_SHUFFLE_ORDER_KEY),
    ]);

    if (storedDate === todayKey && storedOrderJson) {
      const storedOrder: string[] = JSON.parse(storedOrderJson);
      const byId = new Map(trending.map((item) => [item.id, item]));
      const ordered: any[] = [];

      for (const id of storedOrder) {
        const item = byId.get(id);
        if (item) {
          ordered.push(item);
          byId.delete(id);
        }
      }
      ordered.push(...byId.values()); // newly trending items not seen in today's order

      if (ordered.length > 0) {
        console.log('📦 [HomePreloader] Trending: reusing today\'s shuffle order');
        return ordered;
      }
    }
  } catch (err) {
    console.log('📦 [HomePreloader] Trending shuffle cache read failed, reshuffling:', err);
  }

  const shuffled = shuffleArray(trending);
  try {
    await AsyncStorage.multiSet([
      [TRENDING_SHUFFLE_DATE_KEY, todayKey],
      [TRENDING_SHUFFLE_ORDER_KEY, JSON.stringify(shuffled.map((item) => item.id))],
    ]);
  } catch (err) {
    console.log('📦 [HomePreloader] Trending shuffle cache write failed:', err);
  }
  console.log('📦 [HomePreloader] Trending: shuffled fresh for today');
  return shuffled;
}

const formatMavinStream = (item: any): any => ({
  id: extractVideoId(item.url) || item.url,
  videoId: extractVideoId(item.url),
  title: item.name ?? 'Unknown Title',
  artist: item.uploaderName ?? 'Unknown Artist',
  thumbnail: bestThumb(item.thumbnails),
  url: item.url,
  duration: item.duration ?? 0,
  views: item.viewCount ?? 0,
});

const formatMavinChannel = (item: any): any => ({
  id: item.url,
  name: item.name ?? 'Unknown Artist',
  title: item.name ?? 'Unknown Artist',
  thumbnail: bestThumb(item.thumbnails),
  artistId: item.url,
  isVerified: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// QUICK PICKS - Campaign cards from Supabase with dummy fallback
// ─────────────────────────────────────────────────────────────────────────────

async function fetchQuickPicks(): Promise<CampaignCard[]> {
  console.log('📦 [HomePreloader] Fetching quick picks (campaign cards)...');
  
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, title, description, thumbnail_url, promoted, mavin_special, play_count, cta_url, song_id')
      .eq('is_active', true)
      .order('play_count', { ascending: false })
      .limit(10);

    if (!error && campaigns && campaigns.length > 0) {
      console.log(`📦 [HomePreloader] Quick Picks: ${campaigns.length} campaign cards from Supabase`);
      return campaigns.map((camp: any) => ({
        id: camp.id,
        title: camp.title,
        description: camp.description,
        thumbnail: camp.thumbnail_url,
        promoted: camp.promoted ?? false,
        mavinSpecial: camp.mavin_special ?? false,
        playCount: camp.play_count ?? 0,
        ctaUrl: camp.cta_url,
        songId: camp.song_id,
      }));
    }
  } catch (err) {
    console.log('📦 [HomePreloader] Supabase campaigns fetch error, using dummy data');
  }

  // Dummy data for testing - shows immediately
  console.log('📦 [HomePreloader] Quick Picks: using dummy data');
  return [
    {
      id: 'dummy1',
      title: 'Summer Vibes 2024',
      description: 'The hottest tracks of the season',
      thumbnail: 'https://picsum.photos/id/100/400/400',
      promoted: true,
      mavinSpecial: true,
      playCount: 1250000,
      ctaUrl: '/playlist/summer-vibes',
      songId: '',
    },
    {
      id: 'dummy2',
      title: 'Mavin Records Special',
      description: 'Exclusive artist collection',
      thumbnail: 'https://picsum.photos/id/101/400/400',
      promoted: false,
      mavinSpecial: true,
      playCount: 892000,
      ctaUrl: '/playlist/mavin-special',
      songId: '',
    },
    {
      id: 'dummy3',
      title: 'New Album Drop',
      description: 'Listen to the latest release',
      thumbnail: 'https://picsum.photos/id/102/400/400',
      promoted: true,
      mavinSpecial: false,
      playCount: 456000,
      ctaUrl: '/album/new-drop',
      songId: '',
    },
    {
      id: 'dummy4',
      title: 'Weekly Top 50',
      description: 'Most played this week',
      thumbnail: 'https://picsum.photos/id/103/400/400',
      promoted: false,
      mavinSpecial: false,
      playCount: 2100000,
      ctaUrl: '/playlist/top-50',
      songId: '',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback fetch functions (Supabase)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTrendingFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
    .not('artwork_thumbnail', 'is', null)
    .order('play_count', { ascending: false })
    .limit(20);
  
  return (data || []).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    url: song.video_id ? `https://www.youtube.com/watch?v=${song.video_id}` : '',
    duration: song.duration ?? 0,
    views: song.play_count ?? 0,
  }));
}

async function fetchBiggestHitsFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
    .not('artwork_thumbnail', 'is', null)
    .order('play_count', { ascending: false })
    .limit(20);
  
  return (data || []).slice(0, 6).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    url: song.video_id ? `https://www.youtube.com/watch?v=${song.video_id}` : '',
    duration: song.duration ?? 0,
    views: song.play_count ?? 0,
  }));
}

async function fetchPeoplesChoiceFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
    .not('artwork_thumbnail', 'is', null)
    .order('play_count', { ascending: false })
    .limit(20);
  
  return (data || []).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    url: song.video_id ? `https://www.youtube.com/watch?v=${song.video_id}` : '',
    duration: song.duration ?? 0,
    views: song.play_count ?? 0,
  }));
}

async function fetchNewReleasesFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration, created_at')
    .not('artwork_thumbnail', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  
  return (data || []).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    url: song.video_id ? `https://www.youtube.com/watch?v=${song.video_id}` : '',
    duration: song.duration ?? 0,
    views: song.play_count ?? 0,
  }));
}

async function fetchThrowbacksFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration, created_at')
    .not('artwork_thumbnail', 'is', null)
    .order('created_at', { ascending: true })
    .limit(10);
  
  return (data || []).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    thumbnailFallback: song.artwork_url ?? '',
    views: song.play_count ?? 0,
  }));
}

async function fetchChannelsFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('artists')
    .select('id, name, thumbnail_url, is_verified')
    .not('thumbnail_url', 'is', null)
    .neq('thumbnail_url', '')
    .order('monthly_listeners', { ascending: false, nullsFirst: false })
    .limit(10);
  
  return (data || []).map((artist: any) => ({
    id: artist.id,
    name: artist.name ?? 'Unknown Artist',
    title: artist.name ?? 'Unknown Artist',
    thumbnail: artist.thumbnail_url ?? '',
    artistId: artist.id,
    isVerified: artist.is_verified ?? false,
  }));
}

async function fetchPodcastsFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('podcast_episodes')
    .select('id, title, thumbnail_url, duration_seconds, play_count, episode_number, metadata')
    .order('play_count', { ascending: false, nullsFirst: false })
    .limit(10);
  
  return (data || []).map((episode: any) => {
    const meta = (episode.metadata ?? {}) as Record<string, any>;
    return {
      id: episode.id,
      title: episode.title ?? 'Unknown Episode',
      artist: meta.creator ?? 'Unknown Podcast',
      thumbnail: episode.thumbnail_url ?? '',
      episodeCount: episode.episode_number ?? 1,
      type: 'podcast',
    };
  });
}

async function fetchRadioStationsFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('radio_stations')
    .select('id, name, logo_url, stream_url')
    .eq('is_active', true)
    .not('logo_url', 'is', null)
    .limit(10);
  
  return (data || []).map((station: any) => ({
    id: station.id,
    name: station.name ?? 'Unknown Station',
    title: station.name ?? 'Unknown Station',
    thumbnail: station.logo_url ?? '',
    streamUrl: station.stream_url,
  }));
}

async function fetchMavinsBestFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('songs')
    .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
    .not('artwork_thumbnail', 'is', null)
    .order('play_count', { ascending: false })
    .limit(5);
  
  return (data || []).map((song: any) => ({
    id: song.id,
    videoId: song.video_id,
    title: song.title ?? 'Unknown Title',
    artist: song.artist ?? 'Unknown Artist',
    thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
    thumbnailFallback: song.artwork_url ?? '',
    views: song.play_count ?? 0,
  }));
}

async function fetchMixesFallback(): Promise<any[]> {
  const { data } = await supabase
    .from('playlists')
    .select('id, name, description, cover_art_url, track_count')
    .not('cover_art_url', 'is', null)
    .neq('cover_art_url', '')
    .order('created_at', { ascending: false })
    .limit(10);
  
  return (data || []).map((playlist: any) => ({
    id: playlist.id,
    title: playlist.name ?? 'Untitled Mix',
    thumbnail: playlist.cover_art_url ?? '',
    artist: playlist.description ?? 'Curated Playlist',
    trackCount: playlist.track_count ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary fetch functions (MavinEngine - CET/European focus) with fallback
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTrending(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching trending (CET/Europe)...');
    const response = await MavinEngine.search("top 50 global trending music 2024", "", undefined, 0);
    
    if (response?.results) {
      const streams = response.results
        .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
        .slice(0, 20)
        .map(formatMavinStream);
      
      if (streams.length >= 4) {
        console.log(`📦 [HomePreloader] Trending: ${streams.length} items from MavinEngine`);
        return streams;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine trending failed, using Supabase fallback');
    return fetchTrendingFallback();
  }
}

async function fetchBiggestHits(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching biggest hits (CET/Europe)...');
    const response = await MavinEngine.search("biggest hits 2024 top charts", "", undefined, 0);
    
    if (response?.results) {
      const streams = response.results
        .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
        .slice(0, 6)
        .map(formatMavinStream);
      
      if (streams.length >= 3) {
        console.log(`📦 [HomePreloader] Biggest Hits: ${streams.length} items from MavinEngine`);
        return streams;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine biggest hits failed, using Supabase fallback');
    return fetchBiggestHitsFallback();
  }
}

async function fetchPeoplesChoice(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching people\'s choice (CET/Europe)...');
    const response = await MavinEngine.search("most popular songs 2024 viral", "", undefined, 0);
    
    if (response?.results) {
      const streams = response.results
        .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
        .slice(0, 20)
        .map(formatMavinStream);
      
      if (streams.length >= 4) {
        console.log(`📦 [HomePreloader] People's Choice: ${streams.length} items from MavinEngine`);
        return streams;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine people\'s choice failed, using Supabase fallback');
    return fetchPeoplesChoiceFallback();
  }
}

async function fetchNewReleases(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching new releases (CET/Europe)...');
    const response = await MavinEngine.search("new music releases this week 2024", "", undefined, 0);
    
    if (response?.results) {
      const streams = response.results
        .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
        .slice(0, 20)
        .map(formatMavinStream);
      
      if (streams.length >= 4) {
        console.log(`📦 [HomePreloader] New Releases: ${streams.length} items from MavinEngine`);
        return streams;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine new releases failed, using Supabase fallback');
    return fetchNewReleasesFallback();
  }
}

async function fetchThrowbacks(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching throwbacks (CET/Europe)...');
    const response = await MavinEngine.search("throwback hits 2000s 2010s", "", undefined, 0);
    
    if (response?.results) {
      const streams = response.results
        .filter((i: any) => i.type === "stream" && !i.isLive && !i.isShortFormContent)
        .slice(0, 10)
        .map((item: any) => ({
          id: extractVideoId(item.url) || item.url,
          videoId: extractVideoId(item.url),
          title: item.name ?? 'Unknown Title',
          artist: item.uploaderName ?? 'Unknown Artist',
          thumbnail: bestThumb(item.thumbnails),
          thumbnailFallback: bestThumb(item.thumbnails),
          views: item.viewCount ?? 0,
        }));
      
      if (streams.length >= 3) {
        console.log(`📦 [HomePreloader] Throwbacks: ${streams.length} items from MavinEngine`);
        return streams;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine throwbacks failed, using Supabase fallback');
    return fetchThrowbacksFallback();
  }
}

async function fetchMusicChannels(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching music channels (CET/Europe)...');
    const response = await MavinEngine.search("popular music artists 2024", "channels", undefined, 0);
    
    if (response?.results) {
      const channels = response.results
        .filter((i: any) => i.type === "channel")
        .slice(0, 10)
        .map(formatMavinChannel);
      
      if (channels.length >= 3) {
        console.log(`📦 [HomePreloader] Music Channels: ${channels.length} items from MavinEngine`);
        return channels;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine music channels failed, using Supabase fallback');
    return fetchChannelsFallback();
  }
}

async function fetchPodcasts(): Promise<any[]> {
  try {
    console.log('📦 [HomePreloader] MavinEngine: fetching podcasts (CET/Europe)...');
    const response = await MavinEngine.search("top podcasts 2024", "podcasts", undefined, 0);
    
    if (response?.results) {
      const podcasts = response.results
        .filter((i: any) => i.type === "playlist" || i.type === "stream")
        .slice(0, 10)
        .map((item: any) => ({
          id: item.url,
          title: item.name ?? 'Unknown Episode',
          artist: item.uploaderName ?? 'Unknown Podcast',
          thumbnail: bestThumb(item.thumbnails),
          episodeCount: 1,
          type: 'podcast',
        }));
      
      if (podcasts.length >= 3) {
        console.log(`📦 [HomePreloader] Podcasts: ${podcasts.length} items from MavinEngine`);
        return podcasts;
      }
    }
    throw new Error('Insufficient results from MavinEngine');
  } catch (error) {
    console.log('📦 [HomePreloader] MavinEngine podcasts failed, using Supabase fallback');
    return fetchPodcastsFallback();
  }
}

async function fetchRadioStations(): Promise<any[]> {
  console.log('📦 [HomePreloader] Radio stations: using Supabase only');
  return fetchRadioStationsFallback();
}

async function fetchMavinsBest(): Promise<any[]> {
  console.log('📦 [HomePreloader] Mavin\'s Best: using Supabase only');
  return fetchMavinsBestFallback();
}

async function fetchMixes(): Promise<any[]> {
  console.log('📦 [HomePreloader] Mixes: using Supabase only');
  return fetchMixesFallback();
}

async function fetchQuickActions(): Promise<any[]> {
  console.log('📦 [HomePreloader] Fetching quick actions from user_quick_actions...');
  const { data: quickActionsData, error: qaError } = await supabase
    .from('user_quick_actions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (qaError) {
    console.error('Quick actions error:', qaError);
    return [];
  }

  if (!quickActionsData || quickActionsData.length === 0) {
    console.log('📦 [HomePreloader] Quick Actions: 0 items - section will NOT show');
    return [];
  }

  console.log(`📦 [HomePreloader] Quick Actions: ${quickActionsData.length} items`);
  return quickActionsData.map((item: any) => ({
    id: item.track_id,
    videoId: item.video_id,
    title: item.title,
    artist: item.artist,
    thumbnail: item.thumbnail,
    url: item.url,
    duration: item.duration,
    playedAt: new Date(item.created_at).getTime(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function HomePreloader() {
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const setAllData = useHomeStore((s) => s.setAllData);
  const setRecentSongs = useHomeStore((s) => s.setRecentSongs);
  const setQuickPicks = useHomeStore((s) => s.setQuickPicks);
  const setLoading = useHomeStore((s) => s.setLoading);
  const hasAnyData = useHomeStore((s) => s.hasAnyData());
  const isDataFresh = useHomeStore((s) => s.isDataFresh());

  useEffect(() => {
    if (hasAttemptedFetch) {
      console.log('📦 [HomePreloader] Skipping - already attempted this session');
      return;
    }
    if (hasAnyData && isDataFresh) {
      console.log('📦 [HomePreloader] Skipping - persisted data is fresh');
      return;
    }

    const fetchAllData = async () => {
      console.log('📦 [HomePreloader] Starting data fetch (CET/European focused)...');
      setLoading(true);
      setHasAttemptedFetch(true);

      try {
        // ─── 1. Quick Actions (Supabase only) ───
        const quickActionsSongs = await fetchQuickActions();
        const shuffledQuickActions = shuffleArray(quickActionsSongs);
        setRecentSongs(shuffledQuickActions);
        console.log(`📦 [HomePreloader] Quick Actions set: ${shuffledQuickActions.length} items`);

        // ─── 2. Quick Picks (Campaign cards) ───
        const quickPicksCards = await fetchQuickPicks();
        setQuickPicks(quickPicksCards);
        console.log(`📦 [HomePreloader] Quick Picks set: ${quickPicksCards.length} campaign cards`);

        // ─── 3. Fetch all sections in parallel ───
        console.log('📦 [HomePreloader] Fetching all sections in parallel...');
        
        const [
          trending,
          biggestHits,
          peoplesChoice,
          newReleases,
          throwbacks,
          channels,
          podcasts,
          radioStations,
          mavinsBest,
          mixes,
        ] = await Promise.all([
          fetchTrending(),
          fetchBiggestHits(),
          fetchPeoplesChoice(),
          fetchNewReleases(),
          fetchThrowbacks(),
          fetchMusicChannels(),
          fetchPodcasts(),
          fetchRadioStations(),
          fetchMavinsBest(),
          fetchMixes(),
        ]);

        // ─── 4. Prepare data for store ───
        // `trending` only reshuffles once per calendar day (cached locally in
        // AsyncStorage) so the home screen doesn't visibly reorder on every
        // fetch — see getDailyShuffledTrending above.
        const dailyShuffledTrending = await getDailyShuffledTrending(trending);

        const storeData = {
          trending: dailyShuffledTrending,
          biggestHits,
          peoplesChoice,
          mavinsBest,
          newReleases,
          throwbacks,
          mixes,
          channels,
          podcasts,
          radioStations,
        };

        console.log('📦 [HomePreloader] Setting store data:', {
          trending: storeData.trending.length,
          biggestHits: storeData.biggestHits.length,
          peoplesChoice: storeData.peoplesChoice.length,
          mavinsBest: storeData.mavinsBest.length,
          newReleases: storeData.newReleases.length,
          throwbacks: storeData.throwbacks.length,
          mixes: storeData.mixes.length,
          channels: storeData.channels.length,
          podcasts: storeData.podcasts.length,
          radioStations: storeData.radioStations.length,
          quickActions: shuffledQuickActions.length,
          quickPicks: quickPicksCards.length,
        });

        setAllData(storeData);

      } catch (error) {
        console.error('❌ [HomePreloader] Fatal error:', error);
      } finally {
        setLoading(false);
        console.log('📦 [HomePreloader] Fetch complete');
      }
    };

    fetchAllData();
  }, [hasAnyData, isDataFresh, hasAttemptedFetch, setAllData, setRecentSongs, setQuickPicks, setLoading]);

  return null;
}

export default HomePreloader;