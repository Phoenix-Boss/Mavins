/**
 * PodcastSection
 *
 * Displays podcast playlists sourced from YouTube Music search.
 *
 * Data flow:
 *   usePodcasts()
 *     → MavinEngine.search("music podcast 2025", "all")
 *       → Kotlin: performSearch(query, "all", null, 0)
 *       → filters to PlaylistInfoItem results only
 *
 * PodcastCard receives only fields present on PodcastItem.
 * item.artist replaces the fabricated item.artist that was
 * previously passed but never existed on PodcastItem.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { usePodcasts, PodcastItem } from '../../hooks/usePodcasts';
import { PodcastCard } from '../cards/PodcastCard';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
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
              id: item.videoId,           // playlist url → getPlaylistInfo()
              title: item.title,
              artist: item.artist,        // uploaderName — podcast creator
              thumbnail: item.thumbnail,
              episodeCount: item.episodeCount,
              type: 'podcast',
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
    alignItems: 'center',
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