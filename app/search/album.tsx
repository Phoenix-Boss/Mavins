/**
 * AlbumPageScreen — Fixed
 *
 * FIXES:
 *   - Replaced broken mock fetch() with MavinEngine.getPlaylistInfo()
 *   - Added useTheme for full light/dark mode support
 *   - All hooks unconditional (before early returns)
 *   - Uses extractVideoId from helpers/youtube
 *   - LinearGradient adapts to theme colors
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useImageColors } from "@/hooks/useImageColors";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Entypo, Ionicons } from "@expo/vector-icons";
import color from "color";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useCallback } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View, Dimensions } from "react-native";
import { Divider, FAB } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from "react-native-size-matters/extend";

import { usePlayerEngine } from "@/libs/playerSetup";
import { extractVideoId } from "@/helpers/youtube";
import { useTheme } from "@/contexts/ThemeContext";
import MavinEngine, { PlaylistInfo, StreamInfoItem } from "@/modules/mavin-engine";

const GOLD_PRIMARY = "#D4AF37";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AlbumSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  duration: string;
}

interface AlbumPageData {
  title: string;
  subtitle: string;
  second_subtitle: string;
  thumbnail: string;
  songs: AlbumSong[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const bestThumb = (thumbs: { url: string; resolutionLevel?: string }[]): string =>
  thumbs.find(t => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find(t => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ?? unknownTrackImageUri;

/** Convert MavinEngine PlaylistInfo → AlbumPageData */
const playlistInfoToAlbumData = (
  info: PlaylistInfo,
  artistOverride: string,
): AlbumPageData => {
  const thumbnail = bestThumb(info.thumbnails);

  const songs: AlbumSong[] = info.items
    .filter((i): i is StreamInfoItem => i.type === "stream")
    .map(s => {
      const videoId = extractVideoId(s.url);
      return {
        id: videoId ?? s.url,
        title: s.name,
        artist: artistOverride || s.uploaderName,
        thumbnail: bestThumb(s.thumbnails) || thumbnail,
        url: s.url,
        duration: formatDuration(s.duration),
      };
    });

  return {
    title: info.name,
    subtitle: info.uploaderName || artistOverride,
    second_subtitle: `${info.streamCount ?? songs.length} songs`,
    thumbnail,
    songs,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AlbumPageScreen() {
  const [isScrolling, setIsScrolling] = useState(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);
  const { top, bottom } = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumData, setAlbumData] = useState<AlbumPageData | null>(null);
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });

  // ALL HOOKS UNCONDITIONAL
  const { colors } = useTheme();
  const engine = usePlayerEngine();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const { id, artist } = useLocalSearchParams<{ id: string; artist: string }>();
  const router = useRouter();
  const { imageColors } = useImageColors(albumData?.thumbnail ?? unknownTrackImageUri);
  const currentTrackId = engine.currentTrack?.id;

  // ── Data fetch ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      if (!id) { setLoading(false); setError("No album ID provided."); return; }
      setLoading(true);
      setError(null);
      try {
        const decodedId = decodeURIComponent(id);
        console.log(`[AlbumPage] fetching: ${decodedId}`);
        const info: PlaylistInfo = await MavinEngine.getPlaylistInfo(decodedId, 0);
        setAlbumData(playlistInfoToAlbumData(info, artist ?? ""));
      } catch (e: any) {
        console.error("[AlbumPage] error:", e);
        setError(e?.message ?? "Failed to load album.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, artist]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSongSelect = useCallback((song: AlbumSong) => {
    triggerHaptic();
    playAudio(
      { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, url: song.url, duration: 0, videoId: song.id },
      albumData?.songs.map(s => ({ id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, url: s.url, duration: 0, videoId: s.id })),
    );
  }, [playAudio, albumData]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (!albumData?.songs.length) return;
    await playPlaylist(
      albumData.songs.map(s => ({ id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, url: s.url, duration: 0, videoId: s.id })),
    );
  }, [albumData, playPlaylist]);

  const renderSongItem = useCallback(({ item, index }: { item: AlbumSong; index: number }) => {
    const isPlaying = currentTrackId === item.id;
    return (
      <View style={styles.songItem}>
        <TouchableOpacity style={styles.songItemTouchableArea} onPress={() => handleSongSelect(item)} activeOpacity={0.7}>
          <View style={styles.indexContainer}>
            <Text style={[styles.indexText, isPlaying && { color: GOLD_PRIMARY }]}>{index + 1}</Text>
          </View>
          <View style={styles.resultText}>
            <Text style={[styles.resultTitle, { color: colors.text }, isPlaying && { color: GOLD_PRIMARY }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.resultArtist, { color: colors.textMuted ?? colors.textSub }]} numberOfLines={1}>
              {item.duration}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            triggerHaptic();
            router.push({
              pathname: "/(modals)/menu",
              params: { songData: JSON.stringify({ id: item.id, title: item.title, artist: item.artist, thumbnail: item.thumbnail }), type: "song" },
            });
          }}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        >
          <Entypo name="dots-three-vertical" size={moderateScale(15)} color={colors.textMuted ?? "rgba(255,255,255,0.6)"} />
        </TouchableOpacity>
      </View>
    );
  }, [currentTrackId, handleSongSelect, router, colors]);

  const ListHeader = useCallback(() => (
    <>
      <View style={styles.artworkImageContainer}>
        <Image source={{ uri: albumData?.thumbnail ?? unknownTrackImageUri }} style={styles.artworkImage} contentFit="cover" priority="high" />
      </View>
      <Text
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          setTitleLayout({ y, height });
        }}
        style={[styles.titleText, { color: colors.text }]}
      >
        {albumData?.title}
      </Text>
      <Text style={[styles.subtitleText, { color: colors.text }]}>{albumData?.subtitle}</Text>
      <Text style={[styles.subtitleText, { color: colors.textSub ?? colors.text }]}>{albumData?.second_subtitle}</Text>
    </>
  ), [albumData, colors]);

  // ── Gradient colors ────────────────────────────────────────────────────────

  const gradientColors: [string, string] = imageColors
    ? [color(imageColors.average).darken(0.2).hex(), colors.background]
    : [colors.surface ?? "#1a1a1a", colors.background];

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={GOLD_PRIMARY} />
      </View>
    );
  }

  if (error || !albumData) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={moderateScale(40)} color={colors.textSub ?? "#888"} />
        <Text style={[styles.errorText, { color: colors.textSub ?? "#888" }]}>{error ?? "Album not found."}</Text>
        <TouchableOpacity style={[styles.backBtn, { borderColor: GOLD_PRIMARY }]} onPress={() => router.back()}>
          <Text style={{ color: GOLD_PRIMARY, fontSize: moderateScale(13), fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <LinearGradient style={{ flex: 1 }} colors={gradientColors}>
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, isScrolling && styles.headerScrolled, { paddingTop: top }]}>
          <Ionicons
            name="arrow-back"
            size={moderateScale(28)}
            color={colors.text}
            style={{ paddingLeft: 15, paddingRight: 10, marginTop: 2 }}
            onPress={() => { triggerHaptic(); router.back(); }}
          />
          <Text numberOfLines={1} style={[styles.headerText, { color: colors.text }, !showHeaderTitle && { opacity: 0 }]}>
            {albumData.title}
          </Text>
        </View>

        {isScrolling && <Divider style={{ backgroundColor: "rgba(255,255,255,0.2)", height: 0.3, marginHorizontal: -15 }} />}

        <FlashList
          data={albumData.songs}
          renderItem={renderSongItem}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          extraData={currentTrackId}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: verticalScale(190) + bottom }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={70}
          onScroll={e => {
            const pos = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(pos > 0);
            setShowHeaderTitle(pos > titleLayout.y + titleLayout.height);
          }}
          scrollEventThrottle={16}
        />

        {albumData.songs.length > 0 && (
          <FAB
            style={{ position: "absolute", marginRight: 16, marginBottom: moderateScale(138) + bottom, right: 0, bottom: 0, backgroundColor: GOLD_PRIMARY }}
            theme={{ roundness: 7 }}
            icon="play"
            color="#000"
            onPress={handlePlayAll}
          />
        )}
      </View>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1 },
  centeredContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText: { fontSize: "14@ms", textAlign: "center", paddingHorizontal: 20 },
  backBtn: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20 },
  header: { flexDirection: "row", justifyContent: "flex-start", alignItems: "center", paddingBottom: 10 },
  headerText: { fontSize: "20@ms", fontWeight: "bold", textAlign: "left", width: "82%" },
  headerScrolled: { backgroundColor: "rgba(0,0,0,0.3)" },
  artworkImageContainer: {
    elevation: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8, shadowRadius: 11, borderRadius: 12,
    alignSelf: "center", height: "240@ms", width: "240@ms", marginBottom: 10,
  },
  artworkImage: { width: "240@ms", height: "240@ms", borderRadius: 12 },
  titleText: { fontSize: "24@ms", fontWeight: "bold", marginHorizontal: 15, textAlign: "center", marginBottom: 5 },
  subtitleText: { textAlign: "center", fontSize: "15@ms", marginBottom: 5 },
  songItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  songItemTouchableArea: { flex: 1, flexDirection: "row", alignItems: "center" },
  indexContainer: { width: "40@ms", alignItems: "center" },
  indexText: { color: "#888", fontSize: "18@ms", fontWeight: "bold" },
  resultText: { flex: 1 },
  resultTitle: { fontSize: "16@ms" },
  resultArtist: { fontSize: "14@ms" },
});
