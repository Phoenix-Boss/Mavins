// app/_layout.tsx
//
// Player bootstrap:
//   MavinPlayer.initPlayer() → ExoPlayer with full DSP chain (EQ, compressor,
//   crossfeed, FX) built in as AudioProcessors.
//
// Remote controls (lock screen, notification) are handled automatically by
// MavinPlaybackService via Media3's MediaSessionService — no listener setup
// needed here beyond error monitoring.

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRootNavigationState, useRouter, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { StyleSheet } from "react-native";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar, View, ActivityIndicator, Linking, Platform } from "react-native";
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

// ── MavinPlayer ───────────────────────────────────────────────────────────────
// ✅ FIX: Import the player instance directly from mavin-eq (which exports the native module)
// This ensures we get the actual native module, not a getter function.
import MavinPlayer from "@/modules/mavin-eq";
import type { MavinPlayerNativeModule } from "@/modules/mavin-eq/types";

// ── Shared player bootstrap ───────────────────────────────────────────────────
// Import (and re-export) from libs/playerSetup so any component that needs to
// await player readiness imports from ONE place — never from a route file.
export { setupPlayerGlobal } from "@/libs/playerSetup";

// ── Module-level bootstrap ────────────────────────────────────────────────────
SplashScreen.preventAutoHideAsync();
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
initCache({ startBackgroundJobs: true });

const PREMIUM_BANNER_DELAY_MS = 2200;
const SPLASH_FORCE_HIDE_MS    = 4000;

// Helper to check if player is available (Android-only)
const isPlayerAvailable = (): boolean => {
  return Platform.OS === "android" && MavinPlayer !== null;
};

// Helper to safely get the player module (throws if not available)
const getPlayerModule = (): MavinPlayerNativeModule => {
  if (!isPlayerAvailable()) {
    throw new Error("[MavinPlayer] Player module not available on this platform or not initialized");
  }
  return MavinPlayer as MavinPlayerNativeModule;
};

// ─────────────────────────────────────────────────────────────────────────────
// NotificationPlayerExpander
//
// Listens for MavinPlayer's 'onTrackChanged' event (fires when a track starts
// via a notification action) and expands the player overlay.
// ─────────────────────────────────────────────────────────────────────────────

function NotificationPlayerExpander({
  pendingRef,
}: {
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const { expandPlayer } = usePlayerOverlay();
  const router           = useRouter();

  useEffect(() => {
    // ✅ FIX: guard against null — module is Android-only
    if (!isPlayerAvailable()) return;

    const player = getPlayerModule();
    const subscription = player.addListener("onTrackChanged", () => {
      if (!pendingRef.current) return;

      console.log("[NotificationPlayerExpander] Track changed, expanding player");

      const t = setTimeout(() => {
        pendingRef.current = false;
        try {
          expandPlayer();
        } catch {
          router.push("/(player)");
        }
      }, 500);

      return () => clearTimeout(t);
    });

    return () => subscription.remove();
  }, [expandPlayer, pendingRef, router]);

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
        // ✅ FIX: Import setupPlayerGlobal from libs (which now uses MavinPlayer directly)
        const { setupPlayerGlobal } = await import("@/libs/playerSetup");
        const ok = await setupPlayerGlobal();
        setPlayerReady(ok);
        
        try { 
          await initializeLibrary(); 
        } catch (e) { 
          console.warn("[Library] initialization failed:", e); 
        }
      } catch (e) {
        console.warn("[Player] setup error:", e);
        setPlayerReady(false);
      }
    }
    prepare();

    // ✅ FIX: Clean up on unmount with null check
    return () => {
      if (isPlayerAvailable()) {
        try {
          getPlayerModule().release();
        } catch (e) {
          console.warn("[MavinPlayer] release error on unmount:", e);
        }
      }
    };
  }, []);

  // ── Splash ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (appReady) { 
      SplashScreen.hideAsync(); 
      return; 
    }
    const t = setTimeout(() => SplashScreen.hideAsync(), SPLASH_FORCE_HIDE_MS);
    return () => clearTimeout(t);
  }, [appReady]);

  // ── Premium banner ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!appReady) return;
    const t = setTimeout(() => setPremiumBannerVisible(true), PREMIUM_BANNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [appReady]);

  // ── Deep link / notification tap ──────────────────────────────────────────
  const handleOpenFromNotification = useCallback(() => {
    pendingExpandRef.current = true;
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url === null || url?.startsWith("mavins-player")) handleOpenFromNotification();
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url?.startsWith("mavins-player") || url === "") handleOpenFromNotification();
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