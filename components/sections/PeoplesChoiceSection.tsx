/**
 * PeoplesChoiceSection
 *
 * Displays most popular/viral music tracks from Supabase
 * Excludes songs already shown in Trending section to prevent duplicates
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePopularChoice, PopularItem } from "../../hooks/usePopularChoice";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  surface: "#121212",
  surfaceLight: "#1F1F1F",
  goldPrimary: "#D4AF37",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary: "#808080",
  danger: "#EF4444",
};

const formatViews = (viewCount: number): string => {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000_000)
    return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
};

interface PeoplesChoiceSectionProps {
  trendingIds?: string[]; // IDs from Trending section to exclude
  recentlyPlayedIds?: string[]; // IDs from Recently Played to exclude
}

export const PeoplesChoiceSection: React.FC<PeoplesChoiceSectionProps> = ({
  trendingIds = [],
  recentlyPlayedIds = [],
}) => {
  // Combine all IDs to exclude
  const excludeIds = useMemo(() => {
    const combined = [...new Set([...trendingIds, ...recentlyPlayedIds])];
    console.log(`🚫 [PeoplesChoiceSection] Excluding ${combined.length} IDs`);
    return combined;
  }, [trendingIds, recentlyPlayedIds]);

  const { data, loading, error, refetch, isEmpty } = usePopularChoice({
    excludeIds,
    shuffle: true,
  });

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="People's Choice" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading popular songs…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="People's Choice" showPlayAll />
        <View style={styles.centeredBox}>
          <Ionicons
            name="alert-circle-outline"
            size={22}
            color={COLORS.danger}
          />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (isEmpty) {
    return (
      <View style={styles.section}>
        <SectionHeader title="People's Choice" showPlayAll />
        <View style={styles.centeredBox}>
          <Ionicons
            name="musical-note-outline"
            size={22}
            color={COLORS.textTertiary}
          />
          <Text style={styles.subtleText}>No popular songs available</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="People's Choice" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: PopularItem, index: number) => (
          <AlbumCard
            key={`peoples-choice-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views),
            }}
            showPlayButton={false}
          />
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  centeredBox: {
    padding: 40,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    textAlign: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    gap: 5,
    marginTop: 8,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});