/**
 * Mavin Player — Home Screen
 * Data served entirely from Supabase via TanStack Query
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import ScrollControllerWrapper from "@/components/ScrollControllerWrapper";
import { queryClient } from "@/libs/supabase";

// ── Section components ────────────────────────────────────────────────────────
import { TrendingNowSection }   from "@/components/sections/TrendingNowSection";
import { BiggestHitsSection }   from "@/components/sections/BiggestHitsSection";
import { CreateMixSection }     from "@/components/sections/CreateMixSection";
import { MusicChannelsSection } from "@/components/sections/MusicChannelsSection";
import { PeoplesChoiceSection } from "@/components/sections/PeoplesChoiceSection";
import { Top10MonthSection }    from "@/components/sections/Top10MonthSection";
import { MavinsBestSection }    from "@/components/sections/MavinsBestSection";
import { FeaturedSection }      from "@/components/sections/FeaturedSection";
import { PodcastSection }       from "@/components/sections/PodcastSection";
import { RadioFMSection }       from "@/components/sections/RadioFMSection";
import { ThrowbacksSection }    from "@/components/sections/ThrowbacksSection"; // renamed from CoversSection
import { NewReleasesSection }   from "@/components/sections/NewReleasesSection";

const { width } = Dimensions.get("window");

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────
const COLORS = {
  background:        "#000000",
  surface:           "#121212",
  surfaceLight:      "#1F1F1F",
  surfaceDark:       "#0A0A0A",
  goldPrimary:       "#D4AF37",
  goldShiny:         "#FFD700",
  goldRich:          "#BF9B30",
  goldShimmer:       "#E6C16A",
  goldBronze:        "#8C6F0E",
  goldMuted:         "#C9A96A",
  text:              "#FFFFFF",
  textSecondary:     "#B3B3B3",
  textTertiary:      "#808080",
  textQuaternary:    "#666666",
  border:            "#333333",
  borderLight:       "#444444",
  success:           "#22C55E",
  warning:           "#F59E0B",
  danger:            "#EF4444",
  searchBackground:  "#1A1A1A",
  searchPlaceholder: "#666666",
  liveTag:           "#3B82F6",
};

const TOP_CATEGORIES = [
  "Hits", "Mixes", "Charts", "Genres",
  "Workout", "Chill", "Energize", "Feel Good", "Focus", "Party",
];

// ─────────────────────────────────────────────
// Error boundary — one failing section won't crash the screen
// ─────────────────────────────────────────────
class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode; sectionName: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`❌ [${this.props.sectionName}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={24} color={COLORS.danger} />
          <Text style={styles.errorText}>{this.props.sectionName} unavailable</Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false })}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────
// Home screen
// ─────────────────────────────────────────────
export default function HomeScreen() {
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedTab, setSelectedTab] = useState("Hits");
  const { top }                       = useSafeAreaInsets();
  const router                        = useRouter();
  const watermarkPulse                = useRef(new Animated.Value(1)).current;

  // Watermark pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(watermarkPulse, { toValue: 1.06, duration: 3000, useNativeDriver: true }),
        Animated.timing(watermarkPulse, { toValue: 1,    duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Pull-to-refresh — invalidates all home section queries so TanStack refetches
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['homeSection'] });
    setRefreshing(false);
  }, []);

  const handleSearchPress = () => {
    triggerHaptic();
    router.navigate("/search");
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const CombinedHeader = () => (
    <View style={{ backgroundColor: COLORS.background }}>
      {/* Search bar */}
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

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => { triggerHaptic(); router.navigate("/settings"); }}
            style={styles.iconButton}
            hitSlop={12}
          >
            <Ionicons name="settings-outline" size={24} color={COLORS.goldShimmer} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Category tabs */}
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
                selectedTab === category && styles.categoryButtonActive,
              ]}
              onPress={() => { triggerHaptic(); setSelectedTab(category); }}
            >
              <Text style={[
                styles.categoryText,
                selectedTab === category && styles.categoryTextActive,
              ]}>
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Watermark */}
      <Animated.View pointerEvents="none" style={styles.watermarkWrapper}>
        <Animated.Image
          source={require("@/assets/images/mavins.png")}
          style={[styles.watermark, { transform: [{ scale: watermarkPulse }] }]}
          resizeMode="contain"
        />
      </Animated.View>

      <ScrollControllerWrapper
        headerComponent={<CombinedHeader />}
        showHeader={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.goldPrimary]}
            tintColor={COLORS.goldPrimary}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        <SectionErrorBoundary sectionName="Trending Now">
          <TrendingNowSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Biggest Hits">
          <BiggestHitsSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Create Mix">
          <CreateMixSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Music Channels">
          <MusicChannelsSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="People's Choice">
          <PeoplesChoiceSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Top 10 This Month">
          <Top10MonthSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Mavin's Best">
          <MavinsBestSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Featured">
          <FeaturedSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Podcasts">
          <PodcastSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Radio FM">
          <RadioFMSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Throwbacks">
          <ThrowbacksSection />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="New Releases">
          <NewReleasesSection />
        </SectionErrorBoundary>

        <View style={styles.bottomSpacing} />
      </ScrollControllerWrapper>
    </View>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 10,
    backgroundColor: COLORS.background,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.searchBackground,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 16,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + "40",
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
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  categoryTextActive: {
    color: COLORS.goldPrimary,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: 16,
    zIndex: 10,
  },
  bottomSpacing: {
    height: 60,
  },
  errorContainer: {
    padding: 20,
    marginVertical: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.danger + "40",
    alignItems: "center",
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 8,
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});