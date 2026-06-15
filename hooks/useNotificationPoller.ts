// hooks/useNotificationPoller.ts
import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/libs/supabase";
import { getChannelFeed } from "@/modules/mavin-engine";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_POLL_KEY = "@mavin:last_notification_poll";
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface FeedItem {
  url: string;
  name: string;
  uploaderName: string;
  thumbnails: { url: string }[];
  duration: number;
  textualUploadDate: string;
}

interface OfficialChannel {
  name: string;
  channel_url: string;
}

export function useNotificationPoller() {
  const isPolling = useRef(false);

  const pollChannels = useCallback(async () => {
    if (isPolling.current) return;
    isPolling.current = true;

    try {
      // Check if we've polled recently
      const lastPoll = await AsyncStorage.getItem(LAST_POLL_KEY);
      const lastPollTime = lastPoll ? parseInt(lastPoll, 10) : 0;
      const now = Date.now();

      if (now - lastPollTime < POLL_INTERVAL_MS) {
        console.log("[Poller] Skipping — polled recently");
        return;
      }

      // Get active channels from Supabase
      const { data: channels, error } = await supabase
        .from("official_channels")
        .select("name, channel_url")
        .eq("active", true)
        .returns<OfficialChannel[]>();

      if (error || !channels?.length) {
        console.warn("[Poller] No channels to poll:", error?.message);
        return;
      }

      // Get last seen IDs from local storage
      const lastSeenRaw = await AsyncStorage.getItem("@mavin:last_seen_ids");
      const lastSeenMap: Record<string, string> = lastSeenRaw ? JSON.parse(lastSeenRaw) : {};

      const newLastSeenMap = { ...lastSeenMap };
      let totalNew = 0;

      for (const channel of channels) {
        try {
          console.log(`[Poller] Checking ${channel.name}...`);
          const feed = await getChannelFeed(channel.channel_url, 0);

          if (!feed.success || !feed.items?.length) {
            console.log(`[Poller] ${channel.name}: no items`);
            continue;
          }

          const items = feed.items as FeedItem[];
          const latestItem = items[0];
          const latestId = extractVideoId(latestItem.url);

          if (!latestId) continue;

          const previousId = lastSeenMap[channel.channel_url];

          // First time seeing this channel — just record the ID
          if (!previousId) {
            newLastSeenMap[channel.channel_url] = latestId;
            continue;
          }

          // Find all items newer than previousId
          const newItems: FeedItem[] = [];
          for (const item of items) {
            const vid = extractVideoId(item.url);
            if (vid === previousId) break;
            if (vid) newItems.push(item);
          }

          if (newItems.length > 0) {
            console.log(`[Poller] ${channel.name}: ${newItems.length} new item(s)`);

            // Insert into Supabase notifications table
            for (const item of newItems.reverse()) {
              const vid = extractVideoId(item.url);
              if (!vid) continue;

              const { error: insertError } = await (supabase as any)
                .from("notifications")
                .insert({
                  video_id: vid,
                  channel_name: channel.name,
                  channel_url: channel.channel_url,
                  title: item.name,
                  thumbnail_url: item.thumbnails?.[0]?.url || null,
                  duration: Math.round(item.duration || 0),
                  published_at: item.textualUploadDate
                    ? new Date(item.textualUploadDate).toISOString()
                    : new Date().toISOString(),
                })
                .select()
                .single();

              if (insertError && insertError.code !== "23505") {
                console.warn(`[Poller] Insert failed for ${vid}:`, insertError.message);
              }
            }

            totalNew += newItems.length;
          }

          // Update last seen to the absolute latest
          newLastSeenMap[channel.channel_url] = latestId;

        } catch (err: any) {
          console.warn(`[Poller] ${channel.name} failed:`, err.message);
        }
      }

      // Save state
      await AsyncStorage.setItem("@mavin:last_seen_ids", JSON.stringify(newLastSeenMap));
      await AsyncStorage.setItem(LAST_POLL_KEY, now.toString());

      console.log(`[Poller] Done. ${totalNew} new notifications.`);

    } catch (err: any) {
      console.error("[Poller] Fatal error:", err);
    } finally {
      isPolling.current = false;
    }
  }, []);

  useEffect(() => {
    pollChannels();
  }, [pollChannels]);

  return { pollChannels };
}

function extractVideoId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}