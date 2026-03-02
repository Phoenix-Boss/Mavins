/**
 * Mavins Player - Premium Gold Edition
 * Main Home Screen with Real Data Integration - All Sections
 */
import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  RefreshControl,
  StyleSheet,
  Dimensions,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import ScrollControllerWrapper from "@/components/ScrollControllerWrapper";

// Import all sections
import { TrendingNowSection } from "@/components/sections/TrendingNowSection";
import { BiggestHitsSection } from "@/components/sections/BiggestHitsSection";
import { CreateMixSection } from "@/components/sections/CreateMixSection";
import { MusicChannelsSection } from "@/components/sections/MusicChannelsSection";
import { PeoplesChoiceSection } from "@/components/sections/PeoplesChoiceSection";
import { Top10MonthSection } from "@/components/sections/Top10MonthSection";
import { MavinsBestSection } from "@/components/sections/MavinsBestSection";
import { SponsoredSection } from "@/components/sections/SponsoredSection";
import { PodcastSection } from "@/components/sections/PodcastSection";
import { RadioFMSection } from "@/components/sections/RadioFMSection";
import { CoversSection } from "@/components/sections/CoversSection";
import { NewReleasesSection } from "@/components/sections/NewReleasesSection";

const { width } = Dimensions.get('window');

// Metallic Gold Color Palette - Premium Luxury Edition
const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  surfaceDark: '#0A0A0A',
  goldPrimary: '#D4AF37',
  goldShiny: '#FFD700',
  goldRich: '#BF9B30',
  goldShimmer: '#E6C16A',
  goldBronze: '#8C6F0E',
  goldMuted: '#C9A96A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  textQuaternary: '#666666',
  border: '#333333',
  borderLight: '#444444',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  searchBackground: '#1A1A1A',
  searchPlaceholder: '#666666',
  liveTag: '#3B82F6',
};

// Top categories for horizontal scroll
const TOP_CATEGORIES = ["Hits", "Mixes", "Charts", "Genres", "Workout", "Chill", "Energize", "Feel Good", "Focus", "Party"];

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState("Hits");
  const [searchQuery, setSearchQuery] = useState("");
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const watermarkPulse = useRef(new Animated.Value(1)).current;

  // Start pulse animation for watermark
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(watermarkPulse, {
          toValue: 1.06,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(watermarkPulse, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Invalidate caches and refresh data
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const handleSearchPress = () => {
    triggerHaptic();
    router.navigate('/search');
  };

  // Combined Header Component (Search Bar + Categories)
  const CombinedHeader = () => (
    <View style={{ backgroundColor: COLORS.background }}>
      {/* Search Bar */}
      <View style={[styles.header, { paddingTop: top }]}>
        <TouchableOpacity 
          style={styles.searchContainer}
          onPress={handleSearchPress}
          activeOpacity={0.7}
        >
          <Ionicons name="search" size={20} color={COLORS.goldShimmer} style={styles.searchIcon} />
          <Text style={styles.searchPlaceholderText}>
            Search music, artists, albums...
          </Text>
        </TouchableOpacity>
        
        {/* Right Icons */}
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => {
              triggerHaptic();
              router.navigate('/settings');
            }}
            style={styles.iconButton}
            hitSlop={12}
          >
            <Ionicons name="settings-outline" size={24} color={COLORS.goldShimmer} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Top Categories */}
      <View style={styles.categoriesContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScrollContent}
        >
          {TOP_CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category}
              style={[
                styles.categoryButton,
                selectedTab === category && styles.categoryButtonActive
              ]}
              onPress={() => {
                triggerHaptic();
                setSelectedTab(category);
              }}
            >
              <Text style={[
                styles.categoryText,
                selectedTab === category && styles.categoryTextActive
              ]}>
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );

  // Refresh Control Component
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      colors={[COLORS.goldPrimary]}
      tintColor={COLORS.goldPrimary}
    />
  );

  return (
    <View style={styles.container}>
      {/* WATERMARK */}
      <Animated.View pointerEvents="none" style={styles.watermarkWrapper}>
        <Animated.Image
          source={require("@/assets/images/mavins.png")}
          style={[styles.watermark, { transform: [{ scale: watermarkPulse }] }]}
          resizeMode="contain"
        />
      </Animated.View>

      {/* ScrollControllerWrapper with combined header */}
      <ScrollControllerWrapper
        headerComponent={<CombinedHeader />}
        showHeader={true}
        refreshControl={refreshControl}
        contentContainerStyle={styles.scrollContent}
      >
        {/* All 12 sections with real data */}
        <TrendingNowSection />
        <BiggestHitsSection />
        <CreateMixSection />
        <MusicChannelsSection />
        <PeoplesChoiceSection />
        <Top10MonthSection />
        <MavinsBestSection />
        <SponsoredSection />
        <PodcastSection />
        <RadioFMSection />
        <CoversSection />
        <NewReleasesSection />

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollControllerWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  watermarkWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  watermark: {
    width: 300,
    height: 300,
    opacity: 0.08,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 10,
    backgroundColor: COLORS.background,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.searchBackground,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 16,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + '40',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchPlaceholderText: {
    color: COLORS.searchPlaceholder,
    fontSize: 16,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconButton: {
    padding: 4,
  },
  categoriesContainer: {
    backgroundColor: COLORS.background,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  categoriesScrollContent: {
    paddingHorizontal: 16,
  },
  categoryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: COLORS.surface,
    minHeight: 40,
  },
  categoryButtonActive: {
    backgroundColor: `${COLORS.goldPrimary}20`,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textTertiary,
  },
  categoryTextActive: {
    color: COLORS.goldPrimary,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    zIndex: 10,
  },
  bottomSpacing: {
    height: 60,
  },
});