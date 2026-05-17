// components/sections/MavinsBestSection.tsx
/**
 * MavinsBestSection — Theme-Aware Version
 */

import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { SectionHeader } from "../common/SectionHeader";
import type { EditorPick } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

const { width } = Dimensions.get("window");
const PARENT_PADDING = 16;
const SIDE_GAP = 8;
const CARD_VIS_WIDTH = width - SIDE_GAP * 2;
const CARD_HEIGHT = CARD_VIS_WIDTH * 0.68;

function formatViews(viewCount: number): string {
  if (!viewCount) return "";
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M plays`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K plays`;
  return `${viewCount} plays`;
}

interface MavinsBestSectionProps {
  data: EditorPick[];
}

export const MavinsBestSection = ({ data }: MavinsBestSectionProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  const featured = data?.[0] ?? null;

  const handlePlay = () => {
    triggerHaptic();
    if (featured) router.navigate(`/track/${featured.id}`);
  };
  const handleBookmark = () => triggerHaptic();

  if (!featured) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Mavins Player Best" />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Mavins Player Best" />

      <View style={styles.card}>
        <Image source={{ uri: featured.thumbnail }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        <View style={[styles.scrim, { backgroundColor: "rgba(0,0,0,0.72)" }]} />

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.borderGold }]} onPress={handleBookmark} hitSlop={10}>
            <Ionicons name="bookmark-outline" size={20} color={colors.gold} />
          </TouchableOpacity>
        </View>

        <View style={styles.info}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{featured.title}</Text>
          <Text style={[styles.artist, { color: colors.gold }]} numberOfLines={1}>{featured.artist}</Text>
          {featured.views > 0 && <Text style={[styles.plays, { color: colors.textSub }]}>{formatViews(featured.views)}</Text>}
        </View>

        <TouchableOpacity style={[styles.playBtn, { backgroundColor: colors.gold }]} onPress={handlePlay} activeOpacity={0.85}>
          <Ionicons name="play" size={22} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  card: { marginHorizontal: -(PARENT_PADDING - SIDE_GAP), height: CARD_HEIGHT, borderRadius: 14, overflow: "hidden" },
  scrim: { position: "absolute", bottom: 0, left: 0, right: 0, top: "45%" },
  actions: { position: "absolute", top: 12, right: 12, flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.50)", justifyContent: "center", alignItems: "center", borderWidth: 1 },
  info: { position: "absolute", bottom: 16, left: 14, right: 72 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 2 },
  artist: { fontSize: 13, fontWeight: "500", marginBottom: 2 },
  plays: { fontSize: 11 },
  playBtn: { position: "absolute", bottom: 14, right: 14, width: 48, height: 48, borderRadius: 24, justifyContent: "center", alignItems: "center", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 10, elevation: 6 },
  emptyContainer: { marginHorizontal: -(PARENT_PADDING - SIDE_GAP), height: CARD_HEIGHT, borderRadius: 14 },
});
