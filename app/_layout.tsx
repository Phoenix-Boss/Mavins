// app/_layout.tsx
//
// ARCHITECTURE:
//   MusicPlayerProvider  — owns the expo-audio player instance + stream resolution
//   PlayerOverlayContext — manages playerMode: 'hidden' | 'mini' | 'expanded'
//
//   Flow:
//     playAudio() → currentTrack set → overlay auto-shows mini
//     Tap mini-player → expandPlayer() → 'expanded'
//     Swipe down full player → collapsePlayer() → 'mini'
//
//   setPlayerOverlayRefs() wires the overlay's expand/collapse into the engine
//   so MusicPlayerContext can call engine.expandPlayer() without importing
//   PlayerOverlayContext (which would recreate the circular dep).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { SharedValue } from 'react-native-reanimated';
import {
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  Dimensions,
  TouchableOpacity,
  Text,
} from 'react-native';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
  useSharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { initializeLibrary } from '@/store/library';
import { MusicPlayerProvider } from '@/components/MusicPlayerContext';
import { LyricsProvider, LyricsFetcher } from '@/hooks/useLyricsContext';
import { GlobalUIStateProvider } from '@/contexts/GlobalUIStateContext';
import { UpdateModal } from '@/components/UpdateModal';
import { MessageModal } from '@/components/MessageModal';
import PremiumBanner from '@/components/ads/banner/premium';
import { HomePreloader } from '@/components/HomePreloader';
import { queryClient } from '@/libs/supabase';
import { initCache } from '@/libs/cache';
import HoneygainConsentGate from '@/components/HoneygainConsentGate';
import { triggerHaptic } from '@/helpers/haptics';
import PlayerContent from '@/components/player/playerContent';

// Import from libs/playerSetup - single source of truth for GestureContext + player engine
import {
  GestureContext,
  useGestureContext as useGestureContextFromBridge,
  usePlayerEngine,
} from '@/libs/playerSetup';

SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREMIUM_BANNER_DELAY_MS = 2200;
const MINI_PLAYER_HEIGHT      = 64;
const COLLAPSED_BOTTOM_OFFSET = 8;
const SPRING_EXPAND   = { damping: 28, stiffness: 260, mass: 1, overshootClamping: true } as const;
const SPRING_COLLAPSE = { damping: 28, stiffness: 260, overshootClamping: true }           as const;
const SPRING_FLING    = { damping: 38, stiffness: 280, overshootClamping: true }           as const;
const COLLAPSE_THRESHOLD = SCREEN_HEIGHT * 0.18;
const COLLAPSE_VELOCITY  = 750;

const ICON_IMAGE   = require('@/assets/images/icon.png');
const MAVINS_IMAGE = require('@/assets/images/mavins.png');

// ─────────────────────────────────────────────────────────────────────────────
// PlayerOverlayContext
// ─────────────────────────────────────────────────────────────────────────────

type PlayerMode = 'hidden' | 'mini' | 'expanded';

interface PlayerOverlayContextValue {
  playerMode:     PlayerMode;
  showMiniPlayer: () => void;
  expandPlayer:   () => void;
  collapsePlayer: () => void;
  hidePlayer:     () => void;
  isPlayerVisible: boolean;
}

const PlayerOverlayContext = createContext<PlayerOverlayContextValue | null>(null);

export function usePlayerOverlay(): PlayerOverlayContextValue {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) {
    return {
      playerMode:     'hidden',
      showMiniPlayer: () => {},
      expandPlayer:   () => {},
      collapsePlayer: () => {},
      hidePlayer:     () => {},
      isPlayerVisible: false,
    };
  }
  return ctx;
}

// Re-export useGestureContext from the bridge so consumers that import from
// _layout still get the canonical instance.
export { useGestureContextFromBridge as useGestureContext };

// ─────────────────────────────────────────────────────────────────────────────
// MiniPlayer
// ─────────────────────────────────────────────────────────────────────────────

function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const insets = useSafeAreaInsets();
  const engine = usePlayerEngine();

  if (!engine.currentTrack) return null;

  const artwork = engine.currentTrack.thumbnail
    ? { uri: engine.currentTrack.thumbnail }
    : MAVINS_IMAGE;

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onExpand}
      style={[
        styles.miniPlayerContainer,
        { marginBottom: insets.bottom > 0 ? insets.bottom : COLLAPSED_BOTTOM_OFFSET },
      ]}
    >
      <View style={styles.miniPlayerAccent} />

      <Image
        source={artwork}
        style={styles.miniPlayerArtwork}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.miniPlayerTextWrapper}>
        <Text style={styles.miniPlayerTitle} numberOfLines={1}>
          {engine.currentTrack.title}
        </Text>
        <Text style={styles.miniPlayerArtist} numberOfLines={1}>
          {engine.currentTrack.artist || 'Unknown Artist'}
        </Text>
      </View>

      <View style={styles.miniPlayerControls}>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); engine.togglePlayPause(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={engine.isPlaying ? 'pause' : 'play'}
            size={26}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={async (e) => { e.stopPropagation(); await engine.skipToNext(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={{ marginLeft: 16 }}
        >
          <Ionicons name="play-skip-forward" size={22} color="rgba(255,255,255,0.75)" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FullPlayerOverlay
// ─────────────────────────────────────────────────────────────────────────────

function FullPlayerOverlay({ onCollapse }: { onCollapse: () => void }) {
  const insets             = useSafeAreaInsets();
  const router             = useRouter();
  const { gestureBlockedSV } = useGestureContextFromBridge();

  const translateY  = useSharedValue(SCREEN_HEIGHT);
  const isAnimating = useRef(false);

  useEffect(() => {
    translateY.value = withSpring(0, SPRING_EXPAND);
  }, [translateY]);

  const handleCollapse = useCallback(() => {
    if (isAnimating.current) return;
    isAnimating.current = true;
    triggerHaptic();
    onCollapse();
    setTimeout(() => { isAnimating.current = false; }, 400);
  }, [onCollapse]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCollapse();
      return true;
    });
    return () => sub.remove();
  }, [handleCollapse]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-5)
    .onUpdate((event) => {
      if (gestureBlockedSV.value) return;
      if (event.translationY <= 0) return;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      if (gestureBlockedSV.value) {
        translateY.value = withSpring(0, SPRING_COLLAPSE);
        return;
      }
      const shouldCollapse =
        event.translationY > COLLAPSE_THRESHOLD ||
        (event.translationY > 50 && event.velocityY > COLLAPSE_VELOCITY);

      if (shouldCollapse) {
        translateY.value = withSpring(
          SCREEN_HEIGHT,
          { ...SPRING_FLING, velocity: event.velocityY },
          (finished) => { if (finished) runOnJS(handleCollapse)(); },
        );
      } else {
        translateY.value = withSpring(0, SPRING_COLLAPSE);
      }
    });

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

  const onNavigateToLyrics   = useCallback(() => router.push('/(modals)/lyrics'),          [router]);
  const onNavigateToRelated  = useCallback(() => router.push('/(modals)/related'),          [router]);
  const onNavigateToMenu     = useCallback(() => router.push('/(modals)/menu'),             [router]);
  const onNavigateToQueue    = useCallback(() => router.push('/(modals)/queue'),            [router]);
  const onNavigateToPlaylist = useCallback(() => router.push('/(modals)/addToPlaylist'),    [router]);
  const onNavigateToComments = useCallback(() => router.push('/(modals)/comments'),         [router]);
  const onNavigateToArtist   = useCallback(
    (params?: { id: string; subtitle: string }) => {
      if (params?.id) {
        (router as any).push(`/artist/${params.id}`);
      }
    },
    [router],
  );

  return (
    <GestureDetector gesture={panGesture}>
      <ReAnimated.View style={[styles.fullPlayerCard, cardStyle]}>
        <PlayerContent
          onMinimize={handleCollapse}
          onClose={handleCollapse}
          isExpanded
          playerReady={true}
          topInset={insets.top}
          onNavigateToLyrics={onNavigateToLyrics}
          onNavigateToRelated={onNavigateToRelated}
          onNavigateToArtist={onNavigateToArtist}
          onNavigateToMenu={onNavigateToMenu}
          onNavigateToQueue={onNavigateToQueue}
          onNavigateToPlaylist={onNavigateToPlaylist}
          onNavigateToComments={onNavigateToComments}
        />
      </ReAnimated.View>
    </GestureDetector>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerOverlayProvider
// ─────────────────────────────────────────────────────────────────────────────

function PlayerOverlayProvider({ children }: { children: React.ReactNode }) {
  const [playerMode, setPlayerMode] = useState<PlayerMode>('hidden');
  const engine = usePlayerEngine();

  const expandPlayer   = useCallback(() => setPlayerMode('expanded'), []);
  const collapsePlayer = useCallback(() => setPlayerMode('mini'),     []);
  const showMiniPlayer = useCallback(() => setPlayerMode(prev => prev === 'hidden' ? 'mini' : prev), []);
  const hidePlayer     = useCallback(() => setPlayerMode('hidden'),   []);

  useEffect(() => {
    engine.setPlayerOverlayRefs(expandPlayer, collapsePlayer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPlayerMode(prev => {
      if (engine.currentTrack && prev === 'hidden') return 'mini';
      if (!engine.currentTrack && prev !== 'hidden') return 'hidden';
      return prev;
    });
  }, [engine.currentTrack]);

  const isPlayerVisible = playerMode === 'expanded';

  const value: PlayerOverlayContextValue = {
    playerMode,
    showMiniPlayer,
    expandPlayer,
    collapsePlayer,
    hidePlayer,
    isPlayerVisible,
  };

  return (
    <PlayerOverlayContext.Provider value={value}>
      {children}
      {playerMode === 'mini'     && <MiniPlayer       onExpand={expandPlayer}      />}
      {playerMode === 'expanded' && <FullPlayerOverlay onCollapse={collapsePlayer} />}
    </PlayerOverlayContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PulsingLogoOverlay
// ─────────────────────────────────────────────────────────────────────────────

function PulsingLogoOverlay({ visible }: { visible: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const pulseRef  = useRef<Animated.CompositeAnimation | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 850, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 850, useNativeDriver: true }),
      ])
    );
    pulseRef.current.start();
    return () => pulseRef.current?.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (!visible) {
      pulseRef.current?.stop();
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true })
        .start(() => setHidden(true));
    }
  }, [visible, fadeAnim]);

  if (hidden) return null;

  return (
    <Animated.View style={[styles.logoOverlay, { opacity: fadeAnim }]} pointerEvents="none">
      <Animated.Image
        source={ICON_IMAGE}
        style={[styles.logoImage, { transform: [{ scale: pulseAnim }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppShell
// ─────────────────────────────────────────────────────────────────────────────

function AppShell({
  premiumBannerVisible,
  setPremiumBannerVisible,
  fontsLoaded,
}: {
  premiumBannerVisible:    boolean;
  setPremiumBannerVisible: (v: boolean) => void;
  fontsLoaded:             boolean;
}) {
  return (
    <View style={styles.appShell}>
      {fontsLoaded && <HomePreloader />}

      <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen
          name="(player)"
          options={{ animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen
          name="(modals)"
          options={{
            presentation: 'transparentModal',
            animation:    'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>

      <LyricsFetcher />
      <UpdateModal />
      <MessageModal />

      <PremiumBanner
        visible={premiumBannerVisible}
        onDismiss={() => setPremiumBannerVisible(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RootLayout
// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),
    Meriva:    require('@/assets/fonts/Meriva.ttf'),
  });

  const [appReady,             setAppReady]             = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);
  const [navReady,             setNavReady]             = useState(false);

  const navigationState = useRootNavigationState();

  const sliderActiveRef  = useRef(false);
  const buttonActiveRef  = useRef(false);
  const gestureBlockedSV = useSharedValue(false);

  const gestureContextValue = useRef({
    setSliderActive: (v: boolean) => {
      sliderActiveRef.current = v;
      gestureBlockedSV.value  = sliderActiveRef.current || buttonActiveRef.current;
    },
    setButtonActive: (v: boolean) => {
      buttonActiveRef.current = v;
      gestureBlockedSV.value  = sliderActiveRef.current || buttonActiveRef.current;
    },
    isGestureBlocked: () => sliderActiveRef.current || buttonActiveRef.current,
    gestureBlockedSV,
  }).current;

  useEffect(() => {
    if (navigationState?.key && !navReady) setNavReady(true);
  }, [navigationState?.key, navReady]);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(console.warn);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (navReady && !appReady) setAppReady(true);
  }, [navReady, appReady]);

  useEffect(() => {
    initializeLibrary().catch(e => console.warn('[Library]', e));
    try { initCache({ startBackgroundJobs: true }); } catch (e) { console.warn('[Cache]', e); }
  }, []);

  useEffect(() => {
    if (!appReady) return;
    const t = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [appReady]);

  useEffect(() => {
    const handle = (url: string | null) => {
      if (url?.startsWith('mavins-player')) console.log('[DeepLink]', url);
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <GestureHandlerRootView style={styles.flex}>
            <ThemeProvider value={DarkTheme}>
              <StatusBar hidden />
              <GestureContext.Provider value={gestureContextValue}>

                {/* MusicPlayerProvider - expo-audio engine + stream resolution */}
                <MusicPlayerProvider>
                  <GlobalUIStateProvider>
                    <LyricsProvider>

                      {/* PlayerOverlayProvider - manages mini/full player UI */}
                      <PlayerOverlayProvider>
                        <AppShell
                          premiumBannerVisible={premiumBannerVisible}
                          setPremiumBannerVisible={setPremiumBannerVisible}
                          fontsLoaded={fontsLoaded ?? false}
                        />
                        <PulsingLogoOverlay visible={!appReady} />
                      </PlayerOverlayProvider>

                    </LyricsProvider>
                  </GlobalUIStateProvider>
                </MusicPlayerProvider>

              </GestureContext.Provider>
            </ThemeProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </QueryClientProvider>
    </HoneygainConsentGate>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  appShell: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  logoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent:  'center',
    alignItems:      'center',
    zIndex:          9999,
  },
  logoImage: {
    width:        120,
    height:       120,
    borderRadius: 24,
  },

  fullPlayerCard: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    bottom:          0,
    backgroundColor: 'transparent',
    overflow:        'hidden',
    zIndex:          9999,
    elevation:       99,
    borderTopLeftRadius:  Platform.OS === 'ios' ? 14 : 10,
    borderTopRightRadius: Platform.OS === 'ios' ? 14 : 10,
  },

  miniPlayerContainer: {
    position:          'absolute',
    bottom:            0,
    left:              12,
    right:             12,
    flexDirection:     'row',
    alignItems:        'center',
    height:            MINI_PLAYER_HEIGHT,
    backgroundColor:   '#1C1C1E',
    borderRadius:      14,
    paddingHorizontal: 10,
    overflow:          'hidden',
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.4,
    shadowRadius:      8,
    elevation:         10,
    zIndex:            1000,
  },
  miniPlayerAccent: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    height:          2,
    backgroundColor: '#D4AF37',
    opacity:         0.6,
  },
  miniPlayerArtwork: {
    width:           44,
    height:          44,
    borderRadius:    8,
    backgroundColor: '#2a2a2a',
  },
  miniPlayerTextWrapper: {
    flex:           1,
    marginLeft:     10,
    justifyContent: 'center',
  },
  miniPlayerTitle: {
    color:         '#fff',
    fontSize:      13,
    fontWeight:    '600',
    letterSpacing: 0.1,
  },
  miniPlayerArtist: {
    color:     'rgba(255,255,255,0.55)',
    fontSize:  11,
    marginTop: 2,
  },
  miniPlayerControls: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingLeft:   8,
  },
});