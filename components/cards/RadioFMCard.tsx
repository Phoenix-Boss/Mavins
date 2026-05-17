/**
 * Radio FM Card Component - Theme-aware
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
import { useTheme } from "@/contexts/ThemeContext";

const CARD_SIZE = 80;

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

function getColorFromName(name: string, colors: any): string {
  const colorList = [colors.gold, colors.gold, "#E6C16A", "#C9A227", "#B8941F"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colorList[Math.abs(hash) % colorList.length];
}

interface RadioFMCardProps {
  item: { id: string; title: string; artist?: string; thumbnail?: string };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const RadioFMCard = ({ item, isCurrentTrack = false, onPress }: RadioFMCardProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  const cleanedName = cleanStationName(item.title);
  const initials = getInitials(item.title);
  const bgColor = getColorFromName(item.title, colors);
  const hasValidImage = !!item.thumbnail && item.thumbnail.startsWith("http") && !item.thumbnail.includes("placeholder");

  const handlePress = () => {
    triggerHaptic();
    if (onPress) onPress();
    else router.navigate(`/radio/${item.id}`);
  };

  return (
    <TouchableOpacity style={styles.wrapper} onPress={handlePress} activeOpacity={0.85}>
      <View style={styles.circleWrapper}>
        <View style={[
          styles.circle,
          { backgroundColor: colors.surfaceLight, borderColor: `${colors.gold}20` },
          isCurrentTrack && { borderColor: colors.gold, borderWidth: 2, shadowColor: colors.gold, shadowOpacity: 0.7, elevation: 6 }
        ]}>
          {hasValidImage ? (
            <Image source={{ uri: item.thumbnail }} style={styles.image} />
          ) : (
            <View style={[styles.fallback, { backgroundColor: `${bgColor}28` }]}>
              <Text style={[styles.initials, { color: bgColor }]}>{initials}</Text>
            </View>
          )}
        </View>
        <View style={[styles.liveBadge, { backgroundColor: "#3B82F6" }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>{cleanedName}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrapper: { alignItems: "center", width: CARD_SIZE + 8 },
  circleWrapper: { width: CARD_SIZE, height: CARD_SIZE, position: "relative" },
  circle: { width: CARD_SIZE, height: CARD_SIZE, borderRadius: CARD_SIZE / 2, overflow: "hidden", borderWidth: 1.5 },
  image: { width: "100%", height: "100%" },
  fallback: { width: "100%", height: "100%", justifyContent: "center", alignItems: "center" },
  initials: { fontSize: 22, fontWeight: "700", letterSpacing: 1 },
  liveBadge: { position: "absolute", top: 10, left: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, gap: 2, zIndex: 10 },
  liveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#fff" },
  liveText: { fontSize: 7, fontWeight: "700", color: "#fff" },
  name: { marginTop: 6, fontSize: 10, fontWeight: "600", textAlign: "center", lineHeight: 13 },
});
