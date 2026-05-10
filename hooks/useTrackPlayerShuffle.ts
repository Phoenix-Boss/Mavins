// hooks/useTrackPlayerShuffle.ts
/**
 * useTrackPlayerShuffle - expo-av replacement for react-native-track-player's shuffle
 * 
 * Shuffle is implemented purely in JavaScript by reordering the queue.
 * RNTP v4 does NOT have native shuffle methods, so this implementation
 * works the same way for expo-av.
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { triggerHaptic } from '@/helpers/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShuffleMode = "off" | "on";

export interface ShuffleState {
  mode: ShuffleMode;
  originalQueueOrder: any[];
  shuffledQueue: any[];
  currentShuffledIndex: number;
}

interface UseTrackPlayerShuffleResult {
  shuffleMode: ShuffleMode;
  toggleShuffle: () => Promise<void>;
  setShuffleMode: (mode: ShuffleMode) => Promise<void>;
  getDotCount: () => number;
  isShuffleEnabled: boolean;
  isLoading: boolean;
  getCurrentQueueItem: () => any | null;
  getCurrentQueueIndex: () => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (persists across hook instances)
// ─────────────────────────────────────────────────────────────────────────────

let globalShuffleMode: ShuffleMode = "off";
let originalQueueOrderStore: any[] = [];
let shuffledQueueStore: any[] = [];
let currentShuffledIndexStore: number = -1;
let shuffleListeners: Set<(mode: ShuffleMode) => void> = new Set();

// Storage key for persistence
const SHUFFLE_MODE_STORAGE_KEY = '@mavin/shuffle_mode';

// Helper to persist shuffle mode
async function persistShuffleMode(mode: ShuffleMode): Promise<void> {
  try {
    await AsyncStorage.setItem(SHUFFLE_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('[useTrackPlayerShuffle] Failed to persist:', error);
  }
}

// Helper to load persisted shuffle mode
async function loadPersistedShuffleMode(): Promise<ShuffleMode> {
  try {
    const saved = await AsyncStorage.getItem(SHUFFLE_MODE_STORAGE_KEY);
    if (saved === 'on' || saved === 'off') {
      return saved;
    }
  } catch (error) {
    console.warn('[useTrackPlayerShuffle] Failed to load persisted:', error);
  }
  return 'off';
}

/**
 * Fisher-Yates shuffle algorithm
 */
export const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Get the active track from MusicPlayerContext
 */
function getCurrentTrackFromContext(): any | null {
  // This will be accessed via the hook's closure
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useTrackPlayerShuffle = (): UseTrackPlayerShuffleResult => {
  const { 
    queue, 
    currentQueueIndex, 
    setQueue, 
    setCurrentQueueIndex,
    currentTrack 
  } = useMusicPlayer();
  
  const [shuffleMode, setShuffleModeState] = useState<ShuffleMode>(globalShuffleMode);
  const [isLoading, setIsLoading] = useState(false);
  const [originalQueueCache, setOriginalQueueCache] = useState<any[]>([]);
  
  const isShufflingRef = useRef(false);
  const lastQueueLengthRef = useRef(0);

  // Computed
  const isShuffleEnabled = shuffleMode === "on";
  const getDotCount = useCallback(() => (shuffleMode === "on" ? 1 : 0), [shuffleMode]);

  /**
   * Get the current queue (from context)
   */
  const getCurrentQueue = useCallback((): any[] => {
    return queue || [];
  }, [queue]);

  /**
   * Shuffle the queue while preserving the current track at position 0
   */
  const shuffleWithCurrentTrack = useCallback((queueToShuffle: any[], currentTrackId: string | undefined): any[] => {
    if (!queueToShuffle.length) return [];
    
    // Filter out current track for shuffling others
    const otherTracks = currentTrackId 
      ? queueToShuffle.filter(track => track.id !== currentTrackId)
      : [...queueToShuffle];
    
    // Shuffle the other tracks
    const shuffledOthers = shuffleArray(otherTracks);
    
    // Insert current track at the beginning if it exists
    const currentTrackObj = currentTrackId 
      ? queueToShuffle.find(track => track.id === currentTrackId)
      : null;
    
    if (currentTrackObj) {
      return [currentTrackObj, ...shuffledOthers];
    }
    
    return shuffledOthers;
  }, []);

  /**
   * Apply shuffle to the current queue
   */
  const applyShuffle = useCallback(async (queueToShuffle: any[], preserveCurrent: boolean = true): Promise<any[]> => {
    if (!queueToShuffle.length) return [];
    
    const currentTrackId = currentTrack?.id;
    let shuffled: any[];
    
    if (preserveCurrent && currentTrackId) {
      shuffled = shuffleWithCurrentTrack(queueToShuffle, currentTrackId);
    } else {
      shuffled = shuffleArray(queueToShuffle);
    }
    
    return shuffled;
  }, [currentTrack?.id, shuffleWithCurrentTrack]);

  /**
   * Restore original queue order
   */
  const restoreOriginalOrder = useCallback(async (): Promise<any[]> => {
    if (originalQueueCache.length) {
      return [...originalQueueCache];
    }
    return getCurrentQueue();
  }, [originalQueueCache, getCurrentQueue]);

  /**
   * Set shuffle mode - reorders queue in-place
   */
  const setShuffleMode = useCallback(async (mode: ShuffleMode) => {
    if (isShufflingRef.current) return;
    isShufflingRef.current = true;
    setIsLoading(true);

    try {
      const currentQueueList = getCurrentQueue();
      const currentTrackId = currentTrack?.id;
      
      if (!currentQueueList.length) {
        globalShuffleMode = mode;
        setShuffleModeState(mode);
        await persistShuffleMode(mode);
        
        // Notify listeners
        shuffleListeners.forEach(listener => listener(mode));
        return;
      }

      if (mode === "on") {
        // Store original order before shuffling
        if (originalQueueCache.length === 0) {
          setOriginalQueueCache([...currentQueueList]);
          originalQueueOrderStore = [...currentQueueList];
        } else {
          originalQueueOrderStore = [...originalQueueCache];
        }

        // Create shuffled queue
        let shuffled: any[];
        
        if (currentTrackId) {
          // Keep current track first, shuffle the rest
          const otherTracks = currentQueueList.filter(track => track.id !== currentTrackId);
          const shuffledOthers = shuffleArray(otherTracks);
          shuffled = [currentTrackList.find(t => t.id === currentTrackId) || currentQueueList[0], ...shuffledOthers];
        } else {
          shuffled = shuffleArray(currentQueueList);
        }
        
        shuffledQueueStore = shuffled;
        currentShuffledIndexStore = 0;
        
        // Update context queue
        if (setQueue) {
          await setQueue(shuffled);
        }
        
        // Reset index to 0 (current track)
        if (setCurrentQueueIndex) {
          setCurrentQueueIndex(0);
        }

        triggerHaptic("impactLight");
      } else {
        // Restore original order
        const original = await restoreOriginalOrder();
        
        if (original.length) {
          // Store current track ID for position restoration
          const currentTrackId_ = currentTrack?.id;
          
          // Update context queue
          if (setQueue) {
            await setQueue(original);
          }
          
          // Restore position
          if (currentTrackId_ && setCurrentQueueIndex) {
            const newIndex = original.findIndex(track => track.id === currentTrackId_);
            if (newIndex >= 0) {
              setCurrentQueueIndex(newIndex);
            }
          }
          
          // Clear stores
          setOriginalQueueCache([]);
          originalQueueOrderStore = [];
          shuffledQueueStore = [];
          currentShuffledIndexStore = -1;
        }
      }

      globalShuffleMode = mode;
      setShuffleModeState(mode);
      await persistShuffleMode(mode);
      
      // Notify listeners
      shuffleListeners.forEach(listener => listener(mode));
      
    } catch (err) {
      console.error("[useTrackPlayerShuffle] Failed:", err);
    } finally {
      isShufflingRef.current = false;
      setIsLoading(false);
    }
  }, [getCurrentQueue, currentTrack?.id, originalQueueCache, restoreOriginalOrder, setQueue, setCurrentQueueIndex]);

  /**
   * Toggle shuffle on/off
   */
  const toggleShuffle = useCallback(async () => {
    const next: ShuffleMode = shuffleMode === "off" ? "on" : "off";
    await setShuffleMode(next);
  }, [shuffleMode, setShuffleMode]);

  /**
   * Get current queue item (taking shuffle into account)
   */
  const getCurrentQueueItem = useCallback((): any | null => {
    const queueList = getCurrentQueue();
    if (!queueList.length) return null;
    
    if (shuffleMode === "on" && shuffledQueueStore.length) {
      const idx = currentShuffledIndexStore;
      if (idx >= 0 && idx < shuffledQueueStore.length) {
        return shuffledQueueStore[idx];
      }
    }
    
    const idx = currentQueueIndex;
    if (idx >= 0 && idx < queueList.length) {
      return queueList[idx];
    }
    
    return null;
  }, [shuffleMode, getCurrentQueue, currentQueueIndex]);

  /**
   * Get current queue index (taking shuffle into account)
   */
  const getCurrentQueueIndex = useCallback((): number => {
    if (shuffleMode === "on" && currentShuffledIndexStore >= 0) {
      return currentShuffledIndexStore;
    }
    return currentQueueIndex;
  }, [shuffleMode, currentQueueIndex]);

  /**
   * Get next track index based on shuffle mode
   */
  const getNextTrackIndex = useCallback((): number | null => {
    const queueLength = getCurrentQueue().length;
    if (queueLength === 0) return null;
    
    if (shuffleMode === "on") {
      const nextIdx = currentShuffledIndexStore + 1;
      if (nextIdx < shuffledQueueStore.length) {
        return nextIdx;
      }
      // Wrap around
      return 0;
    } else {
      const nextIdx = currentQueueIndex + 1;
      if (nextIdx < queueLength) {
        return nextIdx;
      }
      // No wrap for non-shuffle - let repeat mode handle
      return null;
    }
  }, [shuffleMode, getCurrentQueue, currentQueueIndex, currentShuffledIndexStore, shuffledQueueStore.length]);

  /**
   * Get previous track index based on shuffle mode
   */
  const getPreviousTrackIndex = useCallback((): number | null => {
    const queueLength = getCurrentQueue().length;
    if (queueLength === 0) return null;
    
    if (shuffleMode === "on") {
      const prevIdx = currentShuffledIndexStore - 1;
      if (prevIdx >= 0) {
        return prevIdx;
      }
      // Wrap to end
      return shuffledQueueStore.length - 1;
    } else {
      const prevIdx = currentQueueIndex - 1;
      if (prevIdx >= 0) {
        return prevIdx;
      }
      // No wrap for non-shuffle
      return null;
    }
  }, [shuffleMode, getCurrentQueue, currentQueueIndex, currentShuffledIndexStore, shuffledQueueStore.length]);

  // Load persisted shuffle mode on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        const savedMode = await loadPersistedShuffleMode();
        if (savedMode !== globalShuffleMode) {
          globalShuffleMode = savedMode;
          setShuffleModeState(savedMode);
        }
      } catch (err) {
        console.error("[useTrackPlayerShuffle] Failed to load initial mode:", err);
      }
    };
    initialize();
  }, []);

  // Track queue changes and auto-shuffle if needed
  useEffect(() => {
    const currentQueue = getCurrentQueue();
    const currentLength = currentQueue.length;
    
    // If queue length changed significantly and shuffle is on, maybe re-shuffle
    if (shuffleMode === "on" && 
        currentLength !== lastQueueLengthRef.current && 
        currentLength > 0 &&
        !isShufflingRef.current) {
      
      // Only auto-shuffle if we're not already shuffling
      const timeout = setTimeout(() => {
        if (shuffleMode === "on" && !isShufflingRef.current) {
          setShuffleMode("on").catch(console.error);
        }
      }, 500);
      
      return () => clearTimeout(timeout);
    }
    
    lastQueueLengthRef.current = currentLength;
  }, [getCurrentQueue, shuffleMode, setShuffleMode]);

  // Listen to global shuffle mode changes
  useEffect(() => {
    const handleGlobalChange = (mode: ShuffleMode) => {
      if (mode !== shuffleMode) {
        setShuffleModeState(mode);
      }
    };
    
    shuffleListeners.add(handleGlobalChange);
    
    return () => {
      shuffleListeners.delete(handleGlobalChange);
    };
  }, [shuffleMode]);

  return {
    shuffleMode,
    toggleShuffle,
    setShuffleMode,
    getDotCount,
    isShuffleEnabled,
    isLoading,
    getCurrentQueueItem,
    getCurrentQueueIndex,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export const getShuffleModeLabel = (mode: ShuffleMode): string => {
  return mode === "on" ? "Shuffle On" : "Shuffle Off";
};

// Default export
export default useTrackPlayerShuffle;