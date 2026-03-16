/**
 * NewReleasesSection
 *
 * Displays newly released music tracks from Supabase.
 * Each item is shown as a circular thumbnail card with title
 * and artist below — no release date displayed.
 *
 * Data flow:
 *   useNewReleases()
 *     → Supabase songs ordered by created_at DESC
 */

import React from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useNewReleases, NewReleaseItem } from "../../hooks/useNewReleases";
import { SectionHeader } from "../common/SectionHeader";
import { SkeletonLoader } from "../common/SkeletonLoader";

// ─── Constants ────────────────────────────────────────────────────────────────

const CIRCLE_SIZE = 80;

const COLORS = {
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
};

// ─── CircularCard ─────────────────────────────────────────────────────────────

interface CircularCardProps {
  item: NewReleaseItem;
}

const CircularCard = ({ item }: CircularCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    router.navigate(`/track/${item.id}`);
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Circular thumbnail */}
      <View style={styles.circleWrapper}>
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.circle}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.circle, styles.circlePlaceholder]}>
            <Text style={styles.placeholderInitial}>
              {item.title?.charAt(0) ?? "?"}
            </Text>
          </View>
        )}
        {/* Gold ring */}
        <View style={styles.circleRing} />
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>

      {/* Artist */}
      <Text style={styles.artist} numberOfLines={1}>
        {item.artist}
      </Text>
    </TouchableOpacity>
  );
};

// ─── Section ──────────────────────────────────────────────────────────────────

export const NewReleasesSection = () => {
  const { data, loading, error } = useNewReleases();

  // ── Skeleton loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="New" showPlayAll />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {[1, 2, 3, 4, 5].map(i => (
            <View key={`skeleton-${i}`} style={styles.skeletonCard}>
              <View style={styles.skeletonCircle} />
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonLineShort} />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Error / Empty — hide silently ─────────────────────────────────────────
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="New" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {data.map((item: NewReleaseItem) => (
          <CircularCard key={`new-release-${item.id}`} item={item} />
        ))}
      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
    alignItems: "flex-start",
  },

  // ── Circular card ──────────────────────────────────────────────────────────
  card: {
    width: CIRCLE_SIZE + 8,
    alignItems: "center",
    gap: 6,
  },
  circleWrapper: {
    position: "relative",
    width: CIRCLE_SIZE + 4,
    height: CIRCLE_SIZE + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: COLORS.surfaceLight,
  },
  circlePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceLight,
  },
  placeholderInitial: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.goldShimmer,
  },
  circleRing: {
    position: "absolute",
    width: CIRCLE_SIZE + 4,
    height: CIRCLE_SIZE + 4,
    borderRadius: (CIRCLE_SIZE + 4) / 2,
    borderWidth: 1.5,
    borderColor: COLORS.goldPrimary + "60",
  },
  title: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
    width: CIRCLE_SIZE + 8,
  },
  artist: {
    fontSize: 10,
    fontWeight: "400",
    color: COLORS.textTertiary,
    textAlign: "center",
    width: CIRCLE_SIZE + 8,
  },

  // ── Skeleton ───────────────────────────────────────────────────────────────
  skeletonCard: {
    width: CIRCLE_SIZE + 8,
    alignItems: "center",
    gap: 6,
  },
  skeletonCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: COLORS.surfaceLight,
  },
  skeletonLine: {
    width: CIRCLE_SIZE,
    height: 10,
    borderRadius: 4,
    backgroundColor: COLORS.surfaceLight,
  },
  skeletonLineShort: {
    width: CIRCLE_SIZE * 0.7,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.surfaceLight,
  },
});