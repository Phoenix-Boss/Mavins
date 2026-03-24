// components/player/PlayerScreen.tsx
/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * 1. NO loading/waiting state — render PlayerContent immediately.
 *    All track data comes from usePlayerStore, so the UI shows instantly.
 * 2. PlayerContent uses usePlayerStore.currentTrack as display fallback
 *    while useActiveTrack() catches up.
 * 3. If there is no track (and never was one) the UI still renders with
 *    placeholder "—" values — user can navigate away from the player screen.
 */

import React, { useCallback } from "react";
import { View, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

import PlayerContent from "./playerContent";

export default function PlayerScreen() {
  const router = useRouter();

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  // Render PlayerContent immediately — no loading state needed
  // Track data comes from usePlayerStore, displayed instantly
  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
      playerReady={true}
    />
  );
}