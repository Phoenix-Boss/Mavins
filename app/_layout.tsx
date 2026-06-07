// app/_layout.tsx
//
// ISSUE 1 FIX: MusicPlayerProvider hoisted above navigation tree
// Industry standard: Audio engine initializes once at app startup,
// survives all React remounts via module-level singleton pattern.
// Provider is now the outermost layer — nothing above it can remount it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  Dimensions,
  LogBox,
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
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Image } from 'expo-image';

import { initializeLibrary } from '@/store/library';
import {
  MusicPlayerProvider,
  useMusicPlayer,
} from '@/libs/playerSetup';
import {
  GestureContext,
  useGestureContext,
  type GestureContextValue,
} from '@/libs/gestureContext';
import { LyricsProvider, LyricsFetcher } from '@/hooks/useLyricsContext';
import { GlobalUIStateProvider } from '@/contexts/GlobalUIStateContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { AlertProvider } from '@/contexts/AlertContext';
import { UpdateModal } from '@/components/UpdateModal';
// MessageModal: Firebase removed — component now renders null.
// Plain static import is safe; no lazy loading needed without a native module.
import { MessageModal } from '@/components/MessageModal';
import PremiumBanner from '@/components/ads/banner/premium';
import { HomePreloader } from '@/components/HomePreloader';
import { SearchPreloader } from '@/components/SearchPreloader';
import { queryClient } from '@/libs/supabase';
import { initCache } from '@/libs/cache';
import {
  EarningsConsentGate,
  checkAndShowConsent,
} from '@/components/EarningsConsentGate';
import { triggerHaptic } from '@/helpers/haptics';
import PlayerContent from '@/components/player/playerContent';
// ↑ This import MUST remain here (not lazy). playerContent.tsx registers the
//   module-level master player singleton (setMasterPlayer) at evaluation time.
//   MusicPlayerContext's restore IIFE polls for masterPlayerRef for 5 seconds —
//   if playerContent hasn't been evaluated by then, restore fails silently.
//   Keeping this import at the top of _layout ensures the singleton is registered
//   before the restore polling window expires.
import { useImmersiveMode } from '@/hooks/useImmersiveMode';
import FloatingPlayer from '@/components/FloatingPlayer';
import { initLocalDatabase } from '@/db/localDatabase';
import { initAllCaches } from '@/utils/cacheManager';
import { runMaintenance } from '@/db/localDatabaseMaintenance';
import {
  PlayerOverlayProvider,
  usePlayerOverlay,
} from '@/libs/playerOverlay';

// ─────────────────────────────────────────────────────────────────────────────
// ANDROID LOG SUPPRESSION
// ─────────────────────────────────────────────────────────────────────────────

if (Platform.OS === 'android') {
  LogBox.ignoreLogs([
    'setPositionAsync',
    'setBehaviorAsync',
    'setBackgroundColorAsync',
    '`setPositionAsync` is not supported',
    '`setBehaviorAsync` is not supported',
    '`setBackgroundColorAsync` is not supported',
    'Invalid capability',
    'expo-media-control',
    'Require cycle:',
    'Layout children',
    'extraneous',
  ]);
}

if (__DEV__) {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    if (
      message.includes('setPositionAsync') ||
      message.includes('setBehaviorAsync') ||
      message.includes('setBackgroundColorAsync') ||
      message.includes('Require cycle') ||
      message.includes('Invalid capability')
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLASH SCREEN & REANIMATED CONFIG
// ─────────────────────────────────────────────────────────────────────────────

SplashScreen.preventAutoHideAsync().catch(() => {});
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const SPRING_EXPAND = {
  damping: 28,
  stiffness: 260,
  mass: 1,
  overshootClamping: true,
} as const;

const SPRING_COLLAPSE = {
  damping: 28,
  stiffness: 260,
  overshootClamping: true,
} as const;

const SPRING_FLING = {
  damping: 38,
  stiffness: 280,
  overshootClamping: true,
} as const;

const COLLAPSE_THRESHOLD = SCREEN_HEIGHT * 0.18;
const COLLAPSE_VELOCITY = 750;

const ICON_IMAGE = require('@/assets/images/icon.png');

// ─────────────────────────────────────────────────────────────────────────────
// FULL PLAYER OVERLAY (Expanded Player Modal)
// ─────────────────────────────────────────────────────────────────────────────

function FullPlayerOverlay({ onCollapse }: { onCollapse: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { gestureBlockedSV } = useGestureContext();

  const translateY = useSharedValue(SCREEN_HEIGHT);
  const isAnimating = useRef(false);

  useEffect(() => {
    translateY.value = withSpring(0, SPRING_EXPAND);
  }, [translateY]);

  const handleCollapse = useCallback(() => {
    if (isAnimating.current) return;
    isAnimating.current = true;
    triggerHaptic();
    onCollapse();
    setTimeout(() => {
      isAnimating.current = false;
    }, 400);
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
          (finished) => {
            if (finished) runOnJS(handleCollapse)();
          },
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

  const onNavigateToLyrics = useCallback(
    () => router.push('/(modals)/lyrics'),
    [router],
  );
  const onNavigateToRelated = useCallback(
    () => router.push('/(modals)/related'),
    [router],
  );
  const onNavigateToMenu = useCallback(
    () => router.push('/(modals)/menu'),
    [router],
  );
  const onNavigateToQueue = useCallback(
    () => router.push('/(modals)/queue'),
    [router],
  );
  const onNavigateToPlaylist = useCallback(
    () => router.push('/(modals)/addToPlaylist'),
    [router],
  );
  const onNavigateToComments = useCallback(
    () => router.push('/(modals)/comments'),
    [router],
  );

  const onNavigateToArtist = useCallback(
    (params?: { id: string; subtitle: string }) => {
      if (params?.id) {
        router.push({
          pathname: '/search/artist',
          params: { id: params.id, subtitle: params.subtitle },
        });
      }
    },
    [router],
  );

  const onNavigateToLocalFolder = useCallback(
    (folderId: string, trackId: string) => {
      router.push({
        pathname: '/(player)/library',
        params: { folderId, trackId, fromPlayer: 'true' },
      });
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
          onNavigateToLocalFolder={onNavigateToLocalFolder}
        />
      </ReAnimated.View>
    </GestureDetector>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER OVERLAY WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function PlayerOverlayWrapper({ children }: { children: React.ReactNode }) {
  const { playerMode, expandPlayer, collapsePlayer, isPlayerVisible, showPlayer } = usePlayerOverlay();

  // useMusicPlayer throws if rendered outside MusicPlayerProvider.
  // This guard makes PlayerOverlayWrapper safe during error-boundary recovery
  // or any render that precedes the provider tree being fully established.
  let musicPlayer;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    musicPlayer = useMusicPlayer();
  } catch {
    // Provider not yet mounted — render children only, no overlay
    return <>{children}</>;
  }

  const {
    setPlayerOverlayRefs,
    currentTrack,
    isPlaying,
    isBuffering,
    position,
    duration,
    togglePlayPause,
    skipToNext,
    skipToPrevious,
    seekTo,
  } = musicPlayer;

  // Register overlay functions with MusicPlayerContext
  useEffect(() => {
    if (setPlayerOverlayRefs) {
      setPlayerOverlayRefs(expandPlayer, collapsePlayer);
    }
  }, [setPlayerOverlayRefs, expandPlayer, collapsePlayer]);

  // Auto-show mini-player when a track is loaded and player is hidden.
  // Uses a small delay on mount so the module-level restore has time to sync
  // React state before this effect evaluates on the first render.
  const didMountRef = React.useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      // On first mount, wait one tick so the restore sync useEffect in
      // MusicPlayerProvider (also a [] effect) has run and set currentTrack.
      const t = setTimeout(() => {
        if (currentTrack && !isPlayerVisible) showPlayer();
      }, 0);
      return () => clearTimeout(t);
    }
    if (currentTrack && !isPlayerVisible) {
      showPlayer();
    }
  }, [currentTrack, isPlayerVisible, showPlayer]);

  return (
    <>
      {children}
      {/* Only show FloatingPlayer when player is visible (collapsed or expanded, not hidden) */}
      {/* The FloatingPlayer component now handles checking isPlayerVisible internally */}
      <FloatingPlayer />
      {playerMode === 'expanded' && (
        <FullPlayerOverlay onCollapse={collapsePlayer} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME-AWARE NAVIGATION PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

function ThemeAwareNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isDark, colors } = useTheme();

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.background,
          card: colors.tabBarBackground,
          text: colors.text,
          border: colors.border,
          primary: colors.gold,
          notification: colors.gold,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
          card: colors.tabBarBackground,
          text: colors.text,
          border: colors.border,
          primary: colors.gold,
          notification: colors.gold,
        },
      };

  return (
    <NavigationThemeProvider value={navTheme}>
      {children}
    </NavigationThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PULSING LOGO OVERLAY (Splash)
// ─────────────────────────────────────────────────────────────────────────────

function PulsingLogoOverlay({ visible }: { visible: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseRef.current.start();

    return () => pulseRef.current?.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (!visible) {
      pulseRef.current?.stop();
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setHidden(true));
    }
  }, [visible, fadeAnim]);

  if (hidden) return null;

  return (
    <Animated.View
      style={[styles.logoOverlay, { opacity: fadeAnim }]}
      pointerEvents="none"
    >
      <Animated.Image
        source={ICON_IMAGE}
        style={[styles.logoImage, { transform: [{ scale: pulseAnim }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP SHELL (Navigation Stack + UI)
// ─────────────────────────────────────────────────────────────────────────────

function AppShell({
  fontsLoaded,
}: {
  fontsLoaded: boolean;
}) {
  const { colors } = useTheme();

  return (
    <View style={[styles.appShell, { backgroundColor: colors.background }]}>
      {fontsLoaded && (
        <>
          <HomePreloader />
          <SearchPreloader />
        </>
      )}

      <StatusBar
        hidden
        translucent
        backgroundColor="transparent"
      />

      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="(player)"
          options={{
            animation: 'none',
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <Stack.Screen
          name="(modals)"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>

      <LyricsFetcher />
      <UpdateModal />
      {/* MessageModal renders null until Firebase is re-integrated.
          No Suspense wrapper needed — it is no longer lazy loaded. */}
      <MessageModal />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STABLE PROVIDER TREE
// ─────────────────────────────────────────────────────────────────────────────

interface StableProvidersProps {
  gestureContextValue: GestureContextValue;
  fontsLoaded: boolean;
  appReady: boolean;
}

function StableProviders({
  gestureContextValue,
  fontsLoaded,
  appReady,
}: StableProvidersProps) {
  return (
    <ThemeProvider>
      <ThemeAwareNavigationProvider>
        <GestureContext.Provider value={gestureContextValue}>
          <AlertProvider>
            <MusicPlayerProvider>
              <GlobalUIStateProvider>
                <LyricsProvider>
                  <PlayerOverlayProvider>
                    <PlayerOverlayWrapper>
                      <AppShell fontsLoaded={fontsLoaded} />
                      <PulsingLogoOverlay visible={!appReady} />
                    </PlayerOverlayWrapper>
                  </PlayerOverlayProvider>
                </LyricsProvider>
              </GlobalUIStateProvider>
            </MusicPlayerProvider>
          </AlertProvider>
        </GestureContext.Provider>
      </ThemeAwareNavigationProvider>
    </ThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),
    Meriva: require('@/assets/fonts/Meriva.ttf'),
  });

  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const navigationState = useRootNavigationState();
  const router = useRouter();

  const sliderActiveRef = useRef(false);
  const buttonActiveRef = useRef(false);
  const gestureBlockedSV = useSharedValue(false);

  useImmersiveMode({
    hideStatusBar: true,
    hideNavigationBar: true,
    autoHideDelay: 2000,
    showOnBackground: false,
  });

  // Initialize local music database and caches on mount
  useEffect(() => {
    const initLocalMusic = async () => {
      try {
        await initLocalDatabase();
        await initAllCaches();
        await runMaintenance();
        console.log('[RootLayout] Local music system initialized');
      } catch (error) {
        console.error('[RootLayout] Failed to initialize local music:', error);
      }
    };

    void initLocalMusic();
  }, []);

  // Check whether the consent modal should be shown on first launch
  useEffect(() => {
    checkAndShowConsent()
      .then((should) => {
        if (should) setShowConsent(true);
      })
      .catch((err) => {
        console.warn('[RootLayout] checkAndShowConsent failed:', err);
      });
  }, []);

  // Gesture context — stable ref, never changes
  const gestureContextValue = useRef({
    setSliderActive: (v: boolean) => {
      sliderActiveRef.current = v;
      gestureBlockedSV.value =
        sliderActiveRef.current || buttonActiveRef.current;
    },
    setButtonActive: (v: boolean) => {
      buttonActiveRef.current = v;
      gestureBlockedSV.value =
        sliderActiveRef.current || buttonActiveRef.current;
    },
    isGestureBlocked: () =>
      sliderActiveRef.current || buttonActiveRef.current,
    gestureBlockedSV,
  }).current;

  // Track navigation readiness
  useEffect(() => {
    if (navigationState?.key && !navReady) setNavReady(true);
  }, [navigationState?.key, navReady]);

  // Hide splash screen when fonts load
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(console.warn);
    }
  }, [fontsLoaded, fontError]);

  // App is ready when navigation and fonts are ready
  useEffect(() => {
    if (navReady && !appReady) setAppReady(true);
  }, [navReady, appReady]);

  // Initialize library and cache systems
  useEffect(() => {
    initializeLibrary().catch((e) => console.warn('[Library]', e));
    try {
      initCache({ startBackgroundJobs: true });
    } catch (e) {
      console.warn('[Cache]', e);
    }
  }, []);

  // Deep link handling
  useEffect(() => {
    const handle = (url: string | null) => {
      if (url?.startsWith('mavins-player')) console.log('[DeepLink]', url);
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={styles.flex}>
          <StableProviders
            gestureContextValue={gestureContextValue}
            fontsLoaded={fontsLoaded ?? false}
            appReady={appReady}
          />
        </GestureHandlerRootView>

        <EarningsConsentGate
          visible={showConsent}
          onDismiss={() => setShowConsent(false)}
          onOpenSettings={() => {
            triggerHaptic();
            router.push({
              pathname: '/(player)/settings',
              params: { scrollTo: 'privacy' }
            });
          }}
        />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  appShell: {
    flex: 1,
  },

  logoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },

  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 24,
  },

  fullPlayerCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 99,
    borderTopLeftRadius: Platform.OS === 'ios' ? 14 : 10,
    borderTopRightRadius: Platform.OS === 'ios' ? 14 : 10,
  },
});