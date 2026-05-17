// components/sections/CreateMixSection.tsx
/**
 * CreateMixSection — Theme-Aware Version
 */

import React from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import { MixCard } from "../cards/MixCard";
import { SectionHeader } from "../common/SectionHeader";
import { CreateMixButton } from "../common/CreateMixButton";
import type { Mix } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

const DEFAULT_COVER_ART = "https://via.placeholder.com/300x300/1F1F1F/D4AF37?text=Mix";

interface CreateMixSectionProps {
  data: Mix[];
}

export const CreateMixSection = ({ data }: CreateMixSectionProps) => {
  const { colors } = useTheme();

  const getValidThumbnail = (thumbnail: string | undefined): string => {
    if (!thumbnail || thumbnail.trim() === "") return DEFAULT_COVER_ART;
    if (!thumbnail.startsWith("http")) return DEFAULT_COVER_ART;
    return thumbnail.trim();
  };

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
          {data?.map((item, index) => {
            const validThumbnail = getValidThumbnail(item.thumbnail);
            return (
              <View key={`create-mix-${item.id}-${index}`} style={styles.cardWrapper}>
                <MixCard
                  item={{
                    id: item.id,
                    title: item.title,
                    artist: item.artist || "Various Artists",
                    thumbnail: validThumbnail,
                    trackCount: item.trackCount,
                  }}
                />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  createRow: { flexDirection: "row", alignItems: "flex-start" },
  horizontalScroll: { paddingRight: 16, gap: 14 },
  cardWrapper: {},
});
