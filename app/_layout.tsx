// app/_layout.tsx
//
// ROOT LAYOUT — Poweramp-Style Transparent Initialization
//
// CRITICAL FIX:
//   - react-native-track-player is NEVER imported at top level
//   - playerReady state is passed down to MusicPlayerProvider
//   - All RNTP initialization is deferred to useEffect with dynamic import
//   - PlaybackService registration is deferred

import React, {
  createContext,
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
  AppRegistry,
  Linking,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
  useSharedValue,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { initializeLibrary } from '@/store/library';
import { PlayerProvider } from '@/components/player/playerProvider';
import { MusicPlayerProvider } from '@/components/MusicPlayerContext';
import { LyricsProvider, LyricsFetcher } from '@/hooks/useLyricsContext';
import { GlobalUIStateProvider } from '@/contexts/GlobalUIStateContext';
import FloatingPlayer from '@/components/FloatingPlayer';
import { UpdateModal } from '@/components/UpdateModal';
import { MessageModal } from '@/components/MessageModal';
import PremiumBanner from '@/components/ads/banner/premium';
import { HomePreloader } from '@/components/HomePreloader';
import { queryClient } from '@/libs/supabase';
import { initCache } from '@/libs/cache';
import HoneygainConsentGate from '@/components/HoneygainConsentGate';

// NO react-native-track-player import here

SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

const PREMIUM_BANNER_DELAY_MS = 2200;

// ─────────────────────────────────────────────────────────────────────────────
// Gesture Context
// ─────────────────────────────────────────────────────────────────────────────

export interface GestureContextValue {
  setSliderActive: (active: boolean) => void;
  setButtonActive: (active: boolean) => void;
  isGestureBlocked: () => boolean;
  gestureBlockedSV: SharedValue<boolean>;
}

const _defaultSV = { value: false } as unknown as SharedValue<boolean>;

const GestureContext = createContext<GestureContextValue>({
  setSliderActive: () => {},
  setButtonActive: () => {},
  isGestureBlocked: () => false,
  gestureBlockedSV: _defaultSV,
});

export function useGestureContext(): GestureContextValue {
  return useContext(GestureContext);
}

export { GestureContext };

// ─────────────────────────────────────────────────────────────────────────────
// FastInitScreen
// ─────────────────────────────────────────────────────────────────────────────

type InitStatus = 'initializing' | 'mavins' | 'engine' | 'ready';

function FastInitScreen({
  status,
  fadeAnim,
}: {
  status: InitStatus;
  fadeAnim: Animated.Value;
}) {
  const getMessage = () => {
    switch (status) {
      case 'initializing': return 'Initializing';
      case 'mavins':       return 'Mavins Player';
      case 'engine':       return 'Starting Engine';
      case 'ready':        return 'Ready';
      default:             return 'Initializing';
    }
  };

  return (
    <Animated.View
      style={[styles.initOverlay, { opacity: fadeAnim }]}
      pointerEvents="none"
    >
      <Text style={styles.initText}>{getMessage()}</Text>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldShowFloatingPlayer
// ─────────────────────────────────────────────────────────────────────────────

function shouldShowFloatingPlayer(pathname: string): boolean {
  const allowedRoutes = [
    '/(tabs)',
    '/(tabs)/index',
    '/(tabs)/library',
    '/(tabs)/settings',
  ];
  const isAllowed = allowedRoutes.some(
    r => pathname === r || pathname.startsWith(`${r}/`) || pathname.startsWith(`${r}?`)
  );
  const blockedPatterns = [
    '/(player)', '/player',
    '/(modals)', '/modals',
    '/search', '/artist', '/playlist', '/album', '/song/', '/track/',
  ];
  const isBlocked = blockedPatterns.some(p => pathname.includes(p));
  return isAllowed && !isBlocked;
}

// ─────────────────────────────────────────────────────────────────────────────
// AppShell
// ─────────────────────────────────────────────────────────────────────────────

function AppShell({
  premiumBannerVisible,
  setPremiumBannerVisible,
  playerReady,
  fontsLoaded,
}: {
  premiumBannerVisible: boolean;
  setPremiumBannerVisible: (v: boolean) => void;
  playerReady: boolean;
  fontsLoaded: boolean;
}) {
  const pathname = usePathname();
  const showFloatingPlayer = playerReady && shouldShowFloatingPlayer(pathname);

  return (
    <View style={styles.appShell}>
      {fontsLoaded && <HomePreloader />}

      <Stack
        initialRouteName="(tabs)"
        screenOptions={{ headerShown: false, animation: 'none' }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{ animation: 'none', contentStyle: { backgroundColor: '#000' } }}
        />
        <Stack.Screen
          name="(player)"
          options={{
            presentation: 'transparentModal',
            animation: 'none',
            contentStyle: { backgroundColor: 'transparent' },
            gestureEnabled: false,
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

      {showFloatingPlayer && (
        <View style={styles.floatingPlayerWrapper}>
          <FloatingPlayer playerReady={playerReady} />
        </View>
      )}

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
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Meriva: require('../assets/fonts/Meriva.ttf'),
  });

  const [playerReady, setPlayerReady]                   = useState(false);
  const [appReady, setAppReady]                         = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);
  const [initStatus, setInitStatus]                     = useState<InitStatus>('initializing');
  const [fontsCompleted, setFontsCompleted]             = useState(false);
  const [navReady, setNavReady]                         = useState(false);

  const navigationState   = useRootNavigationState();
  const setupAttemptedRef = useRef(false);
  const appStateRef       = useRef<AppStateStatus>(AppState.currentState);
  const initFadeAnim      = useRef(new Animated.Value(1)).current;

  const sliderActiveRef  = useRef(false);
  const buttonActiveRef  = useRef(false);
  const gestureBlockedSV = useSharedValue(false);

  const gestureContextValue = useRef<GestureContextValue>({
    setSliderActive: (v) => {
      sliderActiveRef.current = v;
      gestureBlockedSV.value  = sliderActiveRef.current || buttonActiveRef.current;
    },
    setButtonActive: (v) => {
      buttonActiveRef.current = v;
      gestureBlockedSV.value  = sliderActiveRef.current || buttonActiveRef.current;
    },
    isGestureBlocked: () => sliderActiveRef.current || buttonActiveRef.current,
    gestureBlockedSV,
  }).current;

  // ── Navigation readiness ──────────────────────────────────────────────────
  useEffect(() => {
    if (navigationState?.key && !navReady) {
      console.log('[RootLayout] Navigation ready');
      setNavReady(true);
    }
  }, [navigationState?.key, navReady]);

  // ── Font loading → status update ──────────────────────────────────────────
  useEffect(() => {
    if (fontsLoaded && !fontsCompleted) {
      console.log('[RootLayout] Fonts loaded');
      setFontsCompleted(true);
      setInitStatus(prev => prev === 'initializing' ? 'mavins' : prev);
      SplashScreen.hideAsync().catch(console.warn);
    }
    if (fontError) {
      console.error('[RootLayout] Font error:', fontError);
      SplashScreen.hideAsync().catch(console.warn);
    }
  }, [fontsLoaded, fontsCompleted, fontError]);

  // ── Player readiness → status update ─────────────────────────────────────
  useEffect(() => {
    if (playerReady) {
      console.log('[RootLayout] Player ready');
      setInitStatus(prev =>
        prev === 'initializing' || prev === 'mavins' ? 'engine' : prev
      );
    }
  }, [playerReady]);

  // ── Both ready → fade out init overlay ───────────────────────────────────
  useEffect(() => {
    if (playerReady && navReady && !appReady) {
      console.log('[RootLayout] Fully ready — transitioning');
      setInitStatus('ready');
      Animated.timing(initFadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => setAppReady(true));
    }
  }, [playerReady, navReady, appReady, initFadeAnim]);

  // ── DEFERRED Player initialization (CRITICAL FIX) ─────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initPlayer() {
      if (setupAttemptedRef.current) return;
      setupAttemptedRef.current = true;

      console.log('[RootLayout] Init RNTP');
      
      try {
        // DEFERRED IMPORT: Only load RNTP after React Native runtime is ready
        const { setupPlayerGlobal } = await import('@/libs/playerSetup');
        const ready = await setupPlayerGlobal();
        if (!cancelled) setPlayerReady(ready);

        // Fire-and-forget — don't block player readiness on these
        initializeLibrary().catch(e => console.warn('[Library]', e));
        try {
          const cr = initCache({ startBackgroundJobs: true });
          cr?.catch?.((e: any) => console.warn('[Cache]', e));
        } catch (e) {
          console.warn('[Cache]', e);
        }
      } catch (e) {
        console.error('[RootLayout] Player init error:', e);
        if (!cancelled) setPlayerReady(false);
      }
    }

    initPlayer();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === 'active' &&
        !playerReady
      ) {
        import('@/libs/playerSetup').then(({ isPlayerReady }) => {
          if (isPlayerReady() && !playerReady) {
            setPlayerReady(true);
          }
        });
      }
      appStateRef.current = next;
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [playerReady]);

  // ── DEFERRED PlaybackService registration (CRITICAL FIX) ──────────────────
  useEffect(() => {
    let registered = false;
    
    async function registerService() {
      if (registered) return;
      registered = true;
      
      const _g = global as any;
      if (!_g.__rntp_service_registered) {
        try {
          const { PlaybackService } = await import('@/libs/service');
          AppRegistry.registerHeadlessTask('TrackPlayer', () => PlaybackService);
          _g.__rntp_service_registered = true;
          console.log('[RootLayout] PlaybackService registered');
        } catch (e) {
          console.error('[RootLayout] Service registration failed:', e);
        }
      }
    }
    
    const timer = setTimeout(registerService, 500);
    return () => clearTimeout(timer);
  }, []);

  // ── Premium banner (fires after app is ready) ─────────────────────────────
  useEffect(() => {
    if (!appReady) return;
    const t = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [appReady]);

  // ── Deep link handling ────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (url: string | null) => {
      if (url?.startsWith('mavins-player')) {
        console.log('[DeepLink]', url);
      }
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <GestureHandlerRootView style={styles.flex}>
            <ThemeProvider value={DarkTheme}>
              <StatusBar hidden />
              <GestureContext.Provider value={gestureContextValue}>
                {/* CRITICAL: Pass playerReady down to MusicPlayerProvider */}
                <MusicPlayerProvider playerReady={playerReady}>
                  <PlayerProvider playerReady={playerReady}>
                    <GlobalUIStateProvider>
                      <LyricsProvider>

                        {!appReady ? (
                          <View style={styles.transparentRoot}>
                            <FastInitScreen
                              status={initStatus}
                              fadeAnim={initFadeAnim}
                            />
                          </View>
                        ) : (
                          <AppShell
                            premiumBannerVisible={premiumBannerVisible}
                            setPremiumBannerVisible={setPremiumBannerVisible}
                            playerReady={playerReady}
                            fontsLoaded={fontsLoaded}
                          />
                        )}

                      </LyricsProvider>
                    </GlobalUIStateProvider>
                  </PlayerProvider>
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
    backgroundColor: '#000',
  },

  transparentRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  initOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },

  initText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    fontFamily: 'Meriva',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  floatingPlayerWrapper: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 1000,
  },
});