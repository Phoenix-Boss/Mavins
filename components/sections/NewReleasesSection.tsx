/**
 * NewReleasesSection
 *
 * Displays newly released music tracks with skeleton loading UI.
 *
 * Data flow:
 *   useNewReleases()
 *     → MavinEngine.search("new music releases 2025", "all", undefined, 0)
 *       → Kotlin: performSearch(query, "all", null, 0)
 *
 * MixCard receives NewReleaseItem fields (already transformed by hook).
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useNewReleases, NewReleaseItem } from "../../hooks/useNewReleases";
import { MixCard } from "../cards/MixCard";
import { SectionHeader } from "../common/SectionHeader";
import { SkeletonLoader } from "../common/SkeletonLoader";

export const NewReleasesSection = () => {
  const { data, loading, error } = useNewReleases();

  // ── Skeleton loading ──────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="New" showPlayAll />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalScroll}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonLoader key={i} type="mix" />
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="New" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: NewReleaseItem) => (
          <MixCard
            key={item.id}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
           
              releaseDate: item.releaseDate || undefined,
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
});