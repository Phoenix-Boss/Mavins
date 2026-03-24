// Updated: components/sections/PeoplesChoiceSection.tsx
/**
 * PeoplesChoiceSection — Store-First Version
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from "react-native";
import { AlbumCard } from "../cards/AlbumCard";
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

interface PeoplesChoiceSectionProps {
  data: Song[];
}

export const PeoplesChoiceSection = ({ data }: PeoplesChoiceSectionProps) => {
  // Shuffle the data
  const shuffledData = useMemo(() => {
    if (!data?.length) return [];
    return [...data].sort(() => Math.random() - 0.5);
  }, [data]);

  // Empty state
  if (!shuffledData.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="People's Choice" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="People's Choice" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {shuffledData.map((item, index) => (
          <AlbumCard
            key={`peoples-choice-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views || item.viewCount || 0),
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
  emptyContainer: {
    height: 120,
  },
});