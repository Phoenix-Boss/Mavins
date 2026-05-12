/**
 * This file defines the `ItemList` component, a generic screen for displaying
 * lists of various media types (songs, videos, albums, artists). It dynamically renders
 * items based on the `type` parameter passed via navigation, and provides playback
 * and navigation functionalities.
 *
 * FIXES:
 *   - Removed react-native-track-player (useActiveTrack)
 *   - Removed router.navigate("/player") — player is overlay, not a route
 *   - Uses PlayerEngineContext for active track detection
 *   - All hooks called unconditionally
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import { defaultStyles } from "@/styles";
import { FlashList } from "@shopify/flash-list";
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

// Use PlayerEngineContext instead of RNTP
import { usePlayerEngine } from "@/libs/playerSetup";

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD_PRIMARY = "#D4AF37";

/**
 * `ItemList` component.
 * A generic screen for displaying lists of various media types.
 */
const ItemList = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [formattedTracks, setFormattedTracks] = useState<Song[] | Video[]>([]);
  const [formattedTracksAlbums, setFormattedTracksAlbums] = useState<Album[]>([]);
  const [formattedTracksArtists, setFormattedTracksArtists] = useState<Artist[]>([]);
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const { data, type, title } = useLocalSearchParams<{
    data: string;
    type: string;
    title: string;
  }>();

  // ALL HOOKS CALLED UNCONDITIONALLY
  const engine = usePlayerEngine();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const currentTrackId = engine.currentTrack?.id;

  /**
   * Handles the selection of a song, initiating playback.
   */
  const handleSongSelect = useCallback((song: Song) => {
    triggerHaptic();
    playAudio(song, formattedTracks);
  }, [formattedTracks, playAudio]);

  /**
   * Renders a song search result item.
   */
  const renderSongResult = useCallback(({ item }: { item: Song }) => {
    const isPlaying = currentTrackId === item.id;
    
    return (
      <View key={item.id} style={styles.searchResult}>
        <TouchableOpacity
          style={styles.searchResultTouchableArea}
          onPress={() => handleSongSelect(item)}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.songThumbnail}
            contentFit="cover"
          />
          {isPlaying && (
            <LoaderKit
              style={styles.songTrackPlayingIconIndicator}
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
              params: { songData: songData, type: "song" },
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
  }, [currentTrackId, router, handleSongSelect]);

  /**
   * Renders a video search result item.
   */
  const renderVideoResult = useCallback(({ item }: { item: Song }) => {
    const isPlaying = currentTrackId === item.id;
    
    return (
      <View key={item.id} style={styles.searchResult}>
        <TouchableOpacity
          style={styles.searchResultTouchableArea}
          onPress={() => handleSongSelect(item)}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.videoThumbnail}
            contentFit="cover"
          />
          {isPlaying && (
            <LoaderKit
              style={styles.videoTrackPlayingIconIndicator}
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
              params: { songData: songData, type: "song" },
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
  }, [currentTrackId, router, handleSongSelect]);

  /**
   * Renders an album search result item.
   */
  const renderAlbumResult = useCallback(({ item }: { item: Album }) => (
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
        activeOpacity={0.7}
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
            params: {
              albumData: albumData,
              type: "album",
            },
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
  ), [router]);

  /**
   * Renders an artist search result item.
   */
  const renderArtistResult = useCallback(({ item }: { item: Artist }) => (
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
        activeOpacity={0.7}
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
  ), [router]);

  useEffect(() => {
    const fetchTracks = async () => {
      setIsLoading(true);
      try {
        if (type === "song" || type === "video") {
          const tracks: Song[] = JSON.parse(data) as Song[];
          setFormattedTracks(tracks);
        }
        if (type === "album") {
          const tracks: Album[] = JSON.parse(data) as Album[];
          setFormattedTracksAlbums(tracks);
        }
        if (type === "artist") {
          const tracks: Artist[] = JSON.parse(data) as Artist[];
          setFormattedTracksArtists(tracks);
        }
      } catch (error) {
        console.error("Error fetching favorite tracks", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTracks();
  }, [data, type]);

  const getItems = () => {
    if (type === "song" || type === "video") return formattedTracks;
    if (type === "album") return formattedTracksAlbums;
    if (type === "artist") return formattedTracksArtists;
    return [];
  };
  const items = getItems();

  const renderItem = useCallback(({ item }: { item: any }) => {
    switch (type) {
      case "song":
        return renderSongResult({ item });
      case "video":
        return renderVideoResult({ item });
      case "album":
        return renderAlbumResult({ item });
      case "artist":
        return renderArtistResult({ item });
      default:
        return null;
    }
  }, [type, renderAlbumResult, renderArtistResult, renderSongResult, renderVideoResult]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (formattedTracks.length === 0) return;
    await playPlaylist(formattedTracks);
  }, [formattedTracks, playPlaylist]);

  const isFloatingPlayerNotVisible = !engine.currentTrack;

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

      {/* Loading Indicator */}
      {isLoading ? (
        <ActivityIndicator color="white" size="large" />
      ) : (
        <FlashList
          data={items}
          renderItem={renderItem}
          getItemType={() => type}
          keyExtractor={(item: any, idx: number) => `${item.id}-${idx}`}
          extraData={currentTrackId}
          contentContainerStyle={{
            paddingBottom: verticalScale(190) + bottom,
          }}
          showsVerticalScrollIndicator={false}
          estimatedItemSize={75}
          onScroll={(e) => {
            const currentScrollPosition = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(currentScrollPosition > 5);
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
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
            marginBottom: (isFloatingPlayerNotVisible ? 60 : moderateScale(138)) + bottom,
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
  );
};

export default ItemList;

// Styles for the ItemList component.
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