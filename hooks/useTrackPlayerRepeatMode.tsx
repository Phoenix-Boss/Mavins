/**
 * useTrackPlayerRepeatMode.tsx
 * 
 * Custom React hook for managing the repeat mode using react-native-track-player.
 */

import { useCallback, useEffect, useState } from "react";
import TrackPlayer, { RepeatMode, Event, useTrackPlayerEvents } from "react-native-track-player";

/**
 * A custom hook that manages the repeat mode of the track player.
 */
export const useTrackPlayerRepeatMode = () => {
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const changeRepeatMode = useCallback(async (newRepeatMode: RepeatMode) => {
    try {
      await TrackPlayer.setRepeatMode(newRepeatMode);
      setRepeatMode(newRepeatMode);
      setError(null);
    } catch (err) {
      console.error("[useTrackPlayerRepeatMode] Failed to change repeat mode:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
      try {
        const actualMode = await TrackPlayer.getRepeatMode();
        setRepeatMode(actualMode);
      } catch {
        // Keep previous value
      }
    }
  }, []);

  // Initial state fetch
  useEffect(() => {
    let mounted = true;

    const fetchInitialMode = async () => {
      try {
        const mode = await TrackPlayer.getRepeatMode();
        if (mounted) {
          setRepeatMode(mode);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          console.error("[useTrackPlayerRepeatMode] Failed to get initial repeat mode:", err);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    fetchInitialMode();

    return () => {
      mounted = false;
    };
  }, []);

  // Event-driven state synchronization using RNTP's useTrackPlayerEvents
  useTrackPlayerEvents([Event.PlaybackState], async () => {
    try {
      const currentMode = await TrackPlayer.getRepeatMode();
      setRepeatMode(currentMode);
    } catch (err) {
      console.warn("[useTrackPlayerRepeatMode] Failed to sync repeat mode:", err);
    }
  });

  return { repeatMode, changeRepeatMode, isLoading, error };
};

/**
 * Helper function to cycle through repeat modes.
 */
export const cycleRepeatMode = (currentMode: RepeatMode): RepeatMode => {
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
 * Helper to get a human-readable label for a repeat mode.
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
 * Helper to get a short icon label for a repeat mode.
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