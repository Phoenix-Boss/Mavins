/**
 * TrendingNowSection
 *
 * Changed from original:
 *   - Passes full `item` (TrendingItem extends Song) to TrendingSongRow
 *     instead of a reshaped object that dropped url/videoId
 *   - Passes `allItems={unique}` so TrendingSongRow can build the queue
 *     for TrackPlayer skip-forward/back to work correctly
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTrending, TrendingItem } from '@/hooks/useTrending';
import { TrendingSongRow } from '@/components/cards/TrendingSongRow';
import { SectionHeader } from '@/components/common/SectionHeader';
import { SkeletonLoader } from '@/components/common/SkeletonLoader';

export const TrendingNowSection = () => {
  const { data, loading, error } = useTrending();

  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Trending Now" showPlayAll />
        <View style={styles.list}>
          {[1, 2, 3].map(i => (
            <SkeletonLoader key={`trending-skeleton-${i}`} type="trending" />
          ))}
        </View>
      </View>
    );
  }

  if (error || !data.length) return null;

  // Remove duplicates within this section
  const unique = data.filter(
    (item, idx, arr) => arr.findIndex(x => x.id === item.id) === idx,
  );

  return (
    <View style={styles.section}>
      <SectionHeader title="Trending Now" showPlayAll />
      <View style={styles.list}>
        {unique.map((item: TrendingItem, index: number) => (
          <TrendingSongRow
            key={`trending-now-${item.id}-${index}`}
            item={item}
            allItems={unique}   // ← full section list for queue context
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
  list: {
    gap: 10,
    paddingHorizontal: 16,
  },
});