/**
 * DownloadsScreen
 *
 * Displays songs downloaded to the device for offline playback.
 * - Active download progress cards
 * - Sort: Recent Â· Aâ€“Z Â· Duration
 * - Play individual song, play all, or shuffle all
 * - Song options menu via `/(modals)/menu`
 * - Active playback indicator
 * - Animated FAB that extends/collapses on scroll
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
import {
  DownloadedSongMetadata,
  useActiveDownloads,
  useDownloadedTracks,
} from "@/store/library";
import { defaultStyles } from "@/styles";
import { Image as ExpoImage } from "expo-image";
import Entypo from "@expo/vector-icons/Entypo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState, useCallback } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import LoaderKit from "react-native-loader-kit";
import { AnimatedFAB, Divider } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useActiveTrack } from "@/modules/mavin-eq";

// â”€â”€â”€ Sort options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SORT_OPTIONS = ["Recent", "Aâ€“Z", "Duration"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// â”€â”€â”€ DownloadsScreen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DownloadsScreen = () => {
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [activeSort, setActiveSort] = useState<SortOption>("Recent");
  const { top, bottom } = useSafeAreaInsets();
  const { playDownloadedSong, playAllDownloadedSongs } = useMusicPlayer();
  const lastActiveTrack = useLastActiveTrack();
  const activeTrack = useActiveTrack();
  const router = useRouter();

  // Real data from Redux store
  const downloadedTracksMeta = useDownloadedTracks();
  const activeDownloads = useActiveDownloads();

  const isFloatingPlayerNotVisible = !(activeTrack ?? lastActiveTrack);

  // Sort and format downloaded tracks (pure memo, no side-effect setState)
  const formattedTracks: DownloadedSongMetadata[] = useMemo(() => {
    const copy = [...downloadedTracksMeta];
    if (activeSort === "Aâ€“Z") return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (activeSort === "Duration") return copy.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return copy.reverse(); // "Recent" â€” newest first
  }, [downloadedTracksMeta, activeSort]);

  const handleSongSelect = useCallback(
    (song: DownloadedSongMetadata) => {
      triggerHaptic();
      playDownloadedSong(song, formattedTracks);
    },
    [formattedTracks, playDownloadedSong],
  );

  const handlePlayAll = async () => {
    triggerHaptic();
    if (formattedTracks.length === 0) return;
    await playAllDownloadedSongs(formattedTracks);
    await router.navigate("/player");
  };

  const handleShuffleAll = async () => {
    triggerHaptic();
    if (formattedTracks.length === 0) return;
    const shuffled = [...formattedTracks].sort(() => Math.random() - 0.5);
    await playAllDownloadedSongs(shuffled);
    await router.navigate("/player");
  };

  const handleOpenMenu = useCallback(
    (song: DownloadedSongMetadata) => {
      triggerHaptic();
      const originalMetadata = downloadedTracksMeta.find((m) => m.id === song.id);
      if (!originalMetadata) return;

      router.push({
        pathname: "/(modals)/menu",
        params: {
          songData: JSON.stringify({
            id: originalMetadata.id,
            title: originalMetadata.title,
            artist: originalMetadata.artist,
            thumbnail: originalMetadata.localArtworkUri,
            url: originalMetadata.localTrackUri,
            duration: originalMetadata.duration,
          }),
          type: "downloadedSong",
        },
      });
    },
    [downloadedTracksMeta, router],
  );

  // â”€â”€â”€ List header (sort pills + active downloads) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const ListHeader = useMemo(
    () => (
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

          {/* Shuffle */}
          {formattedTracks.length > 1 && (
            <TouchableOpacity style={styles.sortPill} onPress={handleShuffleAll} activeOpacity={0.7}>
              <MaterialCommunityIcons name="shuffle-variant" size={moderateScale(14)} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        {/* Active downloads progress cards */}
        {activeDownloads.length > 0 && (
          <View style={styles.activeDownloadsSection}>
            <Text style={styles.activeDownloadsTitle}>
              Downloading ({activeDownloads.length})
            </Text>
            {activeDownloads.map((song) => (
              <View key={song.id} style={styles.activeDownloadItem}>
                <ExpoImage
                  source={{ uri: song.thumbnail ?? unknownTrackImageUri }}
                  style={[styles.resultThumbnail, { opacity: 0.6 }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text numberOfLines={1} style={styles.resultTitle}>{song.title}</Text>
                  <Text style={styles.resultArtist}>{song.artist}</Text>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[styles.progressBarFill, { width: `${Math.min(100, Math.floor(song.progress))}%` }]}
                    />
                  </View>
                  <Text style={styles.progressPct}>{song.progress.toFixed(0)}%</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Track count */}
        {formattedTracks.length > 0 && (
          <Text style={styles.trackCount}>
            {formattedTracks.length} {formattedTracks.length === 1 ? "Download" : "Downloads"}
          </Text>
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDownloads, formattedTracks, activeSort],
  );

  // â”€â”€â”€ Render item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const renderItem = useCallback(
    ({ item }: { item: DownloadedSongMetadata }) => {
      const isPlaying =
        activeTrack?.id === item.id && activeTrack?.url === item.localTrackUri;
      return (
        <View style={styles.songItem}>
          <TouchableOpacity
            style={styles.songItemTouchableArea}
            onPress={() => handleSongSelect(item)}
            activeOpacity={0.7}
          >
            <ExpoImage
              source={{ uri: item.localArtworkUri ?? unknownTrackImageUri }}
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
              <Text style={[styles.resultTitle, isPlaying && styles.resultTitleActive]} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>
                {/* Local badge */}
                <View style={styles.localBadge}>
                  <MaterialCommunityIcons name="cellphone" size={moderateScale(8)} color="#4A90E2" />
                  <Text style={styles.localBadgeText}>Local</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>

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

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          <Text style={styles.headerText}>Downloads</Text>
        </View>

        {/* Play all */}
        {formattedTracks.length > 0 && (
          <TouchableOpacity style={styles.headerPlayBtn} onPress={handlePlayAll} activeOpacity={0.8}>
            <MaterialCommunityIcons name="play" size={moderateScale(18)} color="#000" />
          </TouchableOpacity>
        )}
      </View>

      {isScrolling && (
        <Divider style={{ backgroundColor: "rgba(255,255,255,0.3)", height: 0.3 }} />
      )}

      <FlashList
        data={formattedTracks}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={75}
        extraData={activeTrack}
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
          activeDownloads.length === 0 ? (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons
                name="cloud-download-outline"
                size={moderateScale(52)}
                color="rgba(212,175,55,0.35)"
              />
              <Text style={styles.emptyTitle}>No downloads yet</Text>
              <Text style={styles.emptySub}>
                Download songs and albums to listen offline, even without a connection.
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          formattedTracks.length > 0 ? (
            <Text style={styles.footerText}>
              {formattedTracks.length} {formattedTracks.length === 1 ? "Track" : "Tracks"}
            </Text>
          ) : null
        }
      />

      {/* Floating Action Button */}
      {formattedTracks.length > 0 && (
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

export default DownloadsScreen;

// â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  activeDownloadsSection: {
    marginHorizontal: 15,
    marginBottom: 8,
    backgroundColor: "#161616",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "rgba(212,175,55,0.15)",
    padding: 10,
  },
  activeDownloadsTitle: {
    fontSize: "12@ms",
    color: "#E6C16A",
    fontWeight: "600",
    marginBottom: 8,
  },
  activeDownloadItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  progressBarBg: {
    height: "3@vs",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: "2@ms",
    overflow: "hidden",
    marginTop: "5@vs",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#D4AF37",
    borderRadius: "2@ms",
  },
  progressPct: {
    fontSize: "10@ms",
    color: "#888",
    marginTop: "3@vs",
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
  localBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(74,144,226,0.12)",
    borderRadius: "4@ms",
    paddingHorizontal: "4@s",
    paddingVertical: "1@vs",
    gap: "2@s",
  },
  localBadgeText: { fontSize: "9@ms", color: "#4A90E2", fontWeight: "600" },
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
