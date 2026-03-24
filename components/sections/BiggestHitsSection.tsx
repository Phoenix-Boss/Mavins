// Updated: components/sections/BiggestHitsSection.tsx
/**
 * BiggestHitsSection — Store-First Version
 * 
 * Receives data from parent (HomeStore via index.tsx).
 * No internal data fetching, no loading states.
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";
import type { Song } from "@/store/home";

const { width } = Dimensions.get("window");
const COLORS = {
  background: "#000000",
  surface: "#121212",
  surfaceLight: "#1F1F1F",
  goldPrimary: "#D4AF37",
  goldShiny: "#FFD700",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary: "#808080",
  danger: "#EF4444",
};

function formatViews(viewCount: number): string {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

// Fisher-Yates shuffle
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
  // Shuffle and take 6 items
  const displayItems = useMemo(() => {
    if (!data?.length) return [];
    const shuffled = shuffleArray(data);
    return shuffled.slice(0, 6);
  }, [data]);

  // Split into 2 rows with 3 columns each
  const topRow = displayItems.slice(0, 3);
  const bottomRow = displayItems.slice(3, 6);

  // Empty state
  if (!displayItems.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Biggest Hits" showPlayAll />
      <View style={styles.gridContainer}>
        {/* Top Row - Items 0, 1, 2 */}
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

        {/* Bottom Row - Items 3, 4, 5 */}
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
  section: {
    marginBottom: 20,
  },
  gridContainer: {
    flexDirection: "column",
    paddingHorizontal: 0,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 0,
    justifyContent: "space-between",
    paddingHorizontal: 0,
  },
  gridItem: {
    width: width / 3,
  },
  emptyContainer: {
    height: 120,
  },
});