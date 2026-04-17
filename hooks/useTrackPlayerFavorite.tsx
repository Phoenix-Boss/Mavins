/**
 * useTrackPlayerFavorite.tsx
 * 
 * ADJUSTED: Added safety guards for when player isn't ready
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { useActiveTrack } from "@/modules/mavin-eq";
import { useLibraryStore, useIsSongFavorite } from "@/store/library";
import { triggerHaptic, type HapticStrength } from "@/helpers/haptics";

interface UseTrackPlayerFavoriteResult {
  isFavorite: boolean;
  toggleFavorite: () => Promise<void>;
  toggleFavoriteFunc: () => Promise<void>;
  currentTrackId: string | null;
  isLoading: boolean;
}

export const useTrackPlayerFavorite = (): UseTrackPlayerFavoriteResult => {
  // 🔥 SAFETY: useActiveTrack might return null/undefined initially
  const activeTrackResult = useActiveTrack();
  const activeTrack = activeTrackResult?.track ?? null;
  const trackLoading = activeTrackResult?.isLoading ?? true;
  
  const currentTrackId = activeTrack?.id ?? null;
  
  const isFavoriteFromStore = useIsSongFavorite(currentTrackId ?? "");
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const addFavorite = useLibraryStore((s) => s.addFavorite);
  const removeFavorite = useLibraryStore((s) => s.removeFavorite);
  
  const lastTrackIdRef = useRef<string | null>(null);
  const pendingToggleRef = useRef<boolean>(false);

  useEffect(() => {
    if (trackLoading) {
      setIsLoading(true);
      return;
    }

    const trackId = activeTrack?.id;
    
    if (trackId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = trackId ?? null;
      pendingToggleRef.current = false;
    }
    
    if (!trackId) {
      setIsFavorite(false);
      setIsLoading(false);
      return;
    }
    
    setIsFavorite(isFavoriteFromStore);
    setIsLoading(false);
  }, [activeTrack?.id, isFavoriteFromStore, trackLoading]);

  const toggleFavorite = useCallback(async () => {
    const trackId = currentTrackId;
    
    if (!trackId || pendingToggleRef.current) return;
    pendingToggleRef.current = true;
    
    const newState = !isFavorite;
    setIsFavorite(newState);
    
    const hapticType: HapticStrength = newState ? "light" : "medium";
    triggerHaptic(hapticType);
    
    try {
      if (newState) {
        addFavorite('song', trackId);
      } else {
        removeFavorite('song', trackId);
      }
    } catch (error) {
      console.error("[useTrackPlayerFavorite] Failed:", error);
      setIsFavorite(!newState);
    } finally {
      pendingToggleRef.current = false;
    }
  }, [currentTrackId, isFavorite, addFavorite, removeFavorite]);

  useEffect(() => {
    return () => { pendingToggleRef.current = false; };
  }, []);

  return {
    isFavorite,
    toggleFavorite,
    toggleFavoriteFunc: toggleFavorite,
    currentTrackId,
    isLoading: isLoading || trackLoading,
  };
};

export const checkIsFavorite = (trackId: string | null | undefined): boolean => {
  if (!trackId) return false;
  const state = useLibraryStore.getState();
  return state.favoriteSongIds.includes(trackId);
};

export const toggleTrackFavorite = async (
  trackId: string,
  trackData?: {
    title?: string;
    artist?: string;
    thumbnail?: string;
    url?: string;
    duration?: number;
  }
): Promise<boolean> => {
  const state = useLibraryStore.getState();
  const isCurrentlyFavorite = state.favoriteSongIds.includes(trackId);
  
  const hapticType: HapticStrength = isCurrentlyFavorite ? "medium" : "light";
  triggerHaptic(hapticType);
  
  if (isCurrentlyFavorite) {
    state.removeFavorite('song', trackId);
    return false;
  } else {
    state.addFavorite('song', trackId);
    return true;
  }
};