// app/_layout.tsx

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
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
import { LyricsProvider } from "@/hooks/useLyricsContext";
import { GlobalUIStateProvider } from "@/contexts/GlobalUIStateContext";
import FloatingPlayer from "@/components/FloatingPlayer";
import { UpdateModal } from "@/components/UpdateModal";
import { MessageModal } from "@/components/MessageModal";

// ── Mavin libs ────────────────────────────────────────────────────────────────
import { queryClient } from "@/libs/supabase";   // ✅ singleton, not inline
import { initCache } from "@/libs/cache";         // ✅ initialise cache on boot

// ─────────────────────────────────────────────
// App bootstrap (runs once outside component tree)
// ─────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
TrackPlayer.registerPlaybackService(() => playbackService);
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true }); // ✅ boot cache system + background jobs

// ─────────────────────────────────────────────
// Loading screen
// ─────────────────────────────────────────────
function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color="#D4AF37" />
    </View>
  );
}

// ─────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Meriva: require("../assets/fonts/Meriva.ttf"),
  });

  const [libraryReady, setLibraryReady] = useState(false);
  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const isPlayerScreen = segments.includes("(player)");

  // Initialise app library (no navigation side effects here)
  useEffect(() => {
    async function prepare() {
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

  // Hide splash only after fonts, library, and navigation are all ready
  useEffect(() => {
    if (fontsLoaded && libraryReady && navigationState?.key) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, libraryReady, navigationState]);

  return (
    // ── Server state (TanStack Query) ───────────────────────────────────────
    <QueryClientProvider client={queryClient}>
      {/* ── Local/UI state (Redux) ──────────────────────────────────────── */}
      <Provider store={store}>
        <MusicPlayerProvider>
          <LyricsProvider>
            <GlobalUIStateProvider>
              <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <ThemeProvider value={DarkTheme}>
                    <StatusBar
                      barStyle="light-content"
                      backgroundColor="transparent"
                      translucent
                    />

                    <View style={{ flex: 1, backgroundColor: "#000" }}>
                      {/* Navigator must mount immediately — never gate it */}
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

                      {!isPlayerScreen && (
                        <View
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            zIndex: 1000,
                          }}
                        >
                          <FloatingPlayer />
                        </View>
                      )}

                      {/* Loading overlay — shown until fonts + library ready */}
                      {(!fontsLoaded || !libraryReady) && <LoadingScreen />}
                    </View>

                    <UpdateModal />
                    <MessageModal />
                  </ThemeProvider>
                </GestureHandlerRootView>
              </SafeAreaProvider>
            </GlobalUIStateProvider>
          </LyricsProvider>
        </MusicPlayerProvider>
      </Provider>
    </QueryClientProvider>
  );
}