/**
 * NewReleasesSection
 *
 * Displays newly released music tracks with skeleton loading UI.
 *
 * Data flow:
 *   useNewReleases()
 *     → MavinEngine.search("new music releases 2025", "songs")
 *       → Kotlin: performSearch(query, "songs", null, 0)
 *
 * MixCard receives only fields present on NewReleaseItem —
 * releaseDate is mapped from textualUploadDate (the real
 * StreamInfoItem field, e.g. "3 days ago").
 */

import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useNewReleases, NewReleaseItem } from '../../hooks/useNewReleases';
import { MixCard } from '../cards/MixCard';
import { SectionHeader } from '../common/SectionHeader';
import { SkeletonLoader } from '../common/SkeletonLoader';

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
          {[1, 2, 3, 4, 5].map(i => (
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
              id: item.videoId,         // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: item.duration,
              // ✅ textualUploadDate → releaseDate e.g. "3 days ago"
              releaseDate: item.uploadDate || undefined,
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