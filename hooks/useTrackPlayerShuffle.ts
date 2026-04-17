/**
 * useTrackPlayerShuffle.ts
 * 
 * Custom React hook for managing the shuffle mode of the Mavin player.
 * 
 * ADJUSTED TO FOLLOW WRAPPER PATTERNS:
 *  - Uses TrackPlayer default export for methods (FIX 7)
 *  - Uses addEventListener from wrapper for events
 *  - Uses MavinEvent.PlaybackState (correct enum value)
 *  - Properly typed
 */

import { useCallback, useEffect, useState, useRef } from "react";

// 🔥 FIX 7: Use default export for player methods
import TrackPlayer from "@/modules/mavin-eq";

// Named exports for events
import { 
  addEventListener,
  MavinEvent,
} from "@/modules/mavin-eq";

// Import types
import type { PlaybackStateChangedEvent } from "@/modules/mavin-eq";

import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShuffleMode = "off" | "standard" | "smart" | "album";

interface UseTrackPlayerShuffleResult {
  shuffleMode: ShuffleMode;
  toggleShuffle: () => Promise<void>;
  setShuffleMode: (mode: ShuffleMode) => Promise<void>;
  cycleShuffleMode: () => Promise<void>;
  getDotCount: () => number;
  isShuffleEnabled: boolean;
  isLoading: boolean;
  error: Error | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SHUFFLE_CYCLE: ShuffleMode[] = ["off", "standard", "smart", "album"];

const SHUFFLE_LABELS: Record<ShuffleMode, string> = {
  off: "Shuffle Off",
  standard: "Standard Shuffle",
  smart: "Smart Shuffle",
  album: "Album Shuffle",
};

const SHUFFLE_DOTS: Record<ShuffleMode, number> = {
  off: 0,
  standard: 1,
  smart: 2,
  album: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useTrackPlayerShuffle = (): UseTrackPlayerShuffleResult => {
  const [shuffleMode, setShuffleModeState] = useState<ShuffleMode>("off");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  // Computed
  const isShuffleEnabled = shuffleMode !== "off";
  const getDotCount = useCallback(() => SHUFFLE_DOTS[shuffleMode] ?? 0, [shuffleMode]);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const fetchInitial = async () => {
      try {
        // 🔥 FIX 7: Use default export
        const enabled = await TrackPlayer.getShuffleMode();
        
        if (!mountedRef.current) return;
        
        // Native only returns boolean, map to our extended modes
        setShuffleModeState(enabled ? "standard" : "off");
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        console.error("[useTrackPlayerShuffle] Initial fetch failed:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setShuffleModeState("off");
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    fetchInitial();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Event-driven sync ─────────────────────────────────────────────────────
  useEffect(() => {
    // 🔥 Use wrapper's addEventListener with correct enum
    const sub = addEventListener(
      MavinEvent.PlaybackState, // NOT PlaybackStateChanged
      async (data: PlaybackStateChangedEvent) => {
        if (!mountedRef.current) return;
        
        try {
          const enabled = await TrackPlayer.getShuffleMode();
          if (!mountedRef.current) return;
          
          setShuffleModeState(prev => {
            if (enabled && prev === "off") return "standard";
            if (!enabled && prev !== "off") return "off";
            return prev;
          });
        } catch (err) {
          console.warn("[useTrackPlayerShuffle] Sync failed:", err);
        }
      }
    );

    return () => sub.remove();
  }, []);

  // ── Set shuffle mode ──────────────────────────────────────────────────────
  const setShuffleMode = useCallback(async (mode: ShuffleMode) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    
    const previous = shuffleMode;
    const shouldEnable = mode !== "off";
    
    // Optimistic update
    setShuffleModeState(mode);
    
    try {
      // 🔥 FIX 7: Use default export
      await TrackPlayer.setShuffleMode(shouldEnable);
      
      if (mountedRef.current) {
        setError(null);
        if (mode !== "off") triggerHaptic("impactLight");
      }
      
      // Extended modes are JS-managed
      if (mode === "smart" || mode === "album") {
        console.log(`[useTrackPlayerShuffle] ${mode} mode (JS-managed)`);
      }
    } catch (err) {
      console.error("[useTrackPlayerShuffle] Failed:", err);
      if (mountedRef.current) {
        setShuffleModeState(previous);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      pendingRef.current = false;
    }
  }, [shuffleMode]);

  // ── Toggle ────────────────────────────────────────────────────────────────
  const toggleShuffle = useCallback(async () => {
    const next: ShuffleMode = shuffleMode === "off" ? "standard" : "off";
    await setShuffleMode(next);
  }, [shuffleMode, setShuffleMode]);

  // ── Cycle ─────────────────────────────────────────────────────────────────
  const cycleShuffleMode = useCallback(async () => {
    const idx = SHUFFLE_CYCLE.indexOf(shuffleMode);
    const next = SHUFFLE_CYCLE[(idx + 1) % SHUFFLE_CYCLE.length];
    triggerHaptic("impactLight");
    await setShuffleMode(next);
  }, [shuffleMode, setShuffleMode]);

  return {
    shuffleMode,
    toggleShuffle,
    setShuffleMode,
    cycleShuffleMode,
    getDotCount,
    isShuffleEnabled,
    isLoading,
    error,
  };
};

// ── Utilities ───────────────────────────────────────────────────────────────

export const getShuffleModeLabel = (mode: ShuffleMode): string => {
  return SHUFFLE_LABELS[mode] ?? "Unknown";
};

export const checkIsShuffleEnabled = async (): Promise<boolean> => {
  try {
    // 🔥 FIX 7: Use default export
    return await TrackPlayer.getShuffleMode();
  } catch {
    return false;
  }
};

// Smart shuffle algorithm
export const smartShuffle = (
  tracks: string[], 
  playCounts: Map<string, number>
): string[] => {
  const maxPlays = Math.max(...Array.from(playCounts.values()), 1);
  
  const weights = tracks.map(id => {
    const plays = playCounts.get(id) ?? 0;
    return maxPlays - plays + 1;
  });
  
  const result: string[] = [];
  const remaining = [...tracks];
  const remainingWeights = [...weights];
  
  while (remaining.length > 0) {
    const total = remainingWeights.reduce((a, b) => a + b, 0);
    let random = Math.random() * total;
    
    for (let i = 0; i < remaining.length; i++) {
      random -= remainingWeights[i];
      if (random <= 0) {
        result.push(remaining[i]);
        remaining.splice(i, 1);
        remainingWeights.splice(i, 1);
        break;
      }
    }
  }
  
  return result;
};

// Album shuffle
export const albumShuffle = (
  tracks: Array<{ id: string; albumId?: string | null }>
): string[] => {
  const groups = new Map<string, string[]>();
  const noAlbum: string[] = [];
  
  for (const t of tracks) {
    if (t.albumId) {
      const g = groups.get(t.albumId) ?? [];
      g.push(t.id);
      groups.set(t.albumId, g);
    } else {
      noAlbum.push(t.id);
    }
  }
  
  const albumIds = Array.from(groups.keys());
  for (let i = albumIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [albumIds[i], albumIds[j]] = [albumIds[j], albumIds[i]];
  }
  
  const result: string[] = [];
  for (const id of albumIds) {
    result.push(...(groups.get(id) ?? []));
  }
  
  for (let i = noAlbum.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [noAlbum[i], noAlbum[j]] = [noAlbum[j], noAlbum[i]];
  }
  result.push(...noAlbum);
  
  return result;
};