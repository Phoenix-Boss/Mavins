// app/(modals)/notifications.tsx
import React, { useState, useCallback, useEffect } from "react";
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
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { supabase } from "@/libs/supabase";
import { getStreamInfoById, getStreamUrl } from "@/modules/mavin-engine";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNotificationPoller } from "@/hooks/useNotificationPoller";

// ─── Types ───────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  video_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string | null;
  duration: number | null;
  published_at: string;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const SEEN_KEY = "@mavin:seen_notifications";

function timeAgo(dateString: string): string {
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

async function getSeenIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw));
}

async function markSeen(videoId: string) {
  const seen = await getSeenIds();
  seen.add(videoId);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

async function markAllSeen(videoIds: string[]) {
  const seen = await getSeenIds();
  videoIds.forEach((id) => seen.add(id));
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

// ─── Component ───────────────────────────────────────────────────────────

export default function NotificationsModal() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { colors } = useTheme();
  const { playAudio, expandPlayer } = useMusicPlayer();

  // Start the poller (runs once per 24h)
  useNotificationPoller();

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ─── Fetch ───────────────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async () => {
    try {
      setError(null);
      const { data, error: supaError } = await supabase
        .from("notifications")
        .select("*")
        .order("published_at", { ascending: false })
        .limit(100)
        .returns<NotificationRow[]>();

      if (supaError) throw supaError;

      const rows = data || [];
      setNotifications(rows);

      const seen = await getSeenIds();
      setSeenIds(seen);
      setUnreadCount(rows.filter((r) => !seen.has(r.video_id)).length);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // ─── Mark all read ─────────────────────────────────────────────────────

  const handleMarkAllRead = useCallback(async () => {
    const allIds = notifications.map((n) => n.video_id);
    await markAllSeen(allIds);
    const seen = await getSeenIds();
    setSeenIds(seen);
    setUnreadCount(0);
  }, [notifications]);

  // ─── Play on tap ───────────────────────────────────────────────────────

  const handlePress = useCallback(
    async (item: NotificationRow) => {
      // Mark as seen locally
      await markSeen(item.video_id);
      setSeenIds((prev) => new Set([...prev, item.video_id]));
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        // Resolve stream via engine
        const streamInfo = await getStreamInfoById(item.video_id, 0);
        if (!streamInfo.success) {
          Alert.alert("Unavailable", "This track cannot be played right now.");
          return;
        }

        const bestAudio = streamInfo.audioStreams?.sort((a, b) => b.bitrate - a.bitrate)[0];
        const streamUrl = bestAudio?.url || (await getStreamUrl(item.video_id, "audio", 0)).url;

        if (!streamUrl) {
          Alert.alert("Playback Error", "No playable stream found.");
          return;
        }

        const song = {
          id: item.video_id,
          title: item.title,
          artist: item.channel_name,
          thumbnail: item.thumbnail_url || streamInfo.thumbnails?.[0]?.url || "",
          url: streamUrl,
          duration: item.duration || streamInfo.duration || 0,
        };

        playAudio(song as any);
        expandPlayer();
      } catch (err: any) {
        console.error("[Notifications] Playback failed:", err);
        Alert.alert("Playback Error", err.message || "Could not load this track.");
      }
    },
    [playAudio, expandPlayer]
  );

  // ─── Render ────────────────────────────────────────────────────────────

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [fetchNotifications]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: top + 16 },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.gold }]}>
              <Text style={[styles.badgeText, { color: colors.textInverse }]}>
                {unreadCount}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
              <Text style={[styles.markAllText, { color: colors.gold }]}>
                Mark all read
              </Text>
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

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.gold }]}
            onPress={fetchNotifications}
          >
            <Text style={[styles.retryText, { color: colors.textInverse }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="notifications-off-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No new releases yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSub }]}>
            When your subscribed channels drop new music,{"\n"}you'll see it here.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
          }
        >
          {notifications.map((item) => {
            const isUnread = !seenIds.has(item.video_id);

            return (
              <Pressable
                key={item.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: isUnread ? colors.surfaceRaised : colors.surface,
                    borderLeftColor: isUnread ? colors.gold : "transparent",
                    borderLeftWidth: isUnread ? 3 : 0,
                  },
                ]}
                onPress={() => handlePress(item)}
              >
                {/* Thumbnail */}
                {item.thumbnail_url ? (
                  <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumbPlaceholder, { backgroundColor: colors.surfaceHigh }]}>
                    <Ionicons name="musical-note" size={20} color={colors.textMuted} />
                  </View>
                )}

                {/* Content */}
                <View style={styles.content}>
                  <View style={styles.topRow}>
                    <Text
                      style={[styles.channelName, { color: colors.gold }]}
                      numberOfLines={1}
                    >
                      {item.channel_name}
                    </Text>
                    {isUnread && <View style={[styles.dot, { backgroundColor: colors.gold }]} />}
                  </View>
                  <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={[styles.timeAgo, { color: colors.textSub }]}>
                    {timeAgo(item.published_at)}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 20, fontWeight: "800" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  markAllBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  markAllText: { fontSize: 13, fontWeight: "600" },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  scroll: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    gap: 12,
  },
  thumbnail: { width: 56, height: 56, borderRadius: 8 },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  content: { flex: 1, gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  channelName: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  songTitle: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  timeAgo: { fontSize: 12, fontWeight: "500" },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 16 },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },
  errorText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 14, fontWeight: "700" },
});