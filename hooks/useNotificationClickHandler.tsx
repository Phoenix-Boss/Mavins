// hooks/useNotificationClickHandler.tsx
/**
 * useNotificationClickHandler - expo-av version
 * 
 * Handles notification clicks for media playback controls.
 * For expo-av, we use expo-notifications and navigate to the player screen
 * when the notification is tapped.
 */

import { useEffect, useRef, useCallback } from "react";
import { Linking, Platform } from "react-native";
import {
  useRouter,
  usePathname,
  useRootNavigationState,
} from "expo-router";
import * as Notifications from "expo-notifications";

// Deep link URL for player
const PLAYER_DEEP_LINK = "mavins-player://player";
const NOTIFICATION_CLICK_URL = "trackplayer://notification.click";

/**
 * Hook that handles notification clicks and deep links
 * Navigates to the player screen when a media notification is tapped.
 * 
 * @example
 * useNotificationClickHandler();
 */
const useNotificationClickHandler = () => {
  const router = useRouter();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();

  const latestPath = useRef(pathname);
  const isNavigationReady = !!navigationState?.key;
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    latestPath.current = pathname;
  }, [pathname]);

  /**
   * Navigate to player screen safely
   */
  const navigateToPlayer = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    
    try {
      // If not already on player, navigate safely
      if (!latestPath.current?.includes("(player)") && 
          !latestPath.current?.includes("/player")) {
        router.push("/(player)");
      }
    } catch (error) {
      console.warn("[NotificationClickHandler] Navigation error:", error);
    } finally {
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 500);
    }
  }, [router]);

  // Handle deep link events (for Android and iOS)
  useEffect(() => {
    if (!isNavigationReady) return;

    const handleDeepLink = async ({ url }: { url: string }) => {
      console.log("[NotificationClickHandler] Deep link received:", url);
      
      if (url === PLAYER_DEEP_LINK || url === NOTIFICATION_CLICK_URL) {
        await navigateToPlayer();
      }
    };

    const subscription = Linking.addEventListener("url", handleDeepLink);
    
    // Check for initial URL on app start
    Linking.getInitialURL().then((url) => {
      if (url === PLAYER_DEEP_LINK || url === NOTIFICATION_CLICK_URL) {
        setTimeout(() => navigateToPlayer(), 500);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isNavigationReady, navigateToPlayer]);

  // Handle expo-notifications response (for lock screen and notification center)
  useEffect(() => {
    if (!isNavigationReady) return;

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const { data } = response.notification.request.content;
        
        console.log("[NotificationClickHandler] Notification response:", data);
        
        // Check if this is a media playback notification
        if (data?.type === "MEDIA_PLAYBACK" || data?.action) {
          navigateToPlayer();
        }
      }
    );

    // Also handle when app is opened from a notification while closed
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && response.notification.request.content.data?.type === "MEDIA_PLAYBACK") {
        setTimeout(() => navigateToPlayer(), 500);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isNavigationReady, navigateToPlayer]);

  // Register for remote notifications (Android media style)
  useEffect(() => {
    if (Platform.OS === "android") {
      // Set up notification channel for media playback
      Notifications.setNotificationChannelAsync("media_playback", {
        name: "Media Playback",
        importance: Notifications.AndroidImportance.HIGH,
        sound: undefined,
        vibrationPattern: undefined,
        lightColor: undefined,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        enableVibrate: false,
        showBadge: false,
      }).catch(console.warn);
    }
  }, []);
};

// Named export
export const useMediaNotificationHandler = useNotificationClickHandler;
export const useLockScreenControls = useNotificationClickHandler;

// Default export
export default useNotificationClickHandler;