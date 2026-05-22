// store/search.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TrendingSearchItem {
  id: string;
  query: string;
  thumbnail_url: string;
  artist_name: string;
  search_count: number;
  track_uuid: string | null;
}

export interface DiscoverySong {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'song' | 'beat';
  url: string;
  bpm?: number;
  key?: string;
}

export interface DiscoveryPlaylist {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'playlist';
  url: string;
}

export interface SearchStoreData {
  trending: TrendingSearchItem[];
  discoverSongs: DiscoverySong[];
  playlists: DiscoveryPlaylist[];
  beats: DiscoverySong[];
  lastFetchedAt: number | null;
}

interface SearchState {
  data: SearchStoreData;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

interface SearchActions {
  setTrending: (items: TrendingSearchItem[]) => void;
  setDiscoverSongs: (songs: DiscoverySong[]) => void;
  setPlaylists: (playlists: DiscoveryPlaylist[]) => void;
  setBeats: (beats: DiscoverySong[]) => void;
  setAllData: (data: Partial<SearchStoreData>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetchedAt: (timestamp: number) => void;
  hasAnyData: () => boolean;
  isDataFresh: () => boolean;
  reset: () => void;
}

type SearchStore = SearchState & SearchActions;

const FRESHNESS_TTL_MS = 30 * 60 * 1000; // 30 minutes

const initialState: SearchState = {
  data: {
    trending: [],
    discoverSongs: [],
    playlists: [],
    beats: [],
    lastFetchedAt: null,
  },
  loading: false,
  error: null,
  lastFetchedAt: null,
};

export const useSearchStore = create<SearchStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setTrending: (items) => {
        set((state) => ({
          data: { ...state.data, trending: items, lastFetchedAt: Date.now() },
          lastFetchedAt: Date.now(),
        }));
      },

      setDiscoverSongs: (songs) => {
        set((state) => ({
          data: { ...state.data, discoverSongs: songs, lastFetchedAt: Date.now() },
          lastFetchedAt: Date.now(),
        }));
      },

      setPlaylists: (playlists) => {
        set((state) => ({
          data: { ...state.data, playlists, lastFetchedAt: Date.now() },
          lastFetchedAt: Date.now(),
        }));
      },

      setBeats: (beats) => {
        set((state) => ({
          data: { ...state.data, beats, lastFetchedAt: Date.now() },
          lastFetchedAt: Date.now(),
        }));
      },

      setAllData: (newData) => {
        set((state) => ({
          data: { ...state.data, ...newData, lastFetchedAt: Date.now() },
          lastFetchedAt: Date.now(),
        }));
      },

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error }),

      setLastFetchedAt: (timestamp) => set({ lastFetchedAt: timestamp }),

      hasAnyData: () => {
        const { data } = get();
        return (
          data.trending.length > 0 ||
          data.discoverSongs.length > 0 ||
          data.playlists.length > 0 ||
          data.beats.length > 0
        );
      },

      isDataFresh: () => {
        const { lastFetchedAt } = get();
        if (!lastFetchedAt) return false;
        return Date.now() - lastFetchedAt < FRESHNESS_TTL_MS;
      },

      reset: () => set(initialState),
    }),
    {
      name: 'search-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        data: state.data,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);