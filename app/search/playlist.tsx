/**
 * PlaylistView — Fixed
 *
 * FIXES:
 *   - Added useTheme for full light/dark mode support
 *   - LinearGradient adapts to theme
 *   - Colors from theme context throughout
 *   - All hooks unconditional
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useImageColors } from "@/hooks/useImageColors";
import MavinEngine, { PlaylistInfo, StreamInfoItem } from "@/modules/mavin-engine";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Entypo, Ionicons } from "@expo/vector-icons";
import color from "color";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState, useEffect, useCallback } from "react";
import { Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import LoaderKit from "react-native-loader-kit";
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

const GOLD_PRIMARY = "#D4AF37";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  duration?: number;
}

interface PlaylistPageData {
  title: string;
  subtitle: string;
  second_subtitle: string;
  thumbnail: string;
  songs: Song[];
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

const playlistInfoToPageData = (info: PlaylistInfo): PlaylistPageData => {
  const thumbnail =
    info.thumbnails.find(t => t.resolutionLevel === "HIGH")?.url ??
    info.thumbnails.find(t => t.resolutionLevel === "MEDIUM")?.url ??
    info.thumbnails[0]?.url ??
    unknownTrackImageUri;

  const songs: Song[] = info.items
    .filter((i): i is StreamInfoItem => i.type === "stream")
    .map(s => {
      const videoId = extractVideoId(s.url);
      return {
        id: videoId ?? s.url,
        title: s.name,
        artist: s.uploaderName,
        thumbnail:
          s.thumbnails.find(t => t.resolutionLevel === "MEDIUM")?.url ??
          s.thumbnails[0]?.url ??
          thumbnail,
        url: s.url,
        duration: s.duration,
      };
    });

  return {
    title: info.name,
    subtitle: info.uploaderName,
    second_subtitle: `${info.streamCount} songs`,
    thumbnail,
    songs,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const PlaylistView = () => {
  const [isScrolling, setIsScrolling] = useState(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });
  const [playlistData, setPlaylistData] = useState<PlaylistPageData | null>(null);
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();

  // ALL HOOKS UNCONDITIONAL
  const { colors } = useTheme();
  const engine = usePlayerEngine();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { imageColors } = useImageColors(playlistData?.thumbnail ?? unknownTrackImageUri);
  const currentTrackId = engine.currentTrack?.id;

  useEffect(() => {
    const fetchPlaylistData = async () => {
      if (!id) { setLoading(false); setError("No playlist ID provided."); return; }
      setLoading(true);
      setError(null);
      try {
        const decodedId = decodeURIComponent(id);
        console.log(`[PlaylistView] fetching: ${decodedId}`);
        const info: PlaylistInfo = await MavinEngine.getPlaylistInfo(decodedId, 0);
        setPlaylistData(playlistInfoToPageData(info));
      } catch (e: any) {
        console.error("[PlaylistView] error:", e);
        setError(e?.message ?? "Failed to load playlist.");
      } finally {
        setLoading(false);
      }
    };
    fetchPlaylistData();
  }, [id]);

  const handleSongSelect = useCallback((song: Song) => {
    triggerHaptic();
    playAudio(
      { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, url: song.url, duration: song.duration || 0, videoId: song.id },
      playlistData?.songs,
    );
  }, [playAudio, playlistData?.songs]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (!playlistData?.songs.length) return;
    await playPlaylist(
      playlistData.songs.map(s => ({ id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, url: s.url, duration: s.duration || 0, videoId: s.id })),
    );
  }, [playlistData, playPlaylist]);

  const renderSongItem = useCallback(({ item, index }: { item: Song; index: number }) => {
    const isPlaying = currentTrackId === item.id;
    return (
      <View style={styles.songItem}>
        <TouchableOpacity style={styles.songItemTouchableArea} onPress={() => handleSongSelect(item)} activeOpacity={0.7}>
          <View style={styles.indexContainer}>
            <Text style={[styles.indexText, isPlaying && { color: GOLD_PRIMARY }]}>{index + 1}</Text>
          </View>
          <Image source={{ uri: item.thumbnail }} style={styles.resultThumbnail} contentFit="cover" />
          {isPlaying && (
            <LoaderKit
              style={styles.trackPlayingIconIndicator}
              name="LineScalePulseOutRapid"
              color={GOLD_PRIMARY}
            />
          )}
          <View style={styles.resultText}>
            <Text style={[styles.resultTitle, { color: colors.text }, isPlaying && { color: GOLD_PRIMARY }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.resultArtist, { color: colors.textMuted ?? colors.textSub }]} numberOfLines={1}>
              {item.artist}
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
        <Image source={{ uri: playlistData?.thumbnail ?? unknownTrackImageUri }} style={styles.artworkImage} contentFit="cover" priority="high" />
      </View>
      <Text
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          setTitleLayout({ y, height });
        }}
        style={[styles.titleText, { color: colors.text }]}
      >
        {playlistData?.title}
      </Text>
      <Text style={[styles.subtitleText, { color: colors.text }]}>{playlistData?.subtitle}</Text>
      <Text style={[styles.subtitleText, { color: colors.textSub ?? colors.text }]}>{playlistData?.second_subtitle}</Text>
    </>
  ), [playlistData, colors]);

  const gradientColors: [string, string] = imageColors
    ? [color(imageColors.average).darken(0.2).hex(), colors.background]
    : [colors.surface ?? "#1a1a1a", colors.background];

  // ── States ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={GOLD_PRIMARY} />
      </View>
    );
  }

  if (error || !playlistData) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={moderateScale(40)} color={colors.textSub ?? "#888"} />
        <Text style={[{ fontSize: moderateScale(14), textAlign: "center", paddingHorizontal: 20, color: colors.textSub ?? "#888" }]}>
          {error ?? "Playlist not found."}
        </Text>
        <TouchableOpacity
          style={{ borderWidth: 1, borderColor: GOLD_PRIMARY, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20 }}
          onPress={() => router.back()}
        >
          <Text style={{ color: GOLD_PRIMARY, fontSize: moderateScale(13), fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LinearGradient style={{ flex: 1 }} colors={gradientColors}>
      <View style={styles.container}>
        <View style={[styles.header, isScrolling && styles.headerScrolled, { paddingTop: top }]}>
          <Ionicons
            name="arrow-back"
            size={moderateScale(28)}
            color={colors.text}
            style={{ paddingLeft: 15, paddingRight: 10, marginTop: 2 }}
            onPress={() => { triggerHaptic(); router.back(); }}
          />
          <Text numberOfLines={1} style={[styles.headerText, { color: colors.text }, !showHeaderTitle && { opacity: 0 }]}>
            {playlistData.title}
          </Text>
        </View>

        {isScrolling && <Divider style={{ backgroundColor: "rgba(255,255,255,0.2)", height: 0.3, marginHorizontal: -15 }} />}

        <FlashList
          data={playlistData.songs}
          renderItem={renderSongItem}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          extraData={currentTrackId}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: verticalScale(190) + bottom }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={75}
          onScroll={e => {
            const pos = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(pos > 0);
            setShowHeaderTitle(pos > titleLayout.y + titleLayout.height);
          }}
          scrollEventThrottle={16}
        />

        {(playlistData.songs?.length ?? 0) > 0 && (
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
};

export default PlaylistView;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1 },
  centeredContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
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
  resultThumbnail: { width: "55@ms", height: "55@ms", marginRight: 10, borderRadius: 8 },
  trackPlayingIconIndicator: { position: "absolute", left: "33@ms", top: "15@ms", width: "20@ms", height: "20@ms" },
  resultText: { flex: 1 },
  resultTitle: { fontSize: "16@ms" },
  resultArtist: { fontSize: "14@ms" },
});
