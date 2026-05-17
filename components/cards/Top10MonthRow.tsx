/**
 * Top 10 Month Row Component - Theme-aware
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

interface Top10MonthRowProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    plays: string;
    position?: number;
    previousPosition?: number;
  };
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
}

export const Top10MonthRow = ({ item, isCurrentTrack = false, isPlaying = false, onPress }: Top10MonthRowProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  const handlePress = () => {
    triggerHaptic();
    if (onPress) onPress();
    else router.navigate(`/track/${item.id}`);
  };

  const handleMenuPress = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
  };

  return (
    <TouchableOpacity
      style={[
        styles.top10Row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        isCurrentTrack && { backgroundColor: `${colors.gold}15`, borderColor: colors.gold, borderWidth: 1.5 }
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.thumbnailWithPlayIndicator}>
        <Image source={{ uri: item.thumbnail }} style={[styles.top10Thumbnail, { backgroundColor: colors.surfaceLight }]} />
        {isCurrentTrack && (
          <View style={[styles.currentTrackIndicator, { backgroundColor: colors.surfaceDark, borderColor: colors.gold, shadowColor: colors.gold }]}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={8} color={colors.gold} />
          </View>
        )}
      </View>

      <View style={styles.top10Info}>
        <Text style={[styles.top10Title, { color: colors.text }, isCurrentTrack && { color: colors.gold }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.top10Artist, { color: colors.gold }]} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>

      <View style={styles.top10Right}>
        <Text style={[styles.top10Plays, { color: colors.textSub }]}>{item.plays}</Text>
        <TouchableOpacity style={styles.trendingMenuButton} onPress={handleMenuPress} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.gold} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  top10Row: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, borderWidth: 1 },
  thumbnailWithPlayIndicator: { position: 'relative', marginRight: 10 },
  top10Thumbnail: { width: 46, height: 46, borderRadius: 6 },
  currentTrackIndicator: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', zIndex: 1, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  top10Info: { flex: 1, marginRight: 8 },
  top10Title: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  top10Artist: { fontSize: 12 },
  top10Right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  top10Plays: { fontSize: 10 },
  trendingMenuButton: { padding: 3 },
});
