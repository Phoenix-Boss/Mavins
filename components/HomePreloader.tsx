// components/HomePreloader.tsx
/**
 * HomePreloader — Fetches home data at app startup
 * Quick Actions ONLY from user_quick_actions table - NO FALLBACK
 */

import { useEffect, useState } from 'react';
import { useHomeStore } from '@/store/home';
import { supabase } from '@/libs/supabase';

export function HomePreloader() {
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const setAllData = useHomeStore((s) => s.setAllData);
  const setRecentSongs = useHomeStore((s) => s.setRecentSongs);
  const setLoading = useHomeStore((s) => s.setLoading);
  const hasAnyData = useHomeStore((s) => s.hasAnyData());
  const isDataFresh = useHomeStore((s) => s.isDataFresh());

  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  useEffect(() => {
    // Skip if we already tried this session, or if persisted data is recent enough.
    // hasAnyData alone is NOT sufficient — it returns true from persisted data even
    // when lastFetchedAt is null (e.g. first launch after a store version bump).
    // isDataFresh() requires lastFetchedAt to be set AND within 30 minutes.
    if (hasAttemptedFetch) {
      console.log('📦 [HomePreloader] Skipping - already attempted this session');
      return;
    }
    if (hasAnyData && isDataFresh) {
      console.log('📦 [HomePreloader] Skipping - persisted data is fresh');
      return;
    }

    const fetchAllData = async () => {
      console.log('📦 [HomePreloader] Starting data fetch...');
      setLoading(true);
      setHasAttemptedFetch(true);

      try {
        // ─── 1. Fetch Quick Actions from user_quick_actions ONLY ───
        // NO FALLBACK - if empty, section won't show
        let quickActionsSongs: any[] = [];
        console.log('📦 [HomePreloader] Fetching quick actions from user_quick_actions...');
        const { data: quickActionsData, error: qaError } = await supabase
          .from('user_quick_actions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30);

        if (qaError) {
          console.error('Quick actions error:', qaError);
        } else if (quickActionsData && quickActionsData.length > 0) {
          console.log(`📦 [HomePreloader] Quick Actions: ${quickActionsData.length} items`);
          quickActionsSongs = quickActionsData.map((item: any) => ({
            id: item.track_id,
            videoId: item.video_id,
            title: item.title,
            artist: item.artist,
            thumbnail: item.thumbnail,
            url: item.url,
            duration: item.duration,
            playedAt: new Date(item.created_at).getTime(),
          }));
        } else {
          console.log('📦 [HomePreloader] Quick Actions: 0 items - section will NOT show');
        }

        // Shuffle quick actions for variety
        const shuffledQuickActions = shuffleArray(quickActionsSongs);
        setRecentSongs(shuffledQuickActions);
        console.log(`📦 [HomePreloader] Quick Actions set: ${shuffledQuickActions.length} items (NO FALLBACK)`);

        // ─── 2. Fetch Trending from songs table ───
        console.log('📦 [HomePreloader] Fetching trending...');
        const { data: trendingData, error: trendingError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
          .not('artwork_thumbnail', 'is', null)
          .order('play_count', { ascending: false })
          .limit(20);

        if (trendingError) console.error('Trending error:', trendingError);
        console.log(`📦 [HomePreloader] Trending: ${trendingData?.length || 0} items`);

        // ─── 3. Fetch Biggest Hits ───
        console.log('📦 [HomePreloader] Fetching biggest hits...');
        const { data: hitsData, error: hitsError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
          .not('artwork_thumbnail', 'is', null)
          .order('play_count', { ascending: false })
          .limit(20);

        if (hitsError) console.error('Biggest hits error:', hitsError);
        console.log(`📦 [HomePreloader] Biggest Hits: ${hitsData?.length || 0} items`);

        // ─── 4. Fetch New Releases ───
        console.log('📦 [HomePreloader] Fetching new releases...');
        const { data: releasesData, error: releasesError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration, created_at')
          .not('artwork_thumbnail', 'is', null)
          .order('created_at', { ascending: false })
          .limit(20);

        if (releasesError) console.error('New releases error:', releasesError);
        console.log(`📦 [HomePreloader] New Releases: ${releasesData?.length || 0} items`);

        // ─── 5. Fetch People's Choice ───
        console.log('📦 [HomePreloader] Fetching popular choice...');
        const { data: popularData, error: popularError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
          .not('artwork_thumbnail', 'is', null)
          .order('play_count', { ascending: false })
          .limit(20);

        if (popularError) console.error('Popular choice error:', popularError);
        console.log(`📦 [HomePreloader] Popular Choice: ${popularData?.length || 0} items`);

        // ─── 6. Fetch Top 10 Month from chart_rankings ───
        console.log('📦 [HomePreloader] Fetching top 10 month...');
        const { data: rankingsData, error: rankingsError } = await supabase
          .from('chart_rankings')
          .select('song_id, position')
          .order('position', { ascending: true })
          .limit(10);

        let top10Songs: any[] = [];
        if (rankingsData && rankingsData.length > 0) {
          const songIds = (rankingsData as any[]).map((r: any) => r.song_id);
          const { data: songsData } = await supabase
            .from('songs')
            .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
            .in('id', songIds);
          
          if (songsData) {
            top10Songs = songsData;
          }
        }
        console.log(`📦 [HomePreloader] Top 10 Month: ${top10Songs.length} items`);

        // ─── 7. Fetch Mavin's Best (top picks) ───
        console.log('📦 [HomePreloader] Fetching mavin best...');
        const { data: mavinsData, error: mavinsError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration')
          .not('artwork_thumbnail', 'is', null)
          .order('play_count', { ascending: false })
          .limit(5);

        if (mavinsError) console.error('Mavin best error:', mavinsError);
        console.log(`📦 [HomePreloader] Mavin Best: ${mavinsData?.length || 0} items`);

        // ─── 8. Fetch Throwbacks (older songs) ───
        console.log('📦 [HomePreloader] Fetching throwbacks...');
        const { data: throwbacksData, error: throwbacksError } = await supabase
          .from('songs')
          .select('id, title, artist, video_id, artwork_thumbnail, artwork_url, play_count, duration, created_at')
          .not('artwork_thumbnail', 'is', null)
          .order('created_at', { ascending: true })
          .limit(10);

        if (throwbacksError) console.error('Throwbacks error:', throwbacksError);
        console.log(`📦 [HomePreloader] Throwbacks: ${throwbacksData?.length || 0} items`);

        // ─── 9. Fetch Mixes/Playlists ───
        console.log('📦 [HomePreloader] Fetching mixes...');
        const { data: mixesData, error: mixesError } = await supabase
          .from('playlists')
          .select('id, name, description, cover_art_url, track_count')
          .not('cover_art_url', 'is', null)
          .neq('cover_art_url', '')
          .order('created_at', { ascending: false })
          .limit(10);

        if (mixesError) console.error('Mixes error:', mixesError);
        console.log(`📦 [HomePreloader] Mixes: ${mixesData?.length || 0} items`);

        // ─── 10. Fetch Music Channels (Artists) ───
        console.log('📦 [HomePreloader] Fetching music channels...');
        const { data: channelsData, error: channelsError } = await supabase
          .from('artists')
          .select('id, name, thumbnail_url, is_verified')
          .not('thumbnail_url', 'is', null)
          .neq('thumbnail_url', '')
          .order('monthly_listeners', { ascending: false, nullsFirst: false })
          .limit(10);

        if (channelsError) console.error('Channels error:', channelsError);
        console.log(`📦 [HomePreloader] Channels: ${channelsData?.length || 0} items`);

        // ─── 11. Fetch Podcasts ───
        console.log('📦 [HomePreloader] Fetching podcasts...');
        const { data: podcastsData, error: podcastsError } = await supabase
          .from('podcast_episodes')
          .select('id, title, thumbnail_url, duration_seconds, play_count, episode_number, metadata')
          .order('play_count', { ascending: false, nullsFirst: false })
          .limit(10);

        if (podcastsError) console.error('Podcasts error:', podcastsError);
        console.log(`📦 [HomePreloader] Podcasts: ${podcastsData?.length || 0} items`);

        // ─── 12. Fetch Radio Stations ───
        console.log('📦 [HomePreloader] Fetching radio stations...');
        const { data: radioData, error: radioError } = await supabase
          .from('radio_stations')
          .select('id, name, logo_url, stream_url')
          .eq('is_active', true)
          .not('logo_url', 'is', null)
          .limit(10);

        if (radioError) console.error('Radio stations error:', radioError);
        console.log(`📦 [HomePreloader] Radio Stations: ${radioData?.length || 0} items`);

        // ─── Format helpers ───
        const formatSong = (song: any) => ({
          id: song.id,
          videoId: song.video_id,
          title: song.title ?? 'Unknown Title',
          artist: song.artist ?? 'Unknown Artist',
          thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
          url: song.video_id ? `https://www.youtube.com/watch?v=${song.video_id}` : '',
          duration: song.duration ?? 0,
          views: song.play_count ?? 0,
        });

        const formatMix = (playlist: any) => ({
          id: playlist.id,
          title: playlist.name ?? 'Untitled Mix',
          thumbnail: playlist.cover_art_url ?? '',
          artist: playlist.description ?? 'Curated Playlist',
          trackCount: playlist.track_count ?? 0,
        });

        const formatChannel = (artist: any) => ({
          id: artist.id,
          name: artist.name ?? 'Unknown Artist',
          title: artist.name ?? 'Unknown Artist',
          thumbnail: artist.thumbnail_url ?? '',
          artistId: artist.id,
          isVerified: artist.is_verified ?? false,
        });

        const formatPodcast = (episode: any) => {
          const meta = (episode.metadata ?? {}) as Record<string, any>;
          return {
            id: episode.id,
            title: episode.title ?? 'Unknown Episode',
            artist: meta.creator ?? 'Unknown Podcast',
            thumbnail: episode.thumbnail_url ?? '',
            episodeCount: episode.episode_number ?? 1,
            type: 'podcast',
          };
        };

        const formatRadioStation = (station: any) => ({
          id: station.id,
          name: station.name ?? 'Unknown Station',
          title: station.name ?? 'Unknown Station',
          thumbnail: station.logo_url ?? '',
          streamUrl: station.stream_url,
        });

        const formatEditorPick = (song: any) => ({
          id: song.id,
          videoId: song.video_id,
          title: song.title ?? 'Unknown Title',
          artist: song.artist ?? 'Unknown Artist',
          thumbnail: song.artwork_thumbnail ?? song.artwork_url ?? '',
          thumbnailFallback: song.artwork_url ?? '',
          views: song.play_count ?? 0,
        });

        // ─── Prepare data for store ───
        const storeData = {
          trending: (trendingData || []).map(formatSong),
          biggestHits: (hitsData || []).slice(0, 6).map(formatSong),
          peoplesChoice: (popularData || []).map(formatSong),
          top10Month: (top10Songs || []).map(formatSong),
          mavinsBest: (mavinsData || []).map(formatEditorPick),
          newReleases: (releasesData || []).map(formatSong),
          throwbacks: (throwbacksData || []).map(formatEditorPick),
          mixes: (mixesData || []).map(formatMix),
          channels: (channelsData || []).map(formatChannel),
          podcasts: (podcastsData || []).map(formatPodcast),
          radioStations: (radioData || []).map(formatRadioStation),
        };

        console.log('📦 [HomePreloader] Setting store data:', {
          trending: storeData.trending.length,
          biggestHits: storeData.biggestHits.length,
          peoplesChoice: storeData.peoplesChoice.length,
          top10Month: storeData.top10Month.length,
          mavinsBest: storeData.mavinsBest.length,
          newReleases: storeData.newReleases.length,
          throwbacks: storeData.throwbacks.length,
          mixes: storeData.mixes.length,
          channels: storeData.channels.length,
          podcasts: storeData.podcasts.length,
          radioStations: storeData.radioStations.length,
          quickActions: shuffledQuickActions.length,
        });

        setAllData(storeData);
        console.log('📦 [HomePreloader] Store update complete');

      } catch (error) {
        console.error('❌ [HomePreloader] Fatal error:', error);
      } finally {
        setLoading(false);
        console.log('📦 [HomePreloader] Fetch complete, loading set to false');
      }
    };

    fetchAllData();
  }, [hasAnyData, isDataFresh, hasAttemptedFetch, setAllData, setRecentSongs, setLoading]);

  return null;
}
