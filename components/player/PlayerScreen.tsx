/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * - Player is already initialized by _layout.tsx at app startup.
 * - This screen ONLY verifies readiness, NEVER re-initializes.
 * - Shows PlayerIdleScreen when no track is playing.
 * - Lock screen / notification controls are handled automatically by
 *   MavinPlaybackService (Media3 MediaSessionService).
 *
 * FIXES APPLIED:
 *
 *  1. REMOVED setupPlayerGlobal() entirely - no re-initialization.
 *  2. Only performs a lightweight health check via getState().
 *  3. Accepts alreadyReady prop to skip verification entirely when known ready.
 *  4. Uses default import TrackPlayer consistently.
 *  5. Shows PlayerIdleScreen when no active track (instead of black screen).
 *  6. More robust health check with fallback.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { 
  View, 
  Text, 
  ActivityIndicator, 
  StyleSheet, 
  TouchableOpacity,
  Animated,
  Image,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import PlayerContent from "./playerContent";
import TrackPlayer, { useActiveTrack } from "@/modules/mavin-eq";
import { triggerHaptic } from "@/helpers/haptics";
import { isPlayerReady } from "@/libs/playerSetup";

// ─────────────────────────────────────────────────────────────────────────────
// Loading Screen Component
// ─────────────────────────────────────────────────────────────────────────────

interface LoadingScreenProps {
  onDismiss: () => void;
  error?: string | null;
  onRetry?: () => void;
  isVerifying?: boolean;
}

function LoadingScreen({ onDismiss, error, onRetry, isVerifying }: LoadingScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient 
      style={styles.loadingContainer} 
      colors={["#1a0f05", "#0b0b0b", "#050505"]}
    >
      {/* Top Bar */}
      <View style={[styles.loadingTopBar, { top: insets.top + 8 }]}>
        <View style={styles.dragHandleWrapper}>
          <View style={styles.dragHandle} />
        </View>
        <TouchableOpacity 
          onPress={onDismiss} 
          style={styles.closeBtn} 
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-down" size={28} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.loadingContent}>
        {error ? (
          <>
            <View style={styles.errorIconContainer}>
              <Ionicons name="alert-circle-outline" size={64} color="rgba(255,255,255,0.4)" />
            </View>
            <Text style={styles.errorTitle}>Player Not Responding</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            {onRetry && (
              <TouchableOpacity 
                style={styles.retryButton} 
                onPress={onRetry}
                activeOpacity={0.7}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={styles.dismissButton} 
              onPress={onDismiss}
              activeOpacity={0.7}
            >
              <Text style={styles.dismissButtonText}>Go Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#D4AF37" />
            <Text style={styles.loadingText}>
              {isVerifying ? "Checking Audio Engine..." : "Loading Player..."}
            </Text>
            <Text style={styles.loadingSubtext}>
              {isVerifying ? "Verifying native module readiness" : "Preparing interface"}
            </Text>
          </>
        )}
      </View>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerIdleScreen - Shown when no track is playing
// ─────────────────────────────────────────────────────────────────────────────

function PlayerIdleScreen({ onMinimize }: { onMinimize: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const anim = useRef(new Animated.Value(0)).current;

  const handleDismiss = useCallback(() => {
    onMinimize();
    try {
      if (!router.canGoBack()) router.replace("/(tabs)");
    } catch {
      router.replace("/(tabs)");
    }
  }, [onMinimize, router]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const glowOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.38] });

  return (
    <LinearGradient style={{ flex: 1 }} colors={["#1a0f05", "#0b0b0b", "#050505"]}>
      <View style={[idleStyles.topBar, { top: insets.top + 8 }]}>
        <View style={idleStyles.dragHandleWrapper}>
          <View style={idleStyles.dragHandle} />
        </View>
        <TouchableOpacity onPress={handleDismiss} style={idleStyles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-down" size={28} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      <View style={[idleStyles.body, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 24 }]}>
        <View style={idleStyles.artworkWrapper}>
          <Animated.View style={[idleStyles.glow, { opacity: glowOpacity }]} />
          <Image
            source={require("@/assets/images/mavins.png")}
            style={idleStyles.artworkImage}
            contentFit="contain"
          />
        </View>

        <View style={idleStyles.infoContainer}>
          <Text style={idleStyles.appTitle}>Mavin Player</Text>
          <Text style={idleStyles.subtitle}>No song playing yet</Text>
        </View>

        <View style={idleStyles.progressWrapper}>
          <View style={{ width: "100%", height: 4, borderRadius: 4, backgroundColor: "#1A1A1A" }} />
          <View style={idleStyles.timeRow}>
            <Text style={idleStyles.timeText}>0:00</Text>
            <Text style={idleStyles.timeText}>0:00</Text>
          </View>
        </View>

        <View style={idleStyles.controls}>
          <Ionicons name="shuffle" size={20} color="rgba(255,255,255,0.2)" />
          <Ionicons name="play-skip-back" size={32} color="rgba(255,255,255,0.2)" />
          <View style={idleStyles.bigPlay}>
            <Ionicons name="play" size={32} color="rgba(0,0,0,0.35)" />
          </View>
          <Ionicons name="play-skip-forward" size={32} color="rgba(255,255,255,0.2)" />
          <Ionicons name="repeat" size={22} color="rgba(255,255,255,0.2)" />
        </View>

        <View style={idleStyles.bottomTabs}>
          {["UP NEXT", "LYRICS", "RELATED"].map((label) => (
            <Text key={label} style={idleStyles.bottomTab}>{label}</Text>
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}

const idleStyles = StyleSheet.create({
  topBar: { position: "absolute", left: 0, right: 0, zIndex: 100, alignItems: "center" },
  dragHandleWrapper: { width: "100%", alignItems: "center", paddingBottom: 8 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  closeBtn: { position: "absolute", left: 16, top: 0 },
  body: { flex: 1, paddingHorizontal: 20, alignItems: "center" },
  artworkWrapper: {
    width: 300,
    height: 300,
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1c1208",
    justifyContent: "center",
    alignItems: "center",
  },
  glow: { ...StyleSheet.absoluteFillObject, backgroundColor: "#D4AF37", borderRadius: 16 },
  artworkImage: { width: 200, height: 200, opacity: 0.75 },
  infoContainer: { marginTop: 24, alignItems: "center", width: "100%" },
  appTitle: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center", letterSpacing: 0.4 },
  subtitle: { color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 6, textAlign: "center" },
  progressWrapper: { marginTop: 20, width: "100%" },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  timeText: { color: "rgba(255,255,255,0.3)", fontSize: 12 },
  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: 26,
    width: "100%",
    paddingHorizontal: 8,
  },
  bigPlay: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomTabs: { flexDirection: "row", justifyContent: "space-around", marginTop: 32, width: "100%" },
  bottomTab: { color: "rgba(255,255,255,0.2)", fontSize: 13 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerScreenProps {
  alreadyReady?: boolean;
}

export default function PlayerScreen({ alreadyReady = false }: PlayerScreenProps) {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Primary source of truth: the global singleton in playerSetup.ts.
  // This is synchronous, so we never show a loading screen if the player
  // is already up (which it will be 99% of the time after _layout init).
  const isAlreadyReady = alreadyReady || params.alreadyReady === 'true' || isPlayerReady();

  const [isReady, setIsReady] = useState(isAlreadyReady);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false); // default false - skip unless needed

  const isMountedRef = useRef(true);
  const verifyAttemptedRef = useRef(isAlreadyReady); // skip first verify if already ready

  // Check if there's an active track
  const { track: activeTrack } = useActiveTrack();
  const hasActiveTrack = !!activeTrack;

  // ─── Verification function - HEALTH CHECK ONLY, NO SETUP ───────────────────
  const performVerification = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    // CRITICAL: Do NOT call setupPlayerGlobal() here!
    // The player is already initialized by _layout.tsx at app startup.
    
    try {
      setError(null);
      setIsRetrying(true);
      setIsVerifying(true);
      
      let verified = false;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (!verified && attempts < maxAttempts && isMountedRef.current) {
        try {
          // Try getState() first - it's the lightest health check
          await TrackPlayer.getState();
          verified = true;
          console.log('[PlayerScreen] ✅ Health check passed');
          break;
        } catch (e) {
          attempts++;
          if (attempts < maxAttempts && isMountedRef.current) {
            await new Promise(r => setTimeout(r, 150));
          }
        }
      }
      
      if (!isMountedRef.current) return;
      
      if (verified) {
        setIsReady(true);
        verifyAttemptedRef.current = true;
        setIsVerifying(false);
      } else {
        setError("Audio engine not responding. Please restart the app.");
        setIsVerifying(false);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      
      const message = err instanceof Error ? err.message : String(err);
      console.error("[PlayerScreen] Health check failed:", message);
      setError(message || "Unable to connect to audio engine.");
      setIsVerifying(false);
    } finally {
      if (isMountedRef.current) {
        setIsRetrying(false);
      }
    }
  }, []);

  // ─── Initial verification ──────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    // Skip verification entirely if the global singleton says player is ready.
    // isPlayerReady() checks GLOBAL_STATE which survives hot-reloads via global.
    if (isAlreadyReady) {
      setIsReady(true);
      setIsVerifying(false);
      return;
    }

    // Only verify once on mount (fallback for edge cases where singleton is wrong)
    if (!verifyAttemptedRef.current) {
      setIsVerifying(true);
      const timer = setTimeout(() => {
        performVerification();
      }, 50);
      return () => clearTimeout(timer);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [performVerification, isAlreadyReady]);

  // ─── Retry handler ─────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    triggerHaptic();
    verifyAttemptedRef.current = false;
    performVerification();
  }, [performVerification]);

  // ─── Dismiss handler ───────────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    triggerHaptic();
    
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  
  // Show loading/error screen while verifying
  if (!isReady) {
    return (
      <LoadingScreen 
        onDismiss={handleDismiss} 
        error={error}
        onRetry={error ? handleRetry : undefined}
        isVerifying={isVerifying && !error}
      />
    );
  }

  // Show PlayerIdleScreen when no active track
  if (!hasActiveTrack) {
    return <PlayerIdleScreen onMinimize={handleDismiss} />;
  }

  // Player is verified ready AND has an active track - render the full player content
  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
      playerReady={isReady}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
  },
  loadingTopBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: "center",
  },
  dragHandleWrapper: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  closeBtn: {
    position: "absolute",
    left: 16,
    top: 0,
  },
  loadingContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  loadingText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 24,
    textAlign: "center",
  },
  loadingSubtext: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  errorIconContainer: {
    marginBottom: 24,
  },
  errorTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  errorMessage: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  retryButton: {
    backgroundColor: "#D4AF37",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    marginTop: 8,
  },
  retryButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "600",
  },
  dismissButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  dismissButtonText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    fontWeight: "500",
  },
});