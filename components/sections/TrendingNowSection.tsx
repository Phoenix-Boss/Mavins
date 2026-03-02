/**
 * Trending Now Section - Uses Skeleton UI instead of loading spinner
 */
import React from "react";
import {
  View,
  StyleSheet,
} from "react-native";
import { useTrending } from "../../hooks/useTrending";
import { TrendingSongRow } from "../cards/TrendingSongRow";
import { SectionHeader } from "../common/SectionHeader";
import { SkeletonLoader } from "../common/SkeletonLoader";

const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  text: '#FFFFFF',
  border: '#333333',
};

export const TrendingNowSection = () => {
  const { data: trendingSongs, loading, error } = useTrending();

  const formatDuration = (seconds: number): string => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViews = (views: number): string => {
    if (!views) return "0";
    if (views >= 1_000_000_000) return (views / 1_000_000_000).toFixed(1) + 'B';
    if (views >= 1_000_000) return (views / 1_000_000).toFixed(1) + 'M';
    if (views >= 1_000) return (views / 1_000).toFixed(1) + 'K';
    return views.toString();
  };

  // Skeleton UI for loading state
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Trending Now" showPlayAll={true} />
        <View style={styles.verticalList}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonLoader key={i} type="trending" />
          ))}
        </View>
      </View>
    );
  }

  if (error || !trendingSongs.length) {
    return null;
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Trending Now" showPlayAll={true} />
      <View style={styles.verticalList}>
        {trendingSongs.slice(0, 6).map((item, index) => (
          <TrendingSongRow 
            key={item.id || item.videoId} 
            item={{
              id: item.videoId,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: formatDuration(item.duration),
              plays: formatViews(item.views)
            }} 
            index={index} 
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
});