// components/sections/MusicChannelsSection.tsx
/**
 * MusicChannelsSection — Theme-Aware Version
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SectionHeader } from "../common/SectionHeader";
import { useRouter } from "expo-router";
import type { Channel } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

const { width } = Dimensions.get("window");
const ITEM_SIZE = 80;

interface MusicChannelsSectionProps {
  data: Channel[];
}

export const MusicChannelsSection = ({ data }: MusicChannelsSectionProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  const handleArtistPress = useCallback((artistId: string) => {
    router.push(`/(player)/search/artist?id=${encodeURIComponent(artistId)}`);
  }, [router]);

  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll={false} />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Music Channels" showPlayAll={false} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item, index) => (
          <TouchableOpacity
            key={`channel-${item.id}-${index}`}
            style={styles.channelItem}
            onPress={() => handleArtistPress(item.artistId || item.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.circleContainer, { backgroundColor: colors.surface }]}>
              <Image source={{ uri: item.thumbnail }} style={styles.circleImage} resizeMode="cover" />
              {item.isVerified && (
                <View style={[styles.verifiedBadge, { backgroundColor: colors.background }]}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
                </View>
              )}
            </View>
            <Text style={[styles.artistName, { color: colors.text }]} numberOfLines={1}>
              {item.title || item.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  horizontalScroll: { paddingHorizontal: 16, gap: 16, paddingVertical: 8 },
  channelItem: { alignItems: "center", width: ITEM_SIZE },
  circleContainer: { width: ITEM_SIZE, height: ITEM_SIZE, borderRadius: ITEM_SIZE / 2, overflow: "hidden", position: "relative" },
  circleImage: { width: ITEM_SIZE, height: ITEM_SIZE },
  verifiedBadge: { position: "absolute", bottom: 0, right: 0, borderRadius: 10, padding: 2 },
  artistName: { fontSize: 11, fontWeight: "500", marginTop: 8, textAlign: "center", width: ITEM_SIZE },
  emptyContainer: { height: 100, borderRadius: 12 },
});
