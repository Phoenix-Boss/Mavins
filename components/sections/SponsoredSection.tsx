/**
 * Sponsored Section - Displays promoted/sponsored content
 * Uses useSponsored hook for data fetching
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useSponsored } from "../../hooks/useSponsored";
import { AlbumCard } from "../cards/AlbumCard";
import { SponsoredBadge } from "../common/SponsoredBadge";
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

export const SponsoredSection = () => {
  const { data: sponsoredContent, loading, error } = useSponsored();

  // Loading State
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Sponsored" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.loadingText}>Loading sponsored content...</Text>
        </View>
      </View>
    );
  }

  // Error State - Section won't render if there's an error
  if (error || !sponsoredContent.length) {
    return null;
  }

  // Success State
  return (
    <View style={styles.section}>
      <SectionHeader title="Sponsored" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {sponsoredContent.map((item) => (
          <View key={item.id || item.videoId} style={styles.sponsoredCard}>
            <AlbumCard 
              item={{
                id: item.videoId,
                title: item.title,
                artist: item.artist,
                thumbnail: item.thumbnail
              }} 
              showPlayButton={false} 
            />
            <SponsoredBadge sponsorName={item.sponsorName} />
          </View>
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
  sponsoredCard: {
    position: 'relative',
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