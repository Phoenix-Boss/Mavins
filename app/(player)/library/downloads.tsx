/**
 * DownloadsScreen
 *
 * Displays songs downloaded to the device for offline playback.
 * - Active download progress cards
 * - Sort: Recent · A–Z · Duration
 * - Play individual song, play all, or shuffle all
 * - Song options menu via `/(modals)/menu`
 * - Active playback indicator
 * - Animated FAB that extends/collapses on scroll
 *
 * FIXES:
 *   - Removed react-native-track-player (useActiveTrack)
 *   - Removed router.navigate("/player") — player is overlay, not a route
 *   - Uses PlayerEngineContext for active track detection
 *   - All hooks called unconditionally
 *   - Removed unsupported estimatedItemSize prop from FlashList
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
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

// Use PlayerEngineContext instead of RNTP
import { usePlayerEngine } from "@/libs/playerSetup";

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD_PRIMARY = "#D4AF37";

// ─── Sort options ───────────────────────────────────────────────────────────

const SORT_OPTIONS = ["Recent", "A–Z", "Duration"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// ─── DownloadsScreen ────────────────────────────────────────────────────────

const DownloadsScreen = () => {
  const [isScrolling, setIsScrolling] = useState<boolean>(false);
  const [activeSort, setActiveSort] = useState<SortOption>("Recent");
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  
  // ALL HOOKS CALLED UNCONDITIONALLY
  const engine = usePlayerEngine();
  const { playDownloadedSong, playAllDownloadedSongs } = useMusicPlayer();
  const downloadedTracksMeta = useDownloadedTracks();
  const activeDownloads = useActiveDownloads();
  const currentTrackId = engine.currentTrack?.id;

  // Sort and format downloaded tracks
  const formattedTracks: DownloadedSongMetadata[] = useMemo(() => {
    const copy = [...downloadedTracksMeta];
    if (activeSort === "A–Z") return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (activeSort === "Duration") return copy.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return copy.reverse();
  }, [downloadedTracksMeta, activeSort]);

  const handleSongSelect = useCallback((song: DownloadedSongMetadata) => {
    triggerHaptic();
    playDownloadedSong(song, formattedTracks);
  }, [formattedTracks, playDownloadedSong]);

  const handlePlayAll = useCallback(async () => {
    triggerHaptic();
    if (formattedTracks.length === 0) return;
    await playAllDownloadedSongs(formattedTracks);
  }, [formattedTracks, playAllDownloadedSongs]);

  const handleShuffleAll = useCallback(async () => {
    triggerHaptic();
    if (formattedTracks.length === 0) return;
    const shuffled = [...formattedTracks].sort(() => Math.random() - 0.5);
    await playAllDownloadedSongs(shuffled);
  }, [formattedTracks, playAllDownloadedSongs]);

  const handleOpenMenu = useCallback((song: DownloadedSongMetadata) => {
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
  }, [downloadedTracksMeta, router]);

  const ActiveDownloadItem = useCallback(({ song }: { song: any }) => (
    <View style={adStyles.row}>
      <ExpoImage source={{ uri: song.thumbnail }} style={adStyles.thumb} contentFit="cover" />
      <View style={adStyles.info}>
        <Text style={adStyles.title} numberOfLines={1}>{song.title}</Text>
        <View style={adStyles.progressTrack}>
          <View style={[adStyles.progressFill, { width: `${Math.round((song.progress ?? 0) * 100)}%` }]} />
        </View>
        <Text style={adStyles.pct}>{Math.round((song.progress ?? 0) * 100)}%</Text>
      </View>
    </View>
  ), []);

  // ─── List header ─────────────────────────────────────────────────────────

  const ListHeaderComponent = useCallback(() => (
    <>
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

        {formattedTracks.length > 1 && (
          <TouchableOpacity style={styles.sortPill} onPress={handleShuffleAll} activeOpacity={0.7}>
            <MaterialCommunityIcons name="shuffle-variant" size={moderateScale(14)} color="#888" />
          </TouchableOpacity>
        )}
      </View>

      {activeDownloads.length > 0 && (
        <View style={styles.activeDownloadsSection}>
          <Text style={styles.activeDownloadsTitle}>
            Downloading ({activeDownloads.length})
          </Text>
          {activeDownloads.map((song) => (
            <ActiveDownloadItem key={song.id} song={song} />
          ))}
        </View>
      )}

      {formattedTracks.length > 0 && (
        <Text style={styles.trackCount}>
          {formattedTracks.length} {formattedTracks.length === 1 ? "Download" : "Downloads"}
        </Text>
      )}
    </>
  ), [activeSort, formattedTracks.length, activeDownloads.length, handleShuffleAll, ActiveDownloadItem]);

  // ─── Render item ──────────────────────────────────────────────────────────

  const renderSongItem = useCallback(({ item }: { item: DownloadedSongMetadata }) => {
    const isPlaying = currentTrackId === item.id;
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
            <Text style={[styles.resultTitle, isPlaying && { color: GOLD_PRIMARY }]} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>
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
  }, [currentTrackId, handleSongSelect, handleOpenMenu]);

  // ─── Empty state or main render ───────────────────────────────────────────

  const showEmptyState = formattedTracks.length === 0 && activeDownloads.length === 0;

  if (showEmptyState) {
    return (
      <View style={defaultStyles.container}>
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
        </View>
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
      </View>
    );
  }

  return (
    <View style={defaultStyles.container}>
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
        renderItem={renderSongItem}
        keyExtractor={(item, idx) => `${item.id}-${idx}`}
        extraData={currentTrackId}
        contentContainerStyle={{
          paddingBottom: verticalScale(190) + bottom,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const y = Math.floor(e.nativeEvent.contentOffset.y) || 0;
          setIsScrolling(y > 5);
        }}
        scrollEventThrottle={16}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={
          formattedTracks.length > 0 ? (
            <Text style={styles.footerText}>
              {formattedTracks.length} {formattedTracks.length === 1 ? "Track" : "Tracks"}
            </Text>
          ) : null
        }
      />

      <AnimatedFAB
        style={[
          styles.fab,
          {
            marginBottom: moderateScale(138) + bottom,
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
    </View>
  );
};

export default DownloadsScreen;

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
    backgroundColor: GOLD_PRIMARY,
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
  sortTextActive: { color: GOLD_PRIMARY },
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

const adStyles = ScaledSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "8@vs",
  },
  thumb: {
    width: "44@ms",
    height: "44@ms",
    borderRadius: 8,
    backgroundColor: "#2a2a2a",
  },
  info: { flex: 1, marginLeft: "12@s" },
  title: { fontSize: "13@ms", color: Colors.text, fontWeight: "600", marginBottom: "4@vs" },
  progressTrack: {
    height: "3@vs",
    backgroundColor: "#1C1C1E",
    borderRadius: "2@ms",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: GOLD_PRIMARY, borderRadius: "2@ms" },
  pct: { fontSize: "10@ms", color: Colors.textMuted, marginTop: "3@vs" },
});