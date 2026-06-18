// hooks/useNotificationPoller.ts
import { useEffect, useCallback, useRef, useState } from "react";
import { supabase } from "@/libs/supabase";
import { 
  getChannelInfo, 
  getChannelTabItems, 
  type StreamInfoItem, 
  type InfoItem 
} from "@/modules/mavin-engine";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_POLL_KEY = "@mavin:last_notification_poll";
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_AGE_DAYS = 90; // Only show videos from the last 90 days (3 months)
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

interface OfficialChannel {
  id?: string;
  name: string;
  channel_url: string;
}

export function useNotificationPoller() {
  const isPolling = useRef(false);
  const [lastPollResult, setLastPollResult] = useState<{ success: boolean; message: string; count: number } | null>(null);

  const pollChannels = useCallback(async (force = false) => {
    if (isPolling.current) {
      console.log("[Poller] Already running, skipping...");
      return;
    }
    isPolling.current = true;
    setLastPollResult(null);

    try {
      console.log(`[Poller] 🚀 Starting notification poll... (force=${force})`);
      
      // ─── Only check AsyncStorage if NOT forced ──────────────────────────
      if (!force) {
        const lastPoll = await AsyncStorage.getItem(LAST_POLL_KEY);
        const lastPollTime = lastPoll ? parseInt(lastPoll, 10) : 0;
        const now = Date.now();

        if (now - lastPollTime < POLL_INTERVAL_MS) {
          const msg = `✅ Polled recently at ${new Date(lastPollTime).toLocaleTimeString()}`;
          console.log(`[Poller] ${msg}`);
          setLastPollResult({ success: true, message: msg, count: 0 });
          return;
        }
      } else {
        console.log("[Poller] 🔥 Force refresh - bypassing 24h check");
      }

      // ─── Get active channels from Supabase ──────────────────────────────
      console.log("[Poller] 📡 Fetching active channels from Supabase...");
      const { data: channels, error } = await supabase
        .from("official_channels")
        .select("name, channel_url")
        .eq("active", true);

      if (error) {
        console.error("[Poller] ❌ Supabase error fetching channels:", error);
        setLastPollResult({ success: false, message: `DB Error: ${error.message}`, count: 0 });
        return;
      }

      if (!channels || channels.length === 0) {
        console.warn("[Poller] ⚠️ No active channels found in database!");
        setLastPollResult({ success: false, message: "No channels found", count: 0 });
        return;
      }

      console.log(`[Poller] 📊 Found ${channels.length} active channels`);

      // ─── Get last seen IDs from local storage ──────────────────────────
      const lastSeenRaw = await AsyncStorage.getItem("@mavin:last_seen_ids");
      const lastSeenMap: Record<string, string> = lastSeenRaw ? JSON.parse(lastSeenRaw) : {};
      console.log(`[Poller] 📖 Last seen map has ${Object.keys(lastSeenMap).length} entries`);

      const newLastSeenMap = { ...lastSeenMap };
      let totalNew = 0;
      let totalChannelsProcessed = 0;
      let channelsWithErrors = 0;

      // ─── For each channel, fetch its videos ──────────────────────────────
      for (const channel of channels) {
        try {
          totalChannelsProcessed++;
          console.log(`\n[Poller] 🔍 [${totalChannelsProcessed}/${channels.length}]: ${channel.name}`);
          console.log(`[Poller] 🔗 URL: ${channel.channel_url}`);

          let streamItems: StreamInfoItem[] = [];
          
          // ─── Try method 1: getChannelTabItems with "videos" tab ──────────
          try {
            console.log(`[Poller] 📡 Fetching videos tab for ${channel.name}...`);
            const tabResult = await getChannelTabItems(channel.channel_url, "videos", undefined, 0);
            
            if (tabResult.success && tabResult.items && tabResult.items.length > 0) {
              const items = tabResult.items as InfoItem[];
              streamItems = items.filter((item): item is StreamInfoItem => 
                (item as any).type === 'stream' || 
                (item as any).uploaderName !== undefined
              );
              console.log(`[Poller] 📝 ${channel.name}: found ${streamItems.length} videos via tab`);
            }
          } catch (tabErr: any) {
            console.log(`[Poller] ⚠️ Tab fetch failed for ${channel.name}: ${tabErr?.message || 'unknown'}`);
          }

          // ─── Try method 2: getChannelInfo and extract from tabs ──────────
          if (streamItems.length === 0) {
            try {
              console.log(`[Poller] 📡 Fetching channel info for ${channel.name}...`);
              const channelInfo = await getChannelInfo(channel.channel_url, 0);
              
              if (channelInfo.success && channelInfo.tabs && channelInfo.tabs.length > 0) {
                const videosTab = channelInfo.tabs.find(t => 
                  t.name === 'videos' || 
                  t.contentFilters.includes('videos')
                );
                
                if (videosTab && videosTab.url) {
                  console.log(`[Poller] 📡 Fetching videos from tab URL: ${videosTab.url}`);
                  const tabResult = await getChannelTabItems(videosTab.url, "videos", undefined, 0);
                  
                  if (tabResult.success && tabResult.items && tabResult.items.length > 0) {
                    const items = tabResult.items as InfoItem[];
                    streamItems = items.filter((item): item is StreamInfoItem => 
                      (item as any).type === 'stream' || 
                      (item as any).uploaderName !== undefined
                    );
                    console.log(`[Poller] 📝 ${channel.name}: found ${streamItems.length} videos via channel info`);
                  }
                }
              }
            } catch (infoErr: any) {
              console.log(`[Poller] ⚠️ Channel info failed for ${channel.name}: ${infoErr?.message || 'unknown'}`);
            }
          }

          // ─── Try method 3: Use a search fallback ──────────────────────────
          if (streamItems.length === 0) {
            try {
              console.log(`[Poller] 📡 Trying search fallback for ${channel.name}...`);
              const searchQuery = `${channel.name} official`;
              const { search } = await import('@/modules/mavin-engine');
              const searchResult = await search(searchQuery, 'videos', undefined, 0);
              
              if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
                const items = searchResult.results as InfoItem[];
                const channelItems = items.filter((item): item is StreamInfoItem => {
                  const streamItem = item as StreamInfoItem;
                  return (item as any).type === 'stream' && 
                         streamItem.uploaderName && 
                         streamItem.uploaderName.toLowerCase().includes(channel.name.toLowerCase());
                });
                
                if (channelItems.length > 0) {
                  streamItems = channelItems;
                  console.log(`[Poller] 📝 ${channel.name}: found ${streamItems.length} videos via search`);
                }
              }
            } catch (searchErr: any) {
              console.log(`[Poller] ⚠️ Search fallback failed for ${channel.name}: ${searchErr?.message || 'unknown'}`);
            }
          }

          if (streamItems.length === 0) {
            console.log(`[Poller] 📭 ${channel.name}: no videos found`);
            channelsWithErrors++;
            continue;
          }

          // ─── Filter and sort by date ──────────────────────────────────────
          const now = Date.now();
          const filteredItems = streamItems.filter((item) => {
            const date = parseDateString(item.textualUploadDate);
            if (date === 0) return false;
            const age = now - date;
            return age <= MAX_AGE_MS; // Only keep videos from last 3 months
          });

          if (filteredItems.length === 0) {
            console.log(`[Poller] 📭 ${channel.name}: no videos from last ${MAX_AGE_DAYS} days`);
            continue;
          }

          // Sort by date (newest first)
          const sortedItems = [...filteredItems].sort((a, b) => {
            const dateA = parseDateString(a.textualUploadDate);
            const dateB = parseDateString(b.textualUploadDate);
            return dateB - dateA;
          });

          console.log(`[Poller] 📝 ${channel.name}: ${sortedItems.length} videos from last ${MAX_AGE_DAYS} days`);

          const latestItem = sortedItems[0];
          const latestId = extractVideoId(latestItem.url);
          
          console.log(`[Poller] 🎬 Latest: ${latestItem.name}`);
          console.log(`[Poller] 🆔 Latest ID: ${latestId}`);
          console.log(`[Poller] 📅 Latest date: ${latestItem.textualUploadDate}`);

          if (!latestId) {
            console.warn(`[Poller] ⚠️ ${channel.name}: could not extract video ID`);
            continue;
          }

          const previousId = lastSeenMap[channel.channel_url];
          console.log(`[Poller] 🔄 previousId=${previousId || 'none'}`);

          // ─── First time or force refresh ─────────────────────────────────
          if (!previousId || force) {
            console.log(`[Poller] 🆕 ${channel.name}: ${previousId ? 'force refresh' : 'first time'}, backfilling up to 10 items...`);
            newLastSeenMap[channel.channel_url] = latestId;
            
            const itemsToBackfill = sortedItems.slice(0, Math.min(10, sortedItems.length));
            let backfilled = 0;
            
            for (const item of itemsToBackfill) {
              const vid = extractVideoId(item.url);
              if (!vid) continue;
              const inserted = await insertNotification(item, channel);
              if (inserted) backfilled++;
            }
            
            if (backfilled > 0) {
              totalNew += backfilled;
              console.log(`[Poller] ✅ ${channel.name}: backfilled ${backfilled} videos`);
            }
            continue;
          }

          // ─── Find items newer than previousId ────────────────────────────
          const newItems: StreamInfoItem[] = [];
          let foundPrevious = false;
          
          for (const item of sortedItems) {
            const vid = extractVideoId(item.url);
            if (vid === previousId) {
              foundPrevious = true;
              break;
            }
            if (vid) {
              newItems.push(item);
            }
          }

          if (!foundPrevious && sortedItems.length > 0) {
            console.log(`[Poller] ⚠️ ${channel.name}: previous ID not found, backfilling latest items...`);
            newLastSeenMap[channel.channel_url] = latestId;
            
            const itemsToBackfill = sortedItems.slice(0, Math.min(10, sortedItems.length));
            let backfilled = 0;
            
            for (const item of itemsToBackfill) {
              const vid = extractVideoId(item.url);
              if (!vid) continue;
              const inserted = await insertNotification(item, channel);
              if (inserted) backfilled++;
            }
            
            if (backfilled > 0) {
              totalNew += backfilled;
              console.log(`[Poller] ✅ ${channel.name}: backfilled ${backfilled} videos`);
            }
            continue;
          }

          if (newItems.length > 0) {
            console.log(`[Poller] 🆕 ${channel.name}: ${newItems.length} new item(s) since last poll`);
            for (const item of newItems.reverse()) {
              const inserted = await insertNotification(item, channel);
              if (inserted) totalNew++;
            }
          } else {
            console.log(`[Poller] ✅ ${channel.name}: no new items`);
          }

          newLastSeenMap[channel.channel_url] = latestId;

        } catch (err: any) {
          console.error(`[Poller] ❌ ${channel.name} failed:`, err.message);
          channelsWithErrors++;
        }
      }

      // ─── Save state ─────────────────────────────────────────────────────
      await AsyncStorage.setItem("@mavin:last_seen_ids", JSON.stringify(newLastSeenMap));
      
      // Only update the poll timestamp if not forced
      if (!force) {
        await AsyncStorage.setItem(LAST_POLL_KEY, Date.now().toString());
      }

      const msg = `✅ Processed ${totalChannelsProcessed} channels, ${channelsWithErrors} errors, inserted ${totalNew} new notifications`;
      console.log(`[Poller] ${msg}`);
      setLastPollResult({ success: true, message: msg, count: totalNew });

      // ─── Verify the insert worked ──────────────────────────────────────
      const { data: verify, error: verifyError } = await supabase
        .from("notifications")
        .select("count", { count: "exact", head: true });
      
      if (verifyError) {
        console.error("[Poller] ❌ Failed to verify insert:", verifyError);
      } else {
        console.log(`[Poller] 📊 Total notifications in database: ${verify?.count || 0}`);
      }

    } catch (err: any) {
      console.error("[Poller] 💥 Fatal error:", err);
      setLastPollResult({ success: false, message: `Fatal: ${err.message}`, count: 0 });
    } finally {
      isPolling.current = false;
    }
  }, []);

  const insertNotification = async (item: StreamInfoItem, channel: OfficialChannel): Promise<boolean> => {
    const vid = extractVideoId(item.url);
    if (!vid) {
      console.warn(`[Poller] ⚠️ Could not extract video ID from: ${item.url}`);
      return false;
    }

    try {
      // Check if this video already exists
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("video_id", vid)
        .maybeSingle();

      if (existing) {
        console.log(`[Poller] ⏭️ ${vid} already exists, skipping`);
        return true;
      }

      // Get the best thumbnail
      let thumbnailUrl = item.thumbnails?.[0]?.url || null;
      if (item.thumbnails) {
        const medium = item.thumbnails.find(t => t.resolutionLevel === 'MEDIUM' || t.resolutionLevel === 'HIGH');
        if (medium) thumbnailUrl = medium.url;
      }

      const duration = Math.round(item.duration || 0);

      // ─── Parse the date string ──────────────────────────────────────────────
      let publishedDate = new Date();
      
      if (item.textualUploadDate) {
        const parsedDate = parseDateString(item.textualUploadDate);
        if (parsedDate > 0) {
          publishedDate = new Date(parsedDate);
        } else {
          const relativeDate = parseRelativeDate(item.textualUploadDate);
          if (relativeDate) {
            publishedDate = relativeDate;
          }
        }
      }

      // Validate the date is within the last 3 months
      const now = Date.now();
      if (isNaN(publishedDate.getTime()) || (now - publishedDate.getTime()) > MAX_AGE_MS) {
        console.log(`[Poller] ⏭️ ${vid} is older than ${MAX_AGE_DAYS} days, skipping`);
        return true; // Skip old videos
      }

      console.log(`[Poller] 📝 Inserting: ${item.name} (${vid})`);
      console.log(`[Poller] 📝 Channel: ${channel.name}`);
      console.log(`[Poller] 📝 Date: ${item.textualUploadDate} → ${publishedDate.toISOString()}`);

      const { error: insertError } = await supabase
        .from("notifications")
        .insert({
          video_id: vid,
          channel_name: channel.name,
          channel_url: channel.channel_url,
          title: item.name || "Untitled",
          thumbnail_url: thumbnailUrl,
          duration: duration,
          published_at: publishedDate.toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          return true;
        }
        console.error(`[Poller] ❌ Insert failed for ${vid}:`, insertError.message);
        return false;
      }
      
      console.log(`[Poller] ✅ Inserted: ${item.name?.substring(0, 40) || 'Untitled'}... (${vid})`);
      return true;
    } catch (err) {
      console.error(`[Poller] ❌ Insert exception for ${vid}:`, err);
      return false;
    }
  };

  useEffect(() => {
    console.log("[Poller] 🔄 Hook mounted, starting initial poll...");
    const timer = setTimeout(() => {
      pollChannels(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return { pollChannels, lastPollResult };
}

// ─── Date parsing helpers ──────────────────────────────────────────────────

function parseRelativeDate(relativeStr: string): Date | null {
  if (!relativeStr) return null;
  
  const now = new Date();
  const lower = relativeStr.toLowerCase().trim();
  
  const match = lower.match(/(\d+)\s*(year|month|week|day|hour|minute|second)s?\s*ago/);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  const date = new Date(now);
  switch (unit) {
    case 'year':
      date.setFullYear(date.getFullYear() - value);
      break;
    case 'month':
      date.setMonth(date.getMonth() - value);
      break;
    case 'week':
      date.setDate(date.getDate() - value * 7);
      break;
    case 'day':
      date.setDate(date.getDate() - value);
      break;
    case 'hour':
      date.setHours(date.getHours() - value);
      break;
    case 'minute':
      date.setMinutes(date.getMinutes() - value);
      break;
    case 'second':
      date.setSeconds(date.getSeconds() - value);
      break;
    default:
      return null;
  }
  
  return date;
}

function parseDateString(dateStr: string): number {
  if (!dateStr) return 0;
  
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.getTime();
  }
  
  const relativeDate = parseRelativeDate(dateStr);
  if (relativeDate && !isNaN(relativeDate.getTime())) {
    return relativeDate.getTime();
  }
  
  return 0;
}

function extractVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}