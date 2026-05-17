// components/sections/TrendingNowSection.tsx
/**
 * TrendingNowSection — Theme-Aware Version
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
import { useTheme } from '@/contexts/ThemeContext';

interface TrendingNowSectionProps {
  data: Song[];
}

export const TrendingNowSection = ({ data }: TrendingNowSectionProps) => {
  const { colors } = useTheme();

  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Trending Now" showPlayAll />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
      </View>
    );
  }

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
  section: { marginBottom: 20 },
  list: { gap: 10, paddingHorizontal: 16 },
  emptyContainer: { height: 60, borderRadius: 12 },
});
