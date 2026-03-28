/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * - Waits for global TrackPlayer setup then renders PlayerContent.
 * - Lock screen remote events are handled globally in _layout.tsx —
 *   NOT here. They must survive screen unmounts.
 * - PlayerContent uses usePlayerStore.currentTrack as display fallback.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import PlayerContent from "./playerContent";
import { setupTrackPlayerGlobal } from "@/app/_layout";

export default function PlayerScreen() {
  const router      = useRouter();
  const [isReady, setIsReady] = useState(false);
  const isMountedRef = useRef(true);

  // Wait for global TrackPlayer setup to complete (fast if already done)
  useEffect(() => {
    let cancelled = false;

    setupTrackPlayerGlobal().then((ready) => {
      if (!cancelled && isMountedRef.current) {
        setIsReady(ready);
      }
    });

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, []);

  // ✅ REMOVED: lock screen event listeners — they now live in _layout.tsx
  //    setupTrackPlayerGlobal() and are registered once for the app lifetime.
  //    Having them here caused them to be torn down whenever the user
  //    navigated away from the player screen.

  // ✅ REMOVED: AppState listener — wasn't doing anything actionable and
  //    added noise. RNTP handles background state natively.

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  // PlayerContent renders null until playerReady=true, so no loading flash
  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
      playerReady={isReady}
    />
  );
}