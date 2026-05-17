// components/sections/RadioFMSection.tsx
/**
 * RadioFMSection — Theme-Aware Version
 */

import React from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import { RadioFMCard } from "../cards/RadioFMCard";
import { SectionHeader } from "../common/SectionHeader";
import type { RadioStation } from "@/store/home";
import { useTheme } from "@/contexts/ThemeContext";

interface RadioFMSectionProps {
  data: RadioStation[];
}

export const RadioFMSection = ({ data }: RadioFMSectionProps) => {
  const { colors } = useTheme();

  if (!data?.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll={false} />
        <View style={[styles.emptyContainer, { backgroundColor: colors.surface }]} />
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
  section: { marginBottom: 20 },
  horizontalScroll: { paddingHorizontal: 16, gap: 16, alignItems: "flex-start" },
  emptyContainer: { height: 100, borderRadius: 12 },
});
