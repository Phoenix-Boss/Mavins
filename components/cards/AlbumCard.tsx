/**
 * Album Card Component - Displays an album/playlist in a square card format
 * v1.5 - Theme-aware with proper overlay colors for light/dark mode
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
import { useTheme } from "@/contexts/ThemeContext";

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
  const { colors, isDark } = useTheme();

  const safeItem = {
    id: item?.id || `fallback_${Math.random()}`,
    title: item?.title || fallbackTitle,
    artist: item?.artist || "Unknown Artist",
    thumbnail: item?.thumbnail || undefined,
    position: item?.position,
    plays: item?.plays
  };

  const hasValidImage = !!safeItem.thumbnail && safeItem.thumbnail.startsWith('http');

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
    router.navigate('/(player)');
  };

  // Theme-aware overlay background
  const overlayBackground = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)';

  return (
    <TouchableOpacity
      style={[
        styles.albumCard,
        { backgroundColor: colors.surface },
        isCurrentTrack && { borderColor: colors.gold, borderWidth: 2 },
        !hasValidImage && { borderColor: `${colors.gold}30`, borderWidth: 1 }
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      {hasValidImage ? (
        <Image
          source={{ uri: safeItem.thumbnail }}
          style={styles.albumImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.albumImage, styles.fallbackImage, { backgroundColor: colors.surfaceLight }]}>
          <Ionicons name="musical-note" size={32} color={colors.gold} />
        </View>
      )}
      
      <View style={[styles.albumTextOverlay, { backgroundColor: overlayBackground }]}>
        <View style={styles.albumTextContainer}>
          {safeItem.position && safeItem.position > 0 && (
            <View style={[styles.positionBadge, { backgroundColor: colors.gold }]}>
              <Text style={[styles.positionText, { color: colors.textInverse }]}>#{safeItem.position}</Text>
            </View>
          )}
          
          <Text style={[styles.albumTitle, { color: isDark ? colors.text : colors.text }]} numberOfLines={1}>
            {safeItem.title}
          </Text>
          <Text style={[styles.albumArtist, { color: colors.gold }]} numberOfLines={1}>
            {safeItem.artist}
          </Text>
          
          {safeItem.plays && (
            <Text style={[styles.playsText, { color: colors.textSub }]}>{safeItem.plays} plays</Text>
          )}
        </View>
      </View>
      
      {showPlayButton && hasValidImage && (
        <View style={styles.albumPlayButtonContainerTopRight}>
          <TouchableOpacity 
            style={[
              styles.metallicPlayButtonOutline,
              { borderColor: colors.gold, shadowColor: colors.gold },
              isCurrentTrack && { backgroundColor: `${colors.gold}30`, shadowOpacity: 0.9 }
            ]}
            onPress={handlePlayPress}
          >
            <Ionicons 
              name={isCurrentTrack && isPlaying ? "pause" : "play"} 
              size={12} 
              color={colors.gold} 
            />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  albumCard: {
    width: 110,
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  albumImage: {
    width: '100%',
    height: '100%',
  },
  fallbackImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumTextOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
  },
  albumTextContainer: {
    maxWidth: '100%',
  },
  positionBadge: {
    position: 'absolute',
    top: -20,
    left: 0,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  positionText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  albumTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 1,
  },
  albumArtist: {
    fontSize: 10,
    marginBottom: 1,
  },
  playsText: {
    fontSize: 9,
  },
  albumPlayButtonContainerTopRight: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  metallicPlayButtonOutline: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'transparent',
    borderWidth: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 2,
  },
});
