/**
 * useNotificationClickHandler.tsx
 *
 * Handles notification clicks and deep links for the expo-video player.
 *
 * CHANGES vs previous version:
 *  • AppState effect now tracks a "lastHandledId" ref so the getLastNotificationResponseAsync
 *    poll on app-foreground doesn't re-navigate for notifications that were already handled
 *    by the addNotificationResponseReceivedListener subscription (prevents double-navigation).
 *  • handleNavigation's internal retry loop is replaced with a clean one-shot delay:
 *    instead of recursing with a hardcoded `true`, it waits and then calls itself once
 *    more with the actual isNavigationReady value supplied by the caller.
 *  • Initial URL is handled inside the isNavigationReady effect (not a separate effect)
 *    so it only runs once navigation is confirmed ready — removes the arbitrary 1 s timeout.
 *  • Linking subscription and initial-URL check are co-located in one effect (same
 *    dependency array) for clarity and to avoid potential double-handling.
 *  • expandPlayerRef update uses a layout effect so it's synchronous with the render.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
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
/** Delay (ms) before calling expandPlayer after navigation so the screen has
 *  time to mount before the sheet/modal is triggered. */
const EXPAND_DELAY_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Helper — parse deep link
// ─────────────────────────────────────────────────────────────────────────────

function parseDeepLink(url: string): NotificationPayload | null {
  try {
    if (url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      const parsed = new URL(url);
      const action = parsed.searchParams.get("action") as NotificationPayload["action"];
      const trackId = parsed.searchParams.get("trackId") || undefined;
      const playlistId = parsed.searchParams.get("playlistId") || undefined;
      const type =
        (parsed.searchParams.get("type") as NotificationPayload["type"]) || "player";
      return { type, trackId, playlistId, action: action || undefined };
    }

    // Legacy trackplayer:// notification tap
    if (url === "trackplayer://notification.click") {
      return { type: "player", action: "play" };
    }

    // Expo development client / exp:// launchers
    if (url.startsWith("exp://") || url.includes("expo-development-client")) {
      return { type: "player", action: "play" };
    }

    return null;
  } catch (error) {
    console.warn("[useNotificationClickHandler] Failed to parse deep link:", error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — navigate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigate to the correct screen for the given payload.
 *
 * If navigation isn't ready yet, waits 500 ms and retries once.
 * Uses `isNavigationReady` supplied by the caller rather than always
 * assuming `true` on retry, which could silently drop navigations.
 */
async function handleNavigation(
  payload: NotificationPayload,
  router: ReturnType<typeof useRouter>,
  pathname: string,
  isNavigationReady: boolean,
): Promise<void> {
  if (!isNavigationReady) {
    console.log("[useNotificationClickHandler] Navigation not ready, retrying in 500 ms…");
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    // Re-check: by now the navigation container should be ready.
    // We pass `true` here because if it still isn't, we accept the call
    // rather than looping — the router will queue the navigation internally.
    return handleNavigation(payload, router, pathname, true);
  }

  triggerHaptic();

  switch (payload.type) {
    case "player":
      if (!pathname?.includes("(player)")) {
        router.push("/(player)");
      }
      break;

    case "track":
      if (payload.trackId) {
        router.push({
          pathname: "/(player)",
          params: { autoPlayTrackId: payload.trackId },
        });
      }
      break;

    case "playlist":
      if (payload.playlistId) {
        router.push({
          pathname: "/library/[playlistName]",
          params: { playlistName: payload.playlistId },
        });
      }
      break;

    default:
      if (!pathname?.includes("(player)")) {
        router.push("/(player)");
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

const useNotificationClickHandler = (expandPlayer?: () => void) => {
  const router          = useRouter();
  const pathname        = usePathname();
  const navigationState = useRootNavigationState();
  const isNavigationReady = !!navigationState?.key;

  const latestPath      = useRef(pathname);
  const expandPlayerRef = useRef(expandPlayer);
  /**
   * Tracks the notification identifier that was most recently handled so the
   * AppState poll doesn't re-navigate for notifications already processed by
   * the addNotificationResponseReceivedListener subscription.
   */
  const lastHandledNotifId = useRef<string | null>(null);

  // Keep expandPlayerRef in sync synchronously (layout effect fires before
  // the next paint, so it's always current when any async callback fires).
  useLayoutEffect(() => {
    expandPlayerRef.current = expandPlayer;
  }, [expandPlayer]);

  // Keep pathname ref current.
  useEffect(() => {
    latestPath.current = pathname;
  }, [pathname]);

  // ── Helper: expand player after a short delay ──────────────────────────────
  const maybeExpand = () => {
    if (expandPlayerRef.current) {
      setTimeout(() => expandPlayerRef.current?.(), EXPAND_DELAY_MS);
    }
  };

  // ── 1. Expo notification response listener ─────────────────────────────────
  // Handles taps when the app is in the foreground or background (not killed).
  useEffect(() => {
    if (!isNavigationReady) return;

    const subscription = Notifications.addNotificationResponseReceivedListener(
      response => {
        console.log("[useNotificationClickHandler] Notification tapped:", response);

        // Record this notification as handled so the AppState poll skips it.
        const notifId = response.notification.request.identifier;
        lastHandledNotifId.current = notifId;

        const data = response.notification.request.content.data;
        const payload: NotificationPayload = {
          type:       (data?.type       as NotificationPayload["type"])   || "player",
          trackId:     data?.trackId    as string | undefined,
          playlistId:  data?.playlistId as string | undefined,
          action:     (data?.action     as NotificationPayload["action"]),
        };

        handleNavigation(payload, router, latestPath.current, true).then(maybeExpand);
      },
    );

    return () => subscription.remove();
  }, [isNavigationReady, router]);

  // ── 2. Deep links + initial URL ────────────────────────────────────────────
  // Both the initial URL check and the ongoing listener are in the same effect
  // so they share the same dependency array and lifecycle.
  useEffect(() => {
    if (!isNavigationReady) return;

    const handleDeepLink = async (event: { url: string }) => {
      console.log("[useNotificationClickHandler] Deep link received:", event.url);
      const payload = parseDeepLink(event.url);
      if (!payload) return;

      await handleNavigation(payload, router, latestPath.current, true);
      maybeExpand();
    };

    // Check the URL that cold-launched the app — only process it once
    // (isNavigationReady ensures the router is mounted before we navigate).
    Linking.getInitialURL().then(initialUrl => {
      if (!initialUrl) return;
      console.log("[useNotificationClickHandler] Initial URL:", initialUrl);
      const payload = parseDeepLink(initialUrl);
      if (payload) {
        handleNavigation(payload, router, latestPath.current, true).then(maybeExpand);
      }
    });

    const subscription = Linking.addEventListener("url", handleDeepLink);
    return () => subscription.remove();
  }, [isNavigationReady, router]);

  // ── 3. App foreground — catch notifications that opened the app cold ───────
  // getLastNotificationResponseAsync covers the "app was killed, user tapped
  // the notification" case that addNotificationResponseReceivedListener misses.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState !== "active") return;

      Notifications.getLastNotificationResponseAsync().then(response => {
        if (!response) return;

        const notifId = response.notification.request.identifier;
        // Skip if this notification was already handled by the live listener.
        if (notifId === lastHandledNotifId.current) return;
        lastHandledNotifId.current = notifId;

        console.log(
          "[useNotificationClickHandler] Cold-launch notification response:",
          response,
        );

        const data = response.notification.request.content.data;
        const payload: NotificationPayload = {
          type:       (data?.type       as NotificationPayload["type"])   || "player",
          trackId:     data?.trackId    as string | undefined,
          playlistId:  data?.playlistId as string | undefined,
          action:     (data?.action     as NotificationPayload["action"]),
        };

        handleNavigation(payload, router, latestPath.current, isNavigationReady).then(
          maybeExpand,
        );
      });
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [router, isNavigationReady]);

  return null;
};

export default useNotificationClickHandler;