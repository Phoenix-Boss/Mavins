// components/player/PlayerScreen.tsx
/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * 1. Wait for TrackPlayer native module to be ready (Stage 1 — usually instant).
 * 2. Render PlayerContent immediately once the module is up.
 *    - PlayerContent uses usePlayerStore.currentTrack as a display fallback
 *      while useActiveTrack() catches up, so there is no black screen.
 * 3. If there is no track (and never was one) the UI still renders with
 *    placeholder "—" values — user can navigate away from the player screen.
 *
 * The old Stage-2 track-waiting loop is intentionally removed.
 * PlayerContent itself handles the no-track state gracefully.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import TrackPlayer from "react-native-track-player";

import PlayerContent from "./playerContent";
import { SkeletonLoader } from "@/components/common/SkeletonLoader";

const POLL_INTERVAL = 150;

type Stage = "waiting_player" | "ready" | "error";

// ── Full-screen skeleton while the native player module initialises ──────────

function PlayerSkeleton() {
  return (
    <View style={skStyles.container}>
      {/* Artwork placeholder */}
      <SkeletonLoader type="album" />

      {/* Title + artist */}
      <View style={skStyles.infoBlock}>
        <SkeletonLoader type="trending" />
      </View>

      {/* Progress bar area */}
      <View style={skStyles.progressBlock}>
        <SkeletonLoader type="mix" />
      </View>
    </View>
  );
}

const skStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 28,
  },
  infoBlock: {
    width: "100%",
  },
  progressBlock: {
    width: "100%",
    opacity: 0.6,
  },
});

// ── PlayerScreen ─────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("waiting_player");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const run = async () => {
      // Wait for TrackPlayer native module to be ready (usually 0–1 polls)
      while (mountedRef.current) {
        try {
          await TrackPlayer.getPlaybackState();
          break; // module is ready
        } catch (e: any) {
          const msg = (e?.message ?? "").toLowerCase();
          const notReady =
            msg.includes("not initialized") ||
            msg.includes("not set up") ||
            msg.includes("setupplayer") ||
            msg.includes("player is not initialized");
          if (!notReady) {
            if (mountedRef.current) setErrorMsg(e?.message ?? "Player error");
            if (mountedRef.current) setStage("error");
            return;
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        }
      }

      // Module is ready — render PlayerContent immediately.
      // PlayerContent uses usePlayerStore.currentTrack as display fallback
      // while useActiveTrack() fires, so no blank screen even with no queue.
      if (mountedRef.current) setStage("ready");
    };

    run();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  if (stage === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity onPress={handleDismiss} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (stage === "ready") {
    return (
      <PlayerContent
        onMinimize={handleDismiss}
        onClose={handleDismiss}
        isExpanded={true}
        playerReady={true}
      />
    );
  }

  // waiting_player — show skeleton instead of spinner
  return <PlayerSkeleton />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    color: "#ff4444",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#1C1C1E",
    borderRadius: 8,
    marginTop: 8,
  },
  backBtnText: {
    color: "#D4AF37",
    fontSize: 14,
    fontWeight: "600",
  },
});