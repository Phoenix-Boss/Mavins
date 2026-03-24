// store/home.ts
/**
 * HomeStore — Centralized home screen state
 * 
 * All home sections data is pre-loaded here at app startup by HomePreloader.
 * Components read from this store for instant rendering.
 * Persists to AsyncStorage for instant app launches.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types (matching your existing data structures) ────────────────────────────

export interface Song {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  thumbnail: string;
  url?: string;
  duration?: number;
  uploaderUrl?: string;
  uploaderName?: string;
  likeCount?: number;
  dislikeCount?: number;
  viewCount?: number;
  views?: number; // alias for viewCount used in some hooks
  commentsCount?: number;
}

export interface Mix {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  artist?: string;
  trackCount?: number;
  songs?: Song[];
}

export interface Channel {
  id: string;
  name: string;
  title?: string; // alias
  thumbnail: string;
  artistId?: string;
  subscriberCount?: number;
  isVerified?: boolean;
}

export interface Podcast {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  episodeCount?: number;
  type?: string;
}

export interface RadioStation {
  id: string;
  name: string;
  title?: string; // alias
  thumbnail: string;
  streamUrl?: string;
}

export interface EditorPick {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  thumbnail: string;
  thumbnailFallback?: string;
  views: number;
}

// ─── HomeState Interface ─────────────────────────────────────────────────────

interface HomeState {
  // Data sections
  trending: Song[];
  biggestHits: Song[];
  peoplesChoice: Song[];
  top10Month: Song[];
  mavinsBest: EditorPick[];
  newReleases: Song[];
  throwbacks: EditorPick[];
  mixes: Mix[];
  channels: Channel[];
  podcasts: Podcast[];
  radioStations: RadioStation[];
  
  // Metadata
  lastUpdated: number | null;
  isStale: boolean;
  isLoading: boolean; // Background loading state
  
  // Actions
  setTrending: (songs: Song[]) => void;
  setBiggestHits: (songs: Song[]) => void;
  setPeoplesChoice: (songs: Song[]) => void;
  setTop10Month: (songs: Song[]) => void;
  setMavinsBest: (picks: EditorPick[]) => void;
  setNewReleases: (songs: Song[]) => void;
  setThrowbacks: (picks: EditorPick[]) => void;
  setMixes: (mixes: Mix[]) => void;
  setChannels: (channels: Channel[]) => void;
  setPodcasts: (podcasts: Podcast[]) => void;
  setRadioStations: (stations: RadioStation[]) => void;
  
  // Bulk updates
  setAllData: (data: Partial<Omit<HomeState, 
    | 'setTrending' | 'setBiggestHits' | 'setPeoplesChoice' 
    | 'setTop10Month' | 'setMavinsBest' | 'setNewReleases' 
    | 'setThrowbacks' | 'setMixes' | 'setChannels' 
    | 'setPodcasts' | 'setRadioStations' 
    | 'setAllData' | 'markFresh' | 'markStale' | 'setLoading'
    | 'getExcludedIdsForTop10' | 'hasAnyData'
  >>) => void;
  
  markFresh: () => void;
  markStale: () => void;
  setLoading: (loading: boolean) => void;
  
  // Selectors
  getExcludedIdsForTop10: () => string[];
  hasAnyData: () => boolean;
}

// ─── Zustand Store Creation ──────────────────────────────────────────────────

export const useHomeStore = create<HomeState>()(
  persist(
    (set, get) => ({
      // Initial empty state
      trending: [],
      biggestHits: [],
      peoplesChoice: [],
      top10Month: [],
      mavinsBest: [],
      newReleases: [],
      throwbacks: [],
      mixes: [],
      channels: [],
      podcasts: [],
      radioStations: [],
      
      lastUpdated: null,
      isStale: true,
      isLoading: false,
      
      // Individual setters
      setTrending: (trending) => set({ trending, lastUpdated: Date.now() }),
      setBiggestHits: (biggestHits) => set({ biggestHits, lastUpdated: Date.now() }),
      setPeoplesChoice: (peoplesChoice) => set({ peoplesChoice, lastUpdated: Date.now() }),
      setTop10Month: (top10Month) => set({ top10Month, lastUpdated: Date.now() }),
      setMavinsBest: (mavinsBest) => set({ mavinsBest, lastUpdated: Date.now() }),
      setNewReleases: (newReleases) => set({ newReleases, lastUpdated: Date.now() }),
      setThrowbacks: (throwbacks) => set({ throwbacks, lastUpdated: Date.now() }),
      setMixes: (mixes) => set({ mixes, lastUpdated: Date.now() }),
      setChannels: (channels) => set({ channels, lastUpdated: Date.now() }),
      setPodcasts: (podcasts) => set({ podcasts, lastUpdated: Date.now() }),
      setRadioStations: (radioStations) => set({ radioStations, lastUpdated: Date.now() }),
      
      // Bulk update for preloader
      setAllData: (data) => set({ 
        ...data, 
        lastUpdated: Date.now(),
        isStale: false,
        isLoading: false,
      }),
      
      markFresh: () => set({ isStale: false, lastUpdated: Date.now() }),
      markStale: () => set({ isStale: true }),
      setLoading: (isLoading) => set({ isLoading }),
      
      // Selector: Get IDs to exclude from Top 10 (for deduplication)
      getExcludedIdsForTop10: () => {
        const state = get();
        const ids = new Set<string>();
        
        [...state.trending, ...state.biggestHits, ...state.peoplesChoice].forEach((item) => {
          if (item.id) ids.add(item.id);
          if (item.videoId) ids.add(item.videoId);
        });
        
        return Array.from(ids);
      },
      
      // Selector: Check if any data exists
      hasAnyData: () => {
        const state = get();
        return (
          state.trending.length > 0 ||
          state.biggestHits.length > 0 ||
          state.peoplesChoice.length > 0 ||
          state.top10Month.length > 0 ||
          state.mavinsBest.length > 0 ||
          state.newReleases.length > 0 ||
          state.throwbacks.length > 0 ||
          state.mixes.length > 0 ||
          state.channels.length > 0 ||
          state.podcasts.length > 0 ||
          state.radioStations.length > 0
        );
      },
    }),
    {
      name: 'home-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not functions
      partialize: (state) => ({
        trending: state.trending,
        biggestHits: state.biggestHits,
        peoplesChoice: state.peoplesChoice,
        top10Month: state.top10Month,
        mavinsBest: state.mavinsBest,
        newReleases: state.newReleases,
        throwbacks: state.throwbacks,
        mixes: state.mixes,
        channels: state.channels,
        podcasts: state.podcasts,
        radioStations: state.radioStations,
        lastUpdated: state.lastUpdated,
        isStale: state.isStale,
      }),
    }
  )
);