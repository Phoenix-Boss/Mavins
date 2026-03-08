/**
 * BiggestHitsSection
 *
 * Displays music chart items sourced from the YouTube Music kiosk
 * (getTrending → 'Music' kiosk) and YouTube Music search ('viral50').
 *
 * Data flow:
 *   useTopCharts(chartType)
 *     → MavinEngine.getTrending() or MavinEngine.search('songs')
 *       → Kotlin: KioskInfo("Music") or SearchInfo(filter="songs")
 *
 * Only ChartItem fields are used — the hook transforms StreamInfoItem to ChartItem.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTopCharts, ChartItem } from "../../hooks/useTopCharts";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  background: "#000000",
  surface: "#121212",
  surfaceLight: "#1F1F1F",
  goldPrimary: "#D4AF37",
  goldShiny: "#FFD700",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary: "#808080",
  border: "#333333",
  danger: "#EF4444",
};

const CHART_TYPES = [
  { id: "top50", label: "Top 50", icon: "🏆" },
  { id: "viral50", label: "Viral 50", icon: "🔥" },
] as const;

type ChartType = "top50" | "viral50";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatViews(viewCount: number): string {
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

interface ChartSelectorProps {
  active: ChartType;
  onChange: (type: ChartType) => void;
}

const ChartSelector = ({ active, onChange }: ChartSelectorProps) => (
  <View style={styles.chartSelector}>
    {CHART_TYPES.map(({ id, label, icon }) => {
      const isActive = active === id;
      return (
        <TouchableOpacity
          key={id}
          style={[styles.chartChip, isActive && styles.chartChipActive]}
          onPress={() => onChange(id)}
          activeOpacity={0.75}
        >
          <Text style={styles.chartIcon}>{icon}</Text>
          <Text
            style={[
              styles.chartChipText,
              isActive && styles.chartChipTextActive,
            ]}
          >
            {label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export const BiggestHitsSection = () => {
  const [chartType, setChartType] = useState<ChartType>("top50");
  const { data, loading, error, refetch } = useTopCharts(chartType);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <ChartSelector active={chartType} onChange={setChartType} />
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
        <ChartSelector active={chartType} onChange={setChartType} />
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
  if (!data.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Biggest Hits" showPlayAll />
        <ChartSelector active={chartType} onChange={setChartType} />
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

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Biggest Hits" showPlayAll />
      <ChartSelector active={chartType} onChange={setChartType} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: ChartItem, index: number) => (
          <AlbumCard
            key={item.id}
            item={{
              id: item.videoId, // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              position: item.position,
              plays: item.views > 0 ? formatViews(item.views) : undefined,
             
            }}
            showPlayButton
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
  chartSelector: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  chartChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  chartChipActive: {
    backgroundColor: COLORS.goldPrimary,
    borderColor: COLORS.goldPrimary,
  },
  chartIcon: {
    fontSize: 12,
  },
  chartChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  chartChipTextActive: {
    color: "#000",
    fontWeight: "700",
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 14,
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