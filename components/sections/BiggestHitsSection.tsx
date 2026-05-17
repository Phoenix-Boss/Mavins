// components/sections/BiggestHitsSection.tsx
/**
 * BiggestHitsSection — Theme-Aware Version
 * 
 * Receives data from parent (HomeStore via index.tsx).
 * No internal data fetching, no loading states.
 */

import React, { useMemo } from "react";
import {
  View,
  StyleSheet,
  Dimensions,
} from "react-native";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";
import type { Song } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

const { width } = Dimensions.get("window");

function formatViews(viewCount: number): string {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface BiggestHitsSectionProps {
  data: Song[];
}

export const BiggestHitsSection = ({ data }: BiggestHitsSectionProps) => {
  const { colors } = useTheme();

  const displayItems = useMemo(() => {
    if (!data?.length) return [];
    const shuffled = shuffleArray(data);
    return shuffled.slice(0, 6);
  }, [data]);

  const topRow = displayItems.slice(0, 3);
  const bottomRow = displayItems.slice(3, 6);

  if (!displayItems.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Biggest Hits" showPlayAll />
      <View style={styles.gridContainer}>
        <View style={styles.row}>
          {topRow.map((item, index) => (
            <View key={`top-${item.id}-${index}`} style={styles.gridItem}>
              <AlbumCard
                item={{
                  id: item.videoId || item.id,
                  title: item.title,
                  artist: item.artist,
                  thumbnail: item.thumbnail,
                  plays: item.views > 0 ? formatViews(item.views) : undefined,
                }}
                showPlayButton
                size="small"
              />
            </View>
          ))}
        </View>
        <View style={styles.row}>
          {bottomRow.map((item, index) => (
            <View key={`bottom-${item.id}-${index}`} style={styles.gridItem}>
              <AlbumCard
                item={{
                  id: item.videoId || item.id,
                  title: item.title,
                  artist: item.artist,
                  thumbnail: item.thumbnail,
                  plays: item.views > 0 ? formatViews(item.views) : undefined,
                }}
                showPlayButton
                size="small"
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  gridContainer: { flexDirection: "column", paddingHorizontal: 0, gap: 10 },
  row: { flexDirection: "row", gap: 0, justifyContent: "space-between", paddingHorizontal: 0 },
  gridItem: { width: width / 3 },
  emptyContainer: { height: 120, borderRadius: 12 },
});
