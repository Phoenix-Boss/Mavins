/**
 * Mix Card Component - Displays a mix/playlist in a square card format
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

interface MixCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    reason?: string;
    releaseDate?: string;
    originalArtist?: string;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const MixCard = ({ 
  item, 
  isCurrentTrack = false,
  isPlaying = false,
  onPress 
}: MixCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to mix/playlist
      router.navigate(`/mix/${item.id}`);
    }
  };

  const handlePlayPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    // Play the mix
    router.navigate('/player');
  };

  return (
    <TouchableOpacity
      style={[
        styles.mixCard,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.mixCardImage}
      />
      
      {/* Play button top right */}
      <View style={styles.mixCardPlayButtonContainer}>
        <TouchableOpacity 
          style={[
            styles.metallicPlayButtonOutline,
            isCurrentTrack && styles.activePlayButton
          ]}
          onPress={handlePlayPress}
        >
          <Ionicons 
            name={isCurrentTrack && isPlaying ? "pause" : "play"} 
            size={12} 
            color={COLORS.goldShiny} 
          />
        </TouchableOpacity>
      </View>
      
      <View style={styles.mixCardOverlay}>
        <Text style={styles.mixCardTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.mixCardArtist} numberOfLines={1}>
          {item.artist}
        </Text>
        {item.reason && (
          <Text style={styles.mixCardReason} numberOfLines={1}>
            {item.reason}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  mixCard: {
    width: 150,
    height: 150,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  mixCardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  mixCardPlayButtonContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
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
  mixCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  mixCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  mixCardArtist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
    marginBottom: 2,
  },
  mixCardReason: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});