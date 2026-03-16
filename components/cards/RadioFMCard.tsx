/**
 * Radio FM Card Component - Circular station card
 * - Circular shape
 * - Cover art if available, initials fallback
 * - Clean readable name (no Radio/FM/AM/special chars)
 * - LIVE badge + play button
 * - No view count
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";

const COLORS = {
  background:   "#000000",
  surfaceLight: "#1F1F1F",
  goldPrimary:  "#D4AF37",
  goldShiny:    "#FFD700",
  goldShimmer:  "#E6C16A",
  text:         "#FFFFFF",
  textSecondary:"#B3B3B3",
  liveTag:      "#3B82F6",
};

const CARD_SIZE = 80; // diameter of the circle

interface RadioFMCardProps {
  item: {
    id: string;
    title: string;
    artist?: string;
    thumbnail?: string;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

// Strip noise words and special characters, return readable station name
function cleanStationName(name: string): string {
  if (!name) return "Station";
  return name
    .replace(/\b(Radio|FM|AM|Online|Live|Stream|Music|Station)\b/gi, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim() || name.trim();
}

function getInitials(name: string): string {
  const cleaned = cleanStationName(name);
  const words = cleaned.split(" ").filter(w => w.length > 0);
  if (words.length === 0) return "ST";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getColorFromName(name: string): string {
  const colors = ["#D4AF37", "#FFD700", "#E6C16A", "#C9A227", "#B8941F"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const RadioFMCard = ({
  item,
  isCurrentTrack = false,
  onPress,
}: RadioFMCardProps) => {
  const router = useRouter();

  const cleanedName   = cleanStationName(item.title);
  const initials      = getInitials(item.title);
  const bgColor       = getColorFromName(item.title);
  const hasValidImage =
    !!item.thumbnail &&
    item.thumbnail.startsWith("http") &&
    !item.thumbnail.includes("placeholder");

  const handlePress = () => {
    triggerHaptic();
    if (onPress) onPress();
    else router.navigate(`/radio/${item.id}`);
  };

  return (
    <TouchableOpacity
      style={styles.wrapper}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      {/* Circle + LIVE badge in a relative container so badge sits in front */}
      <View style={styles.circleWrapper}>
        <View style={[styles.circle, isCurrentTrack && styles.circleActive]}>
          {hasValidImage ? (
            <Image source={{ uri: item.thumbnail }} style={styles.image} />
          ) : (
            <View style={[styles.fallback, { backgroundColor: bgColor + "28" }]}>
              <Text style={[styles.initials, { color: bgColor }]}>{initials}</Text>
            </View>
          )}
        </View>

        {/* LIVE badge — absolutely positioned in front of circle, bottom center */}
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Station name */}
      <Text style={styles.name} numberOfLines={2}>{cleanedName}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    width: CARD_SIZE + 8,
  },
  circleWrapper: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    position: "relative",
  },
  circle: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: CARD_SIZE / 2,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1.5,
    borderColor: "rgba(212,175,55,0.2)",
  },
  circleActive: {
    borderColor: COLORS.goldPrimary,
    borderWidth: 2,
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 6,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  fallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  initials: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
  },
  liveBadge: {
    position: "absolute",
    top: 10,
    left: 0,
    backgroundColor: COLORS.liveTag,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
    zIndex: 10,
  },
  liveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#fff",
  },
  liveText: {
    fontSize: 7,
    fontWeight: "700",
    color: "#fff",
  },
  name: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
    lineHeight: 13,
  },
});