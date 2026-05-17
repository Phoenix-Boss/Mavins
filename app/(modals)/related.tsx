// app/(modals)/related.tsx
//
// RELATED MODAL - Displays songs related to the currently playing track
// ANDROID-ONLY: No iOS references
// Accepts onClose prop for overlay dismissal

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import MavinEngine, { StreamInfoItem } from "@/modules/mavin-engine";
import { useMusicPlayer, type Song } from "@/libs/playerSetup";
import { triggerHaptic } from "@/helpers/haptics";

interface RelatedModalProps {
  songUrl: string;
  title: string;
  artist: string;
  onClose: () => void;
}

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  bg:           "#000000",
  surface:      "#0D0D0D",
  surfaceRaised:"#161616",
  border:       "rgba(255,255,255,0.07)",
  borderGold:   "rgba(212,175,55,0.22)",
  gold:         "#D4AF37",
  text:         "#FFFFFF",
  textSub:      "#888888",
  textMuted:    "#4A4A4A",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const extractVideoId = (url: string): string | undefined => {
  if (url.includes("v="))
    return url.split("v=")[1]?.split("&")[0] || undefined;
  if (url.includes("youtu.be/"))
    return url.split("youtu.be/")[1]?.split("?")[0] || undefined;
  return undefined;
};

const bestThumb = (thumbs: { url: string; resolutionLevel: string }[]): string =>
  thumbs.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find((t) => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ??
  "";

const streamItemToSong = (s: StreamInfoItem): Song => {
  const videoId = extractVideoId(s.url);
  return {
    id:        videoId ?? s.url,
    title:     s.name,
    artist:    s.uploaderName,
    thumbnail: bestThumb(s.thumbnails),
    url:       s.url,
    videoId,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RelatedModal({ songUrl, title, artist, onClose }: RelatedModalProps) {
  const { top, bottom } = useSafeAreaInsets();
  const { playAudio } = useMusicPlayer();

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Normalise to proper YouTube watch URL
  const watchUrl = (() => {
    const videoId = extractVideoId(songUrl);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    if (songUrl.includes("youtube.com/watch") || songUrl.includes("youtu.be/")) return songUrl;
    return songUrl;
  })();

  // Fetch related songs
  useEffect(() => {
    if (!watchUrl) {
      setLoading(false);
      setError("No track URL provided.");
      return;
    }

    let cancelled = false;

    const fetchRelated = async () => {
      try {
        setLoading(true);
        setError(null);

        const info = await MavinEngine.getStreamInfo(watchUrl, 0);

        if (cancelled) return;

        if (!info.success) {
          setError("Could not load related tracks.");
          return;
        }

        const related: Song[] = info.relatedItems
          .filter((i): i is StreamInfoItem => i.type === "stream")
          .filter((s) => !s.isLive && !s.isShortFormContent)
          .slice(0, 30)
          .map(streamItemToSong);

        setSongs(related);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to load related tracks.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRelated();
    return () => { cancelled = true; };
  }, [watchUrl]);

  // Handle play
  const handlePlay = useCallback(async (song: Song) => {
    triggerHaptic();
    await playAudio(song, songs);
    onClose();
  }, [songs, playAudio, onClose]);

  // Render item
  const renderItem = ({ item }: { item: Song }) => (
    <TouchableOpacity style={styles.row} onPress={() => handlePlay(item)} activeOpacity={0.7}>
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.cover} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Ionicons name="musical-notes" size={18} color={C.textMuted} />
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
      </View>

      <Ionicons name="play-circle-outline" size={24} color={C.gold} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: top }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-down" size={22} color={C.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Related Songs</Text>
          {(artist || title) && (
            <Text style={styles.headerSub} numberOfLines={1}>Similar to {artist || title}</Text>
          )}
        </View>

        <View style={{ width: 36 }} />
      </View>

      <View style={styles.divider} />

      {/* Loading */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={C.gold} />
          <Text style={styles.loadingText}>Finding related tracks…</Text>
        </View>
      )}

      {/* Error */}
      {!loading && !!error && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={C.textMuted} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySub}>{error}</Text>
        </View>
      )}

      {/* Results */}
      {!loading && !error && (
        <FlatList
          data={songs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 32 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="git-network-outline" size={48} color={C.textMuted} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>No Related Songs</Text>
              <Text style={styles.emptySub}>We couldn't find related tracks right now.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 12, color: C.textSub, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  cover: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  coverPlaceholder: { backgroundColor: C.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  trackTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  trackArtist: { fontSize: 12, color: C.textSub, marginTop: 2 },
  separator: { height: 0.5, backgroundColor: C.border, marginLeft: 68 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingText: { fontSize: 13, color: C.textSub, marginTop: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: C.textSub, textAlign: "center" },
});
