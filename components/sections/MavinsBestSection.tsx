/**
 * MavinsBestSection
 *
 * Single shuffled editorial pick.
 * Card has a small gap on left & right; cover art fills the entire card
 * so all icons and text sit on top of the image.
 */

import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useEditorPicks, EditorPickItem } from "../../hooks/useEditorPicks";
import { SectionHeader } from "../common/SectionHeader";

const { width } = Dimensions.get("window");
const PARENT_PADDING = 16;
const SIDE_GAP       = 8;
const CARD_VIS_WIDTH = width - SIDE_GAP * 2;
const CARD_HEIGHT    = CARD_VIS_WIDTH * 0.68;

const COLORS = {
  background:    "#000000",
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShiny:     "#FFD700",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
  danger:        "#EF4444",
};

function formatViews(viewCount: number): string {
  if (!viewCount) return "";
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M plays`;
  if (viewCount >= 1_000)     return `${(viewCount / 1_000).toFixed(1)}K plays`;
  return `${viewCount} plays`;
}

export const MavinsBestSection = () => {
  const { data, loading, error, refetch } = useEditorPicks();
  const router = useRouter();

  // useEditorPicks already handles pool caching + picking a fresh item each load
  const featured: EditorPickItem | null = data?.[0] ?? null;

  const handlePlay     = () => { triggerHaptic(); if (featured) router.navigate(`/track/${featured.id}`); };
  const handleBookmark = () => triggerHaptic();
  const handleCast     = () => triggerHaptic();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Mavins Player Best" />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading curated pick…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Mavins Player Best" />
        <View style={styles.placeholder}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.danger} />
          <Text style={styles.errorText}>Could not load pick</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (!featured) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Mavins Player Best" />
        <View style={styles.placeholder}>
          <Ionicons name="musical-note-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.subtleText}>No picks available</Text>
        </View>
      </View>
    );
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Mavins Player Best" />

      <View style={styles.card}>

        {/* Cover art fills every pixel */}
        <Image
          source={{ uri: featured.thumbnail }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />

        {/* Dark scrim over bottom 55% so text/icons are readable */}
        <View style={styles.scrim} />

        {/* Action icons — top right, floating over the image */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark} hitSlop={10}>
            <Ionicons name="bookmark-outline" size={20} color={COLORS.goldShimmer} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleCast} hitSlop={10}>
            <Ionicons name="tv-outline" size={20} color={COLORS.goldShimmer} />
          </TouchableOpacity>
        </View>

        {/* Title / artist / plays — bottom left */}
        <View style={styles.info}>
          <Text style={styles.title}  numberOfLines={1}>{featured.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{featured.artist}</Text>
          {featured.views > 0 && (
            <Text style={styles.plays}>{formatViews(featured.views)}</Text>
          )}
        </View>

        {/* Play button — bottom right */}
        <TouchableOpacity style={styles.playBtn} onPress={handlePlay} activeOpacity={0.85}>
          <Ionicons name="play" size={22} color={COLORS.background} />
        </TouchableOpacity>

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },

  // Card breaks out of parent paddingHorizontal:16, adds SIDE_GAP each side
  card: {
    marginHorizontal: -(PARENT_PADDING - SIDE_GAP),
    height: CARD_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },

  scrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: "45%",
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  actions: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.50)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.35)",
  },

  info: {
    position: "absolute",
    bottom: 16,
    left: 14,
    right: 72,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 2,
  },
  artist: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.goldShimmer,
    marginBottom: 2,
  },
  plays: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  playBtn: {
    position: "absolute",
    bottom: 14,
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.goldPrimary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },

  // Shared placeholder box for loading / error / empty states
  placeholder: {
    marginHorizontal: -(PARENT_PADDING - SIDE_GAP),
    height: CARD_HEIGHT,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    marginTop: 4,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});