/**
 * PodcastSection
 *
 * Displays 4 shuffled podcast episodes in a 2x2 grid (no horizontal scroll).
 *
 * Data flow:
 *   usePodcasts()
 *     → Supabase podcast_episodes
 *       title, thumbnail_url, metadata.creator, metadata.video_id
 *       ordered by play_count DESC, created_at DESC
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePodcasts, PodcastItem } from "../../hooks/usePodcasts";
import { PodcastCard } from "../cards/PodcastCard";
import { SectionHeader } from "../common/SectionHeader";

const { width } = Dimensions.get("window");
const GAP        = 8;
const PARENT_PAD = 16; // matches scrollContent paddingHorizontal in index.tsx
const SIDE_PAD   = 14; // comfortable space from screen edge
const CARD_SIZE  = (width - SIDE_PAD * 2 - GAP * 2) / 3 - 4; // -4 shrinks cards slightly

const COLORS = {
  surface:       "#121212",
  goldPrimary:   "#D4AF37",
  danger:        "#EF4444",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const PodcastSection = () => {
  const { data, loading, error, refetch } = usePodcasts();

  // Shuffle and take 9 items for the 3×3 grid
  const gridItems = useMemo(() => {
    if (!data.length) return [];
    return shuffleArray(data).slice(0, 9);
  }, [data]);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Podcasts" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading podcasts…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Podcasts" showPlayAll />
        <View style={styles.centeredBox}>
          <Ionicons name="alert-circle-outline" size={24} color={COLORS.danger} />
          <Text style={styles.errorText}>Could not load podcasts</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty — hides silently ─────────────────
  if (!gridItems.length) return null;

  // ── Success: 3×3 grid ─────────────────────
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
            {row.map((item: PodcastItem, colIndex: number) => (
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
    marginHorizontal: -PARENT_PAD, // break out of parent padding
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
  centeredBox: {
    padding: 40,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    marginTop: 4,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});