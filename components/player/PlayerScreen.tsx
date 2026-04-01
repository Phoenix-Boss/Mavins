/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * - Waits for MavinPlayer global setup then renders PlayerContent.
 * - Lock screen / notification controls are handled automatically by
 *   MavinPlaybackService (Media3 MediaSessionService) — no listener setup
 *   needed here.
 * - PlayerContent uses usePlayerStore.currentTrack as display fallback.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import PlayerContent from "./playerContent";
import { setupPlayerGlobal } from "@/libs/playerSetup";

export default function PlayerScreen() {
  const router       = useRouter();
  const [isReady, setIsReady] = useState(false);
  const isMountedRef = useRef(true);

  // Wait for global MavinPlayer setup to complete (instant if already done)
  useEffect(() => {
    let cancelled = false;

    setupPlayerGlobal().then((ready) => {
      if (!cancelled && isMountedRef.current) {
        setIsReady(ready);
      }
    });

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  // PlayerContent renders null until playerReady=true — no loading flash
  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
      playerReady={isReady}
    />
  );
}