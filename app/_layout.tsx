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

// ── Mavin libs ────────────────────────────────────────────────────────────────
import { queryClient } from "@/libs/supabase";
import { initCache } from "@/libs/cache";

// ── Honeygain ─────────────────────────────────────────────────────────────────
// Outermost wrapper — fires permission dialogs + consent modal on first launch.
// Children render immediately behind the modal; nothing is blocked.
import HoneygainConsentGate from "@/components/HoneygainConsentGate";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level bootstrap — runs once before any component mounts.
// ─────────────────────────────────────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
TrackPlayer.registerPlaybackService(() => playbackService);
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

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

  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const isPlayerScreen = segments.includes("(player)");
  const navReady = !!navigationState?.key;

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
    if (fontsLoaded && libraryReady && navReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, libraryReady, navReady]);

  // ─────────────────────────────────────────────────────────────────────────
  // Provider tree:
  //
  //  HoneygainConsentGate    — permissions + consent modal (outermost)
  //  └─ QueryClientProvider
  //  └─ MusicPlayerProvider
  //  └─ SafeAreaProvider
  //  └─ GestureHandlerRootView
  //  └─ ThemeProvider
  //  └─ LyricsProvider
  //  └─ GlobalUIStateProvider
  //  └─ Stack + screens
  //  └─ LyricsFetcher / FloatingPlayer / Modals
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <HoneygainConsentGate>
      <QueryClientProvider client={queryClient}>
        <MusicPlayerProvider>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ThemeProvider value={DarkTheme}>
                <StatusBar
                  barStyle="light-content"
                  backgroundColor="transparent"
                  translucent
                />

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
                        <Stack.Screen name="(modals)/addToPlaylist" />
                        <Stack.Screen name="(modals)/comments" />
                        <Stack.Screen name="(modals)/equalizer" />
                        <Stack.Screen name="(modals)/deletePlaylist" />
                        <Stack.Screen name="(modals)/queue" />
                        <Stack.Screen name="(modals)/premium" />
                        <Stack.Screen name="(modals)/related" />
                        <Stack.Screen name="(modals)/lyrics" />
                        <Stack.Screen name="(modals)/menu" />
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