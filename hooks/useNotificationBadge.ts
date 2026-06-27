// hooks/useNotificationBadge.ts
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/libs/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SEEN_KEY = "@mavin:seen_notifications";

interface NotificationRow {
  video_id: string;
}

// Global references to prevent duplicate subscriptions
let globalChannel: any = null;
let globalSubscriptionActive = false;
let globalListeners: ((count: number) => void)[] = [];
let globalCount = 0;

export function useNotificationBadge() {
  const [count, setCount] = useState(0);
  const listenerRef = useRef<((count: number) => void) | null>(null);
  const isMounted = useRef(true);

  const checkUnreadCount = async () => {
    if (!isMounted.current) return;
    
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("video_id")
        .order("published_at", { ascending: false })
        .limit(100)
        .returns<NotificationRow[]>();
      
      if (error) throw error;
      
      const raw = await AsyncStorage.getItem(SEEN_KEY);
      const seen = raw ? new Set(JSON.parse(raw)) : new Set();
      const unread = (data || []).filter((d) => !seen.has(d.video_id)).length;
      
      globalCount = unread;
      
      if (isMounted.current) {
        setCount(unread);
      }
      
      // Notify all listeners
      globalListeners.forEach((listener) => listener(unread));
    } catch (err) {
      console.error("[Badge] Failed to check unread count:", err);
    }
  };

  const setupGlobalSubscription = async () => {
    // If already subscribed, just return
    if (globalSubscriptionActive && globalChannel) {
      console.log("[Badge] Subscription already active");
      return;
    }

    try {
      // Unsubscribe from existing channel if any
      if (globalChannel) {
        await globalChannel.unsubscribe();
        globalChannel = null;
        globalSubscriptionActive = false;
      }

      // Create channel with callback BEFORE subscribe
      globalChannel = supabase
        .channel("notifications_badge")
        .on(
          "postgres_changes",
          { 
            event: "INSERT", 
            schema: "public", 
            table: "notifications" 
          },
          () => {
            checkUnreadCount();
          }
        );

      // Subscribe to the channel
      await globalChannel.subscribe();
      globalSubscriptionActive = true;
      console.log("[Badge] Subscription established successfully");

      // Initial fetch
      await checkUnreadCount();
    } catch (error) {
      console.error("[Badge] Subscription error:", error);
      // Retry after a delay if it fails
      setTimeout(() => {
        if (!globalSubscriptionActive) {
          setupGlobalSubscription();
        }
      }, 5000);
    }
  };

  useEffect(() => {
    isMounted.current = true;

    // Create listener function
    const listener = (newCount: number) => {
      if (isMounted.current) {
        setCount(newCount);
      }
    };
    
    listenerRef.current = listener;
    globalListeners.push(listener);

    // Set initial count
    setCount(globalCount);

    // Setup subscription
    setupGlobalSubscription();

    // Cleanup
    return () => {
      isMounted.current = false;
      
      // Remove this listener from the global list
      if (listenerRef.current) {
        globalListeners = globalListeners.filter((l) => l !== listenerRef.current);
        listenerRef.current = null;
      }

      // Only cleanup the channel if there are no more listeners
      if (globalListeners.length === 0 && globalChannel) {
        globalChannel.unsubscribe().catch(() => {});
        globalChannel = null;
        globalSubscriptionActive = false;
      }
    };
  }, []);

  return count;
}