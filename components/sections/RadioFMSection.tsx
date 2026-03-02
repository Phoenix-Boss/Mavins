/**
 * Radio FM Section - Displays live radio stations and live streams
 * Uses useLiveStations hook for data fetching
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLiveStations } from "../../hooks/useLiveStations";
import { RadioFMCard } from "../cards/RadioFMCard";
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
  liveTag: '#3B82F6',
};

export const RadioFMSection = () => {
  const { data: liveStations, loading, error, formatViewers } = useLiveStations();

  // Loading State
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll={true} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.loadingText}>Loading live stations...</Text>
        </View>
      </View>
    );
  }

  // Error State - Section won't render if there's an error
  if (error || !liveStations.length) {
    return null;
  }

  // Success State
  return (
    <View style={styles.section}>
      <SectionHeader title="Radio FM" showPlayAll={true} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {liveStations.slice(0, 8).map((item) => (
          <RadioFMCard 
            key={item.id || item.videoId} 
            item={{
              id: item.videoId,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              viewers: formatViewers(item.viewers),
              live: true
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
    zIndex: 2,
  },
  horizontalScroll: {
    paddingRight: 16,
    gap: 14,
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