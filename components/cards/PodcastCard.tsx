/**
 * Podcast Card Component - Displays a podcast episode or show
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
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  success: '#22C55E',
};

interface PodcastCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    episodeCount?: number;
    type: 'podcast';
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const PodcastCard = ({ 
  item, 
  isCurrentTrack = false,
  isPlaying = false,
  onPress 
}: PodcastCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to podcast
      router.navigate(`/podcast/${item.id}`);
    }
  };

  const handlePlayPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    // Play the latest episode
    router.navigate('/player');
  };

  return (
    <TouchableOpacity
      style={[
        styles.podcastCard,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.podcastImage}
      />
      
      <View style={styles.podcastBadge}>
        <Text style={styles.podcastBadgeText}>PODCAST</Text>
      </View>
      
      {item.episodeCount && (
        <View style={styles.episodeCountBadge}>
          <Ionicons name="mic-outline" size={10} color={COLORS.goldShiny} />
          <Text style={styles.episodeCountText}>{item.episodeCount}</Text>
        </View>
      )}
      
      {/* Play button top right */}
      <View style={styles.podcastPlayButtonContainer}>
        <TouchableOpacity 
          style={[
            styles.metallicPlayButtonOutline,
            isCurrentTrack && styles.activePlayButton
          ]}
          onPress={handlePlayPress}
        >
          <Ionicons 
            name={isCurrentTrack && isPlaying ? "pause" : "play"} 
            size={14} 
            color={COLORS.goldShiny} 
          />
        </TouchableOpacity>
      </View>
      
      <View style={styles.podcastInfo}>
        <Text style={styles.podcastTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.podcastArtist} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  podcastCard: {
    width: 130,
    height: 170,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  podcastImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  podcastBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: COLORS.success,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    zIndex: 2,
  },
  podcastBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.background,
  },
  episodeCountBadge: {
    position: 'absolute',
    top: 6,
    right: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  episodeCountText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.goldShiny,
  },
  podcastPlayButtonContainer: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
  },
  metallicPlayButtonOutline: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderWidth: 1.5,
    borderColor: COLORS.goldShiny,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 3,
  },
  activePlayButton: {
    backgroundColor: COLORS.goldPrimary + '30',
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 6,
  },
  podcastInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  podcastTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  podcastArtist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
  },
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});