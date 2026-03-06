/**
 * FeaturedSection
 *
 * Replaces SponsoredSection. Displays curated featured music
 * from the YouTube "Music" kiosk.
 *
 * Why the rename:
 *   - getSponsoredContent() does not exist in Kotlin
 *   - NewPipeExtractor exposes no sponsored/ad metadata
 *   - SponsoredBadge and sponsorName had no real data source
 *
 * Data flow:
 *   useFeatured()
 *     → MavinEngine.getTrending(undefined, 0)
 *       → Kotlin: extractKioskInfo("Music", null, 0)
 *
 * AlbumCard receives only fields present on FeaturedItem.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useFeatured, FeaturedItem } from '../../hooks/useFeatured';
import { AlbumCard } from '../cards/AlbumCard';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
};

function formatViews(views: number): string {
  if (!views) return '0';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000)     return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000)         return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

export const FeaturedSection = () => {
  const { data, loading, error } = useFeatured();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Featured" />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading featured music…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Featured" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: FeaturedItem) => (
          <AlbumCard
            key={item.id}
            item={{
              id: item.videoId,              // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: item.duration,
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