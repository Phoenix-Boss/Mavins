// components/HomePreloader.tsx
/**
 * HomePreloader — Fetches home data at app startup
 * 
 * Mount this in your root layout (app/_layout.tsx) inside the providers.
 * It silently fetches all home data and populates HomeStore.
 * Home screen reads from store instantly on first render.
 */

import { useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useHomeStore } from '@/store/home';
import { supabase } from '@/libs/supabase';

// ─── Fetch Functions ─────────────────────────────────────────────────────────

const fetchTrending = async () => {
  const { data, error } = await supabase
    .from('trending')
    .select('*')
    .order('rank', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchBiggestHits = async () => {
  const { data, error } = await supabase
    .from('charts')
    .select('*')
    .eq('type', 'top50')
    .order('rank', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchPeoplesChoice = async () => {
  const { data, error } = await supabase
    .from('popular')
    .select('*')
    .eq('category', 'peoples_choice')
    .order('rank', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchTop10Month = async () => {
  const { data, error } = await supabase
    .from('top10')
    .select('*')
    .eq('period', 'month')
    .order('rank', { ascending: true })
    .limit(10);
  if (error) throw error;
  return data || [];
};

const fetchMavinsBest = async () => {
  const { data, error } = await supabase
    .from('editor_picks')
    .select('*')
    .eq('category', 'mavins_best')
    .order('rank', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchNewReleases = async () => {
  const { data, error } = await supabase
    .from('music')
    .select('*')
    .eq('category', 'new_releases')
    .order('released_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchThrowbacks = async () => {
  const { data, error } = await supabase
    .from('covers')
    .select('*')
    .eq('type', 'throwback')
    .order('rank', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
};

const fetchMixes = async () => {
  const { data, error } = await supabase
    .from('mixes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
};

const fetchChannels = async () => {
  const { data, error } = await supabase
    .from('music_channels')
    .select('*')
    .order('subscriber_count', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
};

const fetchPodcasts = async () => {
  const { data, error } = await supabase
    .from('podcasts')
    .select('*')
    .eq('featured', true)
    .order('rank', { ascending: true })
    .limit(10);
  if (error) throw error;
  return data || [];
};

const fetchRadioStations = async () => {
  const { data, error } = await supabase
    .from('radio_stations')
    .select('*')
    .order('rank', { ascending: true })
    .limit(10);
  if (error) throw error;
  return data || [];
};

// ─── Component ───────────────────────────────────────────────────────────────

export function HomePreloader() {
  const setAllData = useHomeStore((s) => s.setAllData);
  const markStale = useHomeStore((s) => s.markStale);
  const setLoading = useHomeStore((s) => s.setLoading);
  const queryClient = useQueryClient();

  // Check if we have cached data
  const hasCachedData = useHomeStore((s) => s.hasAnyData());

  // Set loading if we're fetching fresh data and have no cache
  useEffect(() => {
    if (!hasCachedData) {
      setLoading(true);
    }
  }, [hasCachedData, setLoading]);

  // Fetch all data in parallel
  const results = useQueries({
    queries: [
      { 
        queryKey: ['home', 'trending'], 
        queryFn: fetchTrending, 
        staleTime: 5 * 60 * 1000,
        // If we have cached data, don't refetch on mount immediately
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'biggestHits'], 
        queryFn: fetchBiggestHits, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'peoplesChoice'], 
        queryFn: fetchPeoplesChoice, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'top10Month'], 
        queryFn: fetchTop10Month, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'mavinsBest'], 
        queryFn: fetchMavinsBest, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'newReleases'], 
        queryFn: fetchNewReleases, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'throwbacks'], 
        queryFn: fetchThrowbacks, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'mixes'], 
        queryFn: fetchMixes, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'channels'], 
        queryFn: fetchChannels, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'podcasts'], 
        queryFn: fetchPodcasts, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
      { 
        queryKey: ['home', 'radio'], 
        queryFn: fetchRadioStations, 
        staleTime: 5 * 60 * 1000,
        refetchOnMount: hasCachedData ? false : 'always',
      },
    ],
  });

  // Update store when data arrives
  useEffect(() => {
    const [
      trendingRes,
      biggestHitsRes,
      peoplesChoiceRes,
      top10Res,
      mavinsBestRes,
      newReleasesRes,
      throwbacksRes,
      mixesRes,
      channelsRes,
      podcastsRes,
      radioRes,
    ] = results;

    const data: Parameters<typeof setAllData>[0] = {};
    
    // Only update if we have data (don't overwrite with empty on error)
    if (trendingRes.data?.length) data.trending = trendingRes.data;
    if (biggestHitsRes.data?.length) data.biggestHits = biggestHitsRes.data;
    if (peoplesChoiceRes.data?.length) data.peoplesChoice = peoplesChoiceRes.data;
    if (top10Res.data?.length) data.top10Month = top10Res.data;
    if (mavinsBestRes.data?.length) data.mavinsBest = mavinsBestRes.data;
    if (newReleasesRes.data?.length) data.newReleases = newReleasesRes.data;
    if (throwbacksRes.data?.length) data.throwbacks = throwbacksRes.data;
    if (mixesRes.data?.length) data.mixes = mixesRes.data;
    if (channelsRes.data?.length) data.channels = channelsRes.data;
    if (podcastsRes.data?.length) data.podcasts = podcastsRes.data;
    if (radioRes.data?.length) data.radioStations = radioRes.data;

    // Update store if we have any data
    if (Object.keys(data).length > 0) {
      setAllData(data);
    }
    
    // Mark stale if any query failed
    const hasErrors = results.some(r => r.isError);
    if (hasErrors) {
      markStale();
    }
  }, [results, setAllData, markStale]);

  // This component renders nothing — it's a data layer
  return null;
}