// hooks/useTrackPlayerShuffle.ts
/**
 * useTrackPlayerShuffle - RNTP v4 Compatible
 * 
 * RNTP v4 does NOT have getShuffleMode/setShuffleMode methods.
 * Shuffle is implemented purely in JavaScript by reordering the queue.
 */

import { useCallback, useState, useRef } from "react";
import TrackPlayer from "react-native-track-player";
import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShuffleMode = "off" | "on";

interface UseTrackPlayerShuffleResult {
  shuffleMode: ShuffleMode;
  toggleShuffle: () => Promise<void>;
  setShuffleMode: (mode: ShuffleMode) => Promise<void>;
  getDotCount: () => number;
  isShuffleEnabled: boolean;
  isLoading: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (persists across hook instances)
// ─────────────────────────────────────────────────────────────────────────────

let globalShuffleMode: ShuffleMode = "off";
const originalQueueOrder = new Map<string, any[]>(); // Store original order per session

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useTrackPlayerShuffle = (): UseTrackPlayerShuffleResult => {
  const [shuffleMode, setShuffleModeState] = useState<ShuffleMode>(globalShuffleMode);
  const [isLoading, setIsLoading] = useState(false);
  
  const isShufflingRef = useRef(false);

  // Computed
  const isShuffleEnabled = shuffleMode === "on";
  const getDotCount = useCallback(() => (shuffleMode === "on" ? 1 : 0), [shuffleMode]);

  /**
   * Fisher-Yates shuffle algorithm
   */
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  /**
   * Set shuffle mode - reorders queue in-place
   */
  const setShuffleMode = useCallback(async (mode: ShuffleMode) => {
    if (isShufflingRef.current) return;
    isShufflingRef.current = true;
    setIsLoading(true);

    try {
      const currentTrack = await TrackPlayer.getActiveTrack();
      const queue = await TrackPlayer.getQueue();
      
      if (!queue.length) {
        globalShuffleMode = mode;
        setShuffleModeState(mode);
        return;
      }

      const sessionKey = currentTrack?.id ?? "default";

      if (mode === "on") {
        // Store original order before shuffling
        if (!originalQueueOrder.has(sessionKey)) {
          originalQueueOrder.set(sessionKey, [...queue]);
        }

        // Shuffle queue but keep current track first
        const shuffled = shuffleArray(queue);
        if (currentTrack) {
          const currentIndex = shuffled.findIndex(t => t.id === currentTrack.id);
          if (currentIndex > 0) {
            [shuffled[0], shuffled[currentIndex]] = [shuffled[currentIndex], shuffled[0]];
          }
        }

        // Replace queue while maintaining playback
        await TrackPlayer.reset();
        await TrackPlayer.add(shuffled);
        
        // Resume from beginning of current track
        if (currentTrack) {
          await TrackPlayer.skip(0);
          await TrackPlayer.play();
        }

        triggerHaptic("impactLight");
      } else {
        // Restore original order
        const original = originalQueueOrder.get(sessionKey);
        if (original && original.length) {
          const currentId = currentTrack?.id;
          await TrackPlayer.reset();
          await TrackPlayer.add(original);
          
          // Restore position
          if (currentId) {
            const newIndex = original.findIndex(t => t.id === currentId);
            if (newIndex >= 0) {
              await TrackPlayer.skip(newIndex);
              await TrackPlayer.play();
            }
          }
        }
      }

      globalShuffleMode = mode;
      setShuffleModeState(mode);
    } catch (err) {
      console.error("[useTrackPlayerShuffle] Failed:", err);
    } finally {
      isShufflingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  /**
   * Toggle shuffle on/off
   */
  const toggleShuffle = useCallback(async () => {
    const next: ShuffleMode = shuffleMode === "off" ? "on" : "off";
    await setShuffleMode(next);
  }, [shuffleMode, setShuffleMode]);

  return {
    shuffleMode,
    toggleShuffle,
    setShuffleMode,
    getDotCount,
    isShuffleEnabled,
    isLoading,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export const getShuffleModeLabel = (mode: ShuffleMode): string => {
  return mode === "on" ? "Shuffle On" : "Shuffle Off";
};