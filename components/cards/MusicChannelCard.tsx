/**
 * Music Channel Card Component - Theme-aware
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

interface MusicChannelCardProps {
  item?: {
    id?: string;
    name?: string;
    uploaderName?: string;
    thumbnails?: Array<{ url: string }>;
    duration?: number;
    viewCount?: number;
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

function formatViewCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export const MusicChannelCard = ({ 
  item, 
  isCurrentChannel = false,
  isPlaying = false,
  onPress,
  fallbackName = "Unknown Channel"
}: MusicChannelCardProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  const safeItem = {
    id: item?.id || `fallback_${Math.random()}`,
    name: item?.name || item?.genre || fallbackName,
    artist: item?.uploaderName || "",
    logo: item?.thumbnails?.[0]?.url || item?.logo || undefined,
    tracks: item?.tracks || (item?.duration ? [`${Math.floor(item.duration / 60)}:${(item.duration % 60).toString().padStart(2, '0')}`] : []),
    plays: item?.plays || (item?.viewCount ? formatViewCount(item.viewCount) : "0"),
  };

  const hasValidLogo = !!safeItem.logo && safeItem.logo.startsWith('http');

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
        { backgroundColor: colors.surface, borderColor: colors.border },
        isCurrentChannel && { backgroundColor: `${colors.gold}15`, borderColor: colors.gold, borderWidth: 1.5 }
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <View style={styles.channelHeader}>
        <View style={styles.channelLogoContainer}>
          {hasValidLogo ? (
            <Image source={{ uri: safeItem.logo }} style={styles.channelLogo} resizeMode="cover" />
          ) : (
            <View style={[styles.channelLogo, styles.fallbackLogo, { backgroundColor: colors.surfaceLight, borderColor: `${colors.gold}30`, borderWidth: 1 }]}>
              <Ionicons name="radio" size={24} color={colors.gold} />
            </View>
          )}
          <View style={[styles.channelLogoBorder, { borderColor: colors.gold }]} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={[styles.channelName, { color: colors.text }, isCurrentChannel && { color: colors.gold }]} numberOfLines={1}>
            {safeItem.name}
          </Text>
          {safeItem.artist ? (
            <Text style={[styles.channelArtist, { color: colors.gold }]} numberOfLines={1}>
              {safeItem.artist}
            </Text>
          ) : null}
          <Text style={[styles.channelPlays, { color: colors.textSub }]}>{safeItem.plays} plays</Text>
        </View>
      </View>
      
      {safeItem.tracks.length > 0 && (
        <View style={styles.channelTracks}>
          {safeItem.tracks.slice(0, 3).map((track: string, idx: number) => (
            <View key={idx} style={styles.channelTrackRow}>
              <Text style={[styles.channelTrackNumber, { color: colors.gold }]}>{idx + 1}</Text>
              <Text style={[styles.channelTrack, { color: colors.textMuted }]} numberOfLines={1}>
                {track || "Unknown Track"}
              </Text>
            </View>
          ))}
        </View>
      )}
      
      {safeItem.tracks.length === 0 && (
        <View style={styles.emptyTracks}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>No tracks available</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  channelCard: { width: 210, borderRadius: 10, padding: 10, borderWidth: 1 },
  channelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  channelLogoContainer: { position: 'relative' },
  channelLogo: { width: 46, height: 46, borderRadius: 23 },
  fallbackLogo: { justifyContent: 'center', alignItems: 'center' },
  channelLogoBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 23, borderWidth: 1 },
  channelInfo: { flex: 1, marginLeft: 10 },
  channelName: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  channelArtist: { fontSize: 11, marginBottom: 2 },
  channelPlays: { fontSize: 10 },
  channelTracks: { gap: 4 },
  channelTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  channelTrackNumber: { fontSize: 10, width: 14, textAlign: 'center' },
  channelTrack: { fontSize: 11, flex: 1 },
  emptyTracks: { paddingVertical: 8, alignItems: 'center' },
  emptyText: { fontSize: 10, fontStyle: 'italic' },
});
