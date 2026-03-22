// components/player/PlayerProvider.tsx
/**
 * PlayerProvider.tsx — Pre-mounted Player Screen
 *
 * Exports:
 *   PlayerProvider    — wraps the entire app; mounts the player UI
 *   usePlayerOverlay  — hook: { expandPlayer, minimizePlayer, hidePlayer }
 *
 * Uses playerStore.setIsPlaying() for INSTANT feedback in minimized player.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
  BackHandler,
  Text,
  TouchableOpacity,
} from "react-native";
import { usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TrackPlayer, {
  useActiveTrack,
} from "react-native-track-player";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useProgress } from "react-native-track-player";

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { usePlayerStore, type PlayerStore } from "@/store/player";
import { triggerHaptic } from "@/helpers/haptics";

import PlayerContent from "./playerContent";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PlayerDisplayState = "hidden" | "minimized" | "expanded";

interface PlayerOverlayContextValue {
  expandPlayer: () => void;
  minimizePlayer: () => void;
  hidePlayer: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerOverlayContext
// ─────────────────────────────────────────────────────────────────────────────

const PlayerOverlayContext = createContext<PlayerOverlayContextValue | null>(null);

/**
 * usePlayerOverlay
 *
 * Provides { expandPlayer, minimizePlayer, hidePlayer }.
 * Must be called inside <PlayerProvider>.
 *
 * Returns a no-op fallback instead of throwing so that components that call
 * this during hot-reload or before the provider mounts don't hard-crash the app.
 */
export function usePlayerOverlay(): PlayerOverlayContextValue {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) {
    // Fallback: no-ops so the app degrades gracefully rather than crashing.
    // This happens only if something calls the hook outside <PlayerProvider>.
    console.warn(
      "[usePlayerOverlay] called outside <PlayerProvider> — actions are no-ops"
    );
    return {
      expandPlayer:   () => {},
      minimizePlayer: () => {},
      hidePlayer:     () => {},
    };
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimized Player Bar — uses playerStore for instant feedback
// ─────────────────────────────────────────────────────────────────────────────

function MinimizedPlayer({ onExpand }: { onExpand: () => void }) {
  const insets   = useSafeAreaInsets();
  const progress = useProgress();

  const currentTrack    = usePlayerStore((s: PlayerStore) => s.currentTrack);
  const { togglePlayPause, isPlaying: contextIsPlaying } = useMusicPlayer();

  const storeIsPlaying    = usePlayerStore((state) => state.isPlaying);
  const setStoreIsPlaying = usePlayerStore((state) => state.setIsPlaying);

  const dumbModeRef    = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync store ↔ context when not in "dumb mode"
  useEffect(() => {
    if (!dumbModeRef.current && storeIsPlaying !== contextIsPlaying) {
      setStoreIsPlaying(contextIsPlaying);
    }
  }, [contextIsPlaying, storeIsPlaying, setStoreIsPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  if (!currentTrack) return null;

  const progressPercent =
    progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0;

  const handlePlayPause = (e: any) => {
    e.stopPropagation();
    triggerHaptic("light");

    // Optimistic / "dumb mode": flip the store immediately so the icon
    // responds in the same frame, then let the real toggle catch up.
    dumbModeRef.current = true;
    setStoreIsPlaying(!storeIsPlaying);

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    requestAnimationFrame(() => {
      togglePlayPause();
    });

    // Exit dumb mode after 300 ms and re-sync to ground truth
    syncTimeoutRef.current = setTimeout(() => {
      dumbModeRef.current = false;
      setStoreIsPlaying(contextIsPlaying);
    }, 300);
  };

  const handleNext = async (e: any) => {
    e.stopPropagation();
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // No next track — ignore
    }
  };

  return (
    <View style={[miniStyles.container, { bottom: insets.bottom + verticalScale(60) }]}>
      <TouchableOpacity style={miniStyles.bar} onPress={onExpand} activeOpacity={0.95}>
        {/* Artwork */}
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

        {/* Text */}
        <View style={miniStyles.textContainer}>
          <Text style={miniStyles.title} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={miniStyles.artist} numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </View>

        {/* Controls */}
        <View style={miniStyles.controls}>
          <TouchableOpacity
            onPress={handlePlayPause}
            style={miniStyles.playButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={storeIsPlaying ? "pause" : "play"}
              size={moderateScale(22)}
              color="#fff"
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={miniStyles.skipButton}
            onPress={handleNext}
            activeOpacity={0.7}
          >
            <Ionicons name="play-skip-forward" size={moderateScale(20)} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={miniStyles.progressBar}>
          <View style={[miniStyles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

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
  artwork: {
    width: "100%",
    height: "100%",
  },
  artworkPlaceholder: {
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontSize: moderateScale(13),
    fontWeight: "600",
  },
  artist: {
    color: "rgba(255,255,255,0.6)",
    fontSize: moderateScale(11),
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
  },
  playButton: {
    width: scale(36),
    height: scale(36),
    borderRadius: 18,
    backgroundColor: "rgba(212,175,55,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  skipButton: {
    padding: scale(4),
  },
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
  progressFill: {
    height: "100%",
    backgroundColor: "#D4AF37",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PlayerProvider
// ─────────────────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const pathname     = usePathname();
  const [displayState, setDisplayState] = useState<PlayerDisplayState>("hidden");

  const setStoreTrack = usePlayerStore((s: PlayerStore) => s.setPlaying);
  const activeTrack   = useActiveTrack();

  // ── Sync active track → Zustand store ─────────────────────────────────────
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
    const currentStoreTrack = usePlayerStore.getState().currentTrack;
    if (currentStoreTrack?.id !== trackForStore.id) {
      setStoreTrack(trackForStore);
    }
  }, [activeTrack, setStoreTrack]);

  // ── Auto-show minimized bar when a track first loads ──────────────────────
  useEffect(() => {
    if (activeTrack && displayState === "hidden") {
      setDisplayState("minimized");
    }
  }, [activeTrack, displayState]);

  // ── Hardware back button: expanded → minimized ────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (displayState === "expanded") {
        setDisplayState("minimized");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [displayState]);

  // ── Slide animation ────────────────────────────────────────────────────────
  const slideAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.spring(slideAnim, {
      toValue:         displayState === "expanded" ? 1 : 0,
      damping:         displayState === "expanded" ? 22 : 25,
      stiffness:       displayState === "expanded" ? 160 : 200,
      useNativeDriver: true,
    }).start();
  }, [displayState, slideAnim]);

  const slideTransform = slideAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [SCREEN_HEIGHT, 0],
  });

  // ── Context actions ────────────────────────────────────────────────────────
  const expandPlayer   = useCallback(() => setDisplayState("expanded"),   []);
  const minimizePlayer = useCallback(() => setDisplayState("minimized"),  []);
  const hidePlayer     = useCallback(() => setDisplayState("hidden"),     []);

  const overlayContextValue: PlayerOverlayContextValue = {
    expandPlayer,
    minimizePlayer,
    hidePlayer,
  };

  // ── Render guards ──────────────────────────────────────────────────────────
  const isPlayerScreen = pathname?.includes("/player");
  const currentTrack   = usePlayerStore((s: PlayerStore) => s.currentTrack);
  const showMinimized  =
    displayState === "minimized" && !isPlayerScreen && !!currentTrack;

  return (
    // Expose expandPlayer / minimizePlayer / hidePlayer to the entire tree
    <PlayerOverlayContext.Provider value={overlayContextValue}>
      <GestureHandlerRootView style={styles.container}>

        {/* Main app content */}
        <View style={styles.content}>{children}</View>

        {/* Full-screen player overlay — always mounted, shown/hidden via opacity */}
        <View
          style={[
            styles.playerOverlay,
            {
              opacity:       displayState === "expanded" ? 1 : 0,
              pointerEvents: displayState === "expanded" ? "auto" : "none",
              zIndex:        displayState === "expanded" ? 1000 : -1,
            },
          ]}
        >
          <StatusBar style="light" />
          <RNAnimated.View
            style={[
              styles.playerContainer,
              { transform: [{ translateY: slideTransform }] },
            ]}
          >
            {/* PlayerContent is ALWAYS mounted — no skeleton, always ready */}
            <PlayerContent
              onMinimize={minimizePlayer}
              onClose={hidePlayer}
              isExpanded={displayState === "expanded"}
            />
          </RNAnimated.View>
        </View>

        {/* Minimized bar */}
        {showMinimized && <MinimizedPlayer onExpand={expandPlayer} />}

      </GestureHandlerRootView>
    </PlayerOverlayContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  playerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  playerContainer: {
    flex: 1,
  },
});