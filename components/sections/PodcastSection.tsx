// Updated: components/sections/PodcastSection.tsx
/**
 * PodcastSection — Store-First Version
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from "react-native";
import { PodcastCard } from "../cards/PodcastCard";
import { SectionHeader } from "../common/SectionHeader";
import type { Podcast } from "@/store/home";

const { width } = Dimensions.get("window");
const GAP        = 8;
const PARENT_PAD = 16;
const SIDE_PAD   = 14;
const CARD_SIZE  = (width - SIDE_PAD * 2 - GAP * 2) / 3 - 4;

const COLORS = {
  surface:       "#121212",
  goldPrimary:   "#D4AF37",
};

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
  // Shuffle and take 9 items for 3x3 grid
  const gridItems = useMemo(() => {
    if (!data?.length) return [];
    return shuffleArray(data).slice(0, 9);
  }, [data]);

  // Empty state
  if (!gridItems.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Podcasts" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  // 3x3 grid
  const rows = [
    gridItems.slice(0, 3),
    gridItems.slice(3, 6),
    gridItems.slice(6, 9),
  ];

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
  section: {
    marginBottom: 20,
  },
  grid: {
    marginHorizontal: -PARENT_PAD,
    paddingHorizontal: SIDE_PAD,
    gap: GAP,
  },
  row: {
    flexDirection: "row",
    gap: GAP,
  },
  cell: {
    width: CARD_SIZE,
  },
  emptyContainer: {
    height: 120,
  },
});