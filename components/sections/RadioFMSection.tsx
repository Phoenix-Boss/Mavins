/**
 * RadioFMSection
 *
 * Displays live radio stations as circular cards in a flex-wrap grid.
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLiveStations, LiveStationItem } from "../../hooks/useLiveStations";
import { RadioFMCard } from "../cards/RadioFMCard";
import { SectionHeader } from "../common/SectionHeader";

const COLORS = {
  surface:       "#121212",
  goldPrimary:   "#D4AF37",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
  danger:        "#EF4444",
};

export const RadioFMSection = () => {
  const { data, loading, error, refetch } = useLiveStations();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading stations…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Radio FM" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <Ionicons name="alert-circle-outline" size={22} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
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
        <SectionHeader title="Radio FM" showPlayAll={false} />
        <View style={styles.centeredBox}>
          <Ionicons name="radio-outline" size={22} color={COLORS.textTertiary} />
          <Text style={styles.subtleText}>No stations available</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Radio FM" showPlayAll={false} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: LiveStationItem, index: number) => (
          <RadioFMCard
            key={`radio-fm-${item.id}-${index}`}
            item={{
              id: item.id,
              title: item.name,
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
  centeredBox: {
    padding: 40,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textSecondary,
    marginTop: 2,
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
    marginTop: 8,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});