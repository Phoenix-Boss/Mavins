// store/home.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Song {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  thumbnail: string;
  url?: string;
  duration?: number;
  views?: number;
  playedAt?: number;
}

export interface Mix {
  id: string;
  title: string;
  thumbnail: string;
  artist?: string;
  trackCount?: number;
}

export interface Channel {
  id: string;
  name: string;
  title?: string;
  thumbnail: string;
  artistId?: string;
  isVerified?: boolean;
}

export interface Podcast {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  episodeCount?: number;
  type?: string;
}

export interface RadioStation {
  id: string;
  name: string;
  title?: string;
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

export interface CampaignCard {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  promoted: boolean;
  mavinSpecial: boolean;
  playCount: number;
  ctaUrl?: string;
  songId?: string;
}

interface HomeState {
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
  recentSongs: Song[];
  quickPicks: CampaignCard[];
  
  lastUpdated: number | null;
  lastFetchedAt: number | null;
  isStale: boolean;
  isLoading: boolean;
  
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
  setRecentSongs: (songs: Song[]) => void;
  addRecentSong: (song: Song) => void;
  removeRecentSong: (songId: string) => void;
  clearRecentSongs: () => void;
  setQuickPicks: (cards: CampaignCard[]) => void;
  
  setAllData: (data: Partial<Omit<HomeState, 
    | 'setTrending' | 'setBiggestHits' | 'setPeoplesChoice' 
    | 'setTop10Month' | 'setMavinsBest' | 'setNewReleases' 
    | 'setThrowbacks' | 'setMixes' | 'setChannels' 
    | 'setPodcasts' | 'setRadioStations' | 'setRecentSongs'
    | 'addRecentSong' | 'removeRecentSong' | 'clearRecentSongs'
    | 'setQuickPicks' | 'setAllData' | 'markFresh' | 'markStale' | 'setLoading'
    | 'getExcludedIdsForTop10' | 'hasAnyData' | 'isDataFresh'
  >>) => void;
  
  markFresh: () => void;
  markStale: () => void;
  setLoading: (loading: boolean) => void;
  
  getExcludedIdsForTop10: () => string[];
  hasAnyData: () => boolean;
  isDataFresh: () => boolean;
}

export const useHomeStore = create<HomeState>()(
  persist(
    (set, get) => {
      console.log('🏪 [HomeStore] Store initialized');
      
      return {
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
        recentSongs: [],
        quickPicks: [],
        
        lastUpdated: null,
        lastFetchedAt: null,
        isStale: true,
        isLoading: false,
        
        setTrending: (trending) => {
          console.log(`📊 [HomeStore] setTrending: ${trending.length} items`);
          set({ trending, lastUpdated: Date.now() });
        },
        
        setBiggestHits: (biggestHits) => {
          console.log(`📊 [HomeStore] setBiggestHits: ${biggestHits.length} items`);
          set({ biggestHits, lastUpdated: Date.now() });
        },
        
        setPeoplesChoice: (peoplesChoice) => {
          console.log(`📊 [HomeStore] setPeoplesChoice: ${peoplesChoice.length} items`);
          set({ peoplesChoice, lastUpdated: Date.now() });
        },
        
        setTop10Month: (top10Month) => {
          console.log(`📊 [HomeStore] setTop10Month: ${top10Month.length} items`);
          set({ top10Month, lastUpdated: Date.now() });
        },
        
        setMavinsBest: (mavinsBest) => {
          console.log(`📊 [HomeStore] setMavinsBest: ${mavinsBest.length} items`);
          set({ mavinsBest, lastUpdated: Date.now() });
        },
        
        setNewReleases: (newReleases) => {
          console.log(`📊 [HomeStore] setNewReleases: ${newReleases.length} items`);
          set({ newReleases, lastUpdated: Date.now() });
        },
        
        setThrowbacks: (throwbacks) => {
          console.log(`📊 [HomeStore] setThrowbacks: ${throwbacks.length} items`);
          set({ throwbacks, lastUpdated: Date.now() });
        },
        
        setMixes: (mixes) => {
          console.log(`📊 [HomeStore] setMixes: ${mixes.length} items`);
          set({ mixes, lastUpdated: Date.now() });
        },
        
        setChannels: (channels) => {
          console.log(`📊 [HomeStore] setChannels: ${channels.length} items`);
          set({ channels, lastUpdated: Date.now() });
        },
        
        setPodcasts: (podcasts) => {
          console.log(`📊 [HomeStore] setPodcasts: ${podcasts.length} items`);
          set({ podcasts, lastUpdated: Date.now() });
        },
        
        setRadioStations: (radioStations) => {
          console.log(`📊 [HomeStore] setRadioStations: ${radioStations.length} items`);
          set({ radioStations, lastUpdated: Date.now() });
        },
        
        setRecentSongs: (recentSongs) => {
          console.log(`📊 [HomeStore] setRecentSongs: ${recentSongs.length} items (FROM DATABASE ONLY)`);
          set({ recentSongs, lastUpdated: Date.now() });
        },
        
        addRecentSong: (song) => set((state) => {
          const filtered = state.recentSongs.filter(s => s.id !== song.id);
          const newSong = { ...song, playedAt: Date.now() };
          const newRecent = [newSong, ...filtered].slice(0, 20);
          console.log(`📊 [HomeStore] addRecentSong: ${song.title}, total: ${newRecent.length}`);
          return { recentSongs: newRecent, lastUpdated: Date.now() };
        }),
        
        removeRecentSong: (songId) => set((state) => {
          console.log(`📊 [HomeStore] removeRecentSong: ${songId}`);
          return {
            recentSongs: state.recentSongs.filter(s => s.id !== songId),
            lastUpdated: Date.now(),
          };
        }),
        
        clearRecentSongs: () => {
          console.log(`📊 [HomeStore] clearRecentSongs`);
          set({ recentSongs: [], lastUpdated: Date.now() });
        },
        
        setQuickPicks: (quickPicks) => {
          console.log(`📊 [HomeStore] setQuickPicks: ${quickPicks.length} campaign cards`);
          set({ quickPicks, lastUpdated: Date.now() });
        },
        
        setAllData: (data) => {
          console.log('📊 [HomeStore] setAllData called with sections:', Object.keys(data));
          set({ 
            ...data, 
            lastUpdated: Date.now(),
            lastFetchedAt: Date.now(),
            isStale: false,
            isLoading: false,
          });
          console.log('📊 [HomeStore] setAllData complete - hasAnyData:', get().hasAnyData());
        },
        
        markFresh: () => {
          console.log('📊 [HomeStore] markFresh');
          set({ isStale: false, lastUpdated: Date.now() });
        },
        
        markStale: () => {
          console.log('📊 [HomeStore] markStale called');
          set({ isStale: true, lastFetchedAt: null });
        },
        
        setLoading: (isLoading) => {
          console.log(`📊 [HomeStore] setLoading: ${isLoading}`);
          set({ isLoading });
        },
        
        getExcludedIdsForTop10: () => {
          const state = get();
          const ids = new Set<string>();
          
          state.trending.forEach((item) => {
            if (item.id) ids.add(item.id);
            if (item.videoId) ids.add(item.videoId);
          });
          
          state.biggestHits.forEach((item) => {
            if (item.id) ids.add(item.id);
            if (item.videoId) ids.add(item.videoId);
          });
          
          state.peoplesChoice.forEach((item) => {
            if (item.id) ids.add(item.id);
            if (item.videoId) ids.add(item.videoId);
          });
          
          return Array.from(ids);
        },
        
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
            state.radioStations.length > 0 ||
            state.quickPicks.length > 0
          );
        },

        isDataFresh: () => {
          const { lastFetchedAt } = get();
          if (!lastFetchedAt) return false;
          const THIRTY_MINUTES = 30 * 60 * 1000;
          return Date.now() - lastFetchedAt < THIRTY_MINUTES;
        },
      };
    },
    {
      name: 'home-store-v6',
      storage: createJSONStorage(() => AsyncStorage),
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
        quickPicks: state.quickPicks,
        lastUpdated: state.lastUpdated,
        lastFetchedAt: state.lastFetchedAt,
        isStale: state.isStale,
      }),
    }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS - Fixed: No duplicate export declarations
// ─────────────────────────────────────────────────────────────────────────────

export type { HomeState };

// Default export for convenience
export default useHomeStore;