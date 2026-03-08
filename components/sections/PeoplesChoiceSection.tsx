/**
 * PeoplesChoiceSection
 *
 * Displays most popular/viral music tracks.
 *
 * Data flow:
 *   usePopularChoice()
 *     → MavinEngine.search("most popular songs 2025", "all", undefined, 0)
 *       → Kotlin: performSearch(query, "all", null, 0)
 *
 * AlbumCard receives PopularItem fields (already transformed by hook).
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { usePopularChoice, PopularItem } from "../../hooks/usePopularChoice";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  surface: "#121212",
  goldPrimary: "#D4AF37",
  textSecondary: "#B3B3B3",
};

const formatViews = (viewCount: number): string => {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000_000)
    return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
};

export const PeoplesChoiceSection = () => {
  const { data, loading, error } = usePopularChoice();

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

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="People's Choice" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: PopularItem) => (
          <AlbumCard
            key={item.id}
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
});