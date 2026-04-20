// components/player/playerProvider.tsx
/**
 * PlayerProvider - Provides player overlay context and state
 *
 * ARCHITECTURE:
 *   PlayerScreenOverlay owns the gesture dismissal.
 *   PlayerProvider only tracks isPlayerVisible state so that:
 *     - FloatingPlayer hides itself while the full player is open
 *     - FloatingPlayer reappears after swipe-dismiss without a flash
 *
 *   expandPlayer  → sets isVisible=true, FloatingPlayer hidden
 *   collapsePlayer → sets isVisible=false ONLY (does NOT clear currentTrack)
 *                    FloatingPlayer reappears with same track data
 *
 *   This is the Spotify pattern: the mini-player is suppressed while the
 *   full player is open, not by checking the route, but by explicit state.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { View, StyleSheet } from "react-native";

import { useActiveTrack } from "react-native-track-player";
import { usePlayerStore } from "@/store/player";
import { useMusicPlayer } from "@/components/MusicPlayerContext";

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerOverlayContextValue {
  /** Open the full-screen player */
  expandPlayer: () => void;
  /**
   * Mark the player as collapsed (state only — no navigation, no track clear).
   * Call this AFTER animation completes so FloatingPlayer appears smoothly.
   */
  collapsePlayer: () => void;
  /** @deprecated use collapsePlayer — kept for backward compat */
  minimizePlayer: () => void;
  hidePlayer: () => void;
  isPlayerVisible: boolean;
  /**
   * Passed from RootLayout startup — true once RNTP is ready.
   * Components read this from context instead of managing their own ready state.
   */
  playerReady: boolean;
}

const PlayerOverlayContext = createContext<PlayerOverlayContextValue | null>(null);

export function usePlayerOverlay(): PlayerOverlayContextValue {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) {
    return {
      expandPlayer: () => {},
      collapsePlayer: () => {},
      minimizePlayer: () => {},
      hidePlayer: () => {},
      isPlayerVisible: false,
      playerReady: false,
    };
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
  const activeTrack = useActiveTrack();
  const [isVisible, setIsVisible] = useState(false);

  // ─── Expand (Open Player) ──────────────────────────────────────────────────
  const expandPlayer = useCallback(() => {
    console.log('[PlayerProvider] Expanding player overlay');
    setIsVisible(true);
  }, []);

  // ─── Collapse (state only) ─────────────────────────────────────────────────
  // CRITICAL: Does NOT clear currentTrack. FloatingPlayer needs track data
  // to display after dismiss. Track only clears when new track plays or queue ends.
  const collapsePlayer = useCallback(() => {
    console.log('[PlayerProvider] Collapsing player overlay (track preserved)');
    setIsVisible(false);
    // DO NOT clear currentTrack here — FloatingPlayer needs it
  }, []);

  // Backward compat alias
  const minimizePlayer = collapsePlayer;

  // ─── Hide (instant state reset) ────────────────────────────────────────────
  const hidePlayer = useCallback(() => {
    setIsVisible(false);
  }, []);

  // ─── Sync active track to store ────────────────────────────────────────────
  const setStoreTrack = usePlayerStore((s) => s.setPlaying);
  const lastSyncedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!playerReady || !activeTrack) {
      lastSyncedIdRef.current = null;
      return;
    }
    if (lastSyncedIdRef.current === activeTrack.id) return;

    const trackForStore = {
      id: activeTrack.id ?? "",
      title: activeTrack.title ?? "Unknown",
      artist: activeTrack.artist ?? "Unknown",
      thumbnail: typeof activeTrack.artwork === "string" ? activeTrack.artwork : "",
      url: activeTrack.url ?? "",
      videoId: (activeTrack as any).videoId,
      duration: activeTrack.duration,
    };

    const currentStoreTrack = usePlayerStore.getState().currentTrack;
    if (currentStoreTrack?.id !== trackForStore.id) {
      setStoreTrack(trackForStore);
      lastSyncedIdRef.current = trackForStore.id;
    }
  }, [activeTrack, playerReady, setStoreTrack]);

  // ─── Wire navigation to MusicPlayerContext ─────────────────────────────────
  // This allows MusicPlayerContext.playAudio() to trigger expandPlayer
  // without any router.push calls.
  const { setPlayerOverlayRefs } = useMusicPlayer();
  
  useEffect(() => {
    console.log('[PlayerProvider] Wiring expandPlayer/collapsePlayer to MusicPlayerContext');
    setPlayerOverlayRefs(expandPlayer, collapsePlayer);
  }, [setPlayerOverlayRefs, expandPlayer, collapsePlayer]);

  const overlayContextValue: PlayerOverlayContextValue = {
    expandPlayer,
    collapsePlayer,
    minimizePlayer,
    hidePlayer,
    isPlayerVisible: isVisible,
    playerReady,
  };

  return (
    <PlayerOverlayContext.Provider value={overlayContextValue}>
      <View style={styles.container}>{children}</View>
    </PlayerOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});