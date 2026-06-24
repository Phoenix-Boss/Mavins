// app/(player)/index.tsx - Home Screen
import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  RefreshControl,
  StyleSheet,
  FlatList,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { triggerHaptic } from "@/helpers/haptics";
import ScrollControllerWrapper from "@/components/ScrollControllerWrapper";
import { useHomeStore, Song, CampaignCard } from "@/store/home";
import { useMusicPlayer } from "@/libs/playerSetup";
import { usePlayerOverlay } from "@/libs/playerOverlay";
import { useTheme } from "@/contexts/ThemeContext";
import { useNotificationBadge } from "@/hooks/useNotificationBadge";
import { useQuickPicks } from "@/hooks/useQuickPicks";

// Section components
import { TrendingNowSection } from "@/components/sections/TrendingNowSection";
import { BiggestHitsSection } from "@/components/sections/BiggestHitsSection";
import { CreateMixSection } from "@/components/sections/CreateMixSection";
import { MusicChannelsSection } from "@/components/sections/MusicChannelsSection";
import { PeoplesChoiceSection } from "@/components/sections/PeoplesChoiceSection";
import { Top10MonthSection } from "@/components/sections/Top10MonthSection";
import { MavinsBestSection } from "@/components/sections/MavinsBestSection";
import { PodcastSection } from "@/components/sections/PodcastSection";
import { RadioFMSection } from "@/components/sections/RadioFMSection";
import { ThrowbacksSection } from "@/components/sections/ThrowbacksSection";
import { NewReleasesSection } from "@/components/sections/NewReleasesSection";
import { QuickPicksSection } from "@/components/sections/QuickPicksSection";

const { width } = Dimensions.get("window");
const GRID_SIZE = (width - 48) / 3;

// ─── Helper ───────────────────────────────────────────────────────────────────

// ─── Section Error Boundary ───────────────────────────────────────────────────

class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode; sectionName: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.error(`❌ [${this.props.sectionName}]`, error); }
  render() { if (this.state.hasError) return null; return this.props.children; }
}

// ─── Quick Actions - SINGLE CARD ONLY (No slideshow, no pagination) ───────────

interface QuickActionsGridProps {
  recentSongs: Song[];
  onSongPress: (song: Song) => void;
}

function QuickActionsGrid({ recentSongs, onSongPress }: QuickActionsGridProps) {
  const router = useRouter();
  const { colors } = useTheme();

  // Take ONLY the FIRST song - NO slideshow, NO multiple cards
  const firstSong = recentSongs.length > 0 ? recentSongs[0] : null;

  // Don't show section if no recent songs
  if (!firstSong) return null;

  const handleClearAll = () => {
    triggerHaptic();
    useHomeStore.getState().clearRecentSongs();
  };

  const handleSeeAll = () => {
    triggerHaptic();
    router.push("/(player)/library/recent");
  };

  return (
    <View style={styles.quickActionsContainer}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleContainer}>
          <Ionicons name="time-outline" size={20} color={colors.gold} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
        </View>
        <View style={styles.sectionActions}>
          <TouchableOpacity onPress={handleClearAll} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: colors.textSub }]}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSeeAll}>
            <Text style={[styles.seeAllText, { color: colors.gold }]}>See All</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SINGLE CARD - No FlatList, No horizontal scroll, No pagination */}
      <TouchableOpacity
        style={[styles.singleQuickActionCard, { backgroundColor: colors.surfaceRaised }]}
        onPress={() => onSongPress(firstSong)}
        activeOpacity={0.7}
      >
        <Image
          source={{ uri: firstSong.thumbnail }}
          style={[styles.singleQuickActionImage, { backgroundColor: colors.surface }]}
          contentFit="cover"
          transition={150}
        />
        <View style={styles.singleQuickActionInfo}>
          <Text style={[styles.singleQuickActionTitle, { color: colors.text }]} numberOfLines={1}>
            {firstSong.title}
          </Text>
          <Text style={[styles.singleQuickActionArtist, { color: colors.textSub }]} numberOfLines={1}>
            {firstSong.artist}
          </Text>
        </View>
        <Ionicons name="play-circle" size={32} color={colors.gold} style={styles.singleQuickActionPlay} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Section Wrappers ─────────────────────────────────────────────────────────

function TrendingNowWrapper({ data }: { data: Song[] }) {
  if (!data.length) return null;
  return <TrendingNowSection data={data} />;
}

function BiggestHitsWrapper({ data }: { data: Song[] }) {
  if (!data.length) return null;
  return <BiggestHitsSection data={data} />;
}

function CreateMixWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <CreateMixSection data={data} />;
}

function MusicChannelsWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <MusicChannelsSection data={data} />;
}

function PeoplesChoiceWrapper({ data }: { data: Song[] }) {
  if (!data.length) return null;
  return <PeoplesChoiceSection data={data} />;
}

function Top10MonthWrapper({ data, excludedIds }: { data: Song[]; excludedIds: string[] }) {
  if (!data.length) return null;
  const filtered = data.filter((s) => !excludedIds.includes(s.id));
  if (!filtered.length) return null;
  return <Top10MonthSection data={filtered} excludedIds={excludedIds} />;
}

function MavinsBestWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <MavinsBestSection data={data} />;
}

function PodcastsWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <PodcastSection data={data} />;
}

function RadioFMWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <RadioFMSection data={data} />;
}

function ThrowbacksWrapper({ data }: { data: any[] }) {
  if (!data.length) return null;
  return <ThrowbacksSection data={data} />;
}

function NewReleasesWrapper({ data }: { data: Song[] }) {
  if (!data.length) return null;
  return <NewReleasesSection data={data} />;
}

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [isThemeReady, setIsThemeReady] = useState(false);
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const watermarkPulse = useRef(new Animated.Value(1)).current;

  const { expandPlayer } = usePlayerOverlay();
  const { playAudio } = useMusicPlayer();
  const { colors } = useTheme();
  const unreadNotificationCount = useNotificationBadge();
  
  // ─── Quick Picks from database ─────────────────────────────────────────────
  const { quickPicks: dbQuickPicks, loading: quickPicksLoading, refetch: refetchQuickPicks } = useQuickPicks();
  const quickPicks = useHomeStore((s) => s.quickPicks);

  useEffect(() => {
    if (colors && colors.background) {
      setIsThemeReady(true);
    }
  }, [colors]);

  // Store selectors
  const trending = useHomeStore((s) => s.trending);
  const biggestHits = useHomeStore((s) => s.biggestHits);
  const peoplesChoice = useHomeStore((s) => s.peoplesChoice);
  const top10Month = useHomeStore((s) => s.top10Month);
  const mavinsBest = useHomeStore((s) => s.mavinsBest);
  const newReleases = useHomeStore((s) => s.newReleases);
  const throwbacks = useHomeStore((s) => s.throwbacks);
  const mixes = useHomeStore((s) => s.mixes);
  const channels = useHomeStore((s) => s.channels);
  const podcasts = useHomeStore((s) => s.podcasts);
  const radioStations = useHomeStore((s) => s.radioStations);
  const recentSongs = useHomeStore((s) => s.recentSongs);
  const getExcludedIdsForTop10 = useHomeStore((s) => s.getExcludedIdsForTop10);
  const top10ExcludedIds = getExcludedIdsForTop10();

  // FIX: previously, TrendingNowWrapper called shuffleArray(...).slice(0, 4)
  // directly during render with no memoization. Since HomeScreen re-renders
  // frequently (store updates, theme ticks, scroll/refresh state, etc.),
  // this produced a brand-new random 4-song selection on EVERY render —
  // visibly reshuffling the "Trending Now" section in front of the user.
  //
  // `trending` itself is already shuffled once per day by
  // setTrendingWithDailyShuffle() in the home store, so its order is stable
  // for the whole day. We just need to take a stable slice of it here, and
  // only recompute that slice when `trending`'s reference actually changes
  // (i.e. once per day), not on every render.
  const trendingDisplay = useMemo(() => trending.slice(0, 4), [trending]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(watermarkPulse, { toValue: 1.06, duration: 3000, useNativeDriver: true }),
        Animated.timing(watermarkPulse, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, [watermarkPulse]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { 
      useHomeStore.getState().markStale();
      await refetchQuickPicks(); // Refresh Quick Picks from database
    }
    catch (e) { console.warn("[HomeScreen] refresh error:", e); }
    finally { setRefreshing(false); }
  }, [refetchQuickPicks]);

  const handleSongPress = useCallback(
    (song: Song) => {
      triggerHaptic();
      useHomeStore.getState().addRecentSong(song);
      
      playAudio(
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          thumbnail: song.thumbnail,
          url: song.url || "",
          duration: song.duration,
          videoId: song.videoId
        },
        undefined,
        expandPlayer,
      );
    },
    [playAudio, expandPlayer],
  );

  const handleCampaignCardPress = useCallback(
    (card: CampaignCard) => {
      triggerHaptic();
      // Campaign cards are treated as songs
      if (card.songId || card.id) {
        const songToPlay = trending.find(s => s.id === card.songId || s.id === card.id) ||
          biggestHits.find(s => s.id === card.songId || s.id === card.id) ||
          newReleases.find(s => s.id === card.songId || s.id === card.id) ||
          peoplesChoice.find(s => s.id === card.songId || s.id === card.id);
        
        if (songToPlay) {
          handleSongPress(songToPlay);
          return;
        }
        
        // Fallback: create basic song object with video ID.
        // Use the normalised fields (songTitle / artistName) populated by
        // useQuickPicks — never fall back to card.description, which is the
        // raw YouTube description blob and is unsuitable as an artist label.
        const videoId = card.songId || card.id;
        handleSongPress({
          id: card.songId || card.id,
          title: card.songTitle || card.title,
          artist: card.artistName || 'Various Artists',
          thumbnail: card.thumbnail,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          videoId: videoId,
          duration: 0,
        });
      }
    },
    [trending, biggestHits, newReleases, peoplesChoice, handleSongPress],
  );

  const handleSearchPress = useCallback(() => {
    triggerHaptic();
    router.push("/search");
  }, [router]);

  const handleNotificationsPress = useCallback(() => {
    triggerHaptic();
    router.push("/(modals)/notifications");
  }, [router]);

  const CombinedHeader = useMemo(
    () => (
      <View style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { paddingTop: top + 10, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.searchContainer,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: `${colors.gold}40`,
                borderWidth: 1,
              }
            ]}
            onPress={handleSearchPress}
            activeOpacity={0.7}
          >
            <Ionicons name="search" size={20} color={colors.gold} style={styles.searchIcon} />
            <Text style={[styles.searchPlaceholderText, { color: colors.textMuted }]}>
              Search music, artists, albums...
            </Text>
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleNotificationsPress}
              style={styles.iconButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <View>
                <Ionicons name="notifications-outline" size={24} color={colors.gold} />
                {unreadNotificationCount > 0 && (
                  <View style={[styles.notificationBadge, { backgroundColor: colors.error || "#FF3B30", borderColor: colors.background }]}>
                    <Text style={styles.notificationBadgeText}>
                      {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    ),
    [colors, top, handleSearchPress, handleNotificationsPress, unreadNotificationCount],
  );

  if (!isThemeReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors?.background || '#000000' }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors?.gold || '#D4AF37'} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View pointerEvents="none" style={styles.watermarkWrapper}>
        <Animated.Image
          source={require("@/assets/images/mavins.png")}
          style={[
            styles.watermark,
            {
              transform: [{ scale: watermarkPulse }],
              opacity: colors.watermarkOpacity,
            }
          ]}
          resizeMode="contain"
        />
      </Animated.View>

      <ScrollControllerWrapper
        headerComponent={CombinedHeader}
        showHeader={true}
        initialHeaderHeight={top + 78}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.gold]}
            tintColor={colors.gold}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        <SectionErrorBoundary sectionName="Quick Actions">
          <QuickActionsGrid recentSongs={recentSongs} onSongPress={handleSongPress} />
        </SectionErrorBoundary>

        {/* ─── Quick Picks - Only show if there are cards ─────────────────── */}
        {quickPicks.length > 0 && (
          <SectionErrorBoundary sectionName="Quick Picks">
            <QuickPicksSection data={quickPicks} onCardPress={handleCampaignCardPress} />
          </SectionErrorBoundary>
        )}

        <SectionErrorBoundary sectionName="Trending Now">
          <TrendingNowWrapper data={trendingDisplay} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Biggest Hits">
          <BiggestHitsWrapper data={biggestHits} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Create Mix">
          <CreateMixWrapper data={mixes} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Music Channels">
          <MusicChannelsWrapper data={channels} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="People's Choice">
          <PeoplesChoiceWrapper data={peoplesChoice} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Top 10 Month">
          <Top10MonthWrapper data={top10Month} excludedIds={top10ExcludedIds} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Mavin's Best">
          <MavinsBestWrapper data={mavinsBest} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Podcasts">
          <PodcastsWrapper data={podcasts} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Radio FM">
          <RadioFMWrapper data={radioStations} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Throwbacks">
          <ThrowbacksWrapper data={throwbacks} />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="New Releases">
          <NewReleasesWrapper data={newReleases} />
        </SectionErrorBoundary>

        <View style={styles.bottomSpacing} />
      </ScrollControllerWrapper>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  watermarkWrapper: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", zIndex: 0 },
  watermark: { width: 300, height: 300 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 16,
  },
  searchIcon: { marginRight: 10 },
  searchPlaceholderText: { fontSize: 16, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  iconButton: { padding: 4 },
  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
  },
  notificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 11,
  },
  scrollContent: { paddingHorizontal: 16 },
  bottomSpacing: { height: 140 },

  // ── Quick Actions Section (Single Card - NO slideshow) ──
  quickActionsContainer: { marginVertical: 16 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitleContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerButton: { paddingHorizontal: 12, paddingVertical: 4 },
  headerButtonText: { fontSize: 13, fontWeight: "500" },
  seeAllText: { fontSize: 13, fontWeight: "600" },

  // SINGLE CARD STYLES (No grid, no FlatList, no pagination)
  singleQuickActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
  },
  singleQuickActionImage: {
    width: 60,
    height: 60,
    borderRadius: 10,
  },
  singleQuickActionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  singleQuickActionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  singleQuickActionArtist: {
    fontSize: 13,
  },
  singleQuickActionPlay: {
    marginLeft: 8,
  },

  // Legacy styles (kept for other sections that may use them)
  gridPage: { width: width - 32 },
  gridRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  gridCell: { width: GRID_SIZE },
  gridItem: { alignItems: "center" },
  gridImage: { width: GRID_SIZE, height: GRID_SIZE, borderRadius: 12 },
  gridTitle: { fontSize: 12, fontWeight: "600", marginTop: 6, textAlign: "center", width: GRID_SIZE },
  gridArtist: { fontSize: 10, textAlign: "center", width: GRID_SIZE },
  pageIndicators: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 12, gap: 8 },
  pageIndicator: { width: 6, height: 6, borderRadius: 3 },
});