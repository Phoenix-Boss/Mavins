/**
 * useNotificationClickHandler.tsx
 *
 * REIMPLEMENTED: No longer uses RNTP deep links.
 * Handles notification clicks for the expo-video player.
 * 
 * Features:
 *   - Listens to Expo notification response events
 *   - Navigates to player screen when notification is clicked
 *   - Handles deep links for custom URL schemes (mavin-player://)
 *   - Preserves playback state when app opens from notification
 */

import { useEffect, useRef } from "react";
import { Linking, AppState, AppStateStatus } from "react-native";
import { useRouter, usePathname, useRootNavigationState } from "expo-router";
import * as Notifications from "expo-notifications";
import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationPayload {
  type?: "player" | "track" | "playlist";
  trackId?: string;
  playlistId?: string;
  action?: "play" | "pause" | "next" | "previous";
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEEP_LINK_SCHEME = "mavin-player";

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse deep link URL to extract action and parameters
 */
function parseDeepLink(url: string): NotificationPayload | null {
  try {
    // Handle mavin-player://player?action=play
    if (url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      const parsed = new URL(url);
      const action = parsed.searchParams.get("action") as NotificationPayload["action"];
      const trackId = parsed.searchParams.get("trackId") || undefined;
      const playlistId = parsed.searchParams.get("playlistId") || undefined;
      const type = parsed.searchParams.get("type") as NotificationPayload["type"] || "player";

      return { type, trackId, playlistId, action: action || undefined };
    }

    // Handle legacy trackplayer:// clicks - redirect to player
    if (url === "trackplayer://notification.click") {
      return { type: "player", action: "play" };
    }

    // Handle standard expo notification URLs
    if (url.startsWith("exp://") || url.includes("expo-development-client")) {
      return { type: "player", action: "play" };
    }

    return null;
  } catch (error) {
    console.warn("[useNotificationClickHandler] Failed to parse deep link:", error);
    return null;
  }
}

/**
 * Handle the actual navigation based on notification payload
 */
async function handleNavigation(
  payload: NotificationPayload,
  router: ReturnType<typeof useRouter>,
  pathname: string,
  isNavigationReady: boolean
): Promise<void> {
  if (!isNavigationReady) {
    console.log("[useNotificationClickHandler] Navigation not ready, delaying...");
    await new Promise(resolve => setTimeout(resolve, 500));
    return handleNavigation(payload, router, pathname, true);
  }

  triggerHaptic();

  switch (payload.type) {
    case "player":
      // Navigate to player screen
      if (!pathname?.includes("(player)")) {
        router.push("/(player)");
      }
      break;

    case "track":
      if (payload.trackId) {
        // Navigate to player with specific track
        router.push({
          pathname: "/(player)",
          params: { autoPlayTrackId: payload.trackId },
        });
      }
      break;

    case "playlist":
      if (payload.playlistId) {
        // FIXED: Use existing playlist route structure
        // Navigate to library playlist screen using the correct route
        router.push({
          pathname: "/library/[playlistName]",
          params: { playlistName: payload.playlistId },
        });
      }
      break;

    default:
      // Default: just go to player
      if (!pathname?.includes("(player)")) {
        router.push("/(player)");
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useNotificationClickHandler
 * 
 * Handles notification clicks and deep links for the music player.
 * Calls the expandPlayer function from the player overlay context
 * to ensure the full player UI is shown when opened from a notification.
 */
const useNotificationClickHandler = (expandPlayer?: () => void) => {
  const router = useRouter();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();

  const latestPath = useRef(pathname);
  const isNavigationReady = !!navigationState?.key;
  const expandPlayerRef = useRef(expandPlayer);

  // Update ref when expandPlayer changes
  useEffect(() => {
    expandPlayerRef.current = expandPlayer;
  }, [expandPlayer]);

  // Track latest pathname
  useEffect(() => {
    latestPath.current = pathname;
  }, [pathname]);

  // ── Handle Expo Notifications ──────────────────────────────────────────────
  useEffect(() => {
    if (!isNavigationReady) return;

    // Handle notification response when app is in foreground or background
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("[useNotificationClickHandler] Notification clicked:", response);
        
        const data = response.notification.request.content.data;
        const payload: NotificationPayload = {
          type: (data?.type as NotificationPayload["type"]) || "player",
          trackId: data?.trackId as string | undefined,
          playlistId: data?.playlistId as string | undefined,
          action: data?.action as NotificationPayload["action"],
        };

        handleNavigation(payload, router, latestPath.current, true).then(() => {
          // Expand player if function provided
          if (expandPlayerRef.current) {
            setTimeout(() => expandPlayerRef.current?.(), 300);
          }
        });
      }
    );

    return () => {
      subscription.remove();
    };
  }, [isNavigationReady, router]);

  // ── Handle Deep Links (URL Scheme) ────────────────────────────────────────
  useEffect(() => {
    if (!isNavigationReady) return;

    const handleDeepLink = async (event: { url: string }) => {
      const { url } = event;
      console.log("[useNotificationClickHandler] Deep link received:", url);

      const payload = parseDeepLink(url);
      if (!payload) return;

      await handleNavigation(payload, router, latestPath.current, true);
      
      // Expand player if function provided
      if (expandPlayerRef.current) {
        setTimeout(() => expandPlayerRef.current?.(), 300);
      }
    };

    // Handle initial URL when app starts
    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        console.log("[useNotificationClickHandler] Initial URL:", initialUrl);
        const payload = parseDeepLink(initialUrl);
        if (payload) {
          setTimeout(() => {
            handleNavigation(payload, router, latestPath.current, true);
          }, 1000); // Wait for app to fully initialize
        }
      }
    });

    // Add event listener for subsequent deep links
    const subscription = Linking.addEventListener("url", handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, [isNavigationReady, router]);

  // ── Handle App State Changes (resume from background) ──────────────────────
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        // Check if there's a pending notification that opened the app
        Notifications.getLastNotificationResponseAsync().then((response) => {
          if (response) {
            console.log("[useNotificationClickHandler] Last notification response:", response);
            const data = response.notification.request.content.data;
            const payload: NotificationPayload = {
              type: (data?.type as NotificationPayload["type"]) || "player",
              trackId: data?.trackId as string | undefined,
              playlistId: data?.playlistId as string | undefined,
              action: data?.action as NotificationPayload["action"],
            };

            handleNavigation(payload, router, latestPath.current, true);
          }
        });
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [router, isNavigationReady]);

  return null;
};

export default useNotificationClickHandler;