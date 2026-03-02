/**
 * Top 10 for the Month Section - Displays monthly chart rankings
 * Uses useMonthlyTop hook for data fetching
 */
import React from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useMonthlyTop } from "../../hooks/useMonthlyTop";
import { Top10MonthRow } from "../cards/Top10MonthRow";
import { SectionHeader } from "../common/SectionHeader";

// Metallic Gold Color Palette
const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  goldMuted: '#C9A96A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  border: '#333333',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
};

// Format view counts
const formatViews = (views: number): string => {
  if (!views) return "0";
  if (views >= 1_000_000_000) {
    return (views / 1_000_000_000).toFixed(1) + 'B';
  }
  if (views >= 1_000_000) {
    return (views / 1_000_000).toFixed(1) + 'M';
  }
  if (views >= 1_000) {
    return (views / 1_000).toFixed(1) + 'K';
  }
  return views.toString();
};

export const Top10MonthSection = () => {
  const { data: monthlySongs, loading, error } = useMonthlyTop();

  // Loading State
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Top 10 for the Month" showPlayAll={true} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.loadingText}>Loading monthly chart...</Text>
        </View>
      </View>
    );
  }

  // Error State
  if (error || !monthlySongs.length) {
    return null;
  }

  // Success State
  return (
    <View style={styles.section}>
      <SectionHeader title="Top 10 for the Month" showPlayAll={true} />
      <View style={styles.verticalList}>
        {monthlySongs.slice(0, 10).map((item) => (
          <Top10MonthRow 
            key={item.id || item.videoId} 
            item={{
              id: item.videoId,
              title: `${item.position}. ${item.title}`,
              artist: item.artist,
              thumbnail: item.thumbnail,
              plays: formatViews(item.views),
              position: item.position,
              previousPosition: item.previousPosition
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
    zIndex: 2,
  },
  verticalList: {
    gap: 10,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
  },
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 10,
  },
});