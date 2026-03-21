import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import {
  useRouter,
  usePathname,
  useRootNavigationState,
} from "expo-router";

const useNotificationClickHandler = () => {
  const router = useRouter();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();

  const latestPath = useRef(pathname);
  const isNavigationReady = !!navigationState?.key;

  useEffect(() => {
    latestPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!isNavigationReady) return;

    const handleDeepLink = async (event: { url: string }) => {
      const { url } = event;

      if (url === "trackplayer://notification.click") {
        try {
          // If not already on player, navigate safely
          if (!latestPath.current?.includes("(player)")) {
            router.push("/(player)");
          }
        } catch (error) {
          console.warn("Navigation error:", error);
        }
      }
    };

    const subscription = Linking.addEventListener("url", handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, [isNavigationReady, router]);
};

export default useNotificationClickHandler;