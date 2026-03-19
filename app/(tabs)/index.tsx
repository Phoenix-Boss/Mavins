/**
 * Mavin Player — Home Screen
 *
 * All intended approaches incorporated:
 *
 * 1. Search bar → pushes to /(tabs)/search (the full search screen)
 * 2. Notification icon → /(modals)/notifications
 * 4. Pull-to-refresh → invalidates TanStack Query cache AND clears
 *    device cache for all home section list keys so hooks re-fetch
 * 5. Categories row commented out cleanly (re-enable by uncommenting)
 * 6. Watermark pulse animation
 * 7. SectionErrorBoundary wraps every section — one crash never takes
 *    down the whole screen
 * 8. top10ExcludedIds dedup — songs already shown above are excluded
 *    from Top 10 This Month
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
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
import { cache } from "@/libs/cache";

// ── Hooks for dedup ───────────────────────────────────────────────────────────
import { useTrending }      from "@/hooks/useTrending";
import { useTopCharts }     from "@/hooks/useTopCharts";
import { usePopularChoice } from "@/hooks/usePopularChoice";

// ── Section components ────────────────────────────────────────────────────────
import { TrendingNowSection }   from "@/components/sections/TrendingNowSection";
import { BiggestHitsSection }   from "@/components/sections/BiggestHitsSection";
import { CreateMixSection }     from "@/components/sections/CreateMixSection";
import { MusicChannelsSection } from "@/components/sections/MusicChannelsSection";
import { PeoplesChoiceSection } from "@/components/sections/PeoplesChoiceSection";
import { Top10MonthSection }    from "@/components/sections/Top10MonthSection";
import { MavinsBestSection }    from "@/components/sections/MavinsBestSection";
import { PodcastSection }       from "@/components/sections/PodcastSection";
import { RadioFMSection }       from "@/components/sections/RadioFMSection";
import { ThrowbacksSection }    from "@/components/sections/ThrowbacksSection";
import { NewReleasesSection }   from "@/components/sections/NewReleasesSection";

// ─── Constants ────────────────────────────────────────────────────────────────

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

/**
 * Home section device-cache keys to bust on pull-to-refresh.
 * These match the LIST_KEY_PREFIXES routing in libs/cache/index.ts.
 */
const HOME_CACHE_KEYS = [
  "trending:v1",
  "charts:top50",
  "popular:peoples_choice",
  "editor:picks",
  "covers:throwbacks:v6",
  "music:newreleases:v2",
  "mixes:create:v4",
  "top10:month",
  "podcasts:featured",
  "radio:stations",
  "music:channels",
] as const;

// ── Top categories — disabled until further notice ────────────────────────────
// const TOP_CATEGORIES = [
//   "Hits", "Mixes", "Charts", "Genres",
//   "Workout", "Chill", "Energize", "Feel Good", "Focus", "Party",
// ];

// ─── Error boundary ───────────────────────────────────────────────────────────

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
          <Text style={styles.errorText}>
            {this.props.sectionName} unavailable
          </Text>
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

// ─── Home screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { top } = useSafeAreaInsets();
  const router  = useRouter();
  const watermarkPulse = useRef(new Animated.Value(1)).current;

  // ── Dedup hooks (same cache as the sections — no extra network calls) ────────
  const { allData: trendingAllData } = useTrending();
  const { data: biggestHitsData }    = useTopCharts("top50");
  const { data: peoplesChoiceData }  = usePopularChoice({ shuffle: false });

  /**
   * IDs of every song already rendered above Top10MonthSection.
   * Passed down so Top10 can exclude duplicates.
   */
  const top10ExcludedIds = useMemo(() => {
    const ids = new Set<string>();
    trendingAllData?.forEach((item) => {
      if (item.id)      ids.add(item.id);
      if (item.videoId) ids.add(item.videoId);
    });
    biggestHitsData?.forEach((item) => {
      if (item.id)      ids.add(item.id);
      if (item.videoId) ids.add(item.videoId);
    });
    peoplesChoiceData?.forEach((item) => {
      if (item.id) ids.add(item.id);
    });
    return Array.from(ids);
  }, [trendingAllData, biggestHitsData, peoplesChoiceData]);

  // ── Watermark pulse ──────────────────────────────────────────────────────────
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
      ])
    ).start();
  }, []);

  // ── Pull-to-refresh ──────────────────────────────────────────────────────────
  /**
   * Busts both layers:
   *   1. TanStack Query cache (supabase-backed hooks)
   *   2. Device cache for all home section list keys
   *      so hooks skip L1 on the next mount and re-fetch from Supabase
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        // Invalidate TanStack Query (supabase hooks)
        queryClient.invalidateQueries({ queryKey: ["homeSection"] }),
        // Bust device cache for all home list keys
        ...HOME_CACHE_KEYS.map((key) => cache.delete(key).catch(() => {})),
      ]);
    } catch (e) {
      console.warn("[HomeScreen] refresh error:", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ── Navigation handlers ──────────────────────────────────────────────────────
  const handleSearchPress = () => {
    triggerHaptic();
    router.push("/(tabs)/search");
  };

  const handleNotificationsPress = () => {
    triggerHaptic();
    router.push("/(modals)/notifications");
  };

  // ── Header ───────────────────────────────────────────────────────────────────
  const CombinedHeader = () => (
    <View style={{ backgroundColor: COLORS.background }}>
      <View style={[styles.header, { paddingTop: top + 10 }]}>

        {/* Search bar — tappable, navigates to full search screen */}
        <TouchableOpacity
          style={styles.searchContainer}
          onPress={handleSearchPress}
          activeOpacity={0.7}
        >
          <Ionicons
            name="search"
            size={20}
            color={COLORS.goldShimmer}
            style={styles.searchIcon}
          />
          <Text style={styles.searchPlaceholderText}>
            Search music, artists, albums...
          </Text>
        </TouchableOpacity>

        {/* Icon row */}
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={handleNotificationsPress}
            style={styles.iconButton}
            hitSlop={12}
            accessibilityLabel="Notifications"
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={COLORS.goldShimmer}
            />
          </TouchableOpacity>

        </View>
      </View>

      {/*
        ── Categories row — uncomment to re-enable ──────────────────────────
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
                <Text
                  style={[
                    styles.categoryText,
                    selectedTab === category && styles.categoryTextActive,
                  ]}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      */}
    </View>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Watermark — sits behind everything, pointer events disabled */}
      <Animated.View pointerEvents="none" style={styles.watermarkWrapper}>
        <Animated.Image
          source={require("@/assets/images/mavins.png")}
          style={[
            styles.watermark,
            { transform: [{ scale: watermarkPulse }] },
          ]}
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

        {/*
          All IDs from trending pool + biggest hits + peoples choice are
          excluded so Top 10 This Month never duplicates a visible song.
        */}
        <SectionErrorBoundary sectionName="Top 10 This Month">
          <Top10MonthSection excludedIds={top10ExcludedIds} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Mavin's Best">
          <MavinsBestSection />
        </SectionErrorBoundary>

        {/*
          FeaturedSection disabled — same data source as MavinsBestSection.
          Re-enable once Featured has its own dedicated Supabase data.

          <SectionErrorBoundary sectionName="Featured">
            <FeaturedSection />
          </SectionErrorBoundary>
        */}

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // ── Watermark ──────────────────────────────────────────────────────────────
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

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
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

  // ── Categories (re-enable later) ───────────────────────────────────────────
  // categoriesContainer: {
  //   backgroundColor: COLORS.background,
  //   paddingVertical: 12,
  //   borderBottomWidth: 1,
  //   borderBottomColor: COLORS.border,
  // },
  // categoriesScrollContent: {
  //   paddingHorizontal: 16,
  // },
  // categoryButton: {
  //   paddingHorizontal: 14,
  //   paddingVertical: 10,
  //   borderRadius: 20,
  //   marginRight: 10,
  //   backgroundColor: COLORS.surface,
  //   minHeight: 40,
  // },
  // categoryButtonActive: {
  //   backgroundColor: `${COLORS.goldPrimary}20`,
  //   borderWidth: 1,
  //   borderColor: COLORS.goldPrimary,
  // },
  // categoryText: {
  //   fontSize: 12,
  //   fontWeight: "500",
  //   color: COLORS.textTertiary,
  // },
  // categoryTextActive: {
  //   color: COLORS.goldPrimary,
  //   fontWeight: "600",
  // },

  // ── Content ────────────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: 16,
    zIndex: 10,
  },
  bottomSpacing: {
    height: 140,  // FloatingPlayer (64) + tab bar (~56) + gap — prevents last section being hidden
  },

  // ── Error boundary ─────────────────────────────────────────────────────────
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