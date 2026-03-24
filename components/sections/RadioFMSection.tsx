// Updated: components/sections/RadioFMSection.tsx
/**
 * RadioFMSection — Store-First Version
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from "react-native";
import { RadioFMCard } from "../cards/RadioFMCard";
import { SectionHeader } from "../common/SectionHeader";
import type { RadioStation } from "@/store/home";

const COLORS = {
  surface:       "#121212",
  goldPrimary:   "#D4AF37",
  textSecondary: "#B3B3B3",
};

interface RadioFMSectionProps {
  data: RadioStation[];
}

export const RadioFMSection = ({ data }: RadioFMSectionProps) => {
  // Empty state
  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll={false} />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Radio FM" showPlayAll={false} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item, index) => (
          <RadioFMCard
            key={`radio-fm-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.name || item.title,
              thumbnail: item.thumbnail,
            }}
          />
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
    alignItems: "flex-start",
  },
  emptyContainer: {
    height: 100,
  },
});