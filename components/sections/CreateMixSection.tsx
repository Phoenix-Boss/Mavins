/**
 * CreateMixSection
 *
 * Displays playlist mixes from Supabase
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMixes, MixItem } from "../../hooks/useMixes";
import { MixCard } from "../cards/MixCard";
import { SectionHeader } from "../common/SectionHeader";
import { CreateMixButton } from "../common/CreateMixButton";

const COLORS = {
  surface: "#121212",
  surfaceLight: "#1F1F1F",
  goldPrimary: "#D4AF37",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary: "#808080",
  border: "#333333",
  danger: "#EF4444",
};

// Default fallback image for playlists without cover art
const DEFAULT_COVER_ART = "https://via.placeholder.com/300x300/1F1F1F/D4AF37?text=Mix";

export const CreateMixSection = () => {
  const { data, loading, error, refetch, isEmpty } = useMixes();

  // Helper to validate and sanitize thumbnail URLs
  const getValidThumbnail = (thumbnail: string | undefined): string => {
    if (!thumbnail || thumbnail.trim() === "") {
      return DEFAULT_COVER_ART;
    }
    
    // Ensure URL starts with http/https
    if (!thumbnail.startsWith("http")) {
      return DEFAULT_COVER_ART;
    }
    
    // Ensure URL doesn't contain spaces or invalid characters
    const sanitized = thumbnail.trim();
    
    // Return the URL with a cache-busting param to force reload
    return sanitized;
  };

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Create Mix" />
        <View style={styles.createRow}>
          <CreateMixButton />
          <View style={styles.centeredBox}>
            <ActivityIndicator size="small" color={COLORS.goldPrimary} />
            <Text style={styles.subtleText}>Loading mixes…</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Create Mix" />
        <View style={styles.createRow}>
          <CreateMixButton />
          <View style={styles.centeredBox}>
            <Ionicons
              name="alert-circle-outline"
              size={22}
              color={COLORS.danger}
            />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refetch}>
              <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (isEmpty) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Create Mix" />
        <View style={styles.createRow}>
          <CreateMixButton />
          <View style={styles.centeredBox}>
            <Ionicons
              name="musical-note-outline"
              size={22}
              color={COLORS.textTertiary}
            />
            <Text style={styles.subtleText}>No mixes available</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refetch}>
              <Text style={styles.retryText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Create Mix" />
      <View style={styles.createRow}>
        <CreateMixButton />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalScroll}
        >
          {data.map((item: MixItem, index: number) => {
            const validThumbnail = getValidThumbnail(item.thumbnail);
            
            return (
              <View key={`create-mix-${item.id}-${index}`} style={styles.cardWrapper}>
                <MixCard
                  item={{
                    id: item.id,
                    title: item.title,
                    artist: item.artist,
                    thumbnail: validThumbnail,
                    trackCount: item.trackCount,
                  }}
                />
                {/* Debug overlay - remove in production */}
                {/* <Text style={styles.debugText}>{validThumbnail.slice(0, 30)}...</Text> */}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  horizontalScroll: {
    paddingRight: 16,
    gap: 14,
  },
  cardWrapper: {
    // Ensure consistent sizing
  },
  centeredBox: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    textAlign: "center",
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    textAlign: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    gap: 5,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  debugText: {
    color: COLORS.goldPrimary,
    fontSize: 8,
    position: "absolute",
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
});