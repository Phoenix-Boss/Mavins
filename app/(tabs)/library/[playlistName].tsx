// app/(library)/[playlistName].tsx
/**
 * PlaylistView
 *
 * Displays the contents of a specific playlist.
 * - Song list with active playback indicator
 * - Sort: Default · A–Z · Artist
 * - Shuffle all
 * - Play entire playlist via FAB
 * - Individual song options menu
 * - Gradient header from first track's artwork colours
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useImageColors } from "@/hooks/useImageColors";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
import { useActiveTrack } from "@/hooks/useActiveTrack";
import { usePlaylists, usePlaylistTracks } from "@/store/library";
import type { Song as LibrarySong } from "@/store/library";
import type { Song } from "@/types/song";
import { FlashList, FlashListProps } from "@shopify/flash-list";
import { Image as ExpoImage } from "expo-image";
import { Entypo, Ionicons } from "@expo/vector-icons";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import color from "color";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import LoaderKit from "react-native-loader-kit";
import { Divider, FAB } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";

// ─── Sort options ───────────────────────────────────────────────────────────

const SORT_OPTIONS = ["Default", "A–Z", "Artist"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// ─── Typed FlashList wrapper ─────────────────────────────────────────────────

type FlashListPropsWithEstimated<T> = FlashListProps<T> & {
  estimatedItemSize?: number;
};
const TypedFlashList = FlashList as React.ComponentType<
  FlashListPropsWithEstimated<LibrarySong>
>;

// ─── Normalise store Song → types/song.Song ──────────────────────────────────
// library.Song:     url?: string, thumbnail?: string  (both optional)
// types/song.Song:  url:  string, thumbnail:  string  (both required)

const toPlayerSong = (s: LibrarySong): Song => ({
  id:        s.id,
  title:     s.title,
  artist:    s.artist,
  thumbnail: s.thumbnail ?? "",
  url:       s.url       ?? "",
  videoId:   undefined,
  videoUrl:  undefined,
  duration:  s.duration,
});

// ─── PlaylistView ────────────────────────────────────────────────────────────

const PlaylistView = () => {
  const [isScrolling, setIsScrolling] = useState(false);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);
  const [titleLayout, setTitleLayout] = useState({ y: 0, height: 0 });
  const [activeSort, setActiveSort] = useState<SortOption>("Default");

  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const lastActiveTrack = useLastActiveTrack();
  const activeTrack = useActiveTrack();
  const { playAudio, playPlaylist } = useMusicPlayer();

  // Get the playlist name/id from navigation params
  const { playlistName } = useLocalSearchParams<{ playlistName: string }>();

  // usePlaylists returns Record<string, Playlist | SmartPlaylist> directly
  const playlists = usePlaylists();
  const playlistMeta = playlistName ? playlists[playlistName] : null;
  const displayName = playlistMeta?.name ?? playlistName ?? "";

  // usePlaylistTracks resolves trackIds → LibrarySong[] via the store
  const rawTracks = usePlaylistTracks(playlistName ?? "");

  // Sort
  const playlist = useMemo<LibrarySong[]>(() => {
    if (activeSort === "A–Z")
      return [...rawTracks].sort((a, b) => a.title.localeCompare(b.title));
    if (activeSort === "Artist")
      return [...rawTracks].sort((a, b) => a.artist.localeCompare(b.artist));
    return rawTracks; // Default
  }, [rawTracks, activeSort]);

  // Derive artwork colours from the first song's thumbnail
  const { imageColors } = useImageColors(
    playlist[0]?.thumbnail ?? unknownTrackImageUri,
  );

  const isFloatingPlayerNotVisible = !(activeTrack ?? lastActiveTrack);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleSongSelect = (song: LibrarySong) => {
    triggerHaptic();
    playAudio(toPlayerSong(song), playlist.map(toPlayerSong));
  };

  const handleShuffleAll = async () => {
    triggerHaptic();
    if (playlist.length === 0) return;
    const shuffled = [...playlist].sort(() => Math.random() - 0.5);
    await playPlaylist(shuffled.map(toPlayerSong));
    await router.navigate("/(player)");
  };

  const handlePlayAll = async () => {
    triggerHaptic();
    if (playlist.length === 0) return;
    await playPlaylist(playlist.map(toPlayerSong));
    await router.navigate("/(player)");
  };

  // ─── Sub-components ───────────────────────────────────────────────────────

  const ListHeader = () => (
    <>
      {/* Artwork */}
      <View style={styles.artworkImageContainer}>
        <ExpoImage
          source={{ uri: playlist[0]?.thumbnail ?? unknownTrackImageUri }}
          style={styles.artworkImage}
          contentFit="cover"
          priority="high"
        />
      </View>

      {/* Title */}
      <Text
        onLayout={(e) => {
          const l = e.nativeEvent.layout;
          setTitleLayout({ y: l.y, height: l.height });
        }}
        style={styles.titleText}
      >
        {displayName}
      </Text>

      {/* Track count */}
      {playlist.length > 0 && (
        <Text style={styles.trackCountText}>
          {playlist.length} {playlist.length === 1 ? "Track" : "Tracks"}
        </Text>
      )}

      {/* Controls row: Sort pills + Shuffle */}
      {rawTracks.length > 0 && (
        <View style={styles.controlsRow}>
          <View style={styles.sortRow}>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.sortPill,
                  activeSort === opt && styles.sortPillActive,
                ]}
                onPress={() => {
                  triggerHaptic();
                  setActiveSort(opt);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.sortText,
                    activeSort === opt && styles.sortTextActive,
                  ]}
                >
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {playlist.length > 1 && (
            <TouchableOpacity
              style={styles.shuffleBtn}
              onPress={handleShuffleAll}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="shuffle-variant"
                size={moderateScale(18)}
                color="#D4AF37"
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  );

  const renderSongItem = ({
    item,
    index,
  }: {
    item: LibrarySong;
    index: number;
  }) => {
    const isPlaying = activeTrack?.id === item.id;
    return (
      <View style={styles.songItem}>
        <TouchableOpacity
          style={styles.songItemTouchableArea}
          onPress={() => handleSongSelect(item)}
          activeOpacity={0.7}
        >
          <ExpoImage
            source={{ uri: item.thumbnail ?? "" }}
            style={styles.resultThumbnail}
            contentFit="cover"
            priority="normal"
          />
          {isPlaying && (
            <LoaderKit
              style={styles.trackPlayingIconIndicator}
              name="LineScalePulseOutRapid"
              color="white"
            />
          )}
          <View style={styles.resultText}>
            <Text
              style={[
                styles.resultTitle,
                isPlaying && styles.resultTitleActive,
              ]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text style={styles.resultArtist} numberOfLines={1}>
              {item.artist}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Options menu */}
        <TouchableOpacity
          onPress={() => {
            triggerHaptic();
            router.push({
              pathname: "/(modals)/menu",
              params: {
                songData: JSON.stringify({
                  id:        item.id,
                  title:     item.title,
                  artist:    item.artist,
                  thumbnail: item.thumbnail ?? "",
                }),
                type: "playlistSong",
                playlistName: playlistName,
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
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

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
        {/* Header */}
        <View
          style={[
            styles.header,
            isScrolling && styles.headerScrolled,
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
            style={[
              styles.headerText,
              !showHeaderTitle && { opacity: 0 },
            ]}
          >
            {displayName}
          </Text>
          {/* Header play button — visible when title scrolled past */}
          {showHeaderTitle && playlist.length > 0 && (
            <TouchableOpacity
              style={styles.headerPlayBtn}
              onPress={handlePlayAll}
              hitSlop={10}
            >
              <MaterialCommunityIcons
                name="play"
                size={moderateScale(18)}
                color="#000"
              />
            </TouchableOpacity>
          )}
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

        <TypedFlashList
          data={playlist}
          renderItem={renderSongItem}
          keyExtractor={(item: LibrarySong) => item.id}
          estimatedItemSize={75}
          extraData={[activeTrack, activeSort]}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{
            paddingHorizontal: 15,
            paddingBottom: verticalScale(190) + bottom,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            const y = Math.floor(e.nativeEvent.contentOffset.y) || 0;
            setIsScrolling(y > 0);
            setShowHeaderTitle(y > titleLayout.y + titleLayout.height);
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons
                name="playlist-music-outline"
                size={moderateScale(52)}
                color="rgba(212,175,55,0.35)"
              />
              <Text style={styles.emptyTitle}>This playlist is empty</Text>
              <Text style={styles.emptySub}>
                Add songs from the streaming feed or your local library.
              </Text>
            </View>
          }
        />

        {/* Play All FAB */}
        {playlist.length > 0 && (
          <FAB
            style={{
              position: "absolute",
              marginRight: 16,
              marginBottom:
                (isFloatingPlayerNotVisible ? 60 : moderateScale(138)) +
                bottom,
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1 },
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
    flex: 1,
  },
  headerPlayBtn: {
    width: "34@ms",
    height: "34@ms",
    borderRadius: "17@ms",
    backgroundColor: "#D4AF37",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
  },
  headerScrolled: { backgroundColor: "rgba(0,0,0,0.3)" },
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
    resizeMode: "cover",
    borderRadius: 12,
  },
  titleText: {
    fontSize: "24@ms",
    fontWeight: "bold",
    color: Colors.text,
    marginHorizontal: 15,
    textAlign: "center",
    marginBottom: 4,
  },
  trackCountText: {
    color: Colors.text,
    textAlign: "center",
    fontSize: "15@ms",
    marginBottom: 12,
    opacity: 0.7,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "8@s",
    flex: 1,
  },
  sortPill: {
    paddingHorizontal: "12@s",
    paddingVertical: "6@vs",
    borderRadius: "20@ms",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.12)",
  },
  sortPillActive: {
    backgroundColor: "rgba(212,175,55,0.15)",
    borderColor: "rgba(212,175,55,0.3)",
  },
  sortText: {
    fontSize: "12@ms",
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
  },
  sortTextActive: { color: "#D4AF37" },
  shuffleBtn: {
    width: "36@ms",
    height: "36@ms",
    borderRadius: "10@ms",
    backgroundColor: "rgba(212,175,55,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "10@vs",
  },
  songItemTouchableArea: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  resultThumbnail: {
    width: "55@ms",
    height: "55@ms",
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  trackPlayingIconIndicator: {
    position: "absolute",
    top: "18@ms",
    left: "19@ms",
    width: "20@ms",
    height: "20@ms",
  },
  resultText: { flex: 1, marginRight: 10 },
  resultTitle: { color: Colors.text, fontSize: "16@ms" },
  resultTitleActive: { color: "#D4AF37" },
  resultArtist: { color: Colors.textMuted, fontSize: "14@ms" },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: "24@s",
    paddingTop: "60@vs",
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: "18@ms",
    fontWeight: "700",
    marginTop: "20@vs",
    textAlign: "center",
  },
  emptySub: {
    color: Colors.textMuted,
    fontSize: "14@ms",
    textAlign: "center",
    marginTop: "8@vs",
    lineHeight: "21@ms",
  },
});