/**
 * Top10MonthSection
 *
 * Displays monthly chart rankings as a vertical list.
 *
 * Data flow:
 *   useMonthlyTop()
 *     → MavinEngine.search("top songs this month 2025", "songs")
 *       → Kotlin: performSearch(query, "songs", null, 0)
 *
 * Top10MonthRow receives only fields present on MonthlyItem.
 * previousPosition is removed — it doesn't exist on StreamInfoItem.
 * position is always set (1-based from result order) so no fallback needed.
 */

import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useMonthlyTop, MonthlyItem } from '../../hooks/useMonthlyTop';
import { Top10MonthRow } from '../cards/Top10MonthRow';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
};

const formatViews = (views: number): string => {
  if (!views) return '0';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000)     return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000)         return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
};

export const Top10MonthSection = () => {
  const { data, loading, error } = useMonthlyTop();

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
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Top 10 for the Month" showPlayAll />
      <View style={styles.verticalList}>
        {data.map((item: MonthlyItem) => (
          <Top10MonthRow
            key={item.id}
            item={{
              id: item.videoId,              // full stream url for playback
              // position prepended to title for display
              title: `${item.position}. ${item.title}`,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views),
              position: item.position,       // always set — 1-based from result order
              duration: item.duration,
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
    alignItems: 'center',
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