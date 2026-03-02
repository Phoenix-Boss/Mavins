/**
 * Top 10 Month Row Component - Displays a single top 10 chart row with position
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
};

interface Top10MonthRowProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    plays: string;
    position: number;
    previousPosition?: number;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const Top10MonthRow = ({ 
  item, 
  isCurrentTrack = false,
  isPlaying = false,
  onPress 
}: Top10MonthRowProps) => {
  const router = useRouter();
  
  // Extract track title without position number
  const trackTitle = item.title.includes('. ') ? item.title.split('. ')[1] : item.title;
  const position = item.position || parseInt(item.title.split('.')[0]) || 1;
  
  // Determine position change indicator
  const getPositionChange = () => {
    if (!item.previousPosition) return null;
    if (item.previousPosition > position) {
      return { icon: 'arrow-up', color: '#22C55E' };
    } else if (item.previousPosition < position) {
      return { icon: 'arrow-down', color: '#EF4444' };
    }
    return { icon: 'remove', color: COLORS.goldMuted };
  };

  const positionChange = getPositionChange();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to track
      router.navigate(`/track/${item.id}`);
    }
  };

  const handleMenuPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    // Open options menu
  };

  return (
    <TouchableOpacity
      style={[
        styles.top10Row,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.positionContainer}>
        <Text style={[
          styles.top10Rank,
          isCurrentTrack && styles.currentTrackText
        ]}>
          {position}
        </Text>
        {positionChange && (
          <Ionicons 
            name={positionChange.icon} 
            size={12} 
            color={positionChange.color} 
            style={styles.positionIcon}
          />
        )}
      </View>
      
      <View style={styles.thumbnailWithPlayIndicator}>
        <Image
          source={{ uri: item.thumbnail }}
          style={styles.top10Thumbnail}
        />
        {isCurrentTrack && (
          <View style={styles.currentTrackIndicator}>
            <Ionicons 
              name={isPlaying ? "pause" : "play"} 
              size={8} 
              color={COLORS.goldShiny} 
            />
          </View>
        )}
      </View>
      
      <View style={styles.top10Info}>
        <Text style={[
          styles.top10Title,
          isCurrentTrack && styles.currentTrackText
        ]} numberOfLines={1}>
          {trackTitle}
        </Text>
        <Text style={styles.top10Artist} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
      
      <View style={styles.top10Right}>
        <Text style={styles.top10Plays}>{item.plays}</Text>
        <TouchableOpacity 
          style={styles.trendingMenuButton}
          onPress={handleMenuPress}
          hitSlop={8}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={COLORS.goldShimmer} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  top10Row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  positionContainer: {
    width: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  top10Rank: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.goldPrimary,
    textAlign: 'center',
  },
  positionIcon: {
    marginTop: 2,
  },
  thumbnailWithPlayIndicator: {
    position: 'relative',
    marginRight: 10,
  },
  top10Thumbnail: {
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
  top10Info: {
    flex: 1,
    marginRight: 8,
  },
  top10Title: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  top10Artist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
  },
  top10Right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  top10Plays: {
    fontSize: 10,
    color: COLORS.textTertiary,
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