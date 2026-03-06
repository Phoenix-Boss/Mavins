/**
 * Music Channel Card Component - Displays a music channel/station
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
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  textQuaternary: '#666666',
  textMuted: '#666666',
  border: '#333333',
};

interface MusicChannelCardProps {
  item?: {
    id?: string;
    name?: string;
    logo?: string;
    tracks?: string[];
    plays?: string;
    genre?: string;
  };
  isCurrentChannel?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  fallbackName?: string;
}

export const MusicChannelCard = ({ 
  item, 
  isCurrentChannel = false,
  isPlaying = false,
  onPress,
  fallbackName = "Unknown Channel"
}: MusicChannelCardProps) => {
  const router = useRouter();

  // ✅ DEFENSIVE: Handle missing or invalid item
  const safeItem = {
    id: item?.id || `fallback_${Math.random()}`,
    name: item?.name || fallbackName,
    logo: item?.logo || null,
    tracks: Array.isArray(item?.tracks) ? item.tracks : [],
    plays: item?.plays || "0",
    genre: item?.genre
  };

  const hasValidLogo = safeItem.logo && safeItem.logo.startsWith('http');

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else if (safeItem.id && !safeItem.id.startsWith('fallback_')) {
      router.navigate(`/channel/${safeItem.id}`);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.channelCard,
        isCurrentChannel && styles.currentPlayingTrack
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <View style={styles.channelHeader}>
        <View style={styles.channelLogoContainer}>
          {hasValidLogo ? (
            <Image
              source={{ uri: safeItem.logo }}
              style={styles.channelLogo}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.channelLogo, styles.fallbackLogo]}>
              <Ionicons name="radio" size={24} color={COLORS.goldShimmer} />
            </View>
          )}
          <View style={styles.channelLogoBorder} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={[
            styles.channelName,
            isCurrentChannel && styles.currentTrackText
          ]} numberOfLines={1}>
            {safeItem.name}
          </Text>
          <Text style={styles.channelPlays}>{safeItem.plays} plays</Text>
          {safeItem.genre && (
            <Text style={styles.channelGenre} numberOfLines={1}>
              {safeItem.genre}
            </Text>
          )}
        </View>
      </View>
      
      {/* Only show tracks if we have them */}
      {safeItem.tracks.length > 0 && (
        <View style={styles.channelTracks}>
          {safeItem.tracks.slice(0, 3).map((track: string, idx: number) => (
            <View key={idx} style={styles.channelTrackRow}>
              <Text style={styles.channelTrackNumber}>{idx + 1}</Text>
              <Text style={styles.channelTrack} numberOfLines={1}>
                {track || "Unknown Track"}
              </Text>
            </View>
          ))}
        </View>
      )}
      
      {/* Empty state */}
      {safeItem.tracks.length === 0 && (
        <View style={styles.emptyTracks}>
          <Text style={styles.emptyText}>No tracks available</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  channelCard: {
    width: 210,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  channelLogoContainer: {
    position: 'relative',
  },
  channelLogo: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.surfaceLight,
  },
  fallbackLogo: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + '30',
  },
  channelLogoBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  channelInfo: {
    flexLeft: 1,
    marginLeft: 10,
  },
  channelName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  channelPlays: {
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  channelGenre: {
    fontSize: 10,
    color: COLORS.goldShimmer,
    marginTop: 2,
  },
  channelTracks: {
    gap: 4,
  },
  channelTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  channelTrackNumber: {
    fontSize: 10,
    color: COLORS.goldPrimary,
    width: 14,
    textAlign: 'center',
  },
  channelTrack: {
    fontSize: 11,
    color: COLORS.textQuaternary,
    flex: 1,
  },
  emptyTracks: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: 'italic',
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