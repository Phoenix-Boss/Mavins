/**
 * Album Card Component - Displays an album/playlist in a square card format
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
};

interface AlbumCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    position?: number;
    plays?: string;
  };
  showPlayButton?: boolean;
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const AlbumCard = ({ 
  item, 
  showPlayButton = true,
  isCurrentTrack = false,
  isPlaying = false,
  onPress 
}: AlbumCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to album/playlist
      router.navigate(`/album/${item.id}`);
    }
  };

  const handlePlayPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    // Play the first track or album
    router.navigate('/player');
  };

  return (
    <TouchableOpacity
      style={[
        styles.albumCard,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.albumImage}
      />
      
      {/* Netflix-style text overlay on image */}
      <View style={styles.albumTextOverlay}>
        <View style={styles.albumTextContainer}>
          <Text style={styles.albumTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.albumArtist} numberOfLines={1}>
            {item.artist}
          </Text>
        </View>
      </View>
      
      {/* Metallic Play Button - Top Right */}
      {showPlayButton && (
        <View style={styles.albumPlayButtonContainerTopRight}>
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
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  albumCard: {
    width: 130,
    height: 170,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  albumImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  albumTextOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  albumTextContainer: {
    maxWidth: '85%',
  },
  albumTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  albumArtist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
  },
  albumPlayButtonContainerTopRight: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  metallicPlayButtonOutline: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'transparent',
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
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});