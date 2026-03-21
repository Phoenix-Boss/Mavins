import React, { useEffect, useState, useCallback } from "react";
// app/_layout.tsx

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";
import { StatusBar, View, ActivityIndicator } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";

// ── Internal ──────────────────────────────────────────────────────────────────
import { Linking } from "react-native";
import { initializeLibrary } from "@/store/library";
import { usePlayerOverlay } from "@/components/player/playerProvider";
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
//
// NOTE: TrackPlayer.registerPlaybackService() is intentionally absent here.
// _layout.tsx re-executes on every Fast Refresh, which would call
// registerPlaybackService multiple times and log:
//   "registerHeadlessTask called multiple times for key TrackPlayer"
// It belongs in index.js (the JS bundle entry point) which runs only once
// per native process. See index.js for the registration call.
// ─────────────────────────────────────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

// How long after app is ready before the banner appears (ms).
const PREMIUM_BANNER_DELAY_MS = 2200;

// ─────────────────────────────────────────────────────────────────────────────
// NotificationPlayerExpander
//
// Sits inside the PlayerProvider tree. Watches pendingExpandRef and calls
// expandPlayer() as soon as the context is available and a track is active.
// ─────────────────────────────────────────────────────────────────────────────
function NotificationPlayerExpander({
  pendingRef,
}: {
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const { expandPlayer } = usePlayerOverlay();
  const activeTrack = require("react-native-track-player").useActiveTrack();

  useEffect(() => {
    if (!pendingRef.current) return;
    if (!activeTrack) return;          // wait until a track is loaded
    pendingRef.current = false;
    // Small delay so the app finishes mounting before the overlay animates in
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
// RootLayout
// ─────────────────────────────────────────────────────────────────────────────
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Meriva: require("../assets/fonts/Meriva.ttf"),
  });

  const [playerReady, setPlayerReady] = useState(false);
  const [libraryReady, setLibraryReady] = useState(false);
  const [premiumBannerVisible, setPremiumBannerVisible] = useState(false);

  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const isPlayerScreen = segments.includes("(player)");
  const navReady = !!navigationState?.key;

  const appReady = fontsLoaded && libraryReady && navReady;

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    async function prepare() {
      try {
        await TrackPlayer.getActiveTrack();
      } catch {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      }
      setPlayerReady(true);

      try {
        await initializeLibrary();
      } catch (error) {
        console.warn("Library initialization failed:", error);
      } finally {
        setLibraryReady(true);
      }
    }
    prepare();
  }, []);

  // ── Hide splash ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (appReady) SplashScreen.hideAsync();
  }, [appReady]);

  // ── Show premium banner after app is ready ────────────────────────────────
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [appReady]);

  // ─────────────────────────────────────────────────────────────────────────
  // Deep link / notification tap handler
  //
  // When the user taps the lock screen card or notification media card while
  // the app is backgrounded or closed, Android re-launches/resumes the app.
  // We listen for the initial URL (cold start) and subsequent URL events
  // (warm resume) and expand the player overlay in both cases.
  //
  // The PlayerOverlayContext is only available after playerReady + providers
  // mount, so we use a ref to queue the expand if it arrives before that.
  // ─────────────────────────────────────────────────────────────────────────
  const pendingExpandRef = React.useRef(false);

  // Called whenever the app is opened from the notification/lock screen card.
  // The OS either sends no URL (plain app resume) or our custom scheme URL.
  // In both cases, if a track is active we want to show the player.
  const handleOpenFromNotification = React.useCallback(() => {
    pendingExpandRef.current = true;
  }, []);

  // Cold start: check if the app was launched by tapping the notification
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      // Any launch from our scheme or a null URL while a track exists means
      // the user tapped the notification card.
      if (url === null || url?.startsWith("mavins-player")) {
        handleOpenFromNotification();
      }
    });

    // Warm resume: app was backgrounded and notification card was tapped
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url?.startsWith("mavins-player") || url === "") {
        handleOpenFromNotification();
      }
    });

    return () => sub.remove();
  }, [handleOpenFromNotification]);

  // ─────────────────────────────────────────────────────────────────────────
  // Provider tree
  // ─────────────────────────────────────────────────────────────────────────
  // SafeAreaProvider and QueryClientProvider are pure-UI / data providers —
  // safe to render immediately.
  // MusicPlayerProvider is gated behind playerReady so it never calls any
  // TrackPlayer API before setupPlayer() has resolved.
  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ThemeProvider value={DarkTheme}>

              {/* ── Device status bar — completely hidden ── */}
              <StatusBar hidden />

              {/* Block everything that touches TrackPlayer until player is ready */}
              {!playerReady ? (
                <LoadingScreen />
              ) : (
                <MusicPlayerProvider>
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
                              presentation: "transparentModal",
                              animation: "slide_from_bottom",
                              contentStyle: { backgroundColor: "transparent" },
                            }}
                          />
                          {/*
                           * (modals) group has its own _layout.tsx.
                           * Register the group here — individual screens are
                           * declared inside app/(modals)/_layout.tsx.
                           */}
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

                        {(!fontsLoaded || !libraryReady) && <LoadingScreen />}

                      </View>

                      <LyricsFetcher />
                      <NotificationPlayerExpander pendingRef={pendingExpandRef} />

                      {navReady && !isPlayerScreen && (
                        <View style={styles.floatingPlayerWrapper}>
                          <FloatingPlayer />
                        </View>
                      )}

                      <UpdateModal />
                      <MessageModal />

                      {/* ── Premium banner — rendered last so it sits above everything ── */}
                      <PremiumBanner
                        visible={premiumBannerVisible}
                        onDismiss={() => setPremiumBannerVisible(false)}
                      />

                    </GlobalUIStateProvider>
                  </LyricsProvider>
                </MusicPlayerProvider>
              )}

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