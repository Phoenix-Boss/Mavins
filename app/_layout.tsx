// app/_layout.tsx

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRootNavigationState, useRouter, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { StyleSheet, View, ActivityIndicator, Linking, Platform } from "react-native";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  Event,
  useActiveTrack,
} from "react-native-track-player";
import { StatusBar } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";

// ── Internal ──────────────────────────────────────────────────────────────────
import { initializeLibrary } from "@/store/library";
import { PlayerProvider, usePlayerOverlay } from "@/components/player/playerProvider";
import { MusicPlayerProvider } from "@/components/MusicPlayerContext";
import { LyricsProvider, LyricsFetcher } from "@/hooks/useLyricsContext";
import { GlobalUIStateProvider } from "@/contexts/GlobalUIStateContext";
import FloatingPlayer from "@/components/FloatingPlayer";
import { UpdateModal } from "@/components/UpdateModal";
import { MessageModal } from "@/components/MessageModal";
import PremiumBanner from "@/components/ads/banner/premium";
import { HomePreloader } from "@/components/HomePreloader";
import { queryClient } from "@/libs/supabase";
import { initCache } from "@/libs/cache";
import HoneygainConsentGate from "@/components/HoneygainConsentGate";
import { initMixerEQ, injectMixerSession } from "@/modules/mavin-eq";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level bootstrap
// ─────────────────────────────────────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

const PREMIUM_BANNER_DELAY_MS = 2200;
const SPLASH_FORCE_HIDE_MS    = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL TrackPlayer Setup Promise — single initialization, never repeated
// ─────────────────────────────────────────────────────────────────────────────
let trackPlayerSetupPromise: Promise<boolean> | null = null;
let isTrackPlayerReady = false;

export async function setupTrackPlayerGlobal(): Promise<boolean> {
  if (isTrackPlayerReady) return true;
  if (trackPlayerSetupPromise) return trackPlayerSetupPromise;

  trackPlayerSetupPromise = (async () => {
    try {
      let mixerSessionId = 0;

      // ┌──────────────────────────────────────────────────────────────────────┐
      // │ Step 1 — Init EQ mixer (Android only)                               │
      // │                                                                      │
      // │ Creates the permanent AudioTrack and attaches DynamicsProcessing     │
      // │ to its session BEFORE setupPlayer(). This gives us a valid           │
      // │ sessionId to pass via androidAudioSessionId (works on fresh          │
      // │ installs where RNTP hasn't self-initialized yet).                   │
      // └──────────────────────────────────────────────────────────────────────┘
      if (Platform.OS === "android") {
        mixerSessionId = await initMixerEQ() ?? 0;
        if (mixerSessionId > 0) {
          console.log("✅ [mavin-eq] Mixer ready, sessionId =", mixerSessionId);
        } else {
          console.warn("⚠️ [mavin-eq] Mixer init failed — EQ disabled");
        }
      }

      // ┌──────────────────────────────────────────────────────────────────────┐
      // │ Step 2 — Setup RNTP player                                          │
      // │                                                                      │
      // │ Pass androidAudioSessionId so ExoPlayer joins the mixer session on  │
      // │ fresh installs. On native-boot restarts RNTP ignores this (already  │
      // │ initialized) — Step 3 fixes that case.                              │
      // └──────────────────────────────────────────────────────────────────────┘
      const setupOpts: any = { autoHandleInterruptions: true };
      if (Platform.OS === "android" && mixerSessionId > 0) {
        setupOpts.androidAudioSessionId = mixerSessionId;
      }

      try {
        await TrackPlayer.setupPlayer(setupOpts);
        console.log("✅ RNTP: Player setup complete");
      } catch (setupError: any) {
        const alreadyInit =
          setupError?.message?.includes("already") ||
          setupError?.message?.includes("initialized") ||
          setupError?.code === "player_already_initialized";
        if (alreadyInit) {
          // RNTP self-initialized before JS ran (native boot). This is expected.
          // injectMixerSession() in Step 3 will correct the session binding.
          console.log("ℹ️ RNTP: Player already initialized (native boot) — Step 3 will inject session");
        } else {
          throw setupError;
        }
      }

      // ┌──────────────────────────────────────────────────────────────────────┐
      // │ Step 3 — Inject mixer session into ExoPlayer (Android only)         │
      // │                                                                      │
      // │ This is the permanent fix for the native-boot race.                 │
      // │                                                                      │
      // │ injectMixerSession() walks the React Native NativeModule registry,  │
      // │ finds RNTP's MusicModule, gets its ExoPlayer instance, and calls    │
      // │ exoPlayer.setAudioSessionId(mixerSessionId) directly.               │
      // │                                                                      │
      // │ Result: ExoPlayer's audio output is routed into the mixer's         │
      // │ AudioFlinger session, where DynamicsProcessing is already attached. │
      // │                                                                      │
      // │ This works on EVERY launch — fresh install AND native-boot restart. │
      // └──────────────────────────────────────────────────────────────────────┘
      if (Platform.OS === "android" && mixerSessionId > 0) {
        const injected = await injectMixerSession();
        if (injected) {
          console.log("✅ [mavin-eq] ExoPlayer joined mixer session:", injected);
        } else {
          console.warn("⚠️ [mavin-eq] injectMixerSession failed — EQ may not process audio");
        }
      }

      // ┌──────────────────────────────────────────────────────────────────────┐
      // │ Step 4 — RNTP options                                               │
      // └──────────────────────────────────────────────────────────────────────┘
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Stop,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
          alwaysPauseOnInterruption: true,
        },
        progressUpdateEventInterval: 1,
      });

      // ┌──────────────────────────────────────────────────────────────────────┐
      // │ Step 5 — Global remote-control listeners (registered once)          │
      // └──────────────────────────────────────────────────────────────────────┘
      TrackPlayer.addEventListener(Event.RemotePlay,     () => TrackPlayer.play().catch(console.error));
      TrackPlayer.addEventListener(Event.RemotePause,    () => TrackPlayer.pause().catch(console.error));
      TrackPlayer.addEventListener(Event.RemoteNext,     () => TrackPlayer.skipToNext().catch(console.error));
      TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious().catch(console.error));
      TrackPlayer.addEventListener(Event.RemoteSeek,     (e) => TrackPlayer.seekTo(e.position).catch(console.error));
      TrackPlayer.addEventListener(Event.RemoteStop,     () => TrackPlayer.stop().catch(console.error));
      TrackPlayer.addEventListener(Event.RemoteDuck,     (e) => {
        if (e.permanent) TrackPlayer.stop().catch(console.error);
        else if (e.paused) TrackPlayer.pause().catch(console.error);
      });

      isTrackPlayerReady = true;
      return true;
    } catch (error) {
      console.error("❌ RNTP setup failed:", error);
      trackPlayerSetupPromise = null;
      return false;
    }
  })();

  return trackPlayerSetupPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// NotificationPlayerExpander
// ─────────────────────────────────────────────────────────────────────────────
function NotificationPlayerExpander({
  pendingRef,
}: {
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const { expandPlayer } = usePlayerOverlay();
  const router = useRouter();
  const activeTrack = useActiveTrack();

  useEffect(() => {
    if (!pendingRef.current) return;
    if (!activeTrack) return;

    const t = setTimeout(() => {
      pendingRef.current = false;
      try {
        expandPlayer();
      } catch {
        router.push("/(player)");
      }
    }, 500);

    return () => clearTimeout(t);
  }, [activeTrack, expandPlayer, pendingRef, router]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LoadingScreen
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator size="large" color="#D4AF37" />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppShell
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

  const isHomeScreen     = pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  const isLibraryScreen  = pathname === "/(tabs)/library";
  const isSettingsScreen = pathname === "/(tabs)/settings";
  const shouldShowFloatingPlayer =
    (isHomeScreen || isLibraryScreen || isSettingsScreen) && playerReady;

  return (
    <LyricsProvider>
      <GlobalUIStateProvider>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#000" },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="(player)"
              options={{
                presentation: "modal",
                animation: "slide_from_bottom",
                contentStyle: { backgroundColor: "#000" },
              }}
            />
            <Stack.Screen
              name="(modals)"
              options={{
                presentation: "transparentModal",
                animation: "slide_from_bottom",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen name="+not-found" />
          </Stack>

          {!fontsLoaded && <LoadingScreen />}
        </View>

        <LyricsFetcher />
        <NotificationPlayerExpander pendingRef={pendingExpandRef} />

        {navReady && shouldShowFloatingPlayer && (
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
      </GlobalUIStateProvider>
    </LyricsProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RootLayout
// ─────────────────────────────────────────────────────────────────────────────
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Meriva:    require("../assets/fonts/Meriva.ttf"),
  });

  const [playerReady, setPlayerReady] = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);

  const navigationState = useRootNavigationState();
  const navReady        = !!navigationState?.key;
  const appReady        = fontsLoaded && navReady;
  const pendingExpandRef = useRef(false);

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Bootstrap: setupTrackPlayer + initLibrary                           │
  // └──────────────────────────────────────────────────────────────────────┘
  useEffect(() => {
    async function prepare() {
      try {
        const setupSuccess = await setupTrackPlayerGlobal();
        setPlayerReady(setupSuccess);
        try {
          await initializeLibrary();
        } catch (error) {
          console.warn("[Library] initialization failed:", error);
        }
      } catch (e) {
        console.warn("[TrackPlayer] setup error:", e);
        setPlayerReady(false);
      }
    }
    prepare();
  }, []);

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Hide splash screen                                                   │
  // └──────────────────────────────────────────────────────────────────────┘
  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync();
      return;
    }
    const fallback = setTimeout(() => SplashScreen.hideAsync(), SPLASH_FORCE_HIDE_MS);
    return () => clearTimeout(fallback);
  }, [appReady]);

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Show premium banner after delay                                      │
  // └──────────────────────────────────────────────────────────────────────┘
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [appReady]);

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Deep link / notification tap                                         │
  // └──────────────────────────────────────────────────────────────────────┘
  const handleOpenFromNotification = useCallback(() => {
    pendingExpandRef.current = true;
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url === null || url?.startsWith("mavins-player")) {
        handleOpenFromNotification();
      }
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url?.startsWith("mavins-player") || url === "") {
        handleOpenFromNotification();
      }
    });
    return () => sub.remove();
  }, [handleOpenFromNotification]);

  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ThemeProvider value={DarkTheme}>
              <StatusBar hidden />
              <MusicPlayerProvider>
                <PlayerProvider playerReady={playerReady}>
                  <HomePreloader />
                  <AppShell
                    fontsLoaded={fontsLoaded}
                    navReady={navReady}
                    premiumBannerVisible={premiumBannerVisible}
                    setPremiumBannerVisible={setPremiumBannerVisible}
                    pendingExpandRef={pendingExpandRef}
                    playerReady={playerReady}
                  />
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
  loadingScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  floatingPlayerWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
});