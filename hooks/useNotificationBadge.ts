// hooks/useNotificationBadge.ts
import { useEffect, useState } from "react";
import { supabase } from "@/libs/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SEEN_KEY = "@mavin:seen_notifications";

interface NotificationRow {
  video_id: string;
}

export function useNotificationBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const checkUnreadCount = async () => {
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
        setCount(unread);
      } catch (err) {
        console.error("[Badge] Failed to check unread count:", err);
      }
    };
    checkUnreadCount();
    // Subscribe to realtime changes
    const channel = supabase
      .channel("notifications_badge")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        checkUnreadCount
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, []);

  return count;
}