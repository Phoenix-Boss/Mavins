/**
 * PodcastSection
 *
 * Displays podcast playlists sourced from YouTube search.
 *
 * Data flow:
 *   usePodcasts()
 *     → MavinEngine.search("music podcast 2025", "all", undefined, 0)
 *       → Kotlin: performSearch(query, "all", null, 0)
 *       → filters to PlaylistInfoItem results only
 *
 * "all" filter is required so PlaylistInfoItems (podcasts) are included
 * alongside StreamInfoItems in the result set.
 *
 * PodcastCard receives PodcastItem fields (already transformed by hook).
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { usePodcasts, PodcastItem } from "../../hooks/usePodcasts";
import { PodcastCard } from "../cards/PodcastCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  surface: "#121212",
  goldPrimary: "#D4AF37",
  textSecondary: "#B3B3B3",
};

export const PodcastSection = () => {
  const { data, loading, error } = usePodcasts();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Podcast" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading podcasts…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Podcast" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: PodcastItem) => (
          <PodcastCard
            key={item.id}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              episodeCount: item.episodeCount,
              type: item.type,
            }}
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