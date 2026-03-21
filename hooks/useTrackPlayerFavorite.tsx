/**
 * useTrackPlayerFavorite
 *
 * Manages the favourite status of the currently active track.
 *
 * Fix vs previous version:
 *   checkIfFavorite used a dynamic `await import('@/store/library')` inside
 *   a useCallback. Dynamic imports inside callbacks are fragile — they create
 *   a new module reference on every call, bypass tree-shaking, and can cause
 *   timing issues if the module hasn't been evaluated yet. The library store
 *   is always needed here, so we import it statically at the top of the file
 *   and call `useLibraryStore.getState()` directly — zero overhead, always safe.
 *
 * Other fixes preserved:
 *   [1] useIsSongFavorite(id) — single boolean selector, no render loop.
 *   [2] toggleFavoriteTrack — stable action reference from the store.
 */

import { useCallback } from "react";
import TrackPlayer, { useActiveTrack } from "react-native-track-player";
import { useIsSongFavorite, useFavorites, useLibraryStore } from "@/store/library";

export const useTrackPlayerFavorite = () => {
  const activeTrack = useActiveTrack();

  // ── isFavorite — direct boolean selector, never causes a render loop ───────
  // Falls back to false when no track is active (activeTrack?.id is undefined).
  const isFavorite = useIsSongFavorite(activeTrack?.id ?? "");

  // ── toggleFavoriteTrack — stable action reference from the Zustand store ───
  const { toggleFavoriteTrack } = useFavorites();

  // ── checkIfFavorite — reads current store state outside React ─────────────
  // Uses getState() (not a hook) so it does NOT subscribe to re-renders.
  // Static import means no dynamic-import overhead or timing issues.
  const checkIfFavorite = useCallback((id: string): boolean => {
    return useLibraryStore.getState().favoriteSongIds.includes(id);
  }, []);

  // ── toggleFavoriteFunc ─────────────────────────────────────────────────────
  const toggleFavoriteFunc = useCallback(
    async (
      track = activeTrack
        ? {
            id:        activeTrack.id       ?? "",
            title:     activeTrack.title    ?? "",
            artist:    activeTrack.artist   ?? "",
            thumbnail: typeof activeTrack.artwork === "string" ? activeTrack.artwork : "",
          }
        : undefined,
    ) => {
      if (!track?.id) return;

      // Toggle in the Zustand store
      toggleFavoriteTrack(track.id);

      // Update RNTP queue metadata so the notification rating reflects the change.
      // isFavorite is the PRE-toggle value here, so we invert it for the rating.
      try {
        const queue      = await TrackPlayer.getQueue();
        const trackIndex = queue.findIndex((t) => t.id === track.id);
        if (trackIndex !== -1) {
          await TrackPlayer.updateMetadataForTrack(trackIndex, {
            rating: isFavorite ? 0 : 1,
          });
        }
      } catch (error) {
        console.error("useTrackPlayerFavorite: error updating RNTP metadata", error);
      }
    },
    [activeTrack, isFavorite, toggleFavoriteTrack],
  );

  return { isFavorite, toggleFavoriteFunc, checkIfFavorite };
};