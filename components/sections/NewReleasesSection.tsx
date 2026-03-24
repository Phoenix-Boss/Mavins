// Updated: components/sections/NewReleasesSection.tsx
/**
 * NewReleasesSection — Store-First Version
 */

import React from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { SectionHeader } from "../common/SectionHeader";
import type { Song } from "@/store/home";

const CIRCLE_SIZE = 80;

const COLORS = {
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textTertiary:  "#808080",
};

interface NewReleasesSectionProps {
  data: Song[];
}

export const NewReleasesSection = ({ data }: NewReleasesSectionProps) => {
  const router = useRouter();

  // Empty state
  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="New" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="New" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {data.map((item) => (
          <TouchableOpacity
            key={`new-release-${item.id}`}
            style={styles.card}
            onPress={() => {
              triggerHaptic();
              router.navigate(`/track/${item.id}`);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.circleWrapper}>
              {item.thumbnail ? (
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.circle}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.circle, styles.circlePlaceholder]}>
                  <Text style={styles.placeholderInitial}>
                    {item.title?.charAt(0) ?? "?"}
                  </Text>
                </View>
              )}
              <View style={styles.circleRing} />
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {item.artist}
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
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
    alignItems: "flex-start",
  },
  card: {
    width: CIRCLE_SIZE + 8,
    alignItems: "center",
    gap: 6,
  },
  circleWrapper: {
    position: "relative",
    width: CIRCLE_SIZE + 4,
    height: CIRCLE_SIZE + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: COLORS.surfaceLight,
  },
  circlePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceLight,
  },
  placeholderInitial: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.goldShimmer,
  },
  circleRing: {
    position: "absolute",
    width: CIRCLE_SIZE + 4,
    height: CIRCLE_SIZE + 4,
    borderRadius: (CIRCLE_SIZE + 4) / 2,
    borderWidth: 1.5,
    borderColor: COLORS.goldPrimary + "60",
  },
  title: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
    width: CIRCLE_SIZE + 8,
  },
  artist: {
    fontSize: 10,
    fontWeight: "400",
    color: COLORS.textTertiary,
    textAlign: "center",
    width: CIRCLE_SIZE + 8,
  },
  emptyContainer: {
    height: 120,
  },
});