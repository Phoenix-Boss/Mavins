/**
 * FavoritesScreen
 *
 * Displays songs the user has hearted/liked — both streamed and local.
 * - Play individual song or play all / shuffle all
 * - Sort: Recent · A–Z · Artist
 * - Song options menu via `/(modals)/menu`
 * - Active playback indicator
 * - Animated FAB that extends/collapses on scroll
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
import { useFavorites } from "@/store/library";
import { defaultStyles } from "@/styles";
import { Image as ExpoImage } from "expo-image";
import { Entypo, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { FlashList } from "@shopify/flash-list";
import { Text, TouchableOpacity, View } from "react-native";
import LoaderKit from "react-native-loader-kit";
import { AnimatedFAB, Divider } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useActiveTrack } from "@/modules/mavin-eq";

// ─── Sort options ───────────────────────────────────────────────────────────

const SORT_OPTIONS = ["Recent", "A–Z", "Artist"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// ─── FavoritesScreen ────────────────────────────────────────────────────────

const FavoritesScreen = () => {
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [activeSort, setActiveSort] = useState<SortOption>("Recent");
  const { top, bottom } = useSafeAreaInsets();
  const { playAudio, playPlaylist } = useMusicPlayer();
  const lastActiveTrack = useLastActiveTrack();
  const activeTrack = useActiveTrack();
  const router = useRouter();

  // Real data from Redux store
  const { favoriteTracks } = useFavorites();

  const isFloatingPlayerNotVisible = !(activeTrack ?? lastActiveTrack);

  // Sort favorites based on active sort option (no side-effects, pure memo)
  const sortedTracks = useMemo<Song[]>(() => {
    const copy = [...favoriteTracks] as Song[];
    if (activeSort === "A–Z") return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (activeSort === "Artist") return copy.sort((a, b) => a.artist.localeCompare(b.artist));
    return copy; // "Recent" — keep insertion order
  }, [favoriteTracks, activeSort]);

  const handleSongSelect = useCallback(
    (song: Song) => {
      triggerHaptic();
      playAudio(song, sortedTracks);
    },
    [playAudio, sortedTracks],
  );

  const handlePlayAll = async () => {
    triggerHaptic();
    if (sortedTracks.length === 0) return;
    await playPlaylist(sortedTracks);
    await router.navigate("/player");
  };

  const handleShuffleAll = async () => {
    triggerHaptic();
    if (sortedTracks.length === 0) return;
    const shuffled = [...sortedTracks].sort(() => Math.random() - 0.5);
    await playPlaylist(shuffled);
    await router.navigate("/player");
  };

  const handleOpenMenu = useCallback(
    (item: Song) => {
      triggerHaptic();
      router.push({
        pathname: "/(modals)/menu",
        params: {
          songData: JSON.stringify({
            id: item.id,
            title: item.title,
            artist: item.artist,
            thumbnail: item.thumbnail,
          }),
          type: "song",
        },
      });
    },
    [router],
  );

  // ─── List header ─────────────────────────────────────────────────────────

  const ListHeader = () => (
    <>
      {/* Sort pill row */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[styles.sortPill, activeSort === opt && styles.sortPillActive]}
            onPress={() => { triggerHaptic(); setActiveSort(opt); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.sortText, activeSort === opt && styles.sortTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}

        {/* Shuffle action */}
        {sortedTracks.length > 1 && (
          <TouchableOpacity style={styles.sortPill} onPress={handleShuffleAll} activeOpacity={0.7}>
            <MaterialCommunityIcons name="shuffle-variant" size={moderateScale(14)} color="#888" />
          </TouchableOpacity>
        )}
      </View>

      {/* Track count */}
      {sortedTracks.length > 0 && (
        <Text style={styles.trackCount}>
          {sortedTracks.length} {sortedTracks.length === 1 ? "Song" : "Songs"}
        </Text>
      )}
    </>
  );

  // ─── Render item ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: Song }) => {
      const isPlaying = activeTrack?.id === item.id;
      return (
        <View style={styles.songItem}>
          <TouchableOpacity
            style={styles.songItemTouchableArea}
            onPress={() => handleSongSelect(item)}
            activeOpacity={0.7}
          >
            <ExpoImage
              source={{ uri: item.thumbnail }}
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
              <Text style={[styles.resultTitle, isPlaying && styles.resultTitleActive]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.resultArtist} numberOfLines={1}>
                {item.artist}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Options menu button */}
          <TouchableOpacity
            onPress={() => handleOpenMenu(item)}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          >
            <Entypo name="dots-three-vertical" size={moderateScale(15)} color="white" />
          </TouchableOpacity>
        </View>
      );
    },
    [handleSongSelect, handleOpenMenu, activeTrack],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={defaultStyles.container}>

      {/* Header */}
      <View style={[styles.header, { paddingTop: top }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={moderateScale(25)}
            color={Colors.text}
            onPress={() => { triggerHaptic(); router.back(); }}
            style={{ marginRight: 10 }}
          />
          <Text style={styles.headerText}>Favourites</Text>
        </View>

        {/* Play all button in header when there are tracks */}
        {sortedTracks.length > 0 && (
          <TouchableOpacity style={styles.headerPlayBtn} onPress={handlePlayAll} activeOpacity={0.8}>
            <MaterialCommunityIcons name="play" size={moderateScale(18)} color="#000" />
          </TouchableOpacity>
        )}
      </View>

      {/* Divider on scroll */}
      {isScrolling && (
        <Divider style={{ backgroundColor: "rgba(255,255,255,0.3)", height: 0.3 }} />
      )}

      <FlashList
        data={sortedTracks}
        renderItem={renderItem}
        extraData={activeTrack}
        keyExtractor={(item) => item.id}
        estimatedItemSize={75}
        contentContainerStyle={{
          paddingBottom: verticalScale(190) + bottom,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const y = Math.floor(e.nativeEvent.contentOffset.y) || 0;
          setIsScrolling(y > 5);
        }}
        scrollEventThrottle={16}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="heart-outline" size={moderateScale(52)} color="rgba(212,175,55,0.35)" />
            <Text style={styles.emptyTitle}>No favourites yet</Text>
            <Text style={styles.emptySub}>
              Heart songs from the streaming feed or your local library to find them here.
            </Text>
          </View>
        }
        ListFooterComponent={
          sortedTracks.length > 0 ? (
            <Text style={styles.footerText}>
              {sortedTracks.length} {sortedTracks.length === 1 ? "Track" : "Tracks"}
            </Text>
          ) : null
        }
      />

      {/* Floating Action Button */}
      {sortedTracks.length > 0 && (
        <AnimatedFAB
          style={[
            styles.fab,
            {
              marginBottom:
                (isFloatingPlayerNotVisible ? 60 : moderateScale(138)) + bottom,
            },
          ]}
          theme={{ roundness: 1 }}
          extended={!isScrolling}
          animateFrom="right"
          icon="play"
          label="Play All"
          color="black"
          onPress={handlePlayAll}
        />
      )}
    </View>
  );
};

export default FavoritesScreen;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  headerText: {
    fontSize: "22@ms",
    color: Colors.text,
    fontFamily: "Meriva",
  },
  headerPlayBtn: {
    width: "36@ms",
    height: "36@ms",
    borderRadius: "18@ms",
    backgroundColor: "#D4AF37",
    alignItems: "center",
    justifyContent: "center",
  },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "8@s",
    paddingHorizontal: 20,
    paddingVertical: "12@vs",
  },
  sortPill: {
    paddingHorizontal: "12@s",
    paddingVertical: "6@vs",
    borderRadius: "20@ms",
    backgroundColor: "#161616",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.07)",
  },
  sortPillActive: {
    backgroundColor: "rgba(212,175,55,0.1)",
    borderColor: "rgba(212,175,55,0.22)",
  },
  sortText: { fontSize: "12@ms", color: "#888", fontWeight: "500" },
  sortTextActive: { color: "#D4AF37" },
  trackCount: {
    fontSize: "12@ms",
    color: "#4A4A4A",
    paddingHorizontal: 20,
    paddingBottom: "6@vs",
    fontWeight: "500",
  },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "10@ms",
    paddingLeft: 20,
    paddingRight: 30,
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
  footerText: {
    color: Colors.textMuted,
    textAlign: "center",
    fontSize: "15@ms",
    paddingTop: 10,
  },
  fab: {
    position: "absolute",
    marginRight: 16,
    right: 0,
    bottom: 0,
    backgroundColor: "white",
  },
});