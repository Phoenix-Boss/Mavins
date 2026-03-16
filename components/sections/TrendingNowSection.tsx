/**
 * TrendingNowSection
 *
 * Displays trending music tracks from Supabase
 *
 * Data flow:
 *   useTrending()
 *     → Supabase trending_tracks or sections with section_type = 'trending'
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTrending, TrendingItem } from '../../hooks/useTrending';
import { TrendingSongRow } from '../cards/TrendingSongRow';
import { SectionHeader } from '../common/SectionHeader';
import { SkeletonLoader } from '../common/SkeletonLoader';

const formatDuration = (seconds: number): string => {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatViews = (viewCount: number): string => {
  if (!viewCount) return '0';
  if (viewCount >= 1_000_000_000) return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000)     return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000)         return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
};

export const TrendingNowSection = () => {
  const { data, loading, error } = useTrending();

  // ── Skeleton loading ──────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Trending Now" showPlayAll />
        <View style={styles.verticalList}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <SkeletonLoader key={`trending-skeleton-${i}`} type="trending" />
          ))}
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  // Remove duplicates within the same section
  const unique = data.filter(
    (item, index, arr) => arr.findIndex(x => x.id === item.id) === index
  );

  return (
    <View style={styles.section}>
      <SectionHeader title="Trending Now" showPlayAll />
      <View style={styles.verticalList}>
        {unique.map((item: TrendingItem, index: number) => (
          <TrendingSongRow
            key={`trending-now-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: formatDuration(item.duration),
              plays: formatViews(item.views),
            }}
            index={index}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  verticalList: {
    gap: 10,
    paddingHorizontal: 16,
  },
}); 