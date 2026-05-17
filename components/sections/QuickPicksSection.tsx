/**
 * QuickPicksSection — Displays a horizontally scrollable list of recommended songs
 * FIXES:
 *   - Removed react-native-track-player (usePlayerEngine instead)
 *   - Theme-aware colors
 *   - Proper navigation to player
 *   - Fixed export to avoid undefined component error
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { usePlayerEngine } from "@/libs/playerSetup";
import { useTheme } from "@/contexts/ThemeContext";
import type { Song } from "@/store/home";

const { width } = Dimensions.get("window");
const CARD_WIDTH = (width - 48) / 2;

interface QuickPicksSectionProps {
  results: Song[];
  onItemClick: (item: Song) => void;
}

export const QuickPicksSection = ({ results, onItemClick }: QuickPicksSectionProps) => {
  const router = useRouter();
  const engine = usePlayerEngine();
  const { colors } = useTheme();

  const currentTrackId = engine.currentTrack?.id;

  // Return null early if no results
  if (!results || results.length === 0) {
    return null;
  }

  const data = useMemo(() => {
    const mid = Math.ceil(results.length / 2);
    return results.slice(0, mid).map((top, idx) => ({
      top,
      bottom: results.slice(mid)[idx],
    }));
  }, [results]);

  const renderItem = (item: Song) => {
    const isPlaying = currentTrackId === item.id;
    
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.itemContainer}
        onPress={() => {
          triggerHaptic();
          onItemClick(item);
        }}
        onLongPress={() => {
          const songData = JSON.stringify({
            id: item.id,
            title: item.title,
            artist: item.artist,
            thumbnail: item.thumbnail,
          });
          triggerHaptic();
          router.push({
            pathname: "/(modals)/menu",
            params: { songData, type: "song" },
          });
        }}
        activeOpacity={0.7}
      >
        <View style={styles.imageContainer}>
          {item.thumbnail ? (
            <Image
              source={{ uri: item.thumbnail }}
              style={[styles.thumbnail, { backgroundColor: colors.surfaceLight }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.thumbnail, styles.placeholderImage, { backgroundColor: colors.surfaceLight }]}>
              <Ionicons name="musical-notes" size={30} color={colors.gold} />
            </View>
          )}
          {isPlaying && (
            <View style={[styles.playingIndicator, { backgroundColor: colors.background, borderColor: colors.gold }]}>
              <Ionicons name="musical-note" size={12} color={colors.gold} />
            </View>
          )}
        </View>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.artist, { color: colors.textSub }]} numberOfLines={1}>
          {item.artist}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.header, { color: colors.text }]}>Quick Picks</Text>
      <View style={styles.listContainer}>
        {data.map((col, colIndex) => (
          <View key={colIndex} style={styles.column}>
            {col.top && renderItem(col.top)}
            {col.bottom && renderItem(col.bottom)}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  header: {
    fontSize: 20,
    fontWeight: "bold",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  listContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
  },
  column: {
    flexDirection: "column",
    gap: 12,
  },
  itemContainer: {
    width: CARD_WIDTH,
  },
  imageContainer: {
    position: "relative",
  },
  thumbnail: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    borderRadius: 12,
  },
  placeholderImage: {
    justifyContent: "center",
    alignItems: "center",
  },
  playingIndicator: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
});
