/**
 * BiggestHitsSection
 *
 * Displays top charts data from Supabase in a 2x3 grid (2 rows, 3 columns)
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTopCharts } from "../../hooks/useTopCharts";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";
import type { ChartItem } from "../../hooks/useTopCharts";

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

// Fisher-Yates shuffle algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const BiggestHitsSection = () => {
  const { data, loading, error, refetch } = useTopCharts("top50");
  const [shuffleKey, setShuffleKey] = useState(0);

  // Shuffle on every render by including shuffleKey in dependencies
  const displayItems = useMemo(() => {
    if (!data || data.length === 0) return [];
    const shuffled = shuffleArray(data);
    return shuffled.slice(0, 6);
  }, [data, shuffleKey]);

  // Split into 2 rows with 3 columns each
  const topRow = displayItems.slice(0, 3);
  const bottomRow = displayItems.slice(3, 6);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading charts…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <View style={styles.centeredBox}>
          <Ionicons
            name="cloud-offline-outline"
            size={32}
            color={COLORS.danger}
          />
          <Text style={styles.errorText}>Charts unavailable</Text>
          <Text style={styles.subtleText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Ionicons name="refresh" size={14} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (!displayItems.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <View style={styles.centeredBox}>
          <Ionicons
            name="musical-note-outline"
            size={32}
            color={COLORS.textTertiary}
          />
          <Text style={styles.subtleText}>No charts available</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Success: 2 Rows × 3 Columns Grid ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Biggest Hits" showPlayAll />
      <View style={styles.gridContainer}>
        {/* Top Row - Items 0, 1, 2 */}
        <View style={styles.row}>
          {topRow.map((item: ChartItem, index: number) => (
            <View key={`top-${item.id}-${index}`} style={styles.gridItem}>
              <AlbumCard
                item={{
                  id: item.videoId,
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
          {bottomRow.map((item: ChartItem, index: number) => (
            <View key={`bottom-${item.id}-${index}`} style={styles.gridItem}>
              <AlbumCard
                item={{
                  id: item.videoId,
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
  centeredBox: {
    padding: 36,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 15,
    fontWeight: "600",
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    textAlign: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    gap: 6,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});