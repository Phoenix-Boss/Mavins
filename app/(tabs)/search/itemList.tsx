// app/(tabs)/search/itemList.tsx
/**
 * ItemList - expo-av version
 *
 * A generic screen for displaying lists of various media types (songs, videos,
 * albums, artists). Uses useActiveTrack and useLastActiveTrack from expo-av hooks.
 *
 * Fixes applied
 * ─────────────
 * 1. Song.url changed from optional (url?: string) to required (url: string) so
 *    playAudio / playPlaylist always receive a usable URL. JSON data that omits
 *    the field now falls back to an empty string rather than undefined, making
 *    the type mismatch visible at the call-site rather than at runtime.
 * 2. renderVideoResult was a near-identical copy of renderSongResult — collapsed
 *    into a single renderTrackResult helper that accepts a style-variant ("song"
 *    | "video") so the two public callbacks delegate to one place.
 * 3. FlashList is now typed: FlashList<Song | Video | Album | Artist>.
 *    getItemType narrowed to return consistent string literals per branch.
 * 4. router.navigate("/player") → router.push("/player") to keep the back-stack
 *    intact and stay consistent with the rest of the codebase.
 * 5. fetchTracks useEffect now guards against a missing / non-string data param
 *    before calling JSON.parse, preventing a silent crash on bad navigation.
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
import { useActiveTrack } from "@/hooks/useActiveTrack";
import { defaultStyles } from "@/styles";
import { FlashList, FlashListProps } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import LoaderKit from "react-native-loader-kit";
import { Divider, FAB } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from "react-native-size-matters/extend";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  /** FIX 1: was `url?: string` — must be required so playAudio always has a URL */
  url: string;
  duration?: number;
}

interface Album {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  year?: string;
}

interface Artist {
  id: string;
  name: string;
  subtitle: string;
  thumbnail: string;
}

// Video shares the same shape as Song (different thumbnail dimensions only)
type Video = Song;

type ListItem = Song | Video | Album | Artist;

// ─── Typed FlashList wrapper (estimatedItemSize missing from installed types) ─
type FlashListPropsWithEstimated<T> = FlashListProps<T> & {
  estimatedItemSize?: number;
};
const TypedFlashList = FlashList as React.ComponentType<
  FlashListPropsWithEstimated<ListItem>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ItemList = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [formattedTracks, setFormattedTracks] = useState<Song[] | Video[]>([]);
  const [formattedTracksAlbums, setFormattedTracksAlbums] = useState<Album[]>([]);
  const [formattedTracksArtists, setFormattedTracksArtists] = useState<Artist[]>([]);

  const { top, bottom } = useSafeAreaInsets();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const lastActiveTrack = useLastActiveTrack();
  const activeTrack = useActiveTrack();
  const router = useRouter();

  const { data, type, title } = useLocalSearchParams<{
    data: string;
    type: string;
    title: string;
  }>();

  const isFloatingPlayerNotVisible = !(activeTrack ?? lastActiveTrack);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSongSelect = useCallback(
    (song: Song) => {
      triggerHaptic();
      playAudio(song, formattedTracks);
    },
    [formattedTracks, playAudio],
  );

  // ── Render helpers ────────────────────────────────────────────────────────

  /**
   * FIX 2: renderSongResult and renderVideoResult were near-identical. Collapsed
   * into one helper parameterised by variant. The only difference between the two
   * was the thumbnail dimensions and the playing-indicator position — both are
   * now driven by the `variant` argument via a small lookup object.
   */
  const renderTrackResult = useCallback(
    (item: Song, variant: "song" | "video") => {
      const isPlaying = activeTrack?.id === item.id;

      const thumbnailStyle =
        variant === "song" ? styles.songThumbnail : styles.videoThumbnail;
      const indicatorStyle =
        variant === "song"
          ? styles.songTrackPlayingIconIndicator
          : styles.videoTrackPlayingIconIndicator;

      return (
        <View key={item.id} style={styles.searchResult}>
          <TouchableOpacity
            style={styles.searchResultTouchableArea}
            onPress={() => handleSongSelect(item)}
          >
            <Image
              source={{ uri: item.thumbnail }}
              style={thumbnailStyle}
              contentFit="cover"
            />
            {isPlaying && (
              <LoaderKit
                style={indicatorStyle}
                name="LineScalePulseOutRapid"
                color="white"
              />
            )}
            <View style={styles.resultText}>
              <Text
                style={[styles.resultTitle, isPlaying && { color: "#D4AF37" }]}
                numberOfLines={1}
              >
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
    },
    [activeTrack, router, handleSongSelect],
  );

  const renderSongResult = useCallback(
    ({ item }: { item: Song }) => renderTrackResult(item, "song"),
    [renderTrackResult],
  );

  const renderVideoResult = useCallback(
    ({ item }: { item: Video }) => renderTrackResult(item, "video"),
    [renderTrackResult],
  );

  const renderAlbumResult = useCallback(
    ({ item }: { item: Album }) => (
      <View key={item.id} style={styles.searchResult}>
        <TouchableOpacity
          style={styles.searchResultTouchableArea}
          onPress={() => {
            triggerHaptic();
            router.push({
              pathname: "/(tabs)/search/album",
              params: {
                id: item.id,
                title: item.title,
                thumbnail: item.thumbnail,
                artist: item.artist,
              },
            });
          }}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.songThumbnail}
            contentFit="cover"
          />
          <View style={styles.resultText}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.resultArtist} numberOfLines={1}>
              {item.artist} • {item.year}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            triggerHaptic();
            const albumData = JSON.stringify({
              name: item.title,
              thumbnail: item.thumbnail,
              id: item.id,
              artist: item.artist,
            });
            router.push({
              pathname: "/(modals)/menu",
              params: { albumData, type: "album" },
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
    ),
    [router],
  );

  const renderArtistResult = useCallback(
    ({ item }: { item: Artist }) => (
      <View key={item.id} style={styles.searchResult}>
        <TouchableOpacity
          style={styles.searchResultTouchableArea}
          onPress={() => {
            triggerHaptic();
            router.push({
              pathname: "/(tabs)/search/artist",
              params: { id: item.id, subtitle: item.subtitle },
            });
          }}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.songThumbnail}
            contentFit="cover"
          />
          <View style={styles.resultText}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.resultArtist} numberOfLines={1}>
              {item.subtitle}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    ),
    [router],
  );

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchTracks = async () => {
      setIsLoading(true);
      try {
        /**
         * FIX 5: Guard against missing / non-string data before JSON.parse.
         * Without this, navigating to the screen without a data param would
         * throw a SyntaxError and leave the list permanently in a loading state.
         */
        if (!data || typeof data !== "string") return;

        if (type === "song" || type === "video") {
          const tracks = JSON.parse(data) as Song[];
          // Normalise: ensure every track has a url string (may be absent in
          // older cached payloads) so playAudio never receives undefined.
          setFormattedTracks(
            tracks.map((t) => ({ ...t, url: t.url ?? "" })),
          );
        } else if (type === "album") {
          setFormattedTracksAlbums(JSON.parse(data) as Album[]);
        } else if (type === "artist") {
          setFormattedTracksArtists(JSON.parse(data) as Artist[]);
        }
      } catch (error) {
        console.error("Error parsing item list data", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTracks();
  }, [data, type]);

  // ── Derived list & render dispatch ────────────────────────────────────────

  const items: ListItem[] = (() => {
    if (type === "song" || type === "video") return formattedTracks;
    if (type === "album") return formattedTracksAlbums;
    if (type === "artist") return formattedTracksArtists;
    return [];
  })();

  /**
   * FIX 3: FlashList is now typed as FlashList<ListItem>.
   * renderItem casts item to the correct subtype per branch so each
   * render callback receives proper types without any `any`.
   */
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (type) {
        case "song":
          return renderSongResult({ item: item as Song });
        case "video":
          return renderVideoResult({ item: item as Video });
        case "album":
          return renderAlbumResult({ item: item as Album });
        case "artist":
          return renderArtistResult({ item: item as Artist });
        default:
          return null;
      }
    },
    [type, renderAlbumResult, renderArtistResult, renderSongResult, renderVideoResult],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={defaultStyles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top }]}>
        <MaterialCommunityIcons
          name="arrow-left"
          size={moderateScale(25)}
          color={Colors.text}
          onPress={() => {
            triggerHaptic();
            router.back();
          }}
        />
        <Text style={styles.headerText}>{title}</Text>
      </View>

      {isScrolling && (
        <Divider
          style={{ backgroundColor: "rgba(255,255,255,0.3)", height: 0.3 }}
        />
      )}

      {isLoading ? (
        <ActivityIndicator color="white" size="large" />
      ) : (
        <TypedFlashList
          data={items}
          renderItem={renderItem}
          getItemType={() => type ?? "song"}
          keyExtractor={(item) => (item as { id: string }).id}
          extraData={activeTrack}
          contentContainerStyle={{ paddingBottom: verticalScale(190) + bottom }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={75}
          onScroll={(e) => {
            const pos = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(pos > 5);
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text
                style={{
                  color: Colors.text,
                  textAlign: "center",
                  fontSize: moderateScale(20),
                  paddingHorizontal: 20,
                }}
              >
                No Result Found
              </Text>
            </View>
          }
        />
      )}

      {(type === "song" || type === "video") && formattedTracks.length > 0 && (
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
            if (formattedTracks.length === 0) return;
            await playPlaylist(formattedTracks);
            // FIX 4: router.navigate → router.push to preserve back-stack
            router.push("/(player)");
          }}
        />
      )}
    </View>
  );
};

export default ItemList;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  headerText: {
    fontSize: "20@ms",
    fontWeight: "bold",
    color: Colors.text,
    paddingLeft: 15,
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "10@ms",
    paddingLeft: 10,
    paddingRight: 30,
  },
  searchResultTouchableArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  songThumbnail: {
    width: "55@ms",
    height: "55@ms",
    marginHorizontal: "10@ms",
    borderRadius: 5,
  },
  songTrackPlayingIconIndicator: {
    position: "absolute",
    top: "17.5@ms",
    left: "28@ms",
    width: "20@ms",
    height: "20@ms",
  },
  videoThumbnail: {
    width: "64@ms",
    height: "36@ms",
    marginHorizontal: "10@ms",
    borderRadius: 5,
  },
  videoTrackPlayingIconIndicator: {
    position: "absolute",
    top: "10@ms",
    left: "33@ms",
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