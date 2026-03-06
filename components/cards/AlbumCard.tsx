/**
 * Album Card Component - Displays an album/playlist in a square card format
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

interface AlbumCardProps {
  item?: {
    id?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    position?: number;
    plays?: string;
  };
  showPlayButton?: boolean;
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  fallbackTitle?: string;
}

export const AlbumCard = ({ 
  item, 
  showPlayButton = true,
  isCurrentTrack = false,
  isPlaying = false,
  onPress,
  fallbackTitle = "Unknown Album"
}: AlbumCardProps) => {
  const router = useRouter();

  // ✅ DEFENSIVE: Handle missing or invalid item
  const safeItem = {
    id: item?.id || `fallback_${Math.random()}`,
    title: item?.title || fallbackTitle,
    artist: item?.artist || "Unknown Artist",
    thumbnail: item?.thumbnail || null,
    position: item?.position,
    plays: item?.plays
  };

  const hasValidImage = safeItem.thumbnail && safeItem.thumbnail.startsWith('http');

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else if (safeItem.id && !safeItem.id.startsWith('fallback_')) {
      router.navigate(`/album/${safeItem.id}`);
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
        styles.albumCard,
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
          style={styles.albumImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.albumImage, styles.fallbackImage]}>
          <Ionicons name="musical-note" size={40} color={COLORS.goldShimmer} />
        </View>
      )}
      
      {/* Text overlay */}
      <View style={styles.albumTextOverlay}>
        <View style={styles.albumTextContainer}>
          {/* Position badge if available */}
          {safeItem.position && safeItem.position > 0 && (
            <View style={styles.positionBadge}>
              <Text style={styles.positionText}>#{safeItem.position}</Text>
            </View>
          )}
          
          <Text style={styles.albumTitle} numberOfLines={1}>
            {safeItem.title}
          </Text>
          <Text style={styles.albumArtist} numberOfLines={1}>
            {safeItem.artist}
          </Text>
          
          {/* Plays count if available */}
          {safeItem.plays && (
            <Text style={styles.playsText}>{safeItem.plays} plays</Text>
          )}
        </View>
      </View>
      
      {/* Play Button */}
      {showPlayButton && hasValidImage && (
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
    backgroundColor: COLORS.surfaceLight,
  },
  noImageCard: {
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + '30',
  },
  albumImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceLight,
  },
  fallbackImage: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  albumTextOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  albumTextContainer: {
    maxWidth: '100%',
  },
  positionBadge: {
    position: 'absolute',
    top: -25,
    left: 0,
    backgroundColor: COLORS.goldPrimary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  positionText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
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
    marginBottom: 2,
  },
  playsText: {
    fontSize: 10,
    color: COLORS.textMuted,
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