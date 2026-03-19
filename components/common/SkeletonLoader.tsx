/**
 * Skeleton Loader Component - Displays loading placeholders
 */
import React from "react";
import {
  View,
  StyleSheet,
  Animated,
} from "react-native";
import { Easing } from "react-native-reanimated";

const COLORS = {
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  skeletonBase: '#1A1A1A',
  skeletonHighlight: '#2A2A2A',
};

interface SkeletonLoaderProps {
  type: 'trending' | 'album' | 'mix' | 'channel' | 'podcast' | 'radio';
}

export const SkeletonLoader = ({ type }: SkeletonLoaderProps) => {
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const backgroundColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.skeletonBase, COLORS.skeletonHighlight],
  });

  // Trending row skeleton
  if (type === 'trending') {
    return (
      <View style={styles.trendingRow}>
        <View style={styles.trendingLeft}>
          <Animated.View style={[styles.trendingThumbnail, { backgroundColor }]} />
          <View style={styles.trendingInfo}>
            <Animated.View style={[styles.titleSkeleton, { backgroundColor, width: 150 }]} />
            <Animated.View style={[styles.artistSkeleton, { backgroundColor, width: 100 }]} />
            <Animated.View style={[styles.playsSkeleton, { backgroundColor, width: 80 }]} />
          </View>
        </View>
        <View style={styles.trendingRight}>
          <Animated.View style={[styles.durationSkeleton, { backgroundColor, width: 40 }]} />
        </View>
      </View>
    );
  }

  // Album/mix card skeleton
  if (type === 'album' || type === 'mix') {
    return (
      <View style={styles.albumCard}>
        <Animated.View style={[styles.albumImage, { backgroundColor }]} />
        <View style={styles.albumOverlay}>
          <Animated.View style={[styles.titleSkeleton, { backgroundColor, width: 80 }]} />
          <Animated.View style={[styles.artistSkeleton, { backgroundColor, width: 60 }]} />
        </View>
      </View>
    );
  }

  // Channel card skeleton
  if (type === 'channel') {
    return (
      <View style={styles.channelCard}>
        <View style={styles.channelHeader}>
          <Animated.View style={[styles.channelLogo, { backgroundColor }]} />
          <View style={styles.channelInfo}>
            <Animated.View style={[styles.titleSkeleton, { backgroundColor, width: 100 }]} />
            <Animated.View style={[styles.playsSkeleton, { backgroundColor, width: 60 }]} />
          </View>
        </View>
        <View style={styles.channelTracks}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.channelTrackRow}>
              <Animated.View style={[styles.trackNumberSkeleton, { backgroundColor, width: 15 }]} />
              <Animated.View style={[styles.trackSkeleton, { backgroundColor, width: 120 }]} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Podcast/radio card skeleton
  return (
    <View style={styles.albumCard}>
      <Animated.View style={[styles.albumImage, { backgroundColor }]} />
      <View style={styles.podcastBadge}>
        <Animated.View style={[styles.badgeSkeleton, { backgroundColor, width: 50 }]} />
      </View>
      <View style={styles.albumOverlay}>
        <Animated.View style={[styles.titleSkeleton, { backgroundColor, width: 80 }]} />
        <Animated.View style={[styles.artistSkeleton, { backgroundColor, width: 60 }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Trending row skeletons
  trendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
  },
  trendingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  trendingThumbnail: {
    width: 46,
    height: 46,
    borderRadius: 6,
  },
  trendingInfo: {
    flex: 1,
    marginLeft: 10,
    gap: 4,
  },
  trendingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  
  // Card skeletons
  albumCard: {
    width: 130,
    height: 170,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  albumImage: {
    width: '100%',
    height: '100%',
  },
  albumOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    gap: 4,
  },
  
  // Channel card skeletons
  channelCard: {
    width: 210,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  channelLogo: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  channelInfo: {
    flex: 1,
    marginLeft: 10,
    gap: 4,
  },
  channelTracks: {
    gap: 4,
  },
  channelTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  
  // Text skeleton sizes
  titleSkeleton: {
    height: 14,
    borderRadius: 4,
  },
  artistSkeleton: {
    height: 12,
    borderRadius: 4,
  },
  playsSkeleton: {
    height: 10,
    borderRadius: 3,
  },
  durationSkeleton: {
    height: 10,
    borderRadius: 3,
  },
  trackNumberSkeleton: {
    height: 10,
    borderRadius: 3,
  },
  trackSkeleton: {
    height: 10,
    borderRadius: 3,
  },
  badgeSkeleton: {
    height: 18,
    borderRadius: 9,
  },
  podcastBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 2,
  },
});