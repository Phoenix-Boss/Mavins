/**
 * PlaylistView
 *
 * Displays the contents of a remote playlist fetched via MavinEngine.
 * Shows artwork, title, and song list; supports per-song playback and
 * full-playlist play via the FAB.
 *
 * Route params:
 *   id — full playlist URL (e.g. "https://music.youtube.com/playlist?list=…")
 *
 * FIXES:
 *   - Removed react-native-track-player (useActiveTrack)
 *   - Removed router.navigate("/player") — player is overlay, not a route
 *   - Uses PlayerEngineContext for active track detection
 *   - Uses extractVideoId from helpers/youtube for URL parsing
 *   - All hooks called unconditionally
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useImageColors } from "@/hooks/useImageColors";
import MavinEngine, {
  PlaylistInfo,
  StreamInfoItem,
} from "@/modules/mavin-engine";
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

// Use PlayerEngineContext instead of RNTP
import { usePlayerEngine } from "@/libs/playerSetup";
import { extractVideoId } from "@/helpers/youtube";

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD_PRIMARY = "#D4AF37";

// ─────────────────────────────────────────────────────────────────────────────
// Local types
// ─────────────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
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

const playlistInfoToPageData = (info: PlaylistInfo): PlaylistPageData => {
  const thumbnail =
    info.thumbnails.find((t) => t.resolutionLevel === "HIGH")?.url ??
    info.thumbnails[0]?.url ??
    unknownTrackImageUri;

  const songs: Song[] = info.items
    .filter((i): i is StreamInfoItem => i.type === "stream")
    .map((s) => {
      const videoId = extractVideoId(s.url);
      return {
        id: videoId ?? s.url,
        title: s.name,
        artist: s.uploaderName,
        thumbnail:
          s.thumbnails.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
          s.thumbnails[0]?.url ??
          thumbnail,
        url: s.url,
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
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });
  const [playlistData, setPlaylistData] = useState<PlaylistPageData | null>(null);
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  
  // ALL HOOKS CALLED UNCONDITIONALLY
  const engine = usePlayerEngine();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { imageColors } = useImageColors(playlistData?.thumbnail ?? unknownTrackImageUri);
  const currentTrackId = engine.currentTrack?.id;

  useEffect(() => {
    const fetchPlaylistData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        console.log(`[PlaylistView] fetching playlist: ${id}`);
        const info: PlaylistInfo = await MavinEngine.getPlaylistInfo(id, 0);
        setPlaylistData(playlistInfoToPageData(info));
      } catch (error) {
        console.error("[PlaylistView] error fetching playlist:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchPlaylistData();
  }, [id]);

  const handleSongSelect = useCallback((song: Song) => {
    triggerHaptic();
    playAudio(song, playlistData?.songs);
  }, [playAudio, playlistData?.songs]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (!playlistData?.songs.length) return;
    await playPlaylist(playlistData.songs);
  }, [playlistData, playPlaylist]);

  const renderSongItem = useCallback(({ item }: { item: Song }) => {
    const isPlaying = currentTrackId === item.id;
    
    return (
      <View style={styles.songItem}>
        <TouchableOpacity
          style={styles.songItemTouchableArea}
          onPress={() => handleSongSelect(item)}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.resultThumbnail}
            contentFit="cover"
          />
          {isPlaying && (
            <LoaderKit
              style={styles.trackPlayingIconIndicator}
              name="LineScalePulseOutRapid"
              color="white"
            />
          )}
          <View style={styles.resultText}>
            <Text style={[styles.resultTitle, isPlaying && { color: GOLD_PRIMARY }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.resultArtist} numberOfLines={1}>
              {item.artist}
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
  }, [currentTrackId, handleSongSelect, router]);

  const ListHeaderComponent = useCallback(() => (
    <>
      <View style={styles.artworkImageContainer}>
        <Image
          source={{ uri: playlistData?.thumbnail ?? unknownTrackImageUri }}
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
        {playlistData?.title}
      </Text>

      <Text
        style={{
          color: Colors.text,
          textAlign: "center",
          fontSize: moderateScale(15),
          marginBottom: 5,
        }}
      >
        {playlistData?.subtitle}
      </Text>
      <Text
        style={{
          color: Colors.text,
          textAlign: "center",
          fontSize: moderateScale(15),
          marginBottom: 5,
        }}
      >
        {playlistData?.second_subtitle}
      </Text>
    </>
  ), [playlistData]);

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
            {playlistData?.title}
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
          data={playlistData?.songs ?? []}
          renderItem={renderSongItem}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          extraData={currentTrackId}
          ListHeaderComponent={ListHeaderComponent}
          contentContainerStyle={{
            paddingHorizontal: 15,
            paddingBottom: verticalScale(190) + bottom,
          }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={75}
          onScroll={(e) => {
            const pos = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(pos > 0);
            setShowHeaderTitle(pos > titleLayout.y + titleLayout.height);
          }}
          scrollEventThrottle={16}
        />

        {(playlistData?.songs?.length ?? 0) > 0 && (
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
};

export default PlaylistView;

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
    padding: 10,
  },
  songItemTouchableArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  resultThumbnail: {
    width: "55@ms",
    height: "55@ms",
    marginRight: 10,
    borderRadius: 8,
  },
  trackPlayingIconIndicator: {
    position: "absolute",
    top: "18@ms",
    left: "19@ms",
    width: "20@ms",
    height: "20@ms",
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