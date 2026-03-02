/**
 * Music Channels Section - Displays genre-based music channels/stations
 * Uses useGenreStations hook for data fetching
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useGenreStations } from "../../hooks/useGenreStations";
import { MusicChannelCard } from "../cards/MusicChannelCard";
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

export const MusicChannelsSection = () => {
  const { data: channels, loading, error } = useGenreStations(4);

  // Loading State
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll={true} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.loadingText}>Loading music channels...</Text>
        </View>
      </View>
    );
  }

  // Error State
  if (error || !channels.length) {
    return null;
  }

  // Success State
  return (
    <View style={styles.section}>
      <SectionHeader title="Music Channels" showPlayAll={true} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {channels.map((item) => (
          <MusicChannelCard 
            key={item.id} 
            item={item}
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