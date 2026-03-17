/**
 * (modals)/menu.tsx — Context menu bottom sheet
 *
 * Receives params:
 *   type: "song" | "downloadedSong" | "localSong" | "playlist"
 *   songData?: JSON string  { id, title, artist, thumbnail, url?, duration? }
 *   playlistName?: string   (playlist id)
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { triggerHaptic } from "@/helpers/haptics";

// ─── Palette ────────────────────────────────────────────────────────────────

const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  danger: "#E05C5C",
};

// ─── Menu item definition ────────────────────────────────────────────────────

interface MenuItem {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MenuModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    type: string;
    songData?: string;
    playlistName?: string;
  }>();

  const { type, songData: songDataRaw, playlistName } = params;

  const songData = useMemo(() => {
    if (!songDataRaw) return null;
    try {
      return JSON.parse(songDataRaw) as {
        id: string;
        title: string;
        artist: string;
        thumbnail?: string;
        url?: string;
        duration?: number;
      };
    } catch {
      return null;
    }
  }, [songDataRaw]);

  // ── Build menu items per type ──────────────────────────────────────────────

  const items: MenuItem[] = useMemo(() => {
    if (type === "playlist" && playlistName) {
      return [
        {
          icon: "play-circle-outline",
          label: "Play Playlist",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(library)/[playlistName]",
              params: { playlistName },
            });
          },
        },
        {
          icon: "shuffle-outline",
          label: "Shuffle Playlist",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(library)/[playlistName]",
              params: { playlistName, shuffle: "1" },
            });
          },
        },
        {
          icon: "pencil-outline",
          label: "Rename Playlist",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/createPlaylist",
              params: { editId: playlistName },
            });
          },
        },
        {
          icon: "trash-outline",
          label: "Delete Playlist",
          danger: true,
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/deletePlaylist",
              params: { playlistName },
            });
          },
        },
      ];
    }

    // song | downloadedSong | localSong
    if (songData) {
      const baseItems: MenuItem[] = [
        {
          icon: "play-circle-outline",
          label: "Play Now",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.navigate("/player");
          },
        },
        {
          icon: "list-outline",
          label: "Add to Queue",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push("/(modals)/queue");
          },
        },
        {
          icon: "add-circle-outline",
          label: "Add to Playlist",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/addToPlaylist",
              params: { songId: songData.id, songTitle: songData.title },
            });
          },
        },
        {
          icon: "musical-notes-outline",
          label: "View Lyrics",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/lyrics",
              params: {
                songId: songData.id,
                title: songData.title,
                artist: songData.artist,
              },
            });
          },
        },
        {
          icon: "git-network-outline",
          label: "Related Songs",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/related",
              params: {
                songId: songData.id,
                title: songData.title,
                artist: songData.artist,
              },
            });
          },
        },
        {
          icon: "chatbubble-outline",
          label: "Comments",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push({
              pathname: "/(modals)/comments",
              params: { songId: songData.id, title: songData.title },
            });
          },
        },
        {
          icon: "star-outline",
          label: "Go Premium",
          onPress: () => {
            triggerHaptic();
            router.back();
            router.push("/(modals)/premium");
          },
        },
      ];

      // Downloaded songs: no delete; local songs: no comments/related/lyrics
      if (type === "downloadedSong") {
        baseItems.push({
          icon: "trash-outline",
          label: "Remove Download",
          danger: true,
          onPress: () => {
            triggerHaptic();
            router.back();
            // trigger delete via redux — replace with your action dispatch here
          },
        });
      }

      return baseItems;
    }

    return [];
  }, [type, songData, playlistName, router]);

  // ── Title + artwork ───────────────────────────────────────────────────────

  const title =
    type === "playlist"
      ? playlistName ?? "Playlist"
      : songData?.title ?? "Options";

  const subtitle =
    type === "playlist" ? "Playlist" : songData?.artist ?? "";

  const artwork =
    type !== "playlist" ? songData?.thumbnail : undefined;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingBottom: bottom + 16 }]}>
      {/* Handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            style={styles.artwork}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]}>
            <Ionicons
              name={type === "playlist" ? "list" : "musical-notes"}
              size={20}
              color={C.textMuted}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle.length > 0 && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={18} color={C.textSub} />
        </TouchableOpacity>
      </View>

      {/* Gold hairline */}
      <View style={styles.divider} />

      {/* Menu items */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.menuItem}
            onPress={item.onPress}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.menuIcon,
                item.danger && styles.menuIconDanger,
              ]}
            >
              <Ionicons
                name={item.icon as any}
                size={18}
                color={item.danger ? C.danger : C.gold}
              />
            </View>
            <Text
              style={[styles.menuLabel, item.danger && styles.menuLabelDanger]}
            >
              {item.label}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={C.textMuted}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: 10,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  artworkPlaceholder: {
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0.5,
    borderColor: C.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.text,
  },
  headerSub: {
    fontSize: 12,
    color: C.textSub,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 0.5,
    backgroundColor: C.borderGold,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.goldFill,
    borderWidth: 0.5,
    borderColor: C.borderGold,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuIconDanger: {
    backgroundColor: "rgba(224,92,92,0.1)",
    borderColor: "rgba(224,92,92,0.22)",
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
  },
  menuLabelDanger: {
    color: C.danger,
  },
});