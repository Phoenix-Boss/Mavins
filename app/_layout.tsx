// app/_layout.tsx - Complete expo-av version
// 
// Root layout with expo-av initialization instead of react-native-track-player

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
  Linking,
  StatusBar,
  StyleSheet,
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
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';

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

SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

const PREMIUM_BANNER_DELAY_MS = 2200;

// ─────────────────────────────────────────────────────────────────────────────
// Configure expo-notifications for lock screen controls
// ─────────────────────────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  false,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
    shouldShowBanner: false, // required by NotificationBehavior in newer expo-notifications
    shouldShowList:   false, // required by NotificationBehavior in newer expo-notifications
  }),
});

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
// PulsingLogoOverlay
// Shows the app icon with a gentle pulse animation.
// Fades out smoothly once the app is ready. No text.
// ─────────────────────────────────────────────────────────────────────────────

function PulsingLogoOverlay({ visible }: { visible: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const pulseRef  = useRef<Animated.CompositeAnimation | null>(null);
  const [hidden, setHidden] = useState(false);

  // Start continuous pulse on mount
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
      ])
    );
    pulseRef.current.start();
    return () => pulseRef.current?.stop();
  }, [pulseAnim]);

  // Fade out when app is ready
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
        source={require('../assets/images/icon.png')}
        style={[styles.logoImage, { transform: [{ scale: pulseAnim }] }]}
        resizeMode="contain"
      />
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
          options={{ animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
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
          <FloatingPlayer />
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
  const [navReady, setNavReady]                         = useState(false);

  const navigationState   = useRootNavigationState();
  const setupAttemptedRef = useRef(false);
  const appStateRef       = useRef<AppStateStatus>(AppState.currentState);

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
      setNavReady(true);
    }
  }, [navigationState?.key, navReady]);

  // ── Hide splash screen as soon as fonts are done ──────────────────────────
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(console.warn);
    }
  }, [fontsLoaded, fontError]);

  // ── Mark app ready once player + nav are both up ──────────────────────────
  useEffect(() => {
    if (playerReady && navReady && !appReady) {
      setAppReady(true);
    }
  }, [playerReady, navReady, appReady]);

  // ── Player initialization with expo-av ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initPlayer() {
      if (setupAttemptedRef.current) return;
      setupAttemptedRef.current = true;

      try {
        // Configure audio mode for playback
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        console.log('[RootLayout] Audio mode configured');
        
        if (!cancelled) setPlayerReady(true);

        // Initialize library and cache
        initializeLibrary().catch(e => console.warn('[Library]', e));

        try {
          initCache({ startBackgroundJobs: true });
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
        next === 'active'
      ) {
        // Re-check audio mode when app returns to foreground
        Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        }).catch(console.warn);
      }
      appStateRef.current = next;
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // ── Premium banner ────────────────────────────────────────────────────────
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

  // ── Register for remote notifications (lock screen controls) ──────────────
  useEffect(() => {
    async function registerForNotifications() {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.log('[RootLayout] Notification permissions not granted');
        return;
      }
      
      // Set up notification category for media controls
      await Notifications.setNotificationCategoryAsync('MEDIA_PLAYBACK', [
        {
          identifier: 'PREVIOUS',
          buttonTitle: '⏮',
          options: { isDestructive: false },
        },
        {
          identifier: 'PLAY',
          buttonTitle: '▶',
          options: { isDestructive: false },
        },
        {
          identifier: 'PAUSE',
          buttonTitle: '⏸',
          options: { isDestructive: false },
        },
        {
          identifier: 'NEXT',
          buttonTitle: '⏭',
          options: { isDestructive: false },
        },
        {
          identifier: 'STOP',
          buttonTitle: '⏹',
          options: { isDestructive: true },
        },
      ]);
      
      console.log('[RootLayout] Notifications configured');
    }
    
    registerForNotifications();
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
                <MusicPlayerProvider playerReady={playerReady}>
                  <PlayerProvider playerReady={playerReady}>
                    <GlobalUIStateProvider>
                      <LyricsProvider>

                        {/* App renders immediately — no gate */}
                        <AppShell
                          premiumBannerVisible={premiumBannerVisible}
                          setPremiumBannerVisible={setPremiumBannerVisible}
                          playerReady={playerReady}
                          fontsLoaded={fontsLoaded}
                        />

                        {/* Pulsing logo overlays until ready, then fades out */}
                        <PulsingLogoOverlay visible={!appReady} />

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
    backgroundColor: 'transparent',
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

  floatingPlayerWrapper: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 1000,
  },
});