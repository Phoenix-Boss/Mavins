// Updated: app/(tabs)/index.tsx
/**
 * Mavin Player — Home Screen (Store-First Instant Render)
 *
 * CHANGES:
 * 1. Reads ALL data from HomeStore — instant render, no waiting
 * 2. NO data fetching hooks in this component
 * 3. Sections receive data via props from store
 * 4. Background refetch handled by HomePreloader in root layout
 * 5. Pull-to-refresh triggers store update via invalidate + refetch
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import ScrollControllerWrapper from "@/components/ScrollControllerWrapper";
import { queryClient } from "@/libs/supabase";
import { useHomeStore } from "@/store/home";

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
  goldPrimary:       "#D4AF37",
  goldShimmer:       "#E6C16A",
  text:              "#FFFFFF",
  textSecondary:     "#B3B3B3",
  searchBackground:  "#1A1A1A",
  searchPlaceholder: "#666666",
  danger:            "#EF4444",
};

// ─── Error boundary ─────────────────────────────────────────────────────────--

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

  // ── Read ALL data from store — INSTANT, no loading, no hooks ────────────────
  const {
    trending,
    biggestHits,
    peoplesChoice,
    top10Month,
    mavinsBest,
    newReleases,
    throwbacks,
    mixes,
    channels,
    podcasts,
    radioStations,
    getExcludedIdsForTop10,
  } = useHomeStore();

  // Pre-computed excluded IDs for Top 10 deduplication
  const top10ExcludedIds = getExcludedIdsForTop10();

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
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Invalidate all home queries — HomePreloader will refetch and update store
      await queryClient.invalidateQueries({ queryKey: ['home'] });
    } catch (e) {
      console.warn("[HomeScreen] refresh error:", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ── Navigation ───────────────────────────────────────────────────────────────
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

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={handleNotificationsPress}
            style={styles.iconButton}
            hitSlop={12}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={COLORS.goldShimmer}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  // ALL data comes from store — sections render instantly with pre-populated data
  return (
    <View style={styles.container}>
      
      {/* Watermark */}
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

        {/* Sections receive data directly from store via props */}
        <SectionErrorBoundary sectionName="Trending Now">
          <TrendingNowSection data={trending} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Biggest Hits">
          <BiggestHitsSection data={biggestHits} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Create Mix">
          <CreateMixSection data={mixes} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Music Channels">
          <MusicChannelsSection data={channels} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="People's Choice">
          <PeoplesChoiceSection data={peoplesChoice} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Top 10 This Month">
          <Top10MonthSection data={top10Month} excludedIds={top10ExcludedIds} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Mavin's Best">
          <MavinsBestSection data={mavinsBest} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Podcasts">
          <PodcastSection data={podcasts} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Radio FM">
          <RadioFMSection data={radioStations} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Throwbacks">
          <ThrowbacksSection data={throwbacks} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="New Releases">
          <NewReleasesSection data={newReleases} />
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

  scrollContent: {
    paddingHorizontal: 16,
    zIndex: 10,
  },
  bottomSpacing: {
    height: 140,
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