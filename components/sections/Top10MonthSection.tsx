/**
 * Top10MonthSection
 *
 * Displays monthly chart rankings from Supabase — shuffled, no position numbers.
 * Accepts `excludedIds` to prevent songs already shown in other sections
 * from appearing here.
 *
 * Usage:
 *   <Top10MonthSection excludedIds={someOtherSectionVideoIds} />
 *
 * Data flow:
 *   useMonthlyTop()
 *     → Supabase chart_rankings joined with songs
 */

import React, { useMemo } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useMonthlyTop, MonthlyItem } from "../../hooks/useMonthlyTop";
import { Top10MonthRow } from "../cards/Top10MonthRow";
import { SectionHeader } from "../common/SectionHeader";

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

interface Top10MonthSectionProps {
  /**
   * IDs (song id or videoId) already rendered in another section.
   * Any item whose `id` or `videoId` matches will be hidden here.
   */
  excludedIds?: string[];
}

export const Top10MonthSection = ({ excludedIds = [] }: Top10MonthSectionProps) => {
  const { data, loading, error } = useMonthlyTop();

  // Filter out songs already shown elsewhere, then deduplicate by id
  const filteredData = useMemo(() => {
    const excludedSet = new Set(excludedIds);
    const seen = new Set<string>();

    return data.filter((item: MonthlyItem) => {
      if (excludedSet.has(item.id) || excludedSet.has(item.videoId)) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [data, excludedIds]);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Top 10 for the Month" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading monthly chart…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !filteredData.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Top 10 for the Month" showPlayAll />
      <View style={styles.verticalList}>
        {filteredData.map((item: MonthlyItem, index: number) => (
          <Top10MonthRow
            key={`top10-month-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views),
            }}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  verticalList: {
    gap: 10,
    paddingHorizontal: 16,
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