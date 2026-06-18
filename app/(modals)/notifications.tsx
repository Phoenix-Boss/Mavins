// app/(modals)/notifications.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
  Pressable,
  FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useAlert } from "@/contexts/AlertContext";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { supabase } from "@/libs/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNotificationPoller } from "@/hooks/useNotificationPoller";
import { SkeletonLoader, SkeletonList } from "@/components/common/SkeletonLoader";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  video_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string | null;
  duration: number | null;
  published_at: string;
  created_at: string;
  type?: "youtube";
}

interface TrendingItem {
  id: string;
  title: string;
  description: string;
  source: string;
  published_at: string;
  thumbnail_url: string | null;
  type: "trending";
  content_type: "music" | "video" | "other";
  view_count?: number;
  duration_seconds?: number;
}

type TabKey = "all" | "music" | "video" | "mavin";

type FeedItem =
  | (NotificationRow & { type: "youtube" })
  | TrendingItem;

// ─── Constants ────────────────────────────────────────────────────────────────

const SEEN_KEY = "@mavin:seen_notifications";
const SEEN_TRENDING_KEY = "@mavin:seen_trending";
const MAX_DISPLAY_PER_SECTION = 5; // Show only 5 items per section in "All" tab

const FETCH_REGIONS = ["NG", "US", "GB", "IN", "ZA", "GH", "CA", "AU", "JP", "DE"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function parseDuration(pt: string): number {
  if (!pt) return 0;
  const match = pt.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

function classifyContent(
  title: string,
  channelTitle: string,
  durationSeconds: number
): "music" | "video" | "other" {
  const t = title.toLowerCase();
  const c = channelTitle.toLowerCase();
  const combined = `${t} ${c}`;

  if (durationSeconds > 1200) return "other";

  const nonMusicSignals = [
    "minecraft", "roblox", "fortnite", "valorant", "pokemon", "gaming",
    "gameplay", "stream", "twitch", "reaction", "react to", "reacts",
    "challenge", "hide and seek", "among us", "gta", "call of duty",
    "warzone", "apex legends", "elden ring", "rust ", "overwatch",
    "dead by daylight", "raid:", "mmorpg", "let's play",
    "honest trailer", "trailer breakdown", "trailer reaction",
    "review", "breakdown",
    "podcast", "episode", "ep.", "vlog", "day in",
    "shrek", "disney", "marvel", "spider-man", "avengers",
    "star wars", "star trek", "netflix", "hbo", "paramount",
    "film", " movie", "teaser trailer", "official trailer",
    "season ", "series", "episode",
  ];
  if (nonMusicSignals.some((kw) => combined.includes(kw))) return "other";

  const mvSignals = [
    "official music video", "official video", "(official video)",
    "official mv", "music video", " mv)", "(mv)", "video clip",
    "official visual", "vevo", "directed by",
  ];
  if (mvSignals.some((kw) => combined.includes(kw))) return "video";

  const musicSignals = [
    "official audio", "(audio)", "lyrics", "letra", "lyric video",
    "official lyric", "audio only", "visualizer", "official visualizer",
    "provided to youtube",
  ];
  if (musicSignals.some((kw) => combined.includes(kw))) return "music";

  const musicChannelPatterns = [
    "records", " music", "vevo", "entertainment", "official", "hiphop",
    "rap", "reggaeton", "latin", "afrobeats", "afro", "naija",
  ];
  if (musicChannelPatterns.some((kw) => c.includes(kw))) {
    if (durationSeconds > 0 && durationSeconds <= 480) return "music";
  }

  if (durationSeconds > 0 && durationSeconds <= 480) return "music";

  return "other";
}

async function getSeenIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw));
}

async function getSeenTrendingIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_TRENDING_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw));
}

async function markSeen(videoId: string) {
  const seen = await getSeenIds();
  seen.add(videoId);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

async function markTrendingSeen(id: string) {
  const seen = await getSeenTrendingIds();
  seen.add(id);
  await AsyncStorage.setItem(SEEN_TRENDING_KEY, JSON.stringify([...seen]));
}

async function markAllSeen(videoIds: string[]) {
  const seen = await getSeenIds();
  videoIds.forEach((id) => seen.add(id));
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

async function markAllTrendingSeen(ids: string[]) {
  const seen = await getSeenTrendingIds();
  ids.forEach((id) => seen.add(id));
  await AsyncStorage.setItem(SEEN_TRENDING_KEY, JSON.stringify([...seen]));
}

// ─── Global Trending Fetch ──────────────────────────────────────────────────

async function fetchGlobalTrending(): Promise<TrendingItem[]> {
  try {
    const results = await Promise.allSettled(
      FETCH_REGIONS.map(async (regionCode) => {
        try {
          const response = await fetch(
            `https://trendgetter.vercel.app/api/youtube/videos?region_code=${regionCode}&limit=50`,
            { signal: createTimeoutSignal(15000) }
          );
          if (!response.ok) return [];
          const json = await response.json();
          if (!json.data || !Array.isArray(json.data)) return [];

          const items: TrendingItem[] = [];

          for (const video of json.data) {
            const title: string = video.title || "";
            const channelTitle: string = video.channel_title || "";
            const viewCount: number =
              typeof video.statistics?.view_count === "string"
                ? parseInt(video.statistics.view_count, 10)
                : video.statistics?.view_count || 0;

            if (viewCount < 50000) continue;

            const durationPt: string = video.details?.duration || "";
            const durationSeconds = parseDuration(durationPt);

            const contentType = classifyContent(title, channelTitle, durationSeconds);

            if (contentType === "other") continue;

            let derivedId: string = "";
            if (video.video_id) {
              derivedId = video.video_id;
            } else if (video.url) {
              const match = video.url.match(/[?&]v=([^&]+)/);
              if (match) derivedId = match[1];
            }
            if (!derivedId) {
              derivedId = `${channelTitle}__${title}`
                .replace(/[^a-zA-Z0-9]/g, "_")
                .substring(0, 60);
            }

            const isRealYtId = /^[a-zA-Z0-9_-]{11}$/.test(derivedId);
            const thumbnailUrl: string | null = video.thumbnail_url
              ? video.thumbnail_url
              : isRealYtId
              ? `https://img.youtube.com/vi/${derivedId}/mqdefault.jpg`
              : null;

            items.push({
              id: `trending_${regionCode}_${derivedId}`,
              title: title || "Untitled",
              description: video.description?.substring(0, 120) || "",
              source: channelTitle || "Music Channel",
              published_at: video.date || new Date().toISOString(),
              thumbnail_url: thumbnailUrl,
              type: "trending" as const,
              content_type: contentType,
              view_count: viewCount,
              duration_seconds: durationSeconds,
            });
          }
          return items;
        } catch (err) {
          console.warn(`[Notifications] Region ${regionCode} failed:`, err);
          return [];
        }
      })
    );

    const seenKeys = new Set<string>();
    const all: TrendingItem[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          const dedupeKey = `${item.source}__${item.title}`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            all.push(item);
          }
        }
      }
    }

    console.log(`[Notifications] Fetched ${all.length} unique trending music/video items`);
    return all.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  } catch (error) {
    console.error("[Notifications] Global trending fetch failed:", error);
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "all",   label: "All",   icon: "apps-outline" },
  { key: "music", label: "Music", icon: "musical-note-outline" },
  { key: "video", label: "Video", icon: "play-outline" },
  { key: "mavin", label: "Mavin", icon: "radio-outline" },
];

export default function NotificationsModal() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { showAlert, showDestructiveAlert } = useAlert();
  const { playAudio, expandPlayer } = useMusicPlayer();

  const { pollChannels, lastPollResult } = useNotificationPoller();

  const [mavinNotifications, setMavinNotifications] = useState<NotificationRow[]>([]);
  const [trendingItems, setTrendingItems] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [seenTrendingIds, setSeenTrendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  // ─── Fetch Mavin channel notifications ───────────────────────────────────

  const fetchMavinNotifications = useCallback(async () => {
    try {
      setError(null);
      const { data, error: supaError } = await supabase
        .from("notifications")
        .select("*")
        .order("published_at", { ascending: false });
      if (supaError) throw supaError;
      setMavinNotifications((data || []) as NotificationRow[]);
    } catch (err: any) {
      setError(err?.message || "Failed to load channel notifications");
    }
  }, []);

  // ─── Fetch global trending ────────────────────────────────────────────────

  const fetchTrending = useCallback(async () => {
    try {
      const items = await fetchGlobalTrending();
      setTrendingItems(items);
    } catch (err: any) {
      console.error("[Notifications] Global trending fetch failed:", err);
    }
  }, []);

  // ─── Load all ─────────────────────────────────────────────────────────────

  const loadAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchMavinNotifications(), fetchTrending()]);
    const [seen, seenTr] = await Promise.all([getSeenIds(), getSeenTrendingIds()]);
    setSeenIds(seen);
    setSeenTrendingIds(seenTr);
    setLoading(false);
    setRefreshing(false);
  }, [fetchMavinNotifications, fetchTrending]);

  // ─── Background refresh (no loading spinner) ─────────────────────────────

  const backgroundRefresh = useCallback(async () => {
    console.log("[Notifications] 🔄 Background refresh started");
    try {
      // Fetch in background without setting loading state
      await Promise.all([fetchMavinNotifications(), fetchTrending()]);
      const [seen, seenTr] = await Promise.all([getSeenIds(), getSeenTrendingIds()]);
      setSeenIds(seen);
      setSeenTrendingIds(seenTr);
      console.log("[Notifications] ✅ Background refresh completed");
    } catch (err) {
      console.error("[Notifications] Background refresh failed:", err);
    }
  }, [fetchMavinNotifications, fetchTrending]);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  // ─── Mark all read ────────────────────────────────────────────────────────

  const handleMarkAllRead = useCallback(async () => {
    await Promise.all([
      markAllSeen(mavinNotifications.map((n) => n.video_id)),
      markAllTrendingSeen(trendingItems.map((n) => n.id)),
    ]);
    setSeenIds(await getSeenIds());
    setSeenTrendingIds(await getSeenTrendingIds());
  }, [mavinNotifications, trendingItems]);

  // ─── Handle Mavin channel press ──────────────────────────────────────────

  const handleMavinPress = useCallback(
    async (item: NotificationRow) => {
      await markSeen(item.video_id);
      setSeenIds((prev) => new Set([...prev, item.video_id]));

      try {
        playAudio({
          id: item.video_id,
          title: item.title,
          artist: item.channel_name,
          thumbnail: item.thumbnail_url || "",
          url: `https://www.youtube.com/watch?v=${item.video_id}`,
          duration: item.duration || 0,
          videoId: item.video_id,
        } as any);
        expandPlayer();
      } catch (err: any) {
        console.error("[Notifications] Mavin playback failed:", err);
        showDestructiveAlert("Playback Error", err.message || "Could not load this track.");
      }
    },
    [playAudio, expandPlayer, showDestructiveAlert]
  );

  // ─── Handle trending press ───────────────────────────────────────────────

  const handleTrendingPress = useCallback(
    async (item: TrendingItem) => {
      await markTrendingSeen(item.id);
      setSeenTrendingIds((prev) => new Set([...prev, item.id]));

      showAlert(item.source, item.title, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Play on Mavin",
          onPress: async () => {
            try {
              playAudio({
                id: item.id,
                title: item.title,
                artist: item.source,
                thumbnail: item.thumbnail_url || "",
                url: `https://www.youtube.com/results?search_query=${encodeURIComponent(
                  `${item.title} ${item.source}`
                )}`,
                duration: item.duration_seconds || 0,
              } as any);
              expandPlayer();
            } catch (err: any) {
              console.error("[Notifications] Trending playback failed:", err);
              showDestructiveAlert("Playback Error", err.message || "Could not load this track.");
            }
          },
        },
      ]);
    },
    [showAlert, showDestructiveAlert, playAudio, expandPlayer]
  );

  // ─── Mavin feed: latest 2 per channel ────────────────────────────────────

  const mavinFeed = useMemo((): (NotificationRow & { type: "youtube" })[] => {
    const groupedByChannel = new Map<string, (NotificationRow & { type: "youtube" })[]>();

    for (const n of mavinNotifications) {
      const item = { ...n, type: "youtube" as const };
      const key = n.channel_name;
      if (!groupedByChannel.has(key)) groupedByChannel.set(key, []);
      groupedByChannel.get(key)!.push(item);
    }

    const result: (NotificationRow & { type: "youtube" })[] = [];
    for (const [, items] of groupedByChannel) {
      result.push(...items.slice(0, 2));
    }

    return result.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }, [mavinNotifications]);

  const musicFeed = useMemo(
    (): TrendingItem[] => trendingItems.filter((t) => t.content_type === "music"),
    [trendingItems]
  );

  const videoFeed = useMemo(
    (): TrendingItem[] => trendingItems.filter((t) => t.content_type === "video"),
    [trendingItems]
  );

  // ─── Limited feeds for "All" tab (only 5 items per section) ────────────

  const limitedMavinFeed = useMemo(
    () => mavinFeed.slice(0, MAX_DISPLAY_PER_SECTION),
    [mavinFeed]
  );

  const limitedMusicFeed = useMemo(
    () => musicFeed.slice(0, MAX_DISPLAY_PER_SECTION),
    [musicFeed]
  );

  const limitedVideoFeed = useMemo(
    () => videoFeed.slice(0, MAX_DISPLAY_PER_SECTION),
    [videoFeed]
  );

  const activeFeed = useMemo((): FeedItem[] => {
    if (activeTab === "music") return musicFeed;
    if (activeTab === "video") return videoFeed;
    if (activeTab === "mavin") return mavinFeed;
    return [];
  }, [activeTab, musicFeed, videoFeed, mavinFeed]);

  // ─── Unread counts ────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const mavinUnread = mavinNotifications.filter((n) => !seenIds.has(n.video_id)).length;
    const musicUnread = musicFeed.filter((n) => !seenTrendingIds.has(n.id)).length;
    const videoUnread = videoFeed.filter((n) => !seenTrendingIds.has(n.id)).length;
    const allUnread = mavinUnread + musicUnread + videoUnread;
    return { all: allUnread, music: musicUnread, video: videoUnread, mavin: mavinUnread };
  }, [mavinNotifications, musicFeed, videoFeed, seenIds, seenTrendingIds]);

  const isUnread = useCallback(
    (item: FeedItem): boolean => {
      if (item.type === "youtube") return !seenIds.has((item as NotificationRow).video_id);
      return !seenTrendingIds.has(item.id);
    },
    [seenIds, seenTrendingIds]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAllData();
  }, [loadAllData]);

  // ─── Force poll (manual refresh - background) ───────────────────────────

  const handleForcePoll = useCallback(async () => {
    if (isPolling) return;
    setIsPolling(true);
    console.log("🔧 Manual force poll triggered (background)");
    try {
      // Don't show loading spinner - just fetch in background
      await pollChannels(true);
      await backgroundRefresh();
    } catch (err) {
      console.error("Manual poll failed:", err);
    } finally {
      setIsPolling(false);
    }
  }, [pollChannels, backgroundRefresh, isPolling]);

  // ─── Gradient ─────────────────────────────────────────────────────────────

  const gradientColors: [string, string, string] = isDark
    ? ["#0A0A0A", "#0D0B06", "#000000"]
    : ["#E8F0F8", "#EDE8D8", "#E8F0F8"];

  // ─── Render single card (no visible borders, gradient background) ───────

  const renderCard = useCallback(
    (item: FeedItem, index: number) => {
      const unread = isUnread(item);
      const isMavin = item.type === "youtube";

      // Transparent gradient background - no visible card borders
      const bgColor = isDark
        ? isMavin ? "rgba(212,175,55,0.06)" : "rgba(255,255,255,0.03)"
        : isMavin ? "rgba(212,175,55,0.07)" : "rgba(255,255,255,0.4)";

      const borderColor = unread
        ? `${colors.gold}40`
        : "transparent";

      const thumbUri = isMavin
        ? (item as NotificationRow).thumbnail_url
        : (item as TrendingItem).thumbnail_url;

      const title = isMavin
        ? (item as NotificationRow).title
        : (item as TrendingItem).title;

      const sourceLine = isMavin
        ? (item as NotificationRow).channel_name
        : (item as TrendingItem).source;

      const time = item.published_at;
      const isVideo = !isMavin && (item as TrendingItem).content_type === "video";

      return (
        <Pressable
          key={`${item.type}_${item.id}_${index}`}
          style={({ pressed }) => [
            styles.card,
            { opacity: pressed ? 0.7 : 1 }
          ]}
          onPress={() =>
            isMavin
              ? handleMavinPress(item as NotificationRow)
              : handleTrendingPress(item as TrendingItem)
          }
        >
          <View style={[styles.cardInner, { backgroundColor: bgColor, borderColor }]}>
            {unread && (
              <View style={[styles.unreadStrip, { backgroundColor: colors.gold }]} />
            )}

            {!unread && <View style={styles.noStripPad} />}

            {thumbUri ? (
              <Image source={{ uri: thumbUri }} style={styles.thumbnail} resizeMode="cover" />
            ) : (
              <View style={[styles.thumbPlaceholder, { backgroundColor: `${colors.gold}15` }]}>
                <Ionicons
                  name={isMavin ? "musical-note" : isVideo ? "play" : "musical-notes-outline"}
                  size={18}
                  color={colors.gold}
                />
              </View>
            )}

            <View style={styles.cardContent}>
              <View style={styles.cardTopRow}>
                {isMavin ? (
                  <Ionicons name="radio-outline" size={11} color={colors.gold} />
                ) : isVideo ? (
                  <Ionicons name="play-circle-outline" size={11} color={colors.textMuted} />
                ) : (
                  <Ionicons name="musical-note-outline" size={11} color={colors.textMuted} />
                )}
                <Text
                  style={[
                    styles.cardSource,
                    { color: isMavin ? colors.gold : isDark ? colors.textSub : colors.textMuted },
                  ]}
                  numberOfLines={1}
                >
                  {sourceLine}
                </Text>
                {isVideo && (
                  <View style={[styles.contentTypeBadge, { backgroundColor: `${colors.gold}22` }]}>
                    <Text style={[styles.contentTypeBadgeText, { color: colors.gold }]}>MV</Text>
                  </View>
                )}
                <Text style={[styles.cardTime, { color: colors.textMuted }]}>
                  {formatRelativeTime(time)}
                </Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                {title}
              </Text>
            </View>

            <Ionicons
              name={isMavin ? "play-circle-outline" : "chevron-forward"}
              size={isMavin ? 22 : 16}
              color={isMavin ? colors.gold : colors.textMuted}
              style={styles.cardAction}
            />
          </View>
        </Pressable>
      );
    },
    [colors, isDark, handleMavinPress, handleTrendingPress, isUnread]
  );

  // ─── Section subheader ────────────────────────────────────────────────────

  const SectionHeader = ({ label, icon, count, showViewAll = false }: { 
    label: string; 
    icon: string; 
    count: number;
    showViewAll?: boolean;
  }) => (
    <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
      <Ionicons name={icon as any} size={13} color={colors.gold} />
      <Text style={[styles.sectionLabel, { color: colors.gold }]}>{label}</Text>
      <Text style={[styles.sectionCount, { color: colors.textMuted }]}>({count})</Text>
      {showViewAll && count > MAX_DISPLAY_PER_SECTION && (
        <TouchableOpacity 
          onPress={() => setActiveTab(
            label === 'Mavin Channels' ? 'mavin' : 
            label === 'Trending Music' ? 'music' : 'video'
          )}
          style={styles.viewAllBtn}
        >
          <Text style={[styles.viewAllText, { color: colors.gold }]}>View All</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ─── All-tab feed with section headers (limited to 5 per section) ──────

  const renderAllFeed = () => {
    const nodes: React.ReactNode[] = [];

    if (limitedMavinFeed.length > 0) {
      nodes.push(
        <SectionHeader
          key="hdr_mavin"
          label="Mavin Channels"
          icon="radio-outline"
          count={mavinFeed.length}
          showViewAll={mavinFeed.length > MAX_DISPLAY_PER_SECTION}
        />
      );
      limitedMavinFeed.forEach((item, i) => nodes.push(renderCard(item, i)));
    }

    if (limitedMusicFeed.length > 0) {
      nodes.push(
        <SectionHeader
          key="hdr_music"
          label="Trending Music"
          icon="musical-note-outline"
          count={musicFeed.length}
          showViewAll={musicFeed.length > MAX_DISPLAY_PER_SECTION}
        />
      );
      limitedMusicFeed.forEach((item, i) => nodes.push(renderCard(item, i)));
    }

    if (limitedVideoFeed.length > 0) {
      nodes.push(
        <SectionHeader
          key="hdr_video"
          label="Music Videos"
          icon="play-outline"
          count={videoFeed.length}
          showViewAll={videoFeed.length > MAX_DISPLAY_PER_SECTION}
        />
      );
      limitedVideoFeed.forEach((item, i) => nodes.push(renderCard(item, i)));
    }

    if (nodes.length === 0) {
      if (loading) {
        return <SkeletonLoader type="trending" count={3} />;
      }
      return (
        <View style={styles.centered}>
          <Ionicons name="notifications-off-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing to show yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSub }]}>Pull down to refresh.</Text>
        </View>
      );
    }

    return nodes;
  };

  // ─── isEmpty for non-all tabs ─────────────────────────────────────────────

  const isEmpty = activeTab !== "all" && activeFeed.length === 0 && !loading;

  // ─── Show skeletons while loading ─────────────────────────────────────────

  const renderSkeletons = () => {
    if (activeTab === "all") {
      return (
        <>
          <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
            <Ionicons name="radio-outline" size={13} color={colors.gold} />
            <Text style={[styles.sectionLabel, { color: colors.gold }]}>Mavin Channels</Text>
          </View>
          <SkeletonLoader type="trending" count={3} />
          <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
            <Ionicons name="musical-note-outline" size={13} color={colors.gold} />
            <Text style={[styles.sectionLabel, { color: colors.gold }]}>Trending Music</Text>
          </View>
          <SkeletonLoader type="trending" count={3} />
          <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
            <Ionicons name="play-outline" size={13} color={colors.gold} />
            <Text style={[styles.sectionLabel, { color: colors.gold }]}>Music Videos</Text>
          </View>
          <SkeletonLoader type="trending" count={3} />
        </>
      );
    }
    return <SkeletonLoader type="trending" count={5} />;
  };

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.4, y: 1 }}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + 16, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="notifications-outline" size={20} color={colors.gold} />
          <Text style={[styles.title, { color: colors.text }]}>For You</Text>
          {counts.all > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.gold }]}>
              <Text style={[styles.badgeText, { color: colors.textInverse }]}>
                {counts.all > 99 ? "99+" : counts.all}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            onPress={handleForcePoll} 
            style={styles.refreshBtn}
            disabled={isPolling}
          >
            {isPolling ? (
              <ActivityIndicator size="small" color={colors.gold} />
            ) : (
              <Ionicons name="refresh-outline" size={22} color={colors.gold} />
            )}
          </TouchableOpacity>
          {counts.all > 0 && (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
              <Text style={[styles.markAllText, { color: colors.gold }]}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const tabCount = counts[tab.key];
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                isActive && { backgroundColor: `${colors.gold}18` },
              ]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={tab.icon as any}
                size={14}
                color={isActive ? colors.gold : colors.textMuted}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: isActive ? colors.gold : colors.textMuted },
                  isActive && { fontWeight: "700" },
                ]}
              >
                {tab.label}
              </Text>
              {tabCount > 0 && (
                <View style={[styles.tabBadge, { backgroundColor: colors.gold }]}>
                  <Text style={[styles.tabBadgeText, { color: colors.textInverse }]}>
                    {tabCount > 99 ? "99+" : tabCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {loading && activeTab !== "all" ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {renderSkeletons()}
        </ScrollView>
      ) : error && activeTab === "mavin" ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.gold }]}
            onPress={loadAllData}
          >
            <Text style={[styles.retryText, { color: colors.textInverse }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isEmpty ? (
        <View style={styles.centered}>
          <Ionicons name="notifications-off-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {activeTab === "mavin"
              ? "No channel updates yet"
              : activeTab === "video"
              ? "No music videos right now"
              : "No trending music right now"}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSub }]}>
            Tap the refresh button to check for new releases.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "all"
            ? renderAllFeed()
            : activeFeed.map((item, i) => renderCard(item, i))}
        </ScrollView>
      )}
    </LinearGradient>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: 0.1 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  markAllBtn: { paddingVertical: 5, paddingHorizontal: 10 },
  markAllText: { fontSize: 13, fontWeight: "600" },
  refreshBtn: { padding: 4, marginRight: 4 },

  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 20,
    gap: 4,
  },
  tabText: { fontSize: 12, fontWeight: "600" },
  tabBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  tabBadgeText: { fontSize: 9, fontWeight: "800" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  sectionCount: { fontSize: 10, fontWeight: "500", marginLeft: 2 },
  viewAllBtn: { marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 4 },
  viewAllText: { fontSize: 11, fontWeight: "600" },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  loadingText: { fontSize: 13, marginTop: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 14, textAlign: "center" },
  emptySubtitle: { fontSize: 13.5, textAlign: "center", lineHeight: 20, marginTop: 4 },
  errorText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 14, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 36,
    paddingHorizontal: 12,
    gap: 6,
  },

  card: { borderRadius: 12, overflow: "hidden" },
  cardInner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 0.5,
    paddingVertical: 9,
    paddingRight: 12,
    overflow: "hidden",
  },
  unreadStrip: {
    width: 3,
    alignSelf: "stretch",
    marginRight: 9,
    borderRadius: 2,
  },
  noStripPad: {
    width: 3,
    marginRight: 9,
  },
  thumbnail: { width: 50, height: 50, borderRadius: 8, marginRight: 10 },
  thumbPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: { flex: 1, gap: 3 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardSource: {
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flex: 1,
  },
  contentTypeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  contentTypeBadgeText: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },
  cardTime: { fontSize: 10, fontWeight: "500" },
  cardTitle: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  cardAction: { marginLeft: 8 },
});