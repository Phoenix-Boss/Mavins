/**
 * MusicChannelsSection
 *
 * Displays artists as circular "Music Channels" - horizontal scroll
 * Shows: circular thumbnail + artist name only
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMusicChannels, MusicChannelItem } from "../../hooks/useMusicChannels";
import { SectionHeader } from "../common/SectionHeader";
import { useRouter } from "expo-router";

const { width } = Dimensions.get("window");
const ITEM_SIZE = 80; // Circle size
const COLORS = {
  background: "#000000",
  surface: "#121212",
  goldPrimary: "#D4AF37",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary: "#808080",
  danger: "#EF4444",
};

export const MusicChannelsSection = () => {
  const { data, loading, error, refetch } = useMusicChannels();
  const router = useRouter();

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleArtistPress = useCallback((artistId: string) => {
    router.push(`/artist/${artistId}`);
  }, [router]);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading...</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.danger} />
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (!data.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <Text style={styles.subtleText}>No channels</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Success: Horizontal Scroll with Circles ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Music Channels" showPlayAll={false} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: MusicChannelItem, index: number) => (
          <TouchableOpacity
            key={`channel-${item.id}-${index}`}
            style={styles.channelItem}
            onPress={() => handleArtistPress(item.artistId)}
            activeOpacity={0.7}
          >
            <View style={styles.circleContainer}>
              <Image
                source={{ uri: item.thumbnail }}
                style={styles.circleImage}
                resizeMode="cover"
              />
              {item.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.goldPrimary} />
                </View>
              )}
            </View>
            <Text style={styles.artistName} numberOfLines={1} ellipsizeMode="tail">
              {item.title}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 16,
    paddingVertical: 8,
  },
  channelItem: {
    alignItems: "center",
    width: ITEM_SIZE,
  },
  circleContainer: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: ITEM_SIZE / 2,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    position: "relative",
  },
  circleImage: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  verifiedBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 2,
  },
  artistName: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "500",
    marginTop: 8,
    textAlign: "center",
    width: ITEM_SIZE,
  },
  centeredBox: {
    padding: 24,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  retryButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});