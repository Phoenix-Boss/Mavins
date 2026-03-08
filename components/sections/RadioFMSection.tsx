/**
 * RadioFMSection
 *
 * Displays live music streams sourced from YouTube search.
 *
 * Data flow:
 *   useLiveStations()
 *     → MavinEngine.search("live music stream", "all", undefined, 0)
 *       → Kotlin: performSearch(query, "all", null, 0)
 *       → filters results to item.isLive === true
 *
 * NOTE: getKioskInfo("Live") is NOT used — YouTube does not register
 * a "Live" kiosk in NewPipeExtractor and throws ExtractionException.
 * Search with isLive filtering is the correct approach.
 *
 * RadioFMCard receives LiveStationItem fields (StreamInfoItem from hook).
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLiveStations, LiveStationItem, formatViewers } from "../../hooks/useLiveStations";
import { RadioFMCard } from "../cards/RadioFMCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  surface: "#121212",
  goldPrimary: "#D4AF37",
  textSecondary: "#B3B3B3",
};

export const RadioFMSection = () => {
  const { data, loading, error } = useLiveStations();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading live stations…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Radio FM" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: LiveStationItem) => (
          <RadioFMCard
            key={item.url}
            item={{
              id: item.url,
              title: item.name,
              artist: item.uploaderName,
              thumbnail: item.thumbnails[0]?.url ?? "",
              viewers: formatViewers(item.viewCount),
              live: true,
            }}
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