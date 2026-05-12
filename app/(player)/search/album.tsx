/**
 * AlbumPageScreen
 *
 * Displays detailed information about a specific album/playlist:
 * artwork, title, artist, and a numbered song list.
 *
 * Data source: MavinEngine.getPlaylistInfo() — albums on YouTube Music
 * are exposed by NewPipe as playlists, so their URLs are full playlist URLs
 * passed from ArtistPageScreen as the `id` param.
 *
 * Route params:
 *   id     — full playlist URL (e.g. "https://music.youtube.com/playlist?list=…")
 *   artist — artist name string to label each song
 *
 * FIXES:
 *   - Removed react-native-track-player (useActiveTrack)
 *   - Removed router.navigate("/player") — player is overlay, not a route
 *   - Uses PlayerEngineContext for active track detection
 *   - Uses extractVideoId from helpers/youtube for URL parsing
 *   - All hooks called unconditionally (before any early returns)
 *   - Fixed Colors.goldPrimary reference (use direct color values)
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
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

// Use PlayerEngineContext instead of RNTP
import { usePlayerEngine } from "@/libs/playerSetup";
import { extractVideoId } from "@/helpers/youtube";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD_PRIMARY = "#D4AF37";

// ─────────────────────────────────────────────────────────────────────────────
// Local types
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

// Mock data fetcher - replace with your actual API
const fetchAlbumData = async (id: string, artistOverride: string): Promise<AlbumPageData> => {
  // TODO: Replace with actual API call
  const response = await fetch(`https://your-api.com/album?id=${encodeURIComponent(id)}`);
  const data = await response.json();
  
  return {
    title: data.name || "Unknown Album",
    subtitle: data.uploaderName || artistOverride,
    second_subtitle: `${data.streamCount || 0} songs`,
    thumbnail: data.thumbnails?.[0]?.url || unknownTrackImageUri,
    songs: data.items?.map((s: any) => {
      const videoId = extractVideoId(s.url);
      return {
        id: videoId ?? s.url,
        title: s.name,
        artist: artistOverride || s.uploaderName,
        thumbnail: s.thumbnails?.[0]?.url || data.thumbnails?.[0]?.url,
        url: s.url,
        duration: formatDuration(s.duration),
      };
    }) || [],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AlbumPageScreen() {
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState<boolean>(false);
  const { top, bottom } = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [albumData, setAlbumData] = useState<AlbumPageData | null>(null);
  const router = useRouter();
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });
  
  // ALL HOOKS CALLED UNCONDITIONALLY
  const engine = usePlayerEngine();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const { id, artist } = useLocalSearchParams<{ id: string; artist: string }>();
  const { imageColors } = useImageColors(albumData?.thumbnail ?? unknownTrackImageUri);
  const currentTrackId = engine.currentTrack?.id;

  // Data fetching effect
  useEffect(() => {
    const loadAlbumData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        console.log(`[AlbumPage] fetching album: ${id}`);
        const data = await fetchAlbumData(id, artist ?? "");
        setAlbumData(data);
      } catch (error) {
        console.error("[AlbumPage] error fetching album:", error);
      } finally {
        setLoading(false);
      }
    };
    loadAlbumData();
  }, [id, artist]);

  // Handlers defined with useCallback (before any early return)
  const handleSongSelect = useCallback((song: AlbumSong, playlist?: AlbumSong[]) => {
    triggerHaptic();
    const songForPlayback = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      url: song.url,
      duration: 0,
      videoId: song.id,
    };
    const playlistForPlayback = playlist?.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail,
      url: s.url,
      duration: 0,
      videoId: s.id,
    }));
    playAudio(songForPlayback, playlistForPlayback);
  }, [playAudio]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (!albumData?.songs.length) return;
    const playlistForPlayback = albumData.songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail,
      url: s.url,
      duration: 0,
      videoId: s.id,
    }));
    await playPlaylist(playlistForPlayback);
  }, [albumData, playPlaylist]);

  const renderSongItem = useCallback(({ item, index }: { item: AlbumSong; index: number }) => {
    const isPlaying = currentTrackId === item.id;
    
    return (
      <View style={styles.songItem}>
        <TouchableOpacity
          style={styles.songItemTouchableArea}
          onPress={() => handleSongSelect(item, albumData?.songs)}
          activeOpacity={0.7}
        >
          <View style={styles.indexContainer}>
            <Text style={[styles.indexText, isPlaying && { color: GOLD_PRIMARY }]}>
              {index + 1}
            </Text>
          </View>
          <View style={styles.resultText}>
            <Text style={[styles.resultTitle, isPlaying && { color: GOLD_PRIMARY }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.resultArtist} numberOfLines={1}>
              {item.duration}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            triggerHaptic();
            const songData = JSON.stringify({
              id: item.id,
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
            });
            router.push({
              pathname: "/(modals)/menu",
              params: { songData, type: "song" },
            });
          }}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        >
          <Entypo
            name="dots-three-vertical"
            size={moderateScale(15)}
            color="white"
          />
        </TouchableOpacity>
      </View>
    );
  }, [currentTrackId, albumData?.songs, handleSongSelect, router]);

  const ListHeaderComponent = useCallback(() => (
    <>
      <View style={styles.artworkImageContainer}>
        <Image
          source={{ uri: albumData?.thumbnail ?? unknownTrackImageUri }}
          style={styles.artworkImage}
          contentFit="cover"
          priority="high"
        />
      </View>

      <Text
        onLayout={(event) => {
          const layout = event.nativeEvent.layout;
          setTitleLayout({ y: layout.y, height: layout.height });
        }}
        style={styles.titleText}
      >
        {albumData?.title}
      </Text>

      <Text
        style={{
          color: Colors.text,
          textAlign: "center",
          fontSize: moderateScale(15),
          marginBottom: 5,
        }}
      >
        {albumData?.subtitle}
      </Text>
      <Text
        style={{
          color: Colors.text,
          textAlign: "center",
          fontSize: moderateScale(15),
          marginBottom: 5,
        }}
      >
        {albumData?.second_subtitle}
      </Text>
    </>
  ), [albumData]);

  // Early return AFTER all hooks
  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  return (
    <LinearGradient
      style={{ flex: 1 }}
      colors={
        imageColors
          ? [color(imageColors.average).darken(0.2).hex(), "#000"]
          : [Colors.background, "#000"]
      }
    >
      <View style={styles.container}>
        <View
          style={[
            styles.header,
            isScrolling ? styles.headerScrolled : {},
            { paddingTop: top },
          ]}
        >
          <Ionicons
            name="arrow-back"
            size={moderateScale(28)}
            color={Colors.text}
            style={{ paddingLeft: 15, paddingRight: 10, marginTop: 2 }}
            onPress={() => {
              triggerHaptic();
              router.back();
            }}
          />
          <Text
            numberOfLines={1}
            style={[styles.headerText, !showHeaderTitle && { opacity: 0 }]}
          >
            {albumData?.title}
          </Text>
        </View>

        {isScrolling && (
          <Divider
            style={{
              backgroundColor: "rgba(255,255,255,0.3)",
              height: 0.3,
              marginHorizontal: -15,
            }}
          />
        )}

        <FlashList
          data={albumData?.songs ?? []}
          renderItem={renderSongItem}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          ListHeaderComponent={ListHeaderComponent}
          contentContainerStyle={{
            paddingHorizontal: 15,
            paddingBottom: verticalScale(190) + bottom,
          }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={70}
          onScroll={(e) => {
            const pos = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(pos > 0);
            setShowHeaderTitle(pos > titleLayout.y + titleLayout.height);
          }}
          scrollEventThrottle={16}
        />

        {(albumData?.songs?.length ?? 0) > 0 && (
          <FAB
            style={{
              position: "absolute",
              marginRight: 16,
              marginBottom: moderateScale(138) + bottom,
              right: 0,
              bottom: 0,
              backgroundColor: "white",
            }}
            theme={{ roundness: 7 }}
            icon="play"
            color="black"
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
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingBottom: 10,
  },
  headerText: {
    fontSize: "20@ms",
    fontWeight: "bold",
    color: Colors.text,
    textAlign: "left",
    width: "82%",
  },
  headerScrolled: {
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  artworkImageContainer: {
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 11,
    borderRadius: 12,
    alignSelf: "center",
    height: "240@ms",
    width: "240@ms",
    marginBottom: 10,
  },
  artworkImage: {
    width: "240@ms",
    height: "240@ms",
    borderRadius: 12,
  },
  titleText: {
    fontSize: "24@ms",
    fontWeight: "bold",
    color: Colors.text,
    marginHorizontal: 15,
    textAlign: "center",
    marginBottom: 5,
  },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  songItemTouchableArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  indexContainer: {
    width: "40@ms",
    alignItems: "center",
  },
  indexText: {
    color: "#888",
    fontSize: "18@ms",
    fontWeight: "bold",
  },
  resultText: {
    flex: 1,
  },
  resultTitle: {
    color: Colors.text,
    fontSize: "16@ms",
  },
  resultArtist: {
    color: Colors.textMuted,
    fontSize: "14@ms",
  },
});