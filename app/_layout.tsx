// app/_layout.tsx - WITH PROPER PROVIDER ORDERING

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import {
  Stack,
  useRootNavigationState,
  useRouter,
  usePathname,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { StyleSheet, Platform, View, ActivityIndicator, Text } from 'react-native';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { StatusBar, Linking } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';

// Internal
import { initializeLibrary } from '@/store/library';
import { PlayerProvider, usePlayerOverlay } from '@/components/player/playerProvider';
import { MusicPlayerProvider, useMusicPlayer } from '@/components/MusicPlayerContext';
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

import {
  setupAndVerifyPlayer,
  releasePlayerGlobal,
} from '@/libs/playerSetup';

import { MavinEvent, addEventListener } from '@/modules/mavin-eq';

export { setupPlayerGlobal } from '@/libs/playerSetup';

SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
// NOTE: initCache is now called inside the initialization useEffect (see RootLayout)
// to prevent module-scope execution on every hot reload from causing provider remounts.

const PREMIUM_BANNER_DELAY_MS = 2200;

// ─────────────────────────────────────────────────────────────────────────────
// PlayerReadyBridge - Syncs player ready state to MusicPlayerContext
// ─────────────────────────────────────────────────────────────────────────────

function PlayerReadyBridge({ playerReady }: { playerReady: boolean }) {
  const { setPlayerReady } = useMusicPlayer();
  // Only propagate the value when it is `true`, or when it genuinely changes
  // from true → false (e.g. player destroyed). This prevents a remounting
  // MusicPlayerProvider from reverting playerReady back to false while the
  // RootLayout already knows the player is up.
  const lastSyncedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastSyncedRef.current === playerReady) return;
    // Never push `false` if we already pushed `true` this session.
    // The only legitimate false is before first-ready, or after explicit destroy.
    if (!playerReady && lastSyncedRef.current === true) return;
    lastSyncedRef.current = playerReady;
    setPlayerReady(playerReady);
  }, [playerReady, setPlayerReady]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Loading Screen
// ─────────────────────────────────────────────────────────────────────────────

function PlayerLoadingScreen() {
  return (
    <View style={styles.playerLoadingContainer}>
      <ActivityIndicator size="large" color="#D4AF37" />
      <Text style={styles.playerLoadingText}>Starting Audio Engine...</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Player Expander
// ─────────────────────────────────────────────────────────────────────────────

function NotificationPlayerExpander({
  pendingRef,
}: {
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const { expandPlayer } = usePlayerOverlay();
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const sub = addEventListener(MavinEvent.PlaybackTrackChanged, () => {
      if (!pendingRef.current) return;
      console.log('[NotificationPlayerExpander] Track changed — expanding player.');
      const t = setTimeout(() => {
        pendingRef.current = false;
        try {
          expandPlayer();
        } catch {
          router.push('/(player)');
        }
      }, 500);
      return () => clearTimeout(t);
    });

    return () => sub.remove();
  }, [expandPlayer, pendingRef, router]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating Player Visibility Helper
// ─────────────────────────────────────────────────────────────────────────────

function shouldShowFloatingPlayer(pathname: string): boolean {
  const allowedRoutes = [
    '/(tabs)',
    '/(tabs)/index',
    '/(tabs)/library',
    '/(tabs)/settings',
  ];
  
  const isAllowed = allowedRoutes.some(route => 
    pathname === route || 
    pathname.startsWith(`${route}/`) ||
    pathname.startsWith(`${route}?`)
  );
  
  const blockedPatterns = [
    '/(player)',
    '/player',
    '/(modals)',
    '/modals',
    '/search',
    '/artist',
    '/playlist',
    '/album',
    '/song/',
    '/track/',
  ];
  
  const isBlocked = blockedPatterns.some(pattern => 
    pathname.includes(pattern)
  );
  
  return isAllowed && !isBlocked;
}

// ─────────────────────────────────────────────────────────────────────────────
// AppShell - Main App Content
// ─────────────────────────────────────────────────────────────────────────────

function AppShell({
  fontsLoaded,
  navReady,
  premiumBannerVisible,
  setPremiumBannerVisible,
  pendingExpandRef,
  playerReady,
}: {
  fontsLoaded: boolean;
  navReady: boolean;
  premiumBannerVisible: boolean;
  setPremiumBannerVisible: (v: boolean) => void;
  pendingExpandRef: React.MutableRefObject<boolean>;
  playerReady: boolean;
}) {
  const pathname = usePathname();
  const showFloatingPlayer = playerReady && navReady && shouldShowFloatingPlayer(pathname);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="(player)"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: '#000' },
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

      {!fontsLoaded && <PlayerLoadingScreen />}

      <LyricsFetcher />
      <NotificationPlayerExpander pendingRef={pendingExpandRef} />

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
// RootLayout - Main Export
// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Meriva: require('../assets/fonts/Meriva.ttf'),
  });

  const [playerReady, setPlayerReady] = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const navigationState = useRootNavigationState();
  const navReady = !!navigationState?.key;
  const pendingExpandRef = useRef(false);
  const setupAttemptedRef = useRef(false);

  // Initialize player ONCE at startup with verification
  useEffect(() => {
    let cancelled = false;

    async function initializePlayer() {
      if (setupAttemptedRef.current) return;
      setupAttemptedRef.current = true;

      console.log('[RootLayout] 🎵 Initializing MavinPlayer...');
      
      try {
        const ready = await setupAndVerifyPlayer();
        
        if (!cancelled) {
          setPlayerReady(ready);
          setIsInitializing(false);
          console.log('[RootLayout] ✅ Player ready:', ready);
        }

        initializeLibrary().catch(e => console.warn('[Library] Init failed:', e));
        initCache({ startBackgroundJobs: true });
        
      } catch (e) {
        console.error('[RootLayout] Player setup error:', e);
        if (!cancelled) {
          setPlayerReady(false);
          setIsInitializing(false);
        }
      }
    }

    initializePlayer();

    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup only on actual app termination
  useEffect(() => {
    return () => {
      if (!__DEV__) {
        releasePlayerGlobal().catch(e => console.warn('[MavinPlayer] Release error:', e));
      }
    };
  }, []);

  // Hide splash screen when fonts loaded and navigation ready
  useEffect(() => {
    if (fontsLoaded && navReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, navReady]);

  // Show premium banner after player is ready
  useEffect(() => {
    if (!playerReady) return;
    const t = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [playerReady]);

  // Handle deep links from notifications
  const handleOpenFromNotification = useCallback(() => {
    pendingExpandRef.current = true;
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then(url => {
      if (url === null || url?.startsWith('mavins-player'))
        handleOpenFromNotification();
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url?.startsWith('mavins-player') || url === '')
        handleOpenFromNotification();
    });
    return () => sub.remove();
  }, [handleOpenFromNotification]);

  // Show loading screen ONLY while fonts are loading
  if (!fontsLoaded) {
    return <PlayerLoadingScreen />;
  }

  // If fonts errored, still render the app
  if (fontError) {
    console.error('[RootLayout] Font loading error:', fontError);
  }

  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ThemeProvider value={DarkTheme}>
              <StatusBar hidden />
              <MusicPlayerProvider>
                <PlayerReadyBridge playerReady={playerReady} />
                <PlayerProvider playerReady={playerReady}>
                  {/* 🔥 FIX: GlobalUIStateProvider wraps everything that needs it */}
                  <GlobalUIStateProvider>
                    <LyricsProvider>
                      <HomePreloader />
                      <AppShell
                        fontsLoaded={fontsLoaded}
                        navReady={navReady}
                        premiumBannerVisible={premiumBannerVisible}
                        setPremiumBannerVisible={setPremiumBannerVisible}
                        pendingExpandRef={pendingExpandRef}
                        playerReady={playerReady}
                      />
                    </LyricsProvider>
                  </GlobalUIStateProvider>
                </PlayerProvider>
              </MusicPlayerProvider>
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
  playerLoadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerLoadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  floatingPlayerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
});