/**
 * Music Channel Card Component - Displays a music channel/station
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
  border: '#333333',
};

interface MusicChannelCardProps {
  item: {
    id: string;
    name: string;
    logo: string;
    tracks: string[];
    plays: string;
    genre?: string;
  };
  isCurrentChannel?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const MusicChannelCard = ({ 
  item, 
  isCurrentChannel = false,
  isPlaying = false,
  onPress 
}: MusicChannelCardProps) => {
  const router = useRouter();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) {
      onPress();
    } else {
      // Default behavior - navigate to channel
      router.navigate(`/channel/${item.id}`);
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
          <Image
            source={{ uri: item.logo }}
            style={styles.channelLogo}
          />
          <View style={styles.channelLogoBorder} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={[
            styles.channelName,
            isCurrentChannel && styles.currentTrackText
          ]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.channelPlays}>{item.plays} plays</Text>
        </View>
      </View>
      <View style={styles.channelTracks}>
        {item.tracks.slice(0, 3).map((track: string, idx: number) => (
          <View key={idx} style={styles.channelTrackRow}>
            <Text style={styles.channelTrackNumber}>{idx + 1}</Text>
            <Text style={styles.channelTrack} numberOfLines={1}>
              {track}
            </Text>
          </View>
        ))}
      </View>
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
  channelLogoBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  channelInfo: {
    flex: 1,
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