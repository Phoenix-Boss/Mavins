// components/player/playerProvider.tsx
/**
 * PlayerProvider — Manages the minimized floating player and navigation.
 *
 * ARCHITECTURE CHANGE (black screen fix):
 *
 * BEFORE: PlayerProvider rendered an absoluteFill overlay for the expanded
 * player (display:"flex"/"none"). This overlay sat inside AppShell's View
 * tree. When the (player) route was pushed as a transparentModal, the modal
 * rendered on a separate native layer above the overlay — so you saw through
 * the transparent modal to a black background, not the overlay content.
 *
 * NOW: The expanded player lives exclusively inside the (player) route
 * (PlayerScreen.tsx). PlayerProvider only manages:
 *   1. The minimized floating mini-player (shown when a track is playing
 *      and the (player) route is NOT active)
 *   2. expandPlayer() — navigates to router.push("/(player)")
 *   3. minimizePlayer() / hidePlayer() — navigates back / hides mini-player
 *
 * NOTIFICATION / LOCK SCREEN TAP:
 * _layout.tsx already intercepts the deep link and calls expandPlayer()
 * (which now does router.push). Works identically for in-app and cold-start.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import {
  View,
  StyleSheet,
  BackHandler,
  Text,
  TouchableOpacity,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TrackPlayer, {
  useActiveTrack,
  useProgress,
} from "react-native-track-player";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { usePlayerStore } from "@/store/player";
import { triggerHaptic } from "@/helpers/haptics";

// Convenience type alias — avoids importing the non-exported PlayerStore type
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
// MinimizedPlayer
// Only rendered when playerReady=true and a track is active.
// ─────────────────────────────────────────────────────────────────────────────

function MinimizedPlayer({ onExpand }: { onExpand: () => void }) {
  const insets   = useSafeAreaInsets();
  const progress = useProgress();

  const currentTrack      = usePlayerStore((s: PS) => s.currentTrack);
  const storeIsPlaying    = usePlayerStore((s: PS) => s.isPlaying);
  const setStoreIsPlaying = usePlayerStore((s: PS) => s.setIsPlaying);

  const { togglePlayPause, isPlaying: contextIsPlaying } = useMusicPlayer();

  const dumbModeRef    = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dumbModeRef.current && storeIsPlaying !== contextIsPlaying) {
      setStoreIsPlaying(contextIsPlaying);
    }
  }, [contextIsPlaying, storeIsPlaying, setStoreIsPlaying]);

  useEffect(() => () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, []);

  if (!currentTrack) return null;

  const progressPercent =
    progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0;

  const handlePlayPause = (e: any) => {
    e.stopPropagation();
    triggerHaptic("light");
    dumbModeRef.current = true;
    setStoreIsPlaying(!storeIsPlaying);
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    requestAnimationFrame(() => { togglePlayPause(); });
    syncTimeoutRef.current = setTimeout(() => {
      dumbModeRef.current = false;
      setStoreIsPlaying(contextIsPlaying);
    }, 300);
  };

  const handleNext = async (e: any) => {
    e.stopPropagation();
    try { await TrackPlayer.skipToNext(); } catch { /* no next track */ }
  };

  return (
    <View style={[miniStyles.container, { bottom: insets.bottom + verticalScale(60) }]}>
      <TouchableOpacity style={miniStyles.bar} onPress={onExpand} activeOpacity={0.95}>
        <View style={miniStyles.artworkContainer}>
          {currentTrack.thumbnail ? (
            <Image
              source={{ uri: currentTrack.thumbnail }}
              style={miniStyles.artwork}
              contentFit="cover"
            />
          ) : (
            <View style={[miniStyles.artwork, miniStyles.artworkPlaceholder]}>
              <Ionicons name="musical-notes" size={20} color="#888" />
            </View>
          )}
        </View>

        <View style={miniStyles.textContainer}>
          <Text style={miniStyles.title} numberOfLines={1}>{currentTrack.title}</Text>
          <Text style={miniStyles.artist} numberOfLines={1}>{currentTrack.artist}</Text>
        </View>

        <View style={miniStyles.controls}>
          <TouchableOpacity onPress={handlePlayPause} style={miniStyles.playButton} activeOpacity={0.7}>
            <Ionicons
              name={storeIsPlaying ? "pause" : "play"}
              size={moderateScale(22)}
              color="#fff"
            />
          </TouchableOpacity>
          <TouchableOpacity style={miniStyles.skipButton} onPress={handleNext} activeOpacity={0.7}>
            <Ionicons name="play-skip-forward" size={moderateScale(20)} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={miniStyles.progressBar}>
          <View style={[miniStyles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerProviderInner
// Only mounted when playerReady=true — safe to call TrackPlayer hooks here.
// ─────────────────────────────────────────────────────────────────────────────

function PlayerProviderInner({
  children,
  expandPlayer,
  playerReady,
}: {
  children: React.ReactNode;
  expandPlayer: () => void;
  playerReady: boolean;
}) {
  const pathname      = usePathname();
  const setStoreTrack = usePlayerStore((s: PS) => s.setPlaying);

  const activeTrack = useActiveTrack();

  // Sync active track → playerStore
  useEffect(() => {
    if (!activeTrack) return;
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
  }, [activeTrack, setStoreTrack]);

  const isPlayerScreen = pathname?.includes("/player");
  const currentTrack   = usePlayerStore((s: PS) => s.currentTrack);
  const showMinimized  = !isPlayerScreen && !!currentTrack && playerReady;

  return (
    <>
      <View style={styles.content}>{children}</View>
      {showMinimized && <MinimizedPlayer onExpand={expandPlayer} />}
    </>
  );
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

  // expandPlayer navigates to the (player) route — works in-app AND from
  // a notification/lock-screen tap deep link.
  const expandPlayer = useCallback(() => {
    router.push("/(player)");
  }, [router]);

  const minimizePlayer = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const hidePlayer = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // Hardware back button: if (player) is on the stack, go back
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => false);
    return () => sub.remove();
  }, []);

  const overlayContextValue: PlayerOverlayContextValue = {
    expandPlayer,
    minimizePlayer,
    hidePlayer,
  };

  return (
    <PlayerOverlayContext.Provider value={overlayContextValue}>
      <View style={styles.container}>
        {playerReady ? (
          <PlayerProviderInner
            expandPlayer={expandPlayer}
            playerReady={playerReady}
          >
            {children}
          </PlayerProviderInner>
        ) : (
          <View style={styles.content}>{children}</View>
        )}
      </View>
    </PlayerOverlayContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { flex: 1 },
});

const miniStyles = StyleSheet.create({
  container: {
    position: "absolute",
    left: scale(12),
    right: scale(12),
    zIndex: 999,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(10),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  artworkContainer: {
    width: scale(44),
    height: scale(44),
    borderRadius: 8,
    overflow: "hidden",
    marginRight: scale(12),
  },
  artwork: { width: "100%", height: "100%" },
  artworkPlaceholder: {
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: { flex: 1, justifyContent: "center" },
  title:  { color: "#fff", fontSize: moderateScale(13), fontWeight: "600" },
  artist: { color: "rgba(255,255,255,0.6)", fontSize: moderateScale(11), marginTop: 2 },
  controls: { flexDirection: "row", alignItems: "center", gap: scale(8) },
  playButton: {
    width: scale(36),
    height: scale(36),
    borderRadius: 18,
    backgroundColor: "rgba(212,175,55,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  skipButton: { padding: scale(4) },
  progressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#D4AF37" },
});