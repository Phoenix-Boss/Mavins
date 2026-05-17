/**
 * Skeleton Loader Component - Displays loading placeholders
 * Upgraded to support local music folder browsing, file rows, and preview cards
 */
import React from "react";
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SkeletonLoaderProps {
  type: 
    | 'trending' 
    | 'album' 
    | 'mix' 
    | 'channel' 
    | 'podcast' 
    | 'radio'
    | 'folderRow'
    | 'fileRow'
    | 'folderPreviewCard'
    | 'breadcrumb'
    | 'gridFolder'
    | 'watchedFolderRow';
  count?: number;
  showIcon?: boolean;
}

export const SkeletonLoader = ({ type, count = 1, showIcon = true }: SkeletonLoaderProps) => {
  const { colors, isDark } = useTheme();
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  }, []);

  const backgroundColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isDark ? '#1A1A1A' : '#E0E0E0',
      isDark ? '#2A2A2A' : '#F0F0F0',
    ],
  });

  // Folder Row Skeleton (for folder browser)
  if (type === 'folderRow') {
    return (
      <View style={styles.folderRow}>
        {showIcon && (
          <Animated.View style={[styles.folderIconSkeleton, { backgroundColor }]} />
        )}
        <View style={styles.folderInfo}>
          <Animated.View style={[styles.folderNameSkeleton, { backgroundColor, width: '60%' }]} />
          <Animated.View style={[styles.folderPathSkeleton, { backgroundColor, width: '40%' }]} />
        </View>
        <Animated.View style={[styles.folderButtonSkeleton, { backgroundColor }]} />
      </View>
    );
  }

  // File Row Skeleton (grayed out, non-interactive)
  if (type === 'fileRow') {
    return (
      <View style={styles.fileRow}>
        {showIcon && (
          <Animated.View style={[styles.fileIconSkeleton, { backgroundColor }]} />
        )}
        <View style={styles.fileInfo}>
          <Animated.View style={[styles.fileNameSkeleton, { backgroundColor, width: '70%' }]} />
          <Animated.View style={[styles.fileMetaSkeleton, { backgroundColor, width: '40%' }]} />
        </View>
        <Animated.View style={[styles.fileDisabledSkeleton, { backgroundColor }]} />
      </View>
    );
  }

  // Folder Preview Card Skeleton
  if (type === 'folderPreviewCard') {
    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeader}>
          <Animated.View style={[styles.previewIconSkeleton, { backgroundColor }]} />
          <View style={styles.previewInfo}>
            <Animated.View style={[styles.previewNameSkeleton, { backgroundColor, width: '60%' }]} />
            <Animated.View style={[styles.previewCountSkeleton, { backgroundColor, width: '30%' }]} />
          </View>
          <Animated.View style={[styles.previewWarningSkeleton, { backgroundColor, width: 60 }]} />
        </View>
        <View style={styles.previewSongs}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.previewSongRow}>
              <Animated.View style={[styles.previewSongIconSkeleton, { backgroundColor }]} />
              <Animated.View style={[styles.previewSongTitleSkeleton, { backgroundColor, width: '60%' }]} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Breadcrumb Skeleton
  if (type === 'breadcrumb') {
    return (
      <View style={styles.breadcrumbRow}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.breadcrumbSegment}>
            <Animated.View style={[styles.breadcrumbTextSkeleton, { backgroundColor, width: 40 }]} />
            {i < 3 && <Animated.View style={[styles.breadcrumbIconSkeleton, { backgroundColor, width: 14, height: 14 }]} />}
          </View>
        ))}
      </View>
    );
  }

  // Grid Folder Skeleton (for album/artist grid view)
  if (type === 'gridFolder') {
    return (
      <View style={styles.gridCard}>
        <Animated.View style={[styles.gridImageSkeleton, { backgroundColor }]} />
        <Animated.View style={[styles.gridTitleSkeleton, { backgroundColor, width: '80%' }]} />
        <Animated.View style={[styles.gridSubtitleSkeleton, { backgroundColor, width: '60%' }]} />
      </View>
    );
  }

  // Watched Folder Row Skeleton
  if (type === 'watchedFolderRow') {
    return (
      <View style={styles.watchedFolderRow}>
        <Animated.View style={[styles.watchedIconSkeleton, { backgroundColor }]} />
        <View style={styles.watchedInfo}>
          <Animated.View style={[styles.watchedNameSkeleton, { backgroundColor, width: '50%' }]} />
          <Animated.View style={[styles.watchedMetaSkeleton, { backgroundColor, width: '35%' }]} />
        </View>
        <Animated.View style={[styles.watchedBadgeSkeleton, { backgroundColor, width: 16, height: 16, borderRadius: 8 }]} />
      </View>
    );
  }

  // ==================== EXISTING SKELETONS ====================

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

// Multi-skeleton wrapper for lists
export const SkeletonList = ({ type, count }: { type: SkeletonLoaderProps['type']; count: number }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonLoader key={index} type={type} />
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  // ==================== LOCAL MUSIC SKELETONS ====================
  
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  folderIconSkeleton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  folderInfo: {
    flex: 1,
    gap: 6,
  },
  folderNameSkeleton: {
    height: 16,
    borderRadius: 4,
  },
  folderPathSkeleton: {
    height: 12,
    borderRadius: 3,
  },
  folderButtonSkeleton: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    opacity: 0.6,
  },
  fileIconSkeleton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
    gap: 4,
  },
  fileNameSkeleton: {
    height: 14,
    borderRadius: 4,
  },
  fileMetaSkeleton: {
    height: 11,
    borderRadius: 3,
  },
  fileDisabledSkeleton: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  
  previewCard: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(212,175,55,0.22)',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewIconSkeleton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  previewInfo: {
    flex: 1,
    gap: 6,
  },
  previewNameSkeleton: {
    height: 16,
    borderRadius: 4,
  },
  previewCountSkeleton: {
    height: 12,
    borderRadius: 3,
  },
  previewWarningSkeleton: {
    height: 24,
    borderRadius: 12,
  },
  previewSongs: {
    gap: 8,
  },
  previewSongRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewSongIconSkeleton: {
    width: 32,
    height: 32,
    borderRadius: 6,
  },
  previewSongTitleSkeleton: {
    height: 12,
    borderRadius: 3,
  },
  
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  breadcrumbSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbTextSkeleton: {
    height: 12,
    borderRadius: 3,
  },
  breadcrumbIconSkeleton: {
    borderRadius: 2,
  },
  
  gridCard: {
    width: (SCREEN_WIDTH - 48) / 2,
    alignItems: 'center',
    paddingVertical: 12,
  },
  gridImageSkeleton: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  gridTitleSkeleton: {
    height: 14,
    borderRadius: 4,
    marginTop: 8,
  },
  gridSubtitleSkeleton: {
    height: 11,
    borderRadius: 3,
    marginTop: 4,
  },
  
  watchedFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.05)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  watchedIconSkeleton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    marginRight: 12,
  },
  watchedInfo: {
    flex: 1,
    gap: 4,
  },
  watchedNameSkeleton: {
    height: 14,
    borderRadius: 4,
  },
  watchedMetaSkeleton: {
    height: 12,
    borderRadius: 3,
  },
  watchedBadgeSkeleton: {
    marginLeft: 8,
  },

  // ==================== EXISTING SKELETONS ====================
  
  trendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    padding: 10,
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

  albumCard: {
    width: 130,
    height: 170,
    borderRadius: 10,
    overflow: 'hidden',
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

  channelCard: {
    width: 210,
    borderRadius: 10,
    padding: 10,
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
