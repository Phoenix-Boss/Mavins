// Updated: components/sections/TrendingNowSection.tsx
/**
 * TrendingNowSection — Store-First Version
 * 
 * Receives data from parent (HomeStore via index.tsx).
 * No internal data fetching, no loading states.
 * Renders instantly with cached data.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TrendingSongRow } from '@/components/cards/TrendingSongRow';
import { SectionHeader } from '@/components/common/SectionHeader';
import type { Song } from '@/store/home';

interface TrendingNowSectionProps {
  data: Song[];
}

export const TrendingNowSection = ({ data }: TrendingNowSectionProps) => {
  // Empty state — section handles gracefully
  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Trending Now" showPlayAll />
        <View style={styles.emptyContainer}>
          {/* Silent empty — no text to avoid layout shift */}
        </View>
      </View>
    );
  }

  // Remove duplicates within this section
  const unique = data.filter(
    (item, idx, arr) => arr.findIndex(x => x.id === item.id) === idx,
  );

  return (
    <View style={styles.section}>
      <SectionHeader title="Trending Now" showPlayAll />
      <View style={styles.list}>
        {unique.map((item, index) => (
          <TrendingSongRow
            key={`trending-now-${item.id}-${index}`}
            item={item}
            allItems={unique}
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
  emptyContainer: {
    height: 60,
  },
});