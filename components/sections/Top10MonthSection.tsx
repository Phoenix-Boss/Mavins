// Updated: components/sections/Top10MonthSection.tsx
/**
 * Top10MonthSection — Store-First Version
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Top10MonthRow } from "../cards/Top10MonthRow";
import { SectionHeader } from "../common/SectionHeader";
import type { Song } from "@/store/home";

const COLORS = {
  surface: "#121212",
  goldPrimary: "#D4AF37",
  textSecondary: "#B3B3B3",
};

const formatViews = (viewCount: number): string => {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000_000)
    return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
};

interface Top10MonthSectionProps {
  data: Song[];
  excludedIds?: string[];
}

export const Top10MonthSection = ({ data, excludedIds = [] }: Top10MonthSectionProps) => {
  // Filter out excluded IDs
  const filteredData = useMemo(() => {
    const excludedSet = new Set(excludedIds);
    const seen = new Set<string>();

    return data.filter((item) => {
      if (excludedSet.has(item.id) || excludedSet.has(item.videoId)) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [data, excludedIds]);

  // Empty state
  if (!filteredData.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Top 10 for the Month" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Top 10 for the Month" showPlayAll />
      <View style={styles.verticalList}>
        {filteredData.map((item, index) => (
          <Top10MonthRow
            key={`top10-month-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views || item.viewCount || 0),
            }}
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
  emptyContainer: {
    height: 120,
  },
});