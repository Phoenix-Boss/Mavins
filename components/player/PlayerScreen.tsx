/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * 1. NO loading/waiting state — render PlayerContent immediately.
 * 2. PlayerContent uses usePlayerStore.currentTrack as display fallback
 * 3. INLINE RNTP INITIALIZATION - Lock screen controls work without service.js
 * 4. Professional event handling directly in useEffect
 */

import React, { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State,
} from "react-native-track-player";
import { useRouter } from "expo-router";

import PlayerContent from "./playerContent";

export default function PlayerScreen() {
  const router = useRouter();

  // 🔥 INLINE RNTP INITIALIZATION + LOCK SCREEN EVENTS (No service.js!)
  useEffect(() => {
    let unmounted = false;
    let eventSubs: any[] = [];

    const initTrackPlayer = async () => {
      try {
        // Setup if not initialized
        if (!(await TrackPlayer.isInitialized())) {
          await TrackPlayer.setupPlayer({
            capabilities: [
              Capability.PlayPause,
              Capability.SkipToNext,
              Capability.SkipToPrevious,
              Capability.SeekTo,
              Capability.Stop,
            ],
            notificationCapabilities: [
              Capability.PlayPause,
              Capability.SkipToNext,
              Capability.SkipToPrevious,
            ],
            compactNotificationCapabilities: [
              Capability.PlayPause,
              Capability.SkipToNext,
              Capability.SkipToPrevious,
            ],
          });
        }

        // 🔥 CRITICAL: Enables lock screen controls
        await TrackPlayer.updateOptions({
          android: {
            capabilities: [
              Capability.PlayPause,
              Capability.SkipToNext,
              Capability.SkipToPrevious,
              Capability.SeekTo,
            ],
            compactCapabilities: [
              Capability.PlayPause,
              Capability.SkipToNext,
            ],
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
          },
        });

        // 🔥 Lock screen events - DIRECTLY here (no service.js)
        if (!unmounted) {
          eventSubs = [
            TrackPlayer.addEventListener(Event.RemotePlay, () => {
              TrackPlayer.play().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemotePause, () => {
              TrackPlayer.pause().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemoteNext, () => {
              TrackPlayer.skipToNext().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemotePrevious, () => {
              TrackPlayer.skipToPrevious().catch(console.error);
            }),
          ];
        }

        console.log('✅ RNTP initialized - Lock screen ACTIVE');
      } catch (error) {
        console.error('❌ RNTP init failed:', error);
      }
    };

    initTrackPlayer();

    return () => {
      unmounted = true;
      eventSubs.forEach((sub: any) => sub.remove());
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  // Render PlayerContent immediately — no loading state needed
  return (
    <PlayerContent
      onMinimize={handleDismiss}
      onClose={handleDismiss}
      isExpanded={true}
      playerReady={true}
    />
  );
}
