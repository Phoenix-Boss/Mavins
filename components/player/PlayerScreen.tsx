/**
 * PlayerScreen — Route entry point for the (player) modal.
 *
 * BEHAVIOUR:
 * 1. NO loading/waiting state — render PlayerContent immediately.
 * 2. PlayerContent uses usePlayerStore.currentTrack as display fallback
 * 3. INLINE RNTP INITIALIZATION - Lock screen controls work without service.js
 * 4. Professional event handling directly in useEffect
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
} from "react-native-track-player";
import { useRouter } from "expo-router";

import PlayerContent from "./playerContent";

export default function PlayerScreen() {
  const router = useRouter();
  const isSetupRef = useRef(false);

  // 🔥 INLINE RNTP INITIALIZATION + LOCK SCREEN EVENTS (No service.js!)
  useEffect(() => {
    let unmounted = false;
    let eventSubs: any[] = [];

    const initTrackPlayer = async () => {
      try {
        // 🔥 RNTP v4: No isInitialized() method - use try/catch instead
        // If already initialized, setupPlayer() will reject with "player_already_initialized"
        if (!isSetupRef.current) {
          try {
            await TrackPlayer.setupPlayer({
              autoHandleInterruptions: true,
            });
            console.log('✅ RNTP: Player setup complete');
          } catch (setupError: any) {
            // If already initialized, that's fine - we can proceed
            if (setupError?.message?.includes('already been initialized') || 
                setupError?.code === 'player_already_initialized') {
              console.log('ℹ️ RNTP: Player already initialized');
            } else {
              throw setupError; // Re-throw if it's a different error
            }
          }
          isSetupRef.current = true;
        }

        // 🔥 CRITICAL: Update options for lock screen controls
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
            Capability.Stop,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
          ],
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
          ],
          android: {
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
            alwaysPauseOnInterruption: true,
          },
          progressUpdateEventInterval: 1,
        });

        // 🔥 Lock screen events - DIRECTLY here (no service.js)
        if (!unmounted && eventSubs.length === 0) {
          eventSubs = [
            TrackPlayer.addEventListener(Event.RemotePlay, () => {
              console.log('🔒 RemotePlay');
              TrackPlayer.play().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemotePause, () => {
              console.log('🔒 RemotePause');
              TrackPlayer.pause().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemoteNext, () => {
              console.log('🔒 RemoteNext');
              TrackPlayer.skipToNext().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemotePrevious, () => {
              console.log('🔒 RemotePrevious');
              TrackPlayer.skipToPrevious().catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
              console.log('🔒 RemoteSeek:', event.position);
              TrackPlayer.seekTo(event.position).catch(console.error);
            }),
            TrackPlayer.addEventListener(Event.RemoteStop, () => {
              console.log('🔒 RemoteStop');
              TrackPlayer.stop().catch(console.error);
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
      eventSubs.forEach((sub: any) => {
        try {
          sub.remove();
        } catch (e) {
          // Ignore removal errors
        }
      });
      eventSubs = [];
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