/**
 * Mix Card Component - Displays a mix/playlist in a square card format
 * v1.1 - With defensive checks for missing data
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
  textMuted: '#808080',
};

interface MixCardProps {
  item?: {
    id?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    reason?: string;
    releaseDate?: string;
    originalArtist?: string;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  fallbackTitle?: string;
}

export const MixCard = ({ 
  item, 
  isCurrentTrack = false,
  isPlaying = false,
  onPress,
  fallbackTitle = "Unknown Mix"
}: MixCardProps) => {
  const router = useRouter();

  // ✅ DEFENSIVE: Handle missing or invalid item
  const safeItem = {
    id: item?.id || `fallback_${Math.random()}`,
    title: item?.title || fallbackTitle,
    artist: item?.artist || "Unknown Artist",
    thumbnail: item?.thumbnail || null,
    reason: item?.reason,
    releaseDate: item?.releaseDate,
    originalArtist: item?.originalArtist
  };

  const hasValidImage = safeItem.thumbnail && safeItem.thumbnail.startsWith('http');

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else if (safeItem.id && !safeItem.id.startsWith('fallback_')) {
      router.navigate(`/mix/${safeItem.id}`);
    }
  };

  const handlePlayPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    router.navigate('/player');
  };

  return (
    <TouchableOpacity
      style={[
        styles.mixCard,
        isCurrentTrack && styles.currentPlayingTrack,
        !hasValidImage && styles.noImageCard
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      {/* ✅ Image with fallback */}
      {hasValidImage ? (
        <Image
          source={{ uri: safeItem.thumbnail }}
          style={styles.mixCardImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.mixCardImage, styles.fallbackImage]}>
          <Ionicons name="musical-notes" size={40} color={COLORS.goldShimmer} />
        </View>
      )}
      
      {/* Play button top right */}
      {hasValidImage && (
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
      )}
      
      <View style={styles.mixCardOverlay}>
        <Text style={styles.mixCardTitle} numberOfLines={1}>
          {safeItem.title}
        </Text>
        <Text style={styles.mixCardArtist} numberOfLines={1}>
          {safeItem.artist}
        </Text>
        {safeItem.reason && (
          <Text style={styles.mixCardReason} numberOfLines={1}>
            {safeItem.reason}
          </Text>
        )}
        {safeItem.releaseDate && (
          <Text style={styles.mixCardDate} numberOfLines={1}>
            {safeItem.releaseDate}
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
    backgroundColor: COLORS.surfaceLight,
  },
  noImageCard: {
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + '30',
  },
  mixCardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  fallbackImage: {
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
    marginBottom: 2,
  },
  mixCardDate: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});