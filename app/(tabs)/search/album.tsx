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
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useImageColors } from "@/hooks/useImageColors";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
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
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Divider, FAB } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useActiveTrack } from "react-native-track-player";

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

const playlistInfoToAlbumData = (
  info: PlaylistInfo,
  artistOverride: string
): AlbumPageData => {
  const thumbnail =
    info.thumbnails.find((t) => t.resolutionLevel === "HIGH")?.url ??
    info.thumbnails[0]?.url ??
    unknownTrackImageUri;

  const songs: AlbumSong[] = info.items
    .filter((i): i is StreamInfoItem => i.type === "stream")
    .map((s) => ({
      id: s.url.split("v=")[1]?.split("&")[0] ?? s.url,
      title: s.name,
      artist: artistOverride || s.uploaderName,
      thumbnail:
        s.thumbnails.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
        s.thumbnails[0]?.url ??
        thumbnail,
      url: s.url,
      duration: formatDuration(s.duration),
    }));

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

export default function AlbumPageScreen() {
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState<boolean>(false);
  const { top, bottom } = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [albumData, setAlbumData] = useState<AlbumPageData | null>(null);
  const router = useRouter();
  const lastActiveTrack = useLastActiveTrack();
  const activeTrack = useActiveTrack();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });
  const { id, artist } = useLocalSearchParams<{ id: string; artist: string }>();

  const { imageColors } = useImageColors(
    albumData?.thumbnail ?? unknownTrackImageUri
  );

  const isFloatingPlayerNotVisible = !(activeTrack ?? lastActiveTrack);

  useEffect(() => {
    const fetchAlbumData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        console.log(`[AlbumPage] fetching playlist: ${id}`);
        const info: PlaylistInfo = await MavinEngine.getPlaylistInfo(id, 0);
        setAlbumData(playlistInfoToAlbumData(info, artist ?? ""));
      } catch (error) {
        console.error("[AlbumPage] error fetching album:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAlbumData();
  }, [id, artist]);

  const handleSongSelect = (song: AlbumSong, playlist?: AlbumSong[]) => {
    playAudio(song, playlist);
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const ListHeader = () => (
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
  );

  const renderSongItem = ({
    item,
    index,
  }: {
    item: AlbumSong;
    index: number;
  }) => (
    <View key={item.id + index} style={styles.songItem}>
      <TouchableOpacity
        style={styles.songItemTouchableArea}
        onPress={() => {
          triggerHaptic();
          handleSongSelect(item, albumData?.songs);
        }}
      >
        <View style={styles.indexContainer}>
          <Text style={styles.indexText}>{index + 1}</Text>
        </View>
        <View style={styles.resultText}>
          <Text style={styles.resultTitle} numberOfLines={1}>
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
          keyExtractor={(item: AlbumSong) => item.id}
          ListHeaderComponent={ListHeader}
          estimatedItemSize={55}
          contentContainerStyle={{
            paddingHorizontal: 15,
            paddingBottom: verticalScale(190) + bottom,
          }}
          showsVerticalScrollIndicator={false}
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
              marginBottom:
                (isFloatingPlayerNotVisible ? 60 : moderateScale(138)) + bottom,
              right: 0,
              bottom: 0,
              backgroundColor: "white",
            }}
            theme={{ roundness: 7 }}
            icon="play"
            color="black"
            onPress={async () => {
              triggerHaptic();
              if (!albumData?.songs.length) return;
              await playPlaylist(albumData.songs);
              await router.navigate("/player");
            }}
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
    padding: 10,
    paddingLeft: 0,
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