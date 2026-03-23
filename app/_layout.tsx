// app/_layout.tsx

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { StyleSheet } from "react-native";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";
import { StatusBar, View, ActivityIndicator, Linking } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";

// ── Internal ──────────────────────────────────────────────────────────────────
import { initializeLibrary } from "@/store/library";
import {
  PlayerProvider,
  usePlayerOverlay,
} from "@/components/player/playerProvider";
import { MusicPlayerProvider } from "@/components/MusicPlayerContext";
import { LyricsProvider, LyricsFetcher } from "@/hooks/useLyricsContext";
import { GlobalUIStateProvider } from "@/contexts/GlobalUIStateContext";
import FloatingPlayer from "@/components/FloatingPlayer";
import { UpdateModal } from "@/components/UpdateModal";
import { MessageModal } from "@/components/MessageModal";
import PremiumBanner from "@/components/ads/banner/premium";

// ── Mavin libs ────────────────────────────────────────────────────────────────
import { queryClient } from "@/libs/supabase";
import { initCache } from "@/libs/cache";

// ── Honeygain ─────────────────────────────────────────────────────────────────
import HoneygainConsentGate from "@/components/HoneygainConsentGate";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level bootstrap — runs once before any component mounts.
// ─────────────────────────────────────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

const PREMIUM_BANNER_DELAY_MS = 2200;
const SPLASH_FORCE_HIDE_MS    = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// NotificationPlayerExpander
// Handles lock-screen / notification tap: waits for an active track then
// calls expandPlayer() (which now does router.push("/(player)")).
// ─────────────────────────────────────────────────────────────────────────────
function NotificationPlayerExpander({
  pendingRef,
}: {
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const { expandPlayer } = usePlayerOverlay();

  let activeTrack: any;
  try {
    const rntp = require("react-native-track-player");
    activeTrack = rntp.useActiveTrack?.();
  } catch {
    return null;
  }

  useEffect(() => {
    if (!pendingRef.current) return;
    if (!activeTrack) return;
    pendingRef.current = false;
    const t = setTimeout(() => expandPlayer(), 300);
    return () => clearTimeout(t);
  }, [activeTrack, expandPlayer, pendingRef]);

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
  const segments       = useSegments();
  const isPlayerScreen = segments.includes("(player)");

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

            {/*
             * (player) — solid black background, slides up from bottom.
             *
             * KEY FIX: backgroundColor is "#000" (NOT transparent).
             * The old "transparentModal" + transparent contentStyle meant the
             * route rendered over a see-through layer — nothing behind it was
             * visible through PlayerProvider's overlay → black screen.
             *
             * PlayerContent itself has a full-screen LinearGradient so the
             * solid black base colour is immediately covered.
             */}
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

        {navReady && !isPlayerScreen && playerReady && (
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

  const [playerReady,          setPlayerReady         ] = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);

  const navigationState = useRootNavigationState();
  const navReady        = !!navigationState?.key;
  const appReady        = fontsLoaded && navReady;

  const pendingExpandRef = useRef(false);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    async function prepare() {
      try {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      } catch (e: any) {
        const msg = e?.message ?? "";
        if (
          !msg.toLowerCase().includes("already") &&
          !msg.toLowerCase().includes("initialized")
        ) {
          console.warn("[TrackPlayer] setupPlayer error:", e);
        }
      }
      setPlayerReady(true);

      try {
        await initializeLibrary();
      } catch (error) {
        console.warn("[Library] initialization failed:", error);
      }
    }

    prepare();
  }, []);

  // ── Hide splash ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (appReady) { SplashScreen.hideAsync(); return; }
    const fallback = setTimeout(() => SplashScreen.hideAsync(), SPLASH_FORCE_HIDE_MS);
    return () => clearTimeout(fallback);
  }, [appReady]);

  // ── Show premium banner ───────────────────────────────────────────────────
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [appReady]);

  // ── Deep link / notification tap ──────────────────────────────────────────
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