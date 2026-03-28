// components/player/playerProvider.tsx
/**
 * PlayerProvider — Manages player overlay navigation only.
 *
 * ARCHITECTURE:
 * - The expanded player lives exclusively inside the (player) route (PlayerScreen.tsx).
 * - PlayerProvider only manages navigation actions (expandPlayer, minimizePlayer, hidePlayer).
 * - NO minimized player here — FloatingPlayer in _layout.tsx handles the mini-player
 *   and is restricted to Home, Library, Settings pages only.
 *
 * FIXES:
 * - Removed the BackHandler useEffect that was registering a listener returning
 *   `false` (a no-op that doesn't consume the event and adds nothing useful).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useActiveTrack } from "react-native-track-player";
import { usePlayerStore } from "@/store/player";

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

  // Sync active track to playerStore so other components can read it
  const setStoreTrack  = usePlayerStore((s: PS) => s.setPlaying);
  const activeTrack    = useActiveTrack();

  useEffect(() => {
    if (!activeTrack || !playerReady) return;
    const trackForStore = {
      id:        activeTrack.id,
      title:     activeTrack.title  || "Unknown",
      artist:    activeTrack.artist || "Unknown",
      thumbnail: typeof activeTrack.artwork === "string" ? activeTrack.artwork : "",
      url:       activeTrack.url    || "",
      videoId:   (activeTrack as any).videoId,
      duration:  activeTrack.duration,
    };
    const current = usePlayerStore.getState().currentTrack;
    if (current?.id !== trackForStore.id) {
      setStoreTrack(trackForStore);
    }
  }, [activeTrack, playerReady, setStoreTrack]);

  // ✅ FIX: Removed BackHandler useEffect.
  //    The previous listener returned `false` unconditionally, which means
  //    it did NOT consume the back event (that requires returning `true`).
  //    It registered a listener that did nothing and added unnecessary cleanup.

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