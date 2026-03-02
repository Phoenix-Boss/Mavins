// app/(player)/index.tsx

import { MovingText } from "@/components/MovingText";
import VerticalSwipeGesture from "@/components/navigation/VerticalGesture";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { Image } from "expo-image";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Text,
  TouchableOpacity,
  View,
  StatusBar,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useMemo, useState } from "react";
import { z } from "zod";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const PlayerTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  artwork: z.union([z.string(), z.number()]).optional(),
});

type PlayerTrack = z.infer<typeof PlayerTrackSchema>;

const getImageSource = (artwork: string | number | undefined) => {
  if (!artwork) return require("@/assets/images/icon.png");
  if (typeof artwork === "number") return artwork;
  return { uri: artwork };
};

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ✅ Poweramp-style 4-mode shuffle
  const [shuffleMode, setShuffleMode] = useState<
    "off" | "list" | "random" | "related"
  >("off");

  // ✅ Repeat toggle: off → all → one → off
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");

  const currentTrack: PlayerTrack = useMemo(
    () => ({
      id: "1",
      title: "Planet Caravan",
      artist: "Black Sabbath",
      artwork: require("@/assets/images/mavins.png"),
    }),
    []
  );

  const validatedTrack = PlayerTrackSchema.parse(currentTrack);

  const artworkForColors =
    typeof validatedTrack.artwork === "string"
      ? validatedTrack.artwork
      : null;

  const { imageColors } = useImageColors(artworkForColors);

  // ✅ ORIGINAL GRADIENT LOGIC RESTORED
  const gradientColors = useMemo(() => {
    if (imageColors?.dominant) {
      return [imageColors.dominant, "#000", "#000"];
    }
    return ["#1a0f05", "#0b0b0b", "#050505"];
  }, [imageColors]);

  // ✅ Shuffle cycle: off → list → random → related → off
  const toggleShuffle = () => {
    setShuffleMode((prev) => {
      switch (prev) {
        case "off":
          return "list";
        case "list":
          return "random";
        case "random":
          return "related";
        default:
          return "off";
      }
    });
  };

  // ✅ Dot count for shuffle indicator
  const getDotCount = () => {
    switch (shuffleMode) {
      case "list":
        return 1;
      case "random":
        return 2;
      case "related":
        return 3;
      default:
        return 0;
    }
  };

  // ✅ Repeat cycle: off → all → one → off
  const toggleRepeat = () => {
    setRepeatMode((prev) =>
      prev === "off" ? "all" : prev === "all" ? "one" : "off"
    );
  };

  // ✅ Navigation handlers for icons
  const handleEqualizer = () => router.push("/(modals)/equalizer");
  const handleCast = () => router.push("/(player)/cast-devices");
  const handleMoreOptions = () => router.push("/(player)/track-options");
  const handleComments = () => router.push("/(player)/comments");
  const handlePlaylist = () => router.push("/(player)/add-to-playlist");
  const handleSleepTimer = () => router.push("/(player)/sleep-timer");
  const handleSeeAll = () => router.push("/(player)/queue");
  const handleLyrics = () => router.push("/(player)/lyrics");
  const handleRelated = () => router.push("/(player)/related");

  const handleClose = () => router.replace("/(tabs)");

  return (
    <>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <VerticalSwipeGesture onSwipeDown={handleClose}>
        <LinearGradient style={{ flex: 1 }} colors={gradientColors}>
          <View style={{ flex: 1 }}>

            {/* TOP BAR */}
            <View style={[styles.topBar, { top: insets.top + 8 }]}>
              <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
                <Ionicons name="chevron-down" size={26} color="#fff" />
              </TouchableOpacity>

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

            <View
              style={[
                styles.contentContainer,
                {
                  paddingTop: insets.top + 90,
                  paddingBottom: insets.bottom + 8,
                },
              ]}
            >
              {/* ARTWORK - ✅ INCREASED SIZE */}
              <View style={styles.artworkContainer}>
                <Image
                  source={getImageSource(validatedTrack.artwork)}
                  style={styles.artworkImage}
                  contentFit="cover"
                  transition={300}
                />
              </View>

              {/* SONG INFO */}
              <View style={styles.infoContainer}>
                <MovingText
                  text={validatedTrack.title}
                  animationThreshold={20}
                  style={styles.title}
                />
                <Text style={styles.artist}>{validatedTrack.artist}</Text>
              </View>

              {/* ACTION ROW - Like + Comment (left) + Extra icons (right) */}
              <View style={styles.actionRow}>
                
                {/* ✅ Left Group: Like + Comment with counts */}
                <View style={styles.leftActions}>
                  {/* Like Group */}
                  <View style={styles.actionContainer}>
                    <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                      <Ionicons name="thumbs-up-outline" size={16} color="#fff" />
                      <Text style={styles.actionText}>29K</Text>
                    </TouchableOpacity>
                    <View style={styles.actionDivider} />
                    <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                      <Ionicons name="thumbs-down-outline" size={16} color="#fff" />
                      <Text style={styles.actionText}>218</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Comment with count */}
                  <TouchableOpacity 
                    style={styles.actionContainer} 
                    onPress={handleComments}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="comment-text-outline" size={16} color="#fff" />
                    <Text style={styles.actionText}>1.2K</Text>
                  </TouchableOpacity>
                </View>

                {/* ✅ Right Group: Playlist + Sleep */}
                <View style={styles.extraActions}>
                  <TouchableOpacity 
                    style={styles.extraIcon} 
                    onPress={handlePlaylist}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="playlist-add" size={20} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.extraIcon} 
                    onPress={handleSleepTimer}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="weather-night" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>

              </View>

              {/* PROGRESS BAR - Static Visual */}
              <View style={styles.progressWrapper}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: "20%" }]} />
                </View>

                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>0:19</Text>
                  <Text style={styles.timeText}>4:28</Text>
                </View>
              </View>

              {/* CONTROLS */}
              <View style={styles.controls}>
                {/* ✅ Poweramp-style Shuffle with dots BELOW icon */}
                <TouchableOpacity onPress={toggleShuffle} style={styles.shuffleWrapper} activeOpacity={0.7}>
                  <Feather
                    name="shuffle"
                    size={20}
                    color={shuffleMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"}
                  />
                  {shuffleMode !== "off" && (
                    <View style={styles.dotContainer}>
                      {Array.from({ length: getDotCount() }).map((_, index) => (
                        <View key={index} style={styles.dot} />
                      ))}
                    </View>
                  )}
                </TouchableOpacity>

                <Ionicons name="play-skip-back" size={26} color="#fff" />

                <TouchableOpacity style={styles.bigPlay} activeOpacity={0.85}>
                  <Ionicons name="pause" size={30} color="#000" />
                </TouchableOpacity>

                <Ionicons name="play-skip-forward" size={26} color="#fff" />

                {/* ✅ Repeat Toggle - No Circle, Just Icon Color + Badge */}
                <TouchableOpacity onPress={toggleRepeat} style={styles.repeatWrapper} activeOpacity={0.7}>
                  <MaterialCommunityIcons
                    name={repeatMode === "one" ? "repeat-once" : "repeat"}
                    size={22}
                    color={repeatMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"}
                  />
                  {repeatMode === "one" && (
                    <View style={styles.repeatOneBadge}>
                      <Text style={styles.repeatOneText}>1</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              {/* BOTTOM TABS - UP NEXT | LYRICS | RELATED */}
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
          </View>
        </LinearGradient>
      </VerticalSwipeGesture>
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    left: screenPadding.horizontal,
    right: screenPadding.horizontal,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 1000,
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

  // ✅ INCREASED ARTWORK SIZE (from 0.7 to 0.85)
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

  // ✅ Action Row: Left (Like + Comment) + Right (Playlist + Sleep)
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: verticalScale(20),
    paddingHorizontal: scale(5),
  },

  // ✅ Left Group: Like + Comment with counts
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

  actionText: {
    color: "#fff",
    fontSize: moderateScale(11),
    fontWeight: "500",
  },

  actionDivider: {
    width: 1,
    height: verticalScale(14),
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: scale(8),
  },

  // ✅ Right Group: Playlist + Sleep
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
    height: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },

  progressFill: {
    height: 3,
    backgroundColor: "#fff",
    borderRadius: 2,
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

  // ✅ Poweramp-style Shuffle Wrapper - Dots BELOW icon
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

  // ✅ Repeat Toggle Styles - NO CIRCLE
  repeatWrapper: {
    alignItems: "center",
    position: "relative",
  },

  // Small "1" badge for repeat one mode - ✅ METALLIC BROWN
  repeatOneBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    backgroundColor: "#8B7355", // ✅ Metallic brown
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

  // ✅ Bottom Tabs: UP NEXT | LYRICS | RELATED
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