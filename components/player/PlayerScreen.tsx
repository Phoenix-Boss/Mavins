/**
 * PlayerScreen — Bottom Sheet Modal
 *
 * Professional RNTP initialization pattern:
 *
 *   PlayerScreen (exported default)
 *   └── usePlayerReady()          — probes TrackPlayer; returns {ready, error}
 *       ├── not ready → <PlayerSkeleton />   (safe, no RNTP hooks)
 *       └── ready     → <PlayerContent />    (all RNTP hooks live here)
 *
 * This mirrors how Spotify, Apple Music etc. handle it: the shell mounts
 * immediately, RNTP hooks only run once the native player is confirmed live.
 * The skeleton is invisible in practice because the player screen only opens
 * after the user taps something — by which point setupPlayer() is long done.
 * The guard exists purely to survive edge cases (fast-refresh, cold start race).
 */

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from "@expo/vector-icons";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import {
  useActiveTrack,
  useProgress,
  usePlaybackState,
  State,
  RepeatMode,
} from "react-native-track-player";
import TrackPlayer from "react-native-track-player";
import { useRouter } from "expo-router";
import { moderateScale, scale, verticalScale } from "react-native-size-matters/extend";

import { MovingText } from "@/components/MovingText";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { useTrackPlayerRepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
import { useTrackPlayerFavorite } from "@/hooks/useTrackPlayerFavorite";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─────────────────────────────────────────────────────────────────────────────
// usePlayerReady
//
// Probes TrackPlayer to confirm setupPlayer() has completed.
// Uses getActiveTrack() as the probe — it throws synchronously if the native
// player isn't initialized, and resolves immediately if it is.
//
// Returns { ready: boolean } — components that call RNTP hooks should render
// only when ready === true.
// ─────────────────────────────────────────────────────────────────────────────

function usePlayerReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        await TrackPlayer.getActiveTrack(); // resolves if initialized
        if (!cancelled) setReady(true);
      } catch {
        // Not ready yet — retry on next tick until it resolves.
        // In practice this only loops 0-1 times; the player is almost always
        // ready before the user can open the player screen.
        const id = setTimeout(probe, 50);
        return () => clearTimeout(id);
      }
    }

    probe();
    return () => { cancelled = true; };
  }, []);

  return ready;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const getImageSource = (artwork: string | number | undefined) => {
  if (!artwork) return require("@/assets/images/icon.png");
  if (typeof artwork === "number") return artwork;
  return { uri: artwork as string };
};

// ─────────────────────────────────────────────────────────────────────────────
// PlayerSkeleton
//
// Shown for the brief moment before playerReady === true.
// Matches the visual shape of PlayerContent so there's no layout shift.
// In production this is essentially never seen — it's a safety net only.
// ─────────────────────────────────────────────────────────────────────────────

function PlayerSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient style={{ flex: 1 }} colors={["#1a0f05", "#0b0b0b", "#050505"]}>
      <View style={[skeletonStyles.container, { paddingTop: insets.top + 90 }]}>
        {/* Drag handle */}
        <View style={skeletonStyles.dragHandleWrapper}>
          <View style={skeletonStyles.dragHandle} />
        </View>
        {/* Artwork placeholder */}
        <View style={skeletonStyles.artworkPlaceholder} />
        {/* Spinner — centered in the artwork area */}
        <ActivityIndicator
          size="large"
          color="#D4AF37"
          style={skeletonStyles.spinner}
        />
      </View>
    </LinearGradient>
  );
}

const skeletonStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: screenPadding.horizontal,
  },
  dragHandleWrapper: {
    width: "100%",
    alignItems: "center",
    marginBottom: 16,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  artworkPlaceholder: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_WIDTH * 0.85,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  spinner: {
    position: "absolute",
    top: SCREEN_WIDTH * 0.85 / 2 + 90 + 32, // centered in artwork placeholder
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PlayerContent
//
// ALL react-native-track-player hooks live here and nowhere else.
// This component only mounts when usePlayerReady() === true, which means
// setupPlayer() has already resolved — hooks are always safe.
// ─────────────────────────────────────────────────────────────────────────────

function PlayerContent() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  // ── RNTP hooks — safe because PlayerContent only mounts after playerReady ──
  const activeTrack   = useActiveTrack();
  const progress      = useProgress(250);
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();
  const { repeatMode, changeRepeatMode } = useTrackPlayerRepeatMode();
  const { isFavorite, toggleFavoriteFunc } = useTrackPlayerFavorite();

  const isPlaying =
    playbackState.state === State.Playing ||
    playbackState.state === State.Buffering;

  // ── Shuffle (local state — not yet in RNTP) ─────────────────────────────────
  const [shuffleMode, setShuffleMode] = useState<"off" | "list" | "random" | "related">("off");

  // ── Gradient from artwork ────────────────────────────────────────────────────
  const artworkForColors =
    typeof activeTrack?.artwork === "string" ? activeTrack.artwork : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo(() => {
    if (imageColors?.dominant) return [imageColors.dominant, "#000", "#000"];
    return ["#1a0f05", "#0b0b0b", "#050505"];
  }, [imageColors]);

  // ── Progress ─────────────────────────────────────────────────────────────────
  const progressPercent =
    progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0;

  // ── Dismiss gesture (drag down to close) ─────────────────────────────────────
  const translateY = useSharedValue(0);
  const DISMISS_THRESHOLD = SCREEN_HEIGHT * 0.25;

  const dismiss = useCallback(() => {
    triggerHaptic();
    if (router.canGoBack()) {
      router.back();
    } else {
      // No history (e.g. deep link, fast-refresh landed on player screen directly)
      // Fall back to the app's home tab so the user is never stranded.
      router.replace("/(tabs)");
    }
  }, [router]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withSpring(0, { damping: 20 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ── Playback controls ─────────────────────────────────────────────────────────
  const handleSkipBack = async () => {
    triggerHaptic();
    try { await TrackPlayer.skipToPrevious(); } catch {}
  };

  const handleSkipNext = async () => {
    triggerHaptic();
    try { await TrackPlayer.skipToNext(); } catch {}
  };

  const handleSeek = async (percent: number) => {
    if (progress.duration > 0) {
      await TrackPlayer.seekTo((percent / 100) * progress.duration);
    }
  };

  const toggleShuffle = () => {
    triggerHaptic();
    setShuffleMode((prev) =>
      prev === "off" ? "list" : prev === "list" ? "random" : prev === "random" ? "related" : "off"
    );
  };

  const toggleRepeat = () => {
    triggerHaptic();
    if (repeatMode === RepeatMode.Off)        changeRepeatMode(RepeatMode.Queue);
    else if (repeatMode === RepeatMode.Queue) changeRepeatMode(RepeatMode.Track);
    else                                      changeRepeatMode(RepeatMode.Off);
  };

  const getDotCount = () => {
    switch (shuffleMode) {
      case "list":    return 1;
      case "random":  return 2;
      case "related": return 3;
      default:        return 0;
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────────
  const handleEqualizer   = () => router.push("/(modals)/equalizer");
  const handleCast        = () => router.push("/(player)/cast-devices");
  const handleMoreOptions = () => router.push("/(player)/track-options");
  const handleComments    = () => router.push("/(modals)/comments");
  const handlePlaylist    = () => router.push("/(modals)/add-to-playlist");
  const handleSleepTimer  = () => router.push("/(player)/sleep-timer");
  const handleSeeAll      = () => router.push("/(modals)/queue");
  const handleLyrics      = () => router.push("/(modals)/lyrics");
  const handleRelated     = () => router.push("/(modals)/related");

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[{ flex: 1 }, animatedStyle]}>
        <LinearGradient style={{ flex: 1 }} colors={gradientColors}>

          {/* TOP BAR */}
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <View style={styles.dragHandleWrapper}>
              <View style={styles.dragHandle} />
            </View>

            <View style={styles.topBarContent}>
              <View style={styles.segmentSwitch}>
                <Text style={styles.segmentActive}>Song</Text>
                <Text style={styles.segmentInactive}>Video</Text>
              </View>

              <View style={styles.topBarRight}>
                <TouchableOpacity onPress={handleEqualizer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="equalizer" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCast} activeOpacity={0.7}>
                  <MaterialIcons name="cast" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleMoreOptions} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* MAIN CONTENT */}
          <View
            style={[
              styles.contentContainer,
              { paddingTop: insets.top + 90, paddingBottom: insets.bottom + 8 },
            ]}
          >
            {/* ARTWORK */}
            <View style={styles.artworkContainer}>
              <Image
                source={getImageSource(activeTrack?.artwork)}
                style={styles.artworkImage}
                contentFit="cover"
                transition={300}
              />
            </View>

            {/* SONG INFO */}
            <View style={styles.infoContainer}>
              <MovingText
                text={activeTrack?.title ?? "—"}
                animationThreshold={20}
                style={styles.title}
              />
              <Text style={styles.artist}>
                {activeTrack?.artist ?? "—"}
              </Text>
            </View>

            {/* ACTION ROW */}
            <View style={styles.actionRow}>
              <View style={styles.leftActions}>
                <View style={styles.actionContainer}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => { triggerHaptic(); toggleFavoriteFunc(); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isFavorite ? "thumbs-up" : "thumbs-up-outline"}
                      size={16}
                      color={isFavorite ? "#D4AF37" : "#fff"}
                    />
                  </TouchableOpacity>
                  <View style={styles.actionDivider} />
                  <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                    <Ionicons name="thumbs-down-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.actionContainer}
                  onPress={handleComments}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="comment-text-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>

              <View style={styles.extraActions}>
                <TouchableOpacity style={styles.extraIcon} onPress={handlePlaylist} activeOpacity={0.7}>
                  <MaterialIcons name="playlist-add" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.extraIcon} onPress={handleSleepTimer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="weather-night" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {/* PROGRESS BAR */}
            <View style={styles.progressWrapper}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={(e) => {
                  const touchX = e.nativeEvent.locationX;
                  const barWidth = SCREEN_WIDTH - screenPadding.horizontal * 2;
                  handleSeek((touchX / barWidth) * 100);
                }}
              >
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                  <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
                </View>
              </TouchableOpacity>

              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
                <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
              </View>
            </View>

            {/* PLAYBACK CONTROLS */}
            <View style={styles.controls}>
              {/* Shuffle */}
              <TouchableOpacity onPress={toggleShuffle} style={styles.shuffleWrapper} activeOpacity={0.7}>
                <Feather
                  name="shuffle"
                  size={20}
                  color={shuffleMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"}
                />
                {shuffleMode !== "off" && (
                  <View style={styles.dotContainer}>
                    {Array.from({ length: getDotCount() }).map((_, i) => (
                      <View key={i} style={styles.dot} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>

              {/* Skip back */}
              <TouchableOpacity onPress={handleSkipBack} activeOpacity={0.7}>
                <Ionicons name="play-skip-back" size={32} color="#fff" />
              </TouchableOpacity>

              {/* Play / Pause */}
              <TouchableOpacity
                onPress={() => { triggerHaptic(); togglePlayPause(); }}
                style={styles.bigPlay}
                activeOpacity={0.85}
                disabled={isLoading}
              >
                <Ionicons
                  name={isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
                  size={32}
                  color="#000"
                />
              </TouchableOpacity>

              {/* Skip next */}
              <TouchableOpacity onPress={handleSkipNext} activeOpacity={0.7}>
                <Ionicons name="play-skip-forward" size={32} color="#fff" />
              </TouchableOpacity>

              {/* Repeat */}
              <TouchableOpacity onPress={toggleRepeat} style={styles.repeatWrapper} activeOpacity={0.7}>
                <MaterialCommunityIcons
                  name={repeatMode === RepeatMode.Track ? "repeat-once" : "repeat"}
                  size={22}
                  color={repeatMode === RepeatMode.Off ? "rgba(255,255,255,0.4)" : "#fff"}
                />
                {repeatMode === RepeatMode.Track && (
                  <View style={styles.repeatOneBadge}>
                    <Text style={styles.repeatOneText}>1</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* BOTTOM TABS */}
            <View style={styles.bottomTabs}>
              <TouchableOpacity onPress={handleSeeAll} activeOpacity={0.7}>
                <Text style={styles.bottomTabActive}>UP NEXT</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLyrics} activeOpacity={0.7}>
                <Text style={styles.bottomTab}>LYRICS</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRelated} activeOpacity={0.7}>
                <Text style={styles.bottomTab}>RELATED</Text>
              </TouchableOpacity>
            </View>

          </View>
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerScreen — exported default
//
// Shell that owns GestureHandlerRootView and StatusBar (safe, no RNTP hooks).
// Delegates to PlayerSkeleton or PlayerContent based on player readiness.
// ─────────────────────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const playerReady = usePlayerReady();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      {playerReady ? <PlayerContent /> : <PlayerSkeleton />}
    </GestureHandlerRootView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles (PlayerContent)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: "center",
  },
  dragHandleWrapper: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  topBarContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: screenPadding.horizontal,
  },
  segmentSwitch: {
    flexDirection: "row",
    gap: scale(20),
  },
  segmentActive: {
    color: "#fff",
    fontWeight: "600",
  },
  segmentInactive: {
    color: "rgba(255,255,255,0.5)",
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(15),
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: screenPadding.horizontal,
  },
  artworkContainer: {
    alignItems: "center",
  },
  artworkImage: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_WIDTH * 0.85,
    borderRadius: 16,
  },
  infoContainer: {
    marginTop: verticalScale(24),
    alignItems: "center",
  },
  title: {
    color: "#fff",
    fontSize: moderateScale(20),
    fontWeight: "700",
    textAlign: "center",
  },
  artist: {
    color: "rgba(255,255,255,0.7)",
    fontSize: moderateScale(15),
    marginTop: 4,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: verticalScale(20),
    paddingHorizontal: scale(5),
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
  },
  actionContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 24,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    alignItems: "center",
    gap: scale(2),
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
  },
  actionDivider: {
    width: 1,
    height: verticalScale(14),
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: scale(8),
  },
  extraActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(18),
  },
  extraIcon: {
    padding: scale(4),
  },
  progressWrapper: {
    marginTop: verticalScale(22),
  },
  progressBar: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    overflow: "visible",
    position: "relative",
  },
  progressFill: {
    height: 4,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#fff",
    marginLeft: -6,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: verticalScale(6),
  },
  timeText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: moderateScale(12),
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: verticalScale(28),
    paddingHorizontal: scale(10),
  },
  shuffleWrapper: {
    alignItems: "center",
    gap: verticalScale(4),
  },
  dotContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#fff",
    marginHorizontal: 1.5,
  },
  bigPlay: {
    width: scale(65),
    height: scale(65),
    borderRadius: 32.5,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  repeatWrapper: {
    alignItems: "center",
    position: "relative",
  },
  repeatOneBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    backgroundColor: "#8B7355",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#A0826D",
  },
  repeatOneText: {
    color: "#fff",
    fontSize: moderateScale(9),
    fontWeight: "700",
    lineHeight: moderateScale(12),
  },
  bottomTabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: verticalScale(35),
    paddingBottom: verticalScale(5),
  },
  bottomTabActive: {
    color: "#fff",
    fontSize: moderateScale(13),
    fontWeight: "600",
  },
  bottomTab: {
    color: "rgba(255,255,255,0.5)",
    fontSize: moderateScale(13),
  },
});