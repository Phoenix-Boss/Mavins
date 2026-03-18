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
import { initializeLibrary } from "@/store/library";
import { playbackService } from "@/constants/playbackService";
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
TrackPlayer.registerPlaybackService(() => playbackService);
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

// How long after app is ready before the banner appears (ms).
const PREMIUM_BANNER_DELAY_MS = 2200;

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
  // Provider tree
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <MusicPlayerProvider>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ThemeProvider value={DarkTheme}>

                {/* ── Device status bar — completely hidden ── */}
                <StatusBar hidden />

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

                    {playerReady && <LyricsFetcher />}

                    {playerReady && navReady && !isPlayerScreen && (
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

              </ThemeProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </MusicPlayerProvider>
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