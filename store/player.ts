// src/stores/player.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

// Use the same Song type from your existing types
// Option 1: If you have types/song.ts
import type { Song } from '@/types/song';

// Option 2: If you want to define TrackData locally based on Song
// Uncomment this and remove the import above if needed:
/*
interface TrackData {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  url?: string;
  duration?: number;
  videoId?: string;
  uploaderUrl?: string;
  albumId?: string;
  albumName?: string;
}
*/

// Use Song as TrackData (they're the same shape)
type TrackData = Song;

// ─────────────────────────────────────────────────────────────────────────────
// Store State & Actions
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerState {
  currentTrack: TrackData | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLoop: boolean;
  isAutoplay: boolean;
  queue: TrackData[];
  history: TrackData[];
}

interface PlayerActions {
  setPlaying: (track: TrackData) => void;
  setPaused: () => void;
  /** Flip isPlaying instantly — UI intent, no engine call. */
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (isMuted: boolean) => void;
  setLoop: (isLoop: boolean) => void;
  setAutoplay: (isAutoplay: boolean) => void;
  addToQueue: (track: TrackData) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  next: () => void;
  previous: () => void;
}

type PlayerStore = PlayerState & PlayerActions;

// ─────────────────────────────────────────────────────────────────────────────
// Zustand Store
// ─────────────────────────────────────────────────────────────────────────────

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isMuted: false,
      isLoop: false,
      isAutoplay: true,
      queue: [],
      history: [],

      setPlaying: (track: TrackData) => {
        set((state: PlayerState) => ({
          currentTrack: track,
          isPlaying: true,
          duration: track.duration || 0,
          history: [track, ...state.history].slice(0, 50),
        }));
      },

      setPaused: () => set({ isPlaying: false }),

      setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

      setCurrentTime: (time: number) => set({ currentTime: time }),

      setDuration: (duration: number) => set({ duration }),

      setVolume: (volume: number) => 
        set({ volume: Math.max(0, Math.min(1, volume)) }),

      setMuted: (isMuted: boolean) => set({ isMuted }),

      setLoop: (isLoop: boolean) => set({ isLoop }),

      setAutoplay: (isAutoplay: boolean) => set({ isAutoplay }),

      addToQueue: (track: TrackData) =>
        set((state: PlayerState) => ({
          queue: [...state.queue, track],
        })),

      removeFromQueue: (index: number) =>
        set((state: PlayerState) => ({
          queue: state.queue.filter((_: TrackData, i: number) => i !== index),
        })),

      clearQueue: () => set({ queue: [] }),

      next: () => {
        const { queue } = get();
        if (queue.length > 0) {
          const nextTrack = queue[0];
          set((state: PlayerState) => ({
            queue: state.queue.slice(1),
          }));
          get().setPlaying(nextTrack);
        }
      },

      previous: () => {
        const { history } = get();
        if (history.length > 1) {
          const prevTrack = history[1];
          set((state: PlayerState) => ({
            history: state.history.slice(1),
          }));
          get().setPlaying(prevTrack);
        }
      },
    }),
    {
      name: 'player-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state: PlayerStore) => ({
        volume: state.volume,
        isLoop: state.isLoop,
        isAutoplay: state.isAutoplay,
        queue: state.queue,
        history: state.history.slice(0, 20),
      }),
    }
  )
);