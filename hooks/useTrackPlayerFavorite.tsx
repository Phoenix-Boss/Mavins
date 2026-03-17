/**
 * useTrackPlayerFavorite
 *
 * Manages the favourite status of the currently active track.
 *
 * Key fixes vs the original:
 *
 * 1. No more useEffect + setState to derive isFavorite.
 *    The original pattern was:
 *      - useFavorites() returns a new array every render (no useShallow)
 *      - useEffect sees favoriteTracks as changed → calls setIsFavorite
 *      - setIsFavorite → re-render → useFavorites re-runs → new array → loop
 *
 *    Fix: useIsSongFavorite(id) selects a single boolean from the store.
 *    Booleans are primitives — Zustand's === check is always correct.
 *    No array allocation, no useEffect, no derived state.
 *
 * 2. toggleFavoriteTrack now comes from useFavorites() which exposes
 *    the store's toggleFavoriteSong action under that name.
 */

import { useIsSongFavorite, useFavorites } from "@/store/library";
import { useCallback } from "react";
import TrackPlayer, { useActiveTrack } from "react-native-track-player";

export const useTrackPlayerFavorite = () => {
  const activeTrack = useActiveTrack();

  // ── isFavorite — direct boolean selector, never causes a loop ──────────────
  // Falls back to false when no track is active (activeTrack?.id is undefined).
  // useIsSongFavorite internally does: s.favoriteSongIds.includes(id)
  // which returns a primitive boolean — safe without useShallow.
  const isFavorite = useIsSongFavorite(activeTrack?.id ?? '');

  // ── toggleFavoriteTrack — stable action reference from the store ───────────
  const { toggleFavoriteTrack } = useFavorites();

  // ── checkIfFavorite — reads current store state outside React ─────────────
  // Uses getState() so it doesn't subscribe to re-renders.
  const checkIfFavorite = useCallback(async (id: string): Promise<boolean> => {
    const { useLibraryStore } = await import('@/store/library');
    return useLibraryStore.getState().favoriteSongIds.includes(id);
  }, []);

  // ── toggleFavoriteFunc ─────────────────────────────────────────────────────
  const toggleFavoriteFunc = useCallback(
    async (
      track = activeTrack
        ? {
            id: activeTrack.id ?? '',
            title: activeTrack.title ?? '',
            artist: activeTrack.artist ?? '',
            thumbnail: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : '',
          }
        : undefined,
    ) => {
      if (!track?.id) return;

      // Toggle in the Zustand store
      toggleFavoriteTrack(track.id);

      // Update RNTP queue metadata so the notification rating reflects the change
      try {
        const queue = await TrackPlayer.getQueue();
        const trackIndex = queue.findIndex((t) => t.id === track.id);
        if (trackIndex !== -1) {
          await TrackPlayer.updateMetadataForTrack(trackIndex, {
            // isFavorite is the PRE-toggle value here — so we invert it
            rating: isFavorite ? 0 : 1,
          });
        }
      } catch (error) {
        console.error('useTrackPlayerFavorite: error updating RNTP metadata', error);
      }
    },
    [activeTrack, isFavorite, toggleFavoriteTrack],
  );

  return { isFavorite, toggleFavoriteFunc, checkIfFavorite };
};