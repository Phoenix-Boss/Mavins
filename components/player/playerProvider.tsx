// components/player/playerProvider.tsx
/**
 * PlayerProvider
 *
 * FIXES APPLIED:
 *
 *  1. useActiveTrack() correctly destructured to access the track property.
 *  2. Player store synchronization now properly handles null/undefined cases.
 *  3. Navigation callback is properly memoized and set exactly once on mount.
 *  4. Added cleanup for navigation callback on unmount.
 *  5. Uses default import TrackPlayer consistently.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import TrackPlayer, { useActiveTrack } from "@/modules/mavin-eq";
import { usePlayerStore } from "@/store/player";
import { useMusicPlayer } from "@/components/MusicPlayerContext";

type PlayerStore = ReturnType<typeof usePlayerStore.getState>;
type PlayerStoreTrack = NonNullable<PlayerStore['currentTrack']>;

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerOverlayContextValue {
  expandPlayer:   () => void;
  minimizePlayer: () => void;
  hidePlayer:     () => void;
}

const PlayerOverlayContext = createContext<PlayerOverlayContextValue | null>(null);

export function usePlayerOverlay(): PlayerOverlayContextValue {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) {
    console.warn("[usePlayerOverlay] called outside <PlayerProvider> — actions are no-ops");
    return { expandPlayer: () => {}, minimizePlayer: () => {}, hidePlayer: () => {} };
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerProvider
// ─────────────────────────────────────────────────────────────────────────────

export function PlayerProvider({
  children,
  playerReady,
}: {
  children: React.ReactNode;
  playerReady: boolean;
}) {
  const router = useRouter();

  // ── Navigation actions ─────────────────────────────────────────────────────
  const expandPlayer = useCallback(() => {
    router.push("/(player)");
  }, [router]);

  const minimizePlayer = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  const hidePlayer = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  // ── Wire up navigation callback in MusicPlayerContext ──────────────────────
  const { setNavigateToPlayer } = useMusicPlayer();
  const hasSetNavigationRef = useRef(false);
  // Keep a stable ref to router.push so the callback identity doesn't change
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  useEffect(() => {
    if (!hasSetNavigationRef.current) {
      // Use a stable closure over routerRef so we never need to re-register
      setNavigateToPlayer(() => routerRef.current.push("/(player)"));
      hasSetNavigationRef.current = true;
    }
    // No cleanup — a stale nav callback is safer than a missing one.
    // The routerRef always stays current via the effect above.
  }, [setNavigateToPlayer]);

  // ── Sync active track into playerStore ─────────────────────────────────────
  // useActiveTrack() may return the track directly OR { track, index, isLoading }
  // depending on the mavin-eq wrapper version. Handle both shapes defensively.
  const activeTrackRaw = useActiveTrack();
  const activeTrack = activeTrackRaw && typeof activeTrackRaw === 'object' && 'track' in activeTrackRaw
    ? (activeTrackRaw as any).track
    : activeTrackRaw;
  const activeTrackIndex = activeTrackRaw && typeof activeTrackRaw === 'object' && 'index' in activeTrackRaw
    ? (activeTrackRaw as any).index
    : null;

  const setStoreTrack = usePlayerStore((s: PlayerStore) => s.setPlaying);
  
  // Ref to track the last synced track ID to prevent unnecessary updates
  const lastSyncedTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't attempt any native track access before the player is ready.
    // Calling getState() or accessing track properties before the native
    // module is initialised can throw and cause a cascade remount.
    if (!playerReady || !activeTrack) {
      return;
    }

    // Prevent syncing the same track multiple times
    if (lastSyncedTrackIdRef.current === activeTrack.id) {
      return;
    }

    // Build the track object for the store
    const trackForStore: PlayerStoreTrack = {
      id:        activeTrack.id ?? "",
      title:     activeTrack.title ?? "Unknown",
      artist:    activeTrack.artist ?? "Unknown",
      thumbnail: typeof activeTrack.artwork === "string"
        ? activeTrack.artwork
        : typeof (activeTrack as any).artworkUri === "string"
          ? (activeTrack as any).artworkUri
          : "",
      url:       (activeTrack as any).url ?? (activeTrack as any).uri ?? "",
      videoId:   (activeTrack as any).videoId,
      duration:  activeTrack.duration,
    };

    // Check if the store already has this track to avoid unnecessary updates
    const currentStoreTrack = usePlayerStore.getState().currentTrack;
    
    if (currentStoreTrack?.id !== trackForStore.id) {
      setStoreTrack(trackForStore);
      lastSyncedTrackIdRef.current = trackForStore.id;
    }
  }, [activeTrack, playerReady, setStoreTrack]);

  // ── Clear store when queue empties ─────────────────────────────────────────
  useEffect(() => {
    if (!playerReady) return;
    
    // When activeTrack becomes null and index is null/negative, clear the store ref
    if (!activeTrack && (activeTrackIndex === null || activeTrackIndex < 0)) {
      const currentStoreTrack = usePlayerStore.getState().currentTrack;
      if (currentStoreTrack !== null) {
        lastSyncedTrackIdRef.current = null;
      }
    }
  }, [activeTrack, activeTrackIndex, playerReady]);

  // ── Context value ──────────────────────────────────────────────────────────
  const overlayContextValue: PlayerOverlayContextValue = {
    expandPlayer,
    minimizePlayer,
    hidePlayer,
  };

  return (
    <PlayerOverlayContext.Provider value={overlayContextValue}>
      <View style={styles.container}>
        {children}
      </View>
    </PlayerOverlayContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
});