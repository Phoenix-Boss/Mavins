import React, { useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Platform,
  GestureResponderEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { Colors } from "@/constants/Colors";

const { width } = Dimensions.get("window");

interface FloatingPlayerProps {
  tabHeight?: number;
  track?: {
    title: string;
    artist: string;
    artwork?: string | number;
  };
}

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({
  tabHeight = 56,
  track,
}) => {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = React.useState(false);

  const togglePlay = () => {
    triggerHaptic();
    setIsPlaying(!isPlaying);
  };

  const playNextSong = () => {
    triggerHaptic();
  };

  const openPlayerScreen = () => {
    triggerHaptic();
    if (!track) return;
    router.push("/(player)");
  };

  const floatingPlayerBottom = tabHeight + 4;

  const animatedStyle = useAnimatedStyle(() => {
    return {
      bottom: withTiming(floatingPlayerBottom, { duration: 300 }),
    };
  }, [floatingPlayerBottom]);

  if (!track) {
    return null;
  }

  const getArtworkSource = () => {
    if (!track.artwork) return null;
    if (typeof track.artwork === "number") return track.artwork;
    return { uri: track.artwork };
  };

  const artworkSource = getArtworkSource();

  return (
    <Animated.View
      style={[
        styles.floatingWrapper,
        { left: 8, right: 8 },
        animatedStyle,
      ]}
    >
      <View style={styles.glassBaseLayer} />
      <View style={styles.floatingCard}>
        <TouchableOpacity
          style={styles.contentContainer}
          onPress={openPlayerScreen}
          activeOpacity={0.9}
        >
          <View style={styles.albumArtContainer}>
            {artworkSource ? (
              <Image
                source={artworkSource}
                style={styles.albumArt}
              />
            ) : (
              <View style={styles.albumArtPlaceholder}>
                <Ionicons
                  name="musical-notes"
                  size={20}
                  color="rgba(255, 255, 255, 0.7)"
                />
              </View>
            )}
          </View>

          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {track.title || "Unknown Title"}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {track.artist || "Unknown Artist"}
            </Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={(e) => {
                e.stopPropagation();
                playNextSong();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="play-skip-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, styles.playButton]}
              onPress={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
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
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  glassBaseLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Platform.select({
      ios: "rgba(20, 20, 25, 0.85)",
      android: "rgba(18, 18, 23, 0.95)",
      default: "rgba(18, 18, 23, 0.9)",
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
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  albumArtPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
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
    color: "rgba(255, 255, 255, 0.7)",
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
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  playButton: {
    backgroundColor: "rgba(139, 115, 85, 0.8)",
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
});

export default FloatingPlayer;