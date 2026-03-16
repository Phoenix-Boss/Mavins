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
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";

// ── Internal ──────────────────────────────────────────────────────────────────
import { store, initializeLibrary } from "@/store/library";
import { playbackService } from "@/constants/playbackService";
import { MusicPlayerProvider } from "@/components/MusicPlayerContext";
// LyricsProvider  = safe shell (no RNTP hooks) — always mounts
// LyricsFetcher   = calls useActiveTrack() — only mounts after playerReady
import { LyricsProvider, LyricsFetcher } from "@/hooks/useLyricsContext";
import { GlobalUIStateProvider } from "@/contexts/GlobalUIStateContext";
import FloatingPlayer from "@/components/FloatingPlayer";
import { UpdateModal } from "@/components/UpdateModal";
import { MessageModal } from "@/components/MessageModal";

// ── Mavin libs ────────────────────────────────────────────────────────────────
import { queryClient } from "@/libs/supabase";
import { initCache } from "@/libs/cache";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level bootstrap — runs once before any component mounts.
// registerPlaybackService MUST be called before setupPlayer().
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

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function prepare() {
      // Step 1: TrackPlayer — probe first to survive fast-refresh in dev
      try {
        await TrackPlayer.getActiveTrack();
      } catch {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      }
      setPlayerReady(true); // ← LyricsFetcher mounts only after this

      // Step 2: App library (runs after player is ready, non-blocking for UI)
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

  // ── Hide splash once everything is ready ─────────────────────────────────────
  useEffect(() => {
    if (fontsLoaded && libraryReady && navReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, libraryReady, navReady]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Provider tree rules:
  //
  //  ┌─ QueryClientProvider          (no RNTP) — always safe
  //  ├─ Provider (Redux)             (no RNTP) — always safe
  //  ├─ MusicPlayerProvider          (no RNTP) — always safe
  //  ├─ LyricsProvider               (no RNTP) — always safe; just holds state
  //  │   └─ GlobalUIStateProvider    (no RNTP) — always safe
  //  │       └─ Stack + screens      ← context is available to ALL screens
  //  │       └─ LyricsFetcher        ← mounts ONLY after playerReady;
  //  │                                  calls useActiveTrack() safely here
  //  │       └─ FloatingPlayer       ← uses RNTP hooks, gated by playerReady
  //  └─ UpdateModal / MessageModal   (no RNTP) — always safe
  //
  // Key principle: RNTP hooks must NEVER be called before setupPlayer() resolves.
  // We achieve this by mounting the components that contain those hooks
  // conditionally, not by trying to guard the hooks themselves.
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <MusicPlayerProvider>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ThemeProvider value={DarkTheme}>
                <StatusBar
                  barStyle="light-content"
                  backgroundColor="transparent"
                  translucent
                />

                {/*
                  LyricsProvider wraps the ENTIRE tree so that useLyricsContext()
                  is available in every screen, including (player) and (modals).
                  It contains NO RNTP hooks — safe to mount immediately.
                */}
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

                      {/* Full-screen overlay until fonts + library are ready */}
                      {(!fontsLoaded || !libraryReady) && <LoadingScreen />}
                    </View>

                    {/*
                      LyricsFetcher — renders null but calls useActiveTrack().
                      MUST stay outside <View> (it's not visual) but inside
                      LyricsProvider so it can write to the context.
                      Mounts ONLY after setupPlayer() has resolved.
                    */}
                    {playerReady && <LyricsFetcher />}

                    {/*
                      FloatingPlayer uses RNTP hooks (useActiveTrack etc).
                      Gated behind both playerReady AND navReady, and hidden
                      when the full player screen is open.
                    */}
                    {playerReady && navReady && !isPlayerScreen && (
                      <View style={styles.floatingPlayerWrapper}>
                        <FloatingPlayer />
                      </View>
                    )}

                    {/* Modals with no RNTP hooks — always safe */}
                    <UpdateModal />
                    <MessageModal />

                  </GlobalUIStateProvider>
                </LyricsProvider>

              </ThemeProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </MusicPlayerProvider>
      </Provider>
    </QueryClientProvider>
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