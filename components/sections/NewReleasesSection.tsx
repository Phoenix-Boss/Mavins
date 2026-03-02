/**
 * New Releases Section - Displays newly released music
 * Uses Skeleton UI instead of loading spinner
 */
import React from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useNewReleases } from "../../hooks/useNewReleases";
import { MixCard } from "../cards/MixCard";
import { SectionHeader } from "../common/SectionHeader";
import { SkeletonLoader } from "../common/SkeletonLoader";

const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  text: '#FFFFFF',
  border: '#333333',
};

export const NewReleasesSection = () => {
  const { data: newReleases, loading, error } = useNewReleases();

  // Skeleton UI for loading state
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="New" showPlayAll={true} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalScroll}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonLoader key={i} type="mix" />
          ))}
        </ScrollView>
      </View>
    );
  }

  if (error || !newReleases.length) {
    return null;
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="New" showPlayAll={true} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {newReleases.slice(0, 8).map((item) => (
          <MixCard 
            key={item.id || item.videoId} 
            item={{
              id: item.videoId,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              releaseDate: item.releaseDate
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
});