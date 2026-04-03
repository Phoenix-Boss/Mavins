// components/player/playerProvider.tsx
/**
 * PlayerProvider
 *
 * FIXES APPLIED:
 *  1. (Previous fix, kept) useActiveTrack imported from '@/modules/mavin-eq'
 *     not from 'react-native-track-player', so it listens to the correct
 *     native event bus.
 *
 *  2. (NEW) Calls setNavigateToPlayer() once on mount so that
 *     MusicPlayerContext's navigateToPlayerRef is always populated.
 *     Previously nothing ever called setNavigateToPlayer, meaning
 *     navigateToPlayerRef.current was always null and goToPlayer?.() was
 *     always a silent no-op when no inline navigate arg was passed.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { useActiveTrack } from "@/modules/mavin-eq";
import { usePlayerStore } from "@/store/player";
import { useMusicPlayer } from "@/components/MusicPlayerContext";

type PS = ReturnType<typeof usePlayerStore.getState>;

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

  const expandPlayer = useCallback(() => {
    router.push("/(player)");
  }, [router]);

  const minimizePlayer = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const hidePlayer = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // ✅ FIX 2: Wire up the navigation callback in MusicPlayerContext so that
  // calls to playAudio(song) without an explicit navigate arg can still
  // route to the player. Previously navigateToPlayerRef was always null
  // because setNavigateToPlayer was never called anywhere.
  const { setNavigateToPlayer } = useMusicPlayer();

  useEffect(() => {
    setNavigateToPlayer(() => router.push("/(player)"));
  }, [setNavigateToPlayer, router]);

  // ── Sync active track into playerStore ───────────────────────────────────
  const setStoreTrack = usePlayerStore((s: PS) => s.setPlaying);
  const activeTrack   = useActiveTrack();

  useEffect(() => {
    if (!activeTrack || !playerReady) return;
    const trackForStore = {
      id:        activeTrack.id        ?? "",
      title:     activeTrack.title     ?? "Unknown",
      artist:    activeTrack.artist    ?? "Unknown",
      thumbnail: typeof activeTrack.artwork === "string" ? activeTrack.artwork : "",
      url:       (activeTrack as any).url ?? (activeTrack as any).uri ?? "",
      videoId:   (activeTrack as any).videoId,
      duration:  activeTrack.duration,
    };
    const current = usePlayerStore.getState().currentTrack;
    if (current?.id !== trackForStore.id) {
      setStoreTrack(trackForStore);
    }
  }, [activeTrack, playerReady, setStoreTrack]);

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