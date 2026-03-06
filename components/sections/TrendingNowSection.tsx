/**
 * TrendingNowSection
 *
 * Displays trending music tracks as a vertical list with skeleton loading.
 *
 * Data flow:
 *   useTrending()
 *     → MavinEngine.getTrending(undefined, 0)
 *       → Kotlin: extractKioskInfo("Music", null, 0)
 *
 * TrendingSongRow receives only fields present on TrendingItem.
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

const formatViews = (views: number): string => {
  if (!views) return '0';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000)     return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000)         return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
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
            <SkeletonLoader key={i} type="trending" />
          ))}
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Trending Now" showPlayAll />
      <View style={styles.verticalList}>
        {data.map((item: TrendingItem, index: number) => (
          <TrendingSongRow
            key={item.id}
            item={{
              id: item.videoId,                    // full stream url for playback
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