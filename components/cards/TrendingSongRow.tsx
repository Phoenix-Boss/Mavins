/**
 * Trending Song Row Component - Displays a single trending song in a row layout
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";

// Metallic Gold Color Palette
const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  surfaceDark: '#0A0A0A',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  goldMuted: '#C9A96A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  border: '#333333',
  success: '#22C55E',
};

interface TrendingSongRowProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    duration: string;
    plays: string;
  };
  index: number;
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  onAddToQueue?: () => void;
}

export const TrendingSongRow = ({ 
  item, 
  index,
  isCurrentTrack = false,
  isPlaying = false,
  onPress,
  onAddToQueue 
}: TrendingSongRowProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to player
      router.navigate('/player');
    }
  };

  const handleAddToQueue = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    if (onAddToQueue) {
      onAddToQueue();
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.trendingRow,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.trendingRowLeft}>
        <View style={styles.thumbnailWithPlayIndicator}>
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.trendingThumbnail}
          />
          {isCurrentTrack && (
            <View style={styles.currentTrackIndicator}>
              <Ionicons 
                name={isPlaying ? "pause" : "play"} 
                size={10} 
                color={COLORS.goldShiny} 
              />
            </View>
          )}
        </View>
        <View style={styles.trendingInfo}>
          <Text style={[
            styles.trendingSongTitle,
            isCurrentTrack && styles.currentTrackText
          ]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.trendingSongArtist} numberOfLines={1}>
            {item.artist}
          </Text>
          <Text style={styles.trendingSongPlays}>{item.plays} plays</Text>
        </View>
      </View>
      <View style={styles.trendingRowRight}>
        <Text style={[
          styles.trendingDuration,
          isCurrentTrack && styles.currentTrackText
        ]}>
          {item.duration}
        </Text>
        <TouchableOpacity 
          style={styles.trendingMenuButton}
          onPress={handleAddToQueue}
          hitSlop={8}
        >
          <Ionicons name="add-circle-outline" size={20} color={COLORS.goldShimmer} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  trendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  trendingRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  thumbnailWithPlayIndicator: {
    position: 'relative',
  },
  trendingThumbnail: {
    width: 46,
    height: 46,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceLight,
  },
  currentTrackIndicator: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1.5,
    borderColor: COLORS.goldPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  trendingInfo: {
    flex: 1,
    marginLeft: 10,
    maxWidth: '70%',
  },
  trendingSongTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  trendingSongArtist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
    marginBottom: 2,
  },
  trendingSongPlays: {
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  trendingRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trendingDuration: {
    fontSize: 10,
    color: COLORS.goldMuted,
  },
  trendingMenuButton: {
    padding: 3,
  },
  currentPlayingTrack: {
    backgroundColor: COLORS.goldPrimary + '15',
    borderColor: COLORS.goldPrimary,
    borderWidth: 1.5,
  },
  currentTrackText: {
    color: COLORS.goldPrimary,
    fontWeight: '700',
  },
});