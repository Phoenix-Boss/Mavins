/**
 * FeaturedSection
 *
 * Displays curated featured music from the YouTube Music kiosk.
 *
 * Data flow:
 *   useFeatured()
 *     → MavinEngine.getYouTubeKiosk("MUSIC", 0)
 *       → Kotlin: extractKioskInfo("Music", null, 0)
 *
 * AlbumCard receives only fields present on StreamInfoItem.
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useFeatured } from "../../hooks/useFeatured";
import { AlbumCard } from "../cards/AlbumCard";
import { SectionHeader } from "../common/SectionHeader";
import { StreamInfoItem } from "@/modules/mavin-engine";

const COLORS = {
  surface: "#121212",
  goldPrimary: "#D4AF37",
  textSecondary: "#B3B3B3",
};

function formatViews(viewCount: number): string {
  if (!viewCount) return "0";
  if (viewCount >= 1_000_000_000)
    return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

export const FeaturedSection = () => {
  const { data, loading, error } = useFeatured();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Featured" />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading featured music…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Featured" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: StreamInfoItem) => (
          <AlbumCard
            key={item.url}
            item={{
              id: item.url, // full stream url for playback
              title: item.name, // StreamInfoItem.name
              artist: item.uploaderName, // StreamInfoItem.uploaderName
              thumbnail: item.thumbnails[0]?.url ?? "",
              plays: formatViews(item.viewCount),
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
});