/**
 * Create Mix Section - Displays personalized mix recommendations
 * Uses useGenreStations and useSearch hooks
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useGenreStations } from "../../hooks/useGenreStations";
import { MixCard } from "../cards/MixCard";
import { SectionHeader } from "../common/SectionHeader";
import { CreateMixButton } from "../common/CreateMixButton";

// Metallic Gold Color Palette
const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldShimmer: '#E6C16A',
  goldMuted: '#C9A96A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  border: '#333333',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export const CreateMixSection = () => {
  const { data: stations, loading, error } = useGenreStations(4);

  // Loading State
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Create Mix" />
        <View style={styles.createMixSection}>
          <CreateMixButton />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.goldPrimary} />
            <Text style={styles.loadingText}>Creating your mix...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Error State
  if (error || !stations.length) {
    return null;
  }

  // Success State
  return (
    <View style={styles.section}>
      <SectionHeader title="Create Mix" />
      <View style={styles.createMixSection}>
        <CreateMixButton />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalScroll}
        >
          {stations.map((item) => (
            <MixCard 
              key={item.id} 
              item={{
                id: item.id,
                title: item.name,
                artist: item.genre,
                thumbnail: item.logo,
                reason: `${item.plays} monthly listeners`
              }} 
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
    zIndex: 2,
  },
  createMixSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  horizontalScroll: {
    paddingRight: 16,
    gap: 14,
  },
  loadingContainer: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 10,
  },
});