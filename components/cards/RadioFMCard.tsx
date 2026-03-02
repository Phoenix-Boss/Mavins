/**
 * Radio FM Card Component - Displays a live radio station
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
  liveTag: '#3B82F6',
};

interface RadioFMCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    viewers: string;
    live: boolean;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const RadioFMCard = ({ 
  item, 
  isCurrentTrack = false,
  isPlaying = false,
  onPress 
}: RadioFMCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to radio station
      router.navigate(`/radio/${item.id}`);
    }
  };

  const handlePlayPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    // Play live stream
    router.navigate('/(player)');
  };

  return (
    <TouchableOpacity
      style={[
        styles.radioCard,
        isCurrentTrack && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.radioImage}
      />
      
      <View style={styles.radioBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.radioBadgeText}>LIVE</Text>
      </View>
      
      {item.viewers && (
        <View style={styles.viewerBadge}>
          <Ionicons name="eye-outline" size={10} color={COLORS.goldShiny} />
          <Text style={styles.viewerText}>{item.viewers}</Text>
        </View>
      )}
      
      {/* Play button top right */}
      <View style={styles.radioPlayButtonContainer}>
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
      
      <View style={styles.radioInfo}>
        <Text style={styles.radioTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.radioArtist} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  radioCard: {
    width: 130,
    height: 170,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  radioImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  radioBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: COLORS.liveTag,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 3,
    zIndex: 2,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.background,
  },
  radioBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.background,
  },
  viewerBadge: {
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
  viewerText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.goldShiny,
  },
  radioPlayButtonContainer: {
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
  radioInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  radioTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  radioArtist: {
    fontSize: 12,
    color: COLORS.goldShimmer,
  },
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});