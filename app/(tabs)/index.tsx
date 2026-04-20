// app/(tabs)/index.tsx - Home Screen with zero-routing player overlay
//
// PLAYER OVERLAY ARCHITECTURE:
//   PlayerScreen is rendered as a direct child of this screen — not a route.
//   Opening/closing is pure React state (isPlayerVisible from PlayerOverlayContext).
//   No router.push, no router.back, no navigation lifecycle events.
//   The home screen never re-mounts, never loses scroll position, never re-fetches.
//   Dismiss = isPlayerVisible → false → overlay unmounts. That's it.
//
// Issue 2 & 9 Fix: Lock Screen Navigation to Home + Auto-expand
//   - AppState listener to auto-expand player when app resumes with active track
//   - Notification launch detection to expand player when opened from lock screen
//   - AsyncStorage restoration of last playing state
//
// Issue 5 Fix: Added ALL navigation handlers to PlayerScreenOverlay
//   - onNavigateToLyrics, onNavigateToRelated, onNavigateToArtist
//   - onNavigateToMenu, onNavigateToEqualizer, onNavigateToQueue
//   - onNavigateToPlaylist, onNavigateToComments, onNavigateToSleepTimer
//   - onNavigateToCast

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  RefreshControl,
  StyleSheet,
  FlatList,
  Image,
  Dimensions,
  BackHandler,
  Platform,
  AppState,
  AppStateStatus,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import TrackPlayer, { State, useActiveTrack } from "react-native-track-player";
import { triggerHaptic } from "@/helpers/haptics";
import ScrollControllerWrapper from "@/components/ScrollControllerWrapper";
import { useHomeStore, Song } from "@/store/home";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { usePlayerOverlay } from "@/components/player/playerProvider";
import { useGestureContext } from "@/app/_layout";
import PlayerContent from "@/components/player/playerContent";

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

const { width, height: SCREEN_HEIGHT } = Dimensions.get("window");
const GRID_SIZE = (width - 48) / 3;

const COLORS = {
  background: "#000000",
  surface: "#121212",
  goldPrimary: "#D4AF37",
  goldShimmer: "#E6C16A",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  searchBackground: "#1A1A1A",
  searchPlaceholder: "#666666",
  danger: "#EF4444",
};

// ─── Spring/gesture constants (matches PlayerScreen.tsx) ──────────────────────

const SPRING_OPEN  = { damping: 28, stiffness: 260, mass: 1, overshootClamping: true };
const SPRING_SNAP  = { damping: 28, stiffness: 260, overshootClamping: true };
const SPRING_FLING = { damping: 38, stiffness: 280, overshootClamping: true };
const DISMISS_THRESHOLD = SCREEN_HEIGHT * 0.18;
const DISMISS_VELOCITY  = 750;

// ─── PlayerScreenOverlay ──────────────────────────────────────────────────────
//
// Self-contained player overlay. Lives in the home screen's component tree.
// No routing. Entrance/exit are pure Reanimated springs.
// onDismiss → calls collapsePlayer() → isPlayerVisible = false → unmounts.
//
// Issue 5 Fix: Added all navigation handlers as props to PlayerContent

interface PlayerScreenOverlayProps {
  onDismiss: () => void;
  playerReady: boolean;
}

function PlayerScreenOverlay({ onDismiss, playerReady }: PlayerScreenOverlayProps) {
  const insets             = useSafeAreaInsets();
  const router             = useRouter();
  const { gestureBlockedSV } = useGestureContext();
  // gestureBlockedSV is a Reanimated shared value from GestureContext —
  // safe to read directly in worklets. Never call isGestureBlocked() from a worklet.

  const translateY    = useSharedValue(SCREEN_HEIGHT);
  const dragProgress  = useSharedValue(0);
  const isAnimating   = useRef(false);

  // ── Entrance: spring up from off-screen on mount ──────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      translateY.value   = withSpring(0, SPRING_OPEN);
      dragProgress.value = withTiming(0, { duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dismiss: animate out then call onDismiss ──────────────────────────────
  const handleDismiss = useCallback(() => {
    if (isAnimating.current) return;
    isAnimating.current = true;
    triggerHaptic();
    onDismiss(); // collapsePlayer() — sets isPlayerVisible=false, unmounts this
  }, [onDismiss]);

  // ── Exit animation wrapper (swipe fling calls this then onDismiss) ─────────
  const animateDismiss = useCallback((velocityY = 600) => {
    if (isAnimating.current) return;
    isAnimating.current = true;
    dragProgress.value  = withTiming(1, { duration: 200 });
    translateY.value    = withSpring(
      SCREEN_HEIGHT,
      { ...SPRING_FLING, velocity: velocityY },
      (finished) => { if (finished) runOnJS(handleDismiss)(); },
    );
  }, [handleDismiss, translateY, dragProgress]);

  // ── Android hardware back ─────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      animateDismiss(600);
      return true;
    });
    return () => sub.remove();
  }, [animateDismiss]);

  // ── Swipe-to-dismiss gesture ──────────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-5)
    .onBegin(() => {
      // gestureBlockedSV is a shared value — readable on the UI thread safely.
    })
    .onUpdate((event) => {
      if (gestureBlockedSV.value) return;
      if (event.translationY <= 0) return;
      translateY.value   = event.translationY;
      dragProgress.value = Math.min(event.translationY / (SCREEN_HEIGHT * 0.5), 1);
    })
    .onEnd((event) => {
      if (gestureBlockedSV.value) {
        translateY.value   = withSpring(0, SPRING_SNAP);
        dragProgress.value = withTiming(0, { duration: 200 });
        return;
      }
      const shouldDismiss =
        event.translationY > DISMISS_THRESHOLD ||
        (event.translationY > 50 && event.velocityY > DISMISS_VELOCITY);

      if (shouldDismiss) {
        runOnJS(animateDismiss)(event.velocityY);
      } else {
        translateY.value   = withSpring(0, SPRING_SNAP);
        dragProgress.value = withTiming(0, { duration: 200 });
      }
    });

  // ── Animated styles ───────────────────────────────────────────────────────
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      {
        scale: interpolate(
          translateY.value,
          [0, SCREEN_HEIGHT * 0.5],
          [1, 0.996],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // ── Navigation Handlers (Issue 5 Fix) ──────────────────────────────────────
  // All handlers use router.push to open modals over the player overlay

  const onNavigateToLyrics = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Lyrics modal');
    router.push('/(modals)/lyrics');
  }, [router]);

  const onNavigateToRelated = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Related modal');
    router.push('/(modals)/related');
  }, [router]);

  const onNavigateToArtist = useCallback((params?: { id: string; subtitle: string }) => {
    console.log('[PlayerScreenOverlay] Navigating to Artist screen:', params);
    if (params?.id) {
      router.push(`/artist/${params.id}`);
    }
  }, [router]);

  const onNavigateToMenu = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Menu modal');
    router.push('/(modals)/song-options');
  }, [router]);

  const onNavigateToEqualizer = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Equalizer modal');
    router.push('/(modals)/equalizer');
  }, [router]);

  const onNavigateToQueue = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Queue modal');
    router.push('/(modals)/queue');
  }, [router]);

  const onNavigateToPlaylist = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Add to Playlist modal');
    router.push('/(modals)/add-to-playlist');
  }, [router]);

  const onNavigateToComments = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Comments modal');
    router.push('/(modals)/comments');
  }, [router]);

  const onNavigateToSleepTimer = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Sleep Timer modal');
    router.push('/(modals)/sleep-timer');
  }, [router]);

  const onNavigateToCast = useCallback(() => {
    console.log('[PlayerScreenOverlay] Navigating to Cast dialog');
    router.push('/(modals)/cast');
  }, [router]);

  return (
    // absoluteFill so it covers the entire home screen including tab bar
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={panGesture}>
        <ReAnimated.View style={[overlayStyles.card, cardStyle]}>
          <PlayerContent
            onMinimize={handleDismiss}
            onClose={handleDismiss}
            isExpanded={true}
            playerReady={playerReady}
            topInset={insets.top}
            // Issue 5 Fix: Pass all navigation handlers
            onNavigateToLyrics={onNavigateToLyrics}
            onNavigateToRelated={onNavigateToRelated}
            onNavigateToArtist={onNavigateToArtist}
            onNavigateToMenu={onNavigateToMenu}
            onNavigateToEqualizer={onNavigateToEqualizer}
            onNavigateToQueue={onNavigateToQueue}
            onNavigateToPlaylist={onNavigateToPlaylist}
            onNavigateToComments={onNavigateToComments}
            onNavigateToSleepTimer={onNavigateToSleepTimer}
            onNavigateToCast={onNavigateToCast}
          />
        </ReAnimated.View>
      </GestureDetector>
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    overflow: "hidden",
    borderTopLeftRadius:  Platform.OS === "ios" ? 14 : 10,
    borderTopRightRadius: Platform.OS === "ios" ? 14 : 10,
    zIndex: 9999,
    elevation: 99,
  },
});

// ─── Shuffle function ─────────────────────────────────────────────────────────

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// ─── Quick Actions Grid Component ─────────────────────────────────────────────
// ONLY shows if recentSongs has data

interface QuickActionsGridProps {
  recentSongs: Song[];
  onSongPress: (song: Song) => void;
}

function QuickActionsGrid({ recentSongs, onSongPress }: QuickActionsGridProps) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  // ── ALL hooks must come before any early return (Rules of Hooks) ──────────
  const shuffledSongs = useMemo(() => {
    if (recentSongs.length === 0) return [];
    return shuffleArray(recentSongs);
  }, [recentSongs]);

  const pages = useMemo(() => {
    const itemsPerPage = 6;
    const result: Song[][] = [];
    for (let i = 0; i < shuffledSongs.length; i += itemsPerPage) {
      result.push(shuffledSongs.slice(i, i + itemsPerPage));
    }
    return result;
  }, [shuffledSongs]);

  useEffect(() => {
    if (pages.length <= 1) return;
    const interval = setInterval(() => {
      const nextPage = (currentPage + 1) % pages.length;
      setCurrentPage(nextPage);
      flatListRef.current?.scrollToIndex({ index: nextPage, animated: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [currentPage, pages.length]);

  // Early return AFTER all hooks
  if (recentSongs.length === 0) return null;

  const handleClearAll = () => {
    triggerHaptic();
    useHomeStore.getState().clearRecentSongs();
  };

  const handleSeeAll = () => {
    triggerHaptic();
    router.push("/(tabs)/library/recent");
  };

  const renderGridItem = ({ item }: { item: Song }) => (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => onSongPress(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.gridImage}
        resizeMode="cover"
      />
      <View style={styles.gridOverlay}>
        <Ionicons name="play" size={20} color="#fff" />
      </View>
      <Text style={styles.gridTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.gridArtist} numberOfLines={1}>
        {item.artist}
      </Text>
    </TouchableOpacity>
  );

  const renderPage = ({ item: pageItems }: { item: Song[]; index: number }) => (
    <View style={styles.gridPage}>
      <View style={styles.gridRow}>
        {pageItems.slice(0, 3).map((song) => (
          <View key={`grid-${song.id}`} style={styles.gridCell}>
            {renderGridItem({ item: song })}
          </View>
        ))}
      </View>
      <View style={styles.gridRow}>
        {pageItems.slice(3, 6).map((song) => (
          <View key={`grid-${song.id}`} style={styles.gridCell}>
            {renderGridItem({ item: song })}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.quickActionsContainer}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleContainer}>
          <Ionicons name="time-outline" size={20} color={COLORS.goldPrimary} />
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.sectionActions}>
          <TouchableOpacity onPress={handleClearAll} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSeeAll}>
            <Text style={styles.seeAllText}>See All</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={(_, index) => `page-${index}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const newPage = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentPage(newPage);
        }}
      />

      {pages.length > 1 && (
        <View style={styles.pageIndicators}>
          {pages.map((_, index) => (
            <View
              key={`indicator-${index}`}
              style={[
                styles.pageIndicator,
                currentPage === index && styles.pageIndicatorActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Section Error Boundary ───────────────────────────────────────────────────

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
      return null;
    }
    return this.props.children;
  }
}

// ─── Section Wrappers - Each only shows if data exists ────────────────────────

interface TrendingNowWrapperProps { data: Song[]; }
function TrendingNowWrapper({ data }: TrendingNowWrapperProps) {
  if (data.length === 0) return null;
  const shuffledData = shuffleArray(data).slice(0, 4);
  if (shuffledData.length === 0) return null;
  return <TrendingNowSection data={shuffledData} />;
}

interface BiggestHitsWrapperProps { data: Song[]; }
function BiggestHitsWrapper({ data }: BiggestHitsWrapperProps) {
  if (data.length === 0) return null;
  return <BiggestHitsSection data={data} />;
}

interface CreateMixWrapperProps { data: any[]; }
function CreateMixWrapper({ data }: CreateMixWrapperProps) {
  if (data.length === 0) return null;
  return <CreateMixSection data={data} />;
}

interface MusicChannelsWrapperProps { data: any[]; }
function MusicChannelsWrapper({ data }: MusicChannelsWrapperProps) {
  if (data.length === 0) return null;
  return <MusicChannelsSection data={data} />;
}

interface PeoplesChoiceWrapperProps { data: Song[]; }
function PeoplesChoiceWrapper({ data }: PeoplesChoiceWrapperProps) {
  if (data.length === 0) return null;
  return <PeoplesChoiceSection data={data} />;
}

interface Top10MonthWrapperProps { data: Song[]; excludedIds: string[]; }
function Top10MonthWrapper({ data, excludedIds }: Top10MonthWrapperProps) {
  if (data.length === 0) return null;
  // Filter out excluded IDs
  const filtered = data.filter(song => !excludedIds.includes(song.id));
  if (filtered.length === 0) return null;
  return <Top10MonthSection data={filtered} excludedIds={excludedIds} />;
}

interface MavinsBestWrapperProps { data: any[]; }
function MavinsBestWrapper({ data }: MavinsBestWrapperProps) {
  if (data.length === 0) return null;
  return <MavinsBestSection data={data} />;
}

interface PodcastsWrapperProps { data: any[]; }
function PodcastsWrapper({ data }: PodcastsWrapperProps) {
  if (data.length === 0) return null;
  return <PodcastSection data={data} />;
}

interface RadioFMWrapperProps { data: any[]; }
function RadioFMWrapper({ data }: RadioFMWrapperProps) {
  if (data.length === 0) return null;
  return <RadioFMSection data={data} />;
}

interface ThrowbacksWrapperProps { data: any[]; }
function ThrowbacksWrapper({ data }: ThrowbacksWrapperProps) {
  if (data.length === 0) return null;
  return <ThrowbacksSection data={data} />;
}

interface NewReleasesWrapperProps { data: Song[]; }
function NewReleasesWrapper({ data }: NewReleasesWrapperProps) {
  if (data.length === 0) return null;
  return <NewReleasesSection data={data} />;
}

// ─── Main Home Screen ─────────────────────────────────────────────────────────
//
// ARCHITECTURE — Why PlayerScreen lives here as a local overlay:
//
//  The old flow: tap song → router.push('/(player)') → React Navigation
//  creates a new route, runs layout effects, re-evaluates focus listeners,
//  and on dismiss calls router.back() which triggers another navigation
//  cycle. Every transition goes through the JS navigation state machine.
//
//  The new flow: tap song → isPlayerVisible = true → PlayerScreen renders
//  as an absolute-fill View on top of this screen. Dismiss sets
//  isPlayerVisible = false. Zero routing. Zero re-mounts. Zero lag.
//  The home screen scroll position, store subscriptions, and animations
//  are completely untouched — exactly like Spotify's implementation.
//
//  The (player) route in app/_layout.tsx can stay for deep-link support,
//  but the primary UI path never touches it.
//
// Issue 2 & 9 Fix: Lock Screen Navigation to Home + Auto-expand
//   - AppState listener detects app coming to foreground
//   - If track is playing, auto-expands player overlay
//   - Checks notification launch on app start

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const watermarkPulse = useRef(new Animated.Value(1)).current;
  const { playAudio } = useMusicPlayer();
  const activeTrack = useActiveTrack();

  // ── Player overlay state ───────────────────────────────────────────────────
  // Driven directly by PlayerOverlayContext so FloatingPlayer and any other
  // consumer stays in sync without any extra plumbing.
  const { isPlayerVisible, expandPlayer, collapsePlayer, playerReady } = usePlayerOverlay();

  // Subscribe to store individually for proper re-renders
  const trending = useHomeStore((state) => state.trending);
  const biggestHits = useHomeStore((state) => state.biggestHits);
  const peoplesChoice = useHomeStore((state) => state.peoplesChoice);
  const top10Month = useHomeStore((state) => state.top10Month);
  const mavinsBest = useHomeStore((state) => state.mavinsBest);
  const newReleases = useHomeStore((state) => state.newReleases);
  const throwbacks = useHomeStore((state) => state.throwbacks);
  const mixes = useHomeStore((state) => state.mixes);
  const channels = useHomeStore((state) => state.channels);
  const podcasts = useHomeStore((state) => state.podcasts);
  const radioStations = useHomeStore((state) => state.radioStations);
  const recentSongs = useHomeStore((state) => state.recentSongs);
  const getExcludedIdsForTop10 = useHomeStore((state) => state.getExcludedIdsForTop10);

  const top10ExcludedIds = getExcludedIdsForTop10();

  // ─── Issue 2 & 9: Auto-expand player when app opens from lock screen ───────
  // Check if app was opened from notification click
  useEffect(() => {
    const checkNotificationLaunch = async () => {
      try {
        const initialURL = await Linking.getInitialURL();
        console.log('[HomeScreen] Initial URL:', initialURL);
        
        // If app opened from notification click, check if track is playing
        if (initialURL?.includes('main') || initialURL?.includes('playback')) {
          console.log('[HomeScreen] Opened from notification, checking active track');
          const playbackState = await TrackPlayer.getState();
          const track = await TrackPlayer.getActiveTrack();
          
          if (track && playbackState === State.Playing && !isPlayerVisible) {
            console.log('[HomeScreen] Auto-expanding player from notification launch');
            setTimeout(() => {
              expandPlayer();
            }, 500);
          }
        }
      } catch (error) {
        console.warn('[HomeScreen] Failed to check notification launch:', error);
      }
    };
    
    checkNotificationLaunch();
  }, [expandPlayer, isPlayerVisible]);

  // ─── Issue 2 & 9: AppState listener for auto-expand when app resumes ───────
  useEffect(() => {
    let lastAppState = AppState.currentState;
    
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      console.log('[HomeScreen] App state changed:', lastAppState, '->', nextAppState);
      
      // When app comes to foreground from background
      if (lastAppState.match(/inactive|background/) && nextAppState === 'active') {
        // Small delay to ensure everything is ready
        setTimeout(async () => {
          try {
            const playbackState = await TrackPlayer.getState();
            const track = await TrackPlayer.getActiveTrack();
            
            console.log('[HomeScreen] App resumed - playbackState:', playbackState, 'track:', track?.title);
            
            // If a track is playing and player overlay is not visible, auto-expand
            if (track && playbackState === State.Playing && !isPlayerVisible && playerReady) {
              console.log('[HomeScreen] Auto-expanding player on app resume');
              expandPlayer();
            }
          } catch (error) {
            console.warn('[HomeScreen] Failed to check playback state on resume:', error);
          }
        }, 300);
      }
      
      lastAppState = nextAppState;
    });
    
    return () => subscription.remove();
  }, [expandPlayer, isPlayerVisible, playerReady]);

  // Log store data on mount (for debugging)
  useEffect(() => {
    console.log('🏠 [HomeScreen] Mounted with data:', {
      trending: trending.length,
      biggestHits: biggestHits.length,
      peoplesChoice: peoplesChoice.length,
      top10Month: top10Month.length,
      mavinsBest: mavinsBest.length,
      newReleases: newReleases.length,
      throwbacks: throwbacks.length,
      mixes: mixes.length,
      channels: channels.length,
      podcasts: podcasts.length,
      radioStations: radioStations.length,
      recentSongs: recentSongs.length,
    });
  }, []);

  // Watermark pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(watermarkPulse, { toValue: 1.06, duration: 3000, useNativeDriver: true }),
        Animated.timing(watermarkPulse, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      useHomeStore.getState().markStale();
    } catch (e) {
      console.warn("[HomeScreen] refresh error:", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Handlers
  const handleSearchPress = () => {
    triggerHaptic();
    router.push("/(tabs)/search");
  };

  const handleNotificationsPress = () => {
    triggerHaptic();
    router.push("/(modals)/notifications");
  };

  const handleRecentSongPress = useCallback((song: Song) => {
    triggerHaptic();
    useHomeStore.getState().addRecentSong(song);
    // Pass expandPlayer as the navigate callback so playAudio opens the overlay
    // immediately (before stream resolves) and never falls back to router.push.
    // Do NOT call expandPlayer() separately — playAudio calls it as its first step.
    playAudio(
      {
        id: song.id,
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        url: song.url || '',
        duration: song.duration,
        videoId: song.videoId,
      },
      undefined,    // no playlist
      expandPlayer, // open overlay immediately, not router.push
    );
  }, [playAudio, expandPlayer]);

  // Header component
  const CombinedHeader = useCallback(() => (
    <View style={{ backgroundColor: COLORS.background }}>
      <View style={[styles.header, { paddingTop: top + 10 }]}>
        <TouchableOpacity
          style={styles.searchContainer}
          onPress={handleSearchPress}
          activeOpacity={0.7}
        >
          <Ionicons name="search" size={20} color={COLORS.goldShimmer} style={styles.searchIcon} />
          <Text style={styles.searchPlaceholderText}>Search music, artists, albums...</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleNotificationsPress} style={styles.iconButton} hitSlop={12}>
            <Ionicons name="notifications-outline" size={24} color={COLORS.goldShimmer} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  ), [top]);

  return (
    <View style={styles.container}>
      {/* Watermark Background */}
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
        initialHeaderHeight={top + 68}
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
        {/* Quick Actions - ONLY shows if recentSongs has data */}
        <SectionErrorBoundary sectionName="Quick Actions">
          <QuickActionsGrid recentSongs={recentSongs} onSongPress={handleRecentSongPress} />
        </SectionErrorBoundary>

        {/* Trending Now - ONLY shows if trending has data */}
        <SectionErrorBoundary sectionName="Trending Now">
          <TrendingNowWrapper data={trending} />
        </SectionErrorBoundary>

        {/* Biggest Hits - ONLY shows if biggestHits has data */}
        <SectionErrorBoundary sectionName="Biggest Hits">
          <BiggestHitsWrapper data={biggestHits} />
        </SectionErrorBoundary>

        {/* Create Mix - ONLY shows if mixes has data */}
        <SectionErrorBoundary sectionName="Create Mix">
          <CreateMixWrapper data={mixes} />
        </SectionErrorBoundary>

        {/* Music Channels - ONLY shows if channels has data */}
        <SectionErrorBoundary sectionName="Music Channels">
          <MusicChannelsWrapper data={channels} />
        </SectionErrorBoundary>

        {/* People's Choice - ONLY shows if peoplesChoice has data */}
        <SectionErrorBoundary sectionName="People's Choice">
          <PeoplesChoiceWrapper data={peoplesChoice} />
        </SectionErrorBoundary>

        {/* Top 10 Month - ONLY shows if top10Month has data */}
        <SectionErrorBoundary sectionName="Top 10 Month">
          <Top10MonthWrapper data={top10Month} excludedIds={top10ExcludedIds} />
        </SectionErrorBoundary>

        {/* Mavin's Best - ONLY shows if mavinsBest has data */}
        <SectionErrorBoundary sectionName="Mavin's Best">
          <MavinsBestWrapper data={mavinsBest} />
        </SectionErrorBoundary>

        {/* Podcasts - ONLY shows if podcasts has data */}
        <SectionErrorBoundary sectionName="Podcasts">
          <PodcastsWrapper data={podcasts} />
        </SectionErrorBoundary>

        {/* Radio FM - ONLY shows if radioStations has data */}
        <SectionErrorBoundary sectionName="Radio FM">
          <RadioFMWrapper data={radioStations} />
        </SectionErrorBoundary>

        {/* Throwbacks - ONLY shows if throwbacks has data */}
        <SectionErrorBoundary sectionName="Throwbacks">
          <ThrowbacksWrapper data={throwbacks} />
        </SectionErrorBoundary>

        {/* New Releases - ONLY shows if newReleases has data */}
        <SectionErrorBoundary sectionName="New Releases">
          <NewReleasesWrapper data={newReleases} />
        </SectionErrorBoundary>

        <View style={styles.bottomSpacing} />
      </ScrollControllerWrapper>

      {/* ── PLAYER OVERLAY ────────────────────────────────────────────────────
          Rendered as a child of this screen, not a separate route.
          isPlayerVisible drives mount/unmount — no router involved.
          PlayerScreenOverlay handles its own spring entrance + swipe dismiss
          and calls collapsePlayer() when done, which sets isPlayerVisible=false
          in the same React batch — zero navigation lag, zero re-mount.
          
          Issue 5 Fix: PlayerScreenOverlay now includes all navigation handlers
          for Lyrics, Related, Artist, Menu, Equalizer, Queue, Playlist, Comments,
          Sleep Timer, and Cast buttons.                                                       */}
      {isPlayerVisible && (
        <PlayerScreenOverlay onDismiss={collapsePlayer} playerReady={playerReady} />
      )}
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
    zIndex: 0,
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
  },
  bottomSpacing: {
    height: 140,
  },
  quickActionsContainer: {
    marginVertical: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "700",
  },
  sectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  headerButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  seeAllText: {
    color: COLORS.goldPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  gridPage: {
    width: width - 32,
  },
  gridRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  gridCell: {
    width: GRID_SIZE,
  },
  gridItem: {
    alignItems: "center",
  },
  gridImage: {
    width: GRID_SIZE,
    height: GRID_SIZE,
    borderRadius: 12,
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    opacity: 0,
  },
  gridTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
    width: GRID_SIZE,
  },
  gridArtist: {
    color: COLORS.textSecondary,
    fontSize: 10,
    textAlign: "center",
    width: GRID_SIZE,
  },
  pageIndicators: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
  },
  pageIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.textSecondary,
  },
  pageIndicatorActive: {
    width: 20,
    backgroundColor: COLORS.goldPrimary,
  },
});