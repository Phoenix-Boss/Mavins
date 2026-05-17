// components/sections/PodcastSection.tsx
/**
 * PodcastSection — Theme-Aware Version
 */

import React, { useMemo } from "react";
import {
  View,
  StyleSheet,
  Dimensions,
} from "react-native";
import { PodcastCard } from "../cards/PodcastCard";
import { SectionHeader } from "../common/SectionHeader";
import type { Podcast } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

const { width } = Dimensions.get("window");
const GAP = 8;
const SIDE_PAD = 14;
const CARD_SIZE = (width - SIDE_PAD * 2 - GAP * 2) / 3 - 4;

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface PodcastSectionProps {
  data: Podcast[];
}

export const PodcastSection = ({ data }: PodcastSectionProps) => {
  const { colors } = useTheme();

  const gridItems = useMemo(() => {
    if (!data?.length) return [];
    return shuffleArray(data).slice(0, 9);
  }, [data]);

  if (!gridItems.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Podcasts" showPlayAll />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
      </View>
    );
  }

  const rows = [gridItems.slice(0, 3), gridItems.slice(3, 6), gridItems.slice(6, 9)];

  return (
    <View style={styles.section}>
      <SectionHeader title="Podcasts" showPlayAll />
      <View style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.row}>
            {row.map((item, colIndex) => (
              <View key={`pod-${rowIndex}-${item.id}-${colIndex}`} style={styles.cell}>
                <PodcastCard
                  item={{
                    id: item.id,
                    title: item.title,
                    artist: item.artist,
                    thumbnail: item.thumbnail,
                    episodeCount: item.episodeCount,
                    type: item.type,
                  }}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  grid: { marginHorizontal: -16, paddingHorizontal: SIDE_PAD, gap: GAP },
  row: { flexDirection: "row", gap: GAP },
  cell: { width: CARD_SIZE },
  emptyContainer: { height: 120, borderRadius: 12 },
});
