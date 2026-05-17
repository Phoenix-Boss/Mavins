// components/sections/NewReleasesSection.tsx
/**
 * NewReleasesSection — Theme-Aware Version
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
import { useTheme } from "@/contexts/ThemeContext";

const CIRCLE_SIZE = 80;

interface NewReleasesSectionProps {
  data: Song[];
}

export const NewReleasesSection = ({ data }: NewReleasesSectionProps) => {
  const router = useRouter();
  const { colors } = useTheme();

  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="New" showPlayAll />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
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
            onPress={() => { triggerHaptic(); router.navigate(`/track/${item.id}`); }}
            activeOpacity={0.8}
          >
            <View style={styles.circleWrapper}>
              {item.thumbnail ? (
                <Image source={{ uri: item.thumbnail }} style={[styles.circle, { backgroundColor: colors.surfaceLight }]} resizeMode="cover" />
              ) : (
                <View style={[styles.circle, styles.circlePlaceholder, { backgroundColor: colors.surfaceLight }]}>
                  <Text style={[styles.placeholderInitial, { color: colors.gold }]}>{item.title?.charAt(0) ?? "?"}</Text>
                </View>
              )}
              <View style={[styles.circleRing, { borderColor: `${colors.gold}60` }]} />
            </View>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.artist, { color: colors.textSub }]} numberOfLines={1}>{item.artist}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  scrollContent: { paddingHorizontal: 16, gap: 16, alignItems: "flex-start" },
  card: { width: CIRCLE_SIZE + 8, alignItems: "center", gap: 6 },
  circleWrapper: { position: "relative", width: CIRCLE_SIZE + 4, height: CIRCLE_SIZE + 4, alignItems: "center", justifyContent: "center" },
  circle: { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2 },
  circlePlaceholder: { alignItems: "center", justifyContent: "center" },
  placeholderInitial: { fontSize: 24, fontWeight: "700" },
  circleRing: { position: "absolute", width: CIRCLE_SIZE + 4, height: CIRCLE_SIZE + 4, borderRadius: (CIRCLE_SIZE + 4) / 2, borderWidth: 1.5 },
  title: { fontSize: 11, fontWeight: "600", textAlign: "center", width: CIRCLE_SIZE + 8 },
  artist: { fontSize: 10, fontWeight: "400", textAlign: "center", width: CIRCLE_SIZE + 8 },
  emptyContainer: { height: 120, borderRadius: 12 },
});
