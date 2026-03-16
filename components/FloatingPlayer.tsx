/**
 * FloatingPlayer
 *
 * Reads directly from react-native-track-player via useActiveTrack()
 * and MusicPlayerContext.togglePlayPause() — no props required.
 *
 * Visibility: hidden when no track is loaded (activeTrack is undefined).
 * Tap anywhere on the card → opens /(player) full screen.
 * Skip button → TrackPlayer.skipToNext().
 * Play/Pause button → MusicPlayerContext.togglePlayPause().
 *
 * SAFETY: This component only mounts after TrackPlayer.setupPlayer() has
 * resolved (enforced by the playerReady + navReady gate in _layout.tsx),
 * so all RNTP hooks are guaranteed to find an initialised player.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { triggerHaptic } from "@/helpers/haptics";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useActiveTrack, usePlaybackState, State } from "react-native-track-player";
import TrackPlayer from "react-native-track-player";
import { useMusicPlayer } from "@/components/MusicPlayerContext";

const { width } = Dimensions.get("window");

// ─── Props ────────────────────────────────────────────────────────────────────

interface FloatingPlayerProps {
  tabHeight?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({ tabHeight = 56 }) => {
  const router        = useRouter();
  const navigation    = useNavigation();
  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();

  /**
   * Normalise the playback state across RNTP v3 (enum) and v4 (object).
   * Falls back to State.None if the value is not yet available — this is
   * purely defensive; the component should never mount before setupPlayer().
   */
  const currentState: State = (() => {
    if (!playbackState) return State.None;
    if (typeof playbackState === "object" && "state" in playbackState) {
      return (playbackState as { state: State }).state ?? State.None;
    }
    return playbackState as unknown as State;
  })();

  const isPlaying =
    currentState === State.Playing ||
    currentState === State.Buffering;

  const floatingPlayerBottom = tabHeight + 4;

  const animatedStyle = useAnimatedStyle(
    () => ({ bottom: withTiming(floatingPlayerBottom, { duration: 300 }) }),
    [floatingPlayerBottom]
  );

  // ── Hide when nothing is loaded ──────────────────────────────────────────
  if (!activeTrack) return null;

  // ── Handlers ────────────────────────────────────────────────────────────

  const openPlayerScreen = () => {
    triggerHaptic();
    /**
     * Use push so the user can go back from the player screen.
     * If the navigator has no history yet (should not happen given the
     * navReady gate, but defensive), replace to avoid a GO_BACK crash.
     */
    if (navigation.canGoBack()) {
      router.push("/(player)");
    } else {
      router.replace("/(player)");
    }
  };

  const handleTogglePlay = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    await togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // End of queue — silently ignore
    }
  };

  const artworkSource =
    activeTrack.artwork
      ? typeof activeTrack.artwork === "number"
        ? activeTrack.artwork
        : { uri: activeTrack.artwork as string }
      : null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Animated.View
      style={[styles.floatingWrapper, { left: 8, right: 8 }, animatedStyle]}
    >
      <View style={styles.glassBaseLayer} />

      <View style={styles.floatingCard}>
        <TouchableOpacity
          style={styles.contentContainer}
          onPress={openPlayerScreen}
          activeOpacity={0.9}
        >
          {/* Artwork */}
          <View style={styles.albumArtContainer}>
            {artworkSource ? (
              <Image source={artworkSource} style={styles.albumArt} />
            ) : (
              <View style={styles.albumArtPlaceholder}>
                <Ionicons
                  name="musical-notes"
                  size={20}
                  color="rgba(255,255,255,0.7)"
                />
              </View>
            )}
          </View>

          {/* Track info */}
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {activeTrack.title || "Unknown Title"}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {activeTrack.artist || "Unknown Artist"}
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={handleSkipNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="play-skip-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, styles.playButton]}
              onPress={handleTogglePlay}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isLoading}
            >
              <Ionicons
                name={
                  isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"
                }
                size={22}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  floatingWrapper: {
    position: "absolute",
    zIndex: 999,
  },
  floatingCard: {
    height: 64,
    borderRadius: 16,
    backgroundColor: "transparent",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  glassBaseLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Platform.select({
      ios:     "rgba(20,20,25,0.85)",
      android: "rgba(18,18,23,0.95)",
      default: "rgba(18,18,23,0.9)",
    }),
    borderRadius: 16,
  },
  contentContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    zIndex: 1,
  },
  albumArtContainer: {
    marginRight: 12,
    zIndex: 1,
  },
  albumArt: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  albumArtPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  trackInfo: {
    flex: 1,
    justifyContent: "center",
    marginRight: 10,
    zIndex: 1,
  },
  trackTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  trackArtist: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    letterSpacing: 0.2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    zIndex: 1,
    gap: 8,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  playButton: {
    backgroundColor: "rgba(139,115,85,0.8)",
    borderColor: "rgba(255,255,255,0.3)",
  },
});

export default FloatingPlayer;