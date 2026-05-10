// hooks/useTrackPlayerRepeatMode.tsx
/**
 * useTrackPlayerRepeatMode - expo-av replacement for react-native-track-player's repeat mode
 * 
 * Manages repeat mode state for the player.
 * Repeat modes: Off, Track (repeat one), Queue (repeat all)
 * State is persisted in module-level variable across hook instances.
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { useTrackPlayerEvents, Event } from './useTrackPlayerEvents';

// RNTP-compatible RepeatMode enum
export enum RepeatMode {
  Off = 0,
  Track = 1,
  Queue = 2,
}

// Module-level state (persists across hook instances)
let globalRepeatMode: RepeatMode = RepeatMode.Off;
let repeatModeListeners: Set<(mode: RepeatMode) => void> = new Set();

// Storage key for persistence
const REPEAT_MODE_STORAGE_KEY = '@mavin/repeat_mode';

// Helper to persist repeat mode
async function persistRepeatMode(mode: RepeatMode): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem(REPEAT_MODE_STORAGE_KEY, String(mode));
  } catch (error) {
    console.warn('[useTrackPlayerRepeatMode] Failed to persist:', error);
  }
}

// Helper to load persisted repeat mode
async function loadPersistedRepeatMode(): Promise<RepeatMode> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const saved = await AsyncStorage.getItem(REPEAT_MODE_STORAGE_KEY);
    if (saved !== null) {
      const mode = parseInt(saved, 10);
      if (mode === RepeatMode.Off || mode === RepeatMode.Track || mode === RepeatMode.Queue) {
        return mode;
      }
    }
  } catch (error) {
    console.warn('[useTrackPlayerRepeatMode] Failed to load persisted:', error);
  }
  return RepeatMode.Off;
}

/**
 * A custom hook that manages the repeat mode of the track player.
 * 
 * @returns {Object} Repeat mode state and control functions
 * 
 * @example
 * const { repeatMode, changeRepeatMode, isLoading, error } = useTrackPlayerRepeatMode();
 * 
 * // Cycle through modes
 * changeRepeatMode(RepeatMode.Queue);
 */
export const useTrackPlayerRepeatMode = () => {
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(globalRepeatMode);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const { skipToNext, skipToPrevious, queue, currentQueueIndex } = useMusicPlayer();

  // Helper to get queue length (using context)
  const getQueueLength = useCallback(() => {
    return queue?.length || 0;
  }, [queue]);

  // Helper to check if at end of queue
  const isAtQueueEnd = useCallback(() => {
    const queueLen = getQueueLength();
    return queueLen > 0 && currentQueueIndex >= queueLen - 1;
  }, [currentQueueIndex, getQueueLength]);

  /**
   * Change the repeat mode
   */
  const changeRepeatMode = useCallback(async (newRepeatMode: RepeatMode) => {
    try {
      setError(null);
      globalRepeatMode = newRepeatMode;
      setRepeatMode(newRepeatMode);
      
      // Persist to storage
      await persistRepeatMode(newRepeatMode);
      
      // Notify all listeners
      repeatModeListeners.forEach(listener => {
        try {
          listener(newRepeatMode);
        } catch (e) {
          console.warn('[useTrackPlayerRepeatMode] Listener error:', e);
        }
      });
      
      console.log('[useTrackPlayerRepeatMode] Repeat mode changed to:', 
        newRepeatMode === RepeatMode.Off ? 'Off' : 
        newRepeatMode === RepeatMode.Track ? 'Track' : 'Queue');
    } catch (err) {
      console.error('[useTrackPlayerRepeatMode] Failed to change repeat mode:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  /**
   * Cycle to the next repeat mode (Off -> Queue -> Track -> Off)
   */
  const cycleRepeatMode = useCallback(async () => {
    let nextMode: RepeatMode;
    switch (repeatMode) {
      case RepeatMode.Off:
        nextMode = RepeatMode.Queue;
        break;
      case RepeatMode.Queue:
        nextMode = RepeatMode.Track;
        break;
      case RepeatMode.Track:
        nextMode = RepeatMode.Off;
        break;
      default:
        nextMode = RepeatMode.Off;
    }
    await changeRepeatMode(nextMode);
    return nextMode;
  }, [repeatMode, changeRepeatMode]);

  /**
   * Check if should repeat current track
   */
  const shouldRepeatTrack = useCallback((): boolean => {
    return repeatMode === RepeatMode.Track;
  }, [repeatMode]);

  /**
   * Check if should repeat the entire queue
   */
  const shouldRepeatQueue = useCallback((): boolean => {
    return repeatMode === RepeatMode.Queue;
  }, [repeatMode]);

  /**
   * Handle queue end logic - determines whether to replay or stop
   * Returns true if should replay from beginning
   */
  const handleQueueEnd = useCallback((): boolean => {
    if (repeatMode === RepeatMode.Queue) {
      // Repeat all - will replay from beginning
      return true;
    }
    if (repeatMode === RepeatMode.Track) {
      // Repeat one - will replay the current track
      return true;
    }
    // No repeat - stop playback
    return false;
  }, [repeatMode]);

  /**
   * Handle track end - determines next action based on repeat mode
   */
  const getNextTrackAction = useCallback((): 'next' | 'repeat' | 'stop' => {
    if (repeatMode === RepeatMode.Track) {
      return 'repeat';
    }
    if (repeatMode === RepeatMode.Queue && isAtQueueEnd()) {
      return 'next'; // Will wrap to beginning
    }
    if (isAtQueueEnd()) {
      return 'stop';
    }
    return 'next';
  }, [repeatMode, isAtQueueEnd]);

  // Load persisted repeat mode on mount
  useEffect(() => {
    let mounted = true;
    isMountedRef.current = true;

    const initialize = async () => {
      try {
        const savedMode = await loadPersistedRepeatMode();
        if (mounted && savedMode !== globalRepeatMode) {
          globalRepeatMode = savedMode;
          setRepeatMode(savedMode);
        }
        setError(null);
      } catch (err) {
        if (mounted) {
          console.error('[useTrackPlayerRepeatMode] Failed to get initial repeat mode:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      isMountedRef.current = false;
    };
  }, []);

  // Sync with global state changes
  useEffect(() => {
    const handleGlobalChange = (mode: RepeatMode) => {
      if (isMountedRef.current && mode !== repeatMode) {
        setRepeatMode(mode);
      }
    };
    
    repeatModeListeners.add(handleGlobalChange);
    
    return () => {
      repeatModeListeners.delete(handleGlobalChange);
    };
  }, [repeatMode]);

  // Sync with queue changes (listen for queue ended event)
  useTrackPlayerEvents([Event.PlaybackQueueEnded], () => {
    if (repeatMode === RepeatMode.Queue || repeatMode === RepeatMode.Track) {
      console.log('[useTrackPlayerRepeatMode] Queue ended with repeat mode:', 
        repeatMode === RepeatMode.Track ? 'Track' : 'Queue');
    }
  });

  return {
    repeatMode,
    changeRepeatMode,
    cycleRepeatMode,
    shouldRepeatTrack,
    shouldRepeatQueue,
    handleQueueEnd,
    getNextTrackAction,
    isLoading,
    error,
  };
};

/**
 * Helper function to cycle through repeat modes (standalone)
 */
export const cycleRepeatModeValue = (currentMode: RepeatMode): RepeatMode => {
  switch (currentMode) {
    case RepeatMode.Off:
      return RepeatMode.Queue;
    case RepeatMode.Queue:
      return RepeatMode.Track;
    case RepeatMode.Track:
      return RepeatMode.Off;
    default:
      return RepeatMode.Off;
  }
};

/**
 * Helper to get a human-readable label for a repeat mode
 */
export const getRepeatModeLabel = (mode: RepeatMode): string => {
  switch (mode) {
    case RepeatMode.Off:
      return "No Repeat";
    case RepeatMode.Track:
      return "Repeat One";
    case RepeatMode.Queue:
      return "Repeat All";
    default:
      return "Unknown";
  }
};

/**
 * Helper to get a short icon label for a repeat mode
 */
export const getRepeatModeShortLabel = (mode: RepeatMode): string => {
  switch (mode) {
    case RepeatMode.Off:
      return "Off";
    case RepeatMode.Track:
      return "1";
    case RepeatMode.Queue:
      return "All";
    default:
      return "";
  }
};

// Default export
export default useTrackPlayerRepeatMode;