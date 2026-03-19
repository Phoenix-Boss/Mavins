/**
 * ArtistPageScreen
 *
 * Displays a detailed artist page including top songs, albums, singles/EPs,
 * and videos. Data is fetched via MavinEngine (NewPipe Extractor v0.26.0)
 * using getChannelInfo + getChannelTabItems.
 *
 * Route params:
 *   id       — YouTube channel/artist ID  (e.g. "UCxxxxxx")
 *   subtitle — Optional pre-fetched subscriber string shown under the name
 */

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import MavinEngine, {
  ChannelInfo,
  ChannelTab,
  InfoItem,
  StreamInfoItem,
  PlaylistInfoItem,
} from "@/modules/mavin-engine";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Entypo, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  moderateScale,
  scale,
  ScaledSheet,
  verticalScale,
} from "react-native-size-matters/extend";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Normalised song shape used throughout this screen */
interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  videoId?: string;
}

/** Normalised album / single / video card shape */
interface ArtistPageItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  url: string;
  type: "album" | "video";
}

/** Full data model for this screen */
interface ArtistPageData {
  title: string;
  thumbnail: string;
  subscriberCount: string;
  songs: Song[];
  albums: ArtistPageItem[];
  singlesAndEPs: ArtistPageItem[];
  videos: ArtistPageItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a channel URL from an artist ID that works with NewPipe */
const channelUrlFromId = (id: string): string =>
  id.startsWith("UC")
    ? `https://www.youtube.com/channel/${id}`
    : `https://music.youtube.com/channel/${id}`;

/** Format a raw subscriber count into a readable string */
const formatSubscribers = (count: number): string => {
  if (count <= 0) return "";
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(1)}M subscribers`;
  if (count >= 1_000)
    return `${(count / 1_000).toFixed(0)}K subscribers`;
  return `${count} subscribers`;
};

/** Convert a StreamInfoItem to the local Song shape */
const streamItemToSong = (item: StreamInfoItem): Song => {
  // Use regex to safely extract the 11-char video ID — split("v=") breaks
  // on URLs like "music.youtube.com/watch?v=..." where "v" also appears elsewhere
  const videoId = item.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1]
    ?? item.url.split("youtu.be/")[1]?.split("?")[0]
    ?? item.url;
  return {
    id:        videoId,
    title:     item.name,
    artist:    item.uploaderName,
    thumbnail: item.thumbnails.find((t) => t.resolutionLevel === "MEDIUM")?.url
      ?? item.thumbnails[0]?.url
      ?? "",
    url:       item.url,
    videoId,
  };
};

/** Convert any InfoItem to an ArtistPageItem, returns null for channel items */
const infoItemToPageItem = (
  item: InfoItem,
  type: "album" | "video"
): ArtistPageItem | null => {
  if (item.type === "stream") {
    const s = item as StreamInfoItem;
    return {
      id: s.url.split("v=")[1]?.split("&")[0] ?? s.url,
      title: s.name,
      subtitle: s.uploaderName,
      thumbnail:
        s.thumbnails.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
        s.thumbnails[0]?.url ??
        "",
      url: s.url,
      type,
    };
  }
  if (item.type === "playlist") {
    const p = item as PlaylistInfoItem;
    return {
      id: p.url,
      title: p.name,
      subtitle: p.uploaderName,
      thumbnail: p.thumbnails[0]?.url ?? "",
      url: p.url,
      type,
    };
  }
  return null;
};

/**
 * Find the first tab whose contentFilters match any of the given keywords.
 * NewPipe channel tab filter names are lowercase (e.g. "videos", "albums").
 */
const findTab = (
  tabs: ChannelTab[],
  ...keywords: string[]
): ChannelTab | undefined =>
  tabs.find((tab) =>
    keywords.some((kw) =>
      tab.contentFilters.some((f) =>
        f.toLowerCase().includes(kw.toLowerCase())
      )
    )
  );

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_HEIGHT = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ArtistPageScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; subtitle?: string }>();
  const artistId = params.id;

  const [artistData, setArtistData] = useState<ArtistPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Retain the songs tab reference so Show More can re-use it
  const songsTabRef = useRef<ChannelTab | null>(null);
  const channelUrlRef = useRef<string>("");

  const { playAudio } = useMusicPlayer();

  // ── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!artistId) {
      setError("No artist ID provided.");
      setLoading(false);
      return;
    }

    const url = channelUrlFromId(artistId);
    channelUrlRef.current = url;

    const fetchArtist = async () => {
      setLoading(true);
      setError(null);

      try {
        // Step 1: channel metadata + tab definitions — single network call
        const info: ChannelInfo = await MavinEngine.getChannelInfo(url, 0);

        const thumbnail =
          info.avatars.find((a) => a.resolutionLevel === "HIGH")?.url ??
          info.avatars[0]?.url ??
          "";

        const data: ArtistPageData = {
          title:           info.name,
          thumbnail,
          subscriberCount: formatSubscribers(info.subscriberCount),
          songs:           [],
          albums:          [],
          singlesAndEPs:   [],
          videos:          [],
        };

        // Step 2: resolve tabs
        const songsTab   = findTab(info.tabs, "videos", "songs");
        const albumsTab  = findTab(info.tabs, "albums", "releases");
        const singlesTab = findTab(info.tabs, "singles", "eps");
        const videosTab  = findTab(info.tabs, "shorts", "live", "streams");

        if (songsTab) songsTabRef.current = songsTab;

        // Step 3: fetch all tabs in parallel, fail gracefully per-tab
        const requests: Array<Promise<void>> = [];

        if (songsTab) {
          requests.push(
            MavinEngine.getChannelTabItems(
              url,
              songsTab.contentFilters[0],
              undefined,
              0
            ).then((page) => {
              data.songs = page.items
                .filter((i): i is StreamInfoItem => i.type === "stream")
                .slice(0, 5)
                .map(streamItemToSong);
            }).catch((e) =>
              console.warn("[ArtistPage] songs tab failed:", e)
            )
          );
        }

        if (albumsTab) {
          requests.push(
            MavinEngine.getChannelTabItems(
              url,
              albumsTab.contentFilters[0],
              undefined,
              0
            ).then((page) => {
              data.albums = page.items
                .map((i) => infoItemToPageItem(i, "album"))
                .filter((i): i is ArtistPageItem => i !== null)
                .slice(0, 10);
            }).catch((e) =>
              console.warn("[ArtistPage] albums tab failed:", e)
            )
          );
        }

        if (singlesTab) {
          requests.push(
            MavinEngine.getChannelTabItems(
              url,
              singlesTab.contentFilters[0],
              undefined,
              0
            ).then((page) => {
              data.singlesAndEPs = page.items
                .map((i) => infoItemToPageItem(i, "album"))
                .filter((i): i is ArtistPageItem => i !== null)
                .slice(0, 10);
            }).catch((e) =>
              console.warn("[ArtistPage] singles tab failed:", e)
            )
          );
        }

        if (videosTab) {
          requests.push(
            MavinEngine.getChannelTabItems(
              url,
              videosTab.contentFilters[0],
              undefined,
              0
            ).then((page) => {
              data.videos = page.items
                .filter((i): i is StreamInfoItem => i.type === "stream")
                .slice(0, 10)
                .map((i) => infoItemToPageItem(i, "video"))
                .filter((i): i is ArtistPageItem => i !== null);
            }).catch((e) =>
              console.warn("[ArtistPage] videos tab failed:", e)
            )
          );
        }

        await Promise.allSettled(requests);
        setArtistData(data);
      } catch (e) {
        console.error("[ArtistPageScreen] fetch failed:", e);
        setError("Could not load artist data. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [artistId]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSongSelect = useCallback(
    (song: Song) => {
      triggerHaptic();
      playAudio(song);
    },
    [playAudio]
  );

  const handleShowMoreSongs = useCallback(async () => {
    const tab = songsTabRef.current;
    const url = channelUrlRef.current;
    if (!tab || !url) return;

    triggerHaptic();
    setLoading(true);

    try {
      const page = await MavinEngine.getChannelTabItems(
        url,
        tab.contentFilters[0],
        undefined,
        0
      );
      const songs = page.items
        .filter((i): i is StreamInfoItem => i.type === "stream")
        .map(streamItemToSong);

      router.push({
        pathname: "/(tabs)/search/itemList",
        params: {
          data:  JSON.stringify(songs),
          type:  "song",
          title: "Top Songs",
        },
      });
    } catch (e) {
      console.error("[ArtistPageScreen] show more songs failed:", e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderSong = useCallback(
    ({ item }: { item: Song }) => (
      <View style={styles.song}>
        {/* flex:1 pushes three-dot menu to the far right */}
        <TouchableOpacity
          style={styles.songTouchableArea}
          onPress={() => handleSongSelect(item)}
        >
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.songThumbnail}
            contentFit="cover"
          />
          <View style={styles.songTextContainer}>
            <Text style={styles.songTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.songArtist} numberOfLines={1}>
              {item.artist}
            </Text>
          </View>
        </TouchableOpacity>

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
                  thumbnail: item.thumbnail,
                }),
                type: "song",
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
    ),
    [handleSongSelect, router]
  );

  const renderLargeItem = useCallback(
    (item: ArtistPageItem) => (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.largeItemContainer,
          item.type === "video" && styles.largeVideoContainer,
        ]}
        onPress={() => {
          triggerHaptic();
          if (item.type === "video") {
            handleSongSelect({
              id:        item.id,
              title:     item.title,
              artist:    item.subtitle.split(" • ")[0] ?? item.subtitle,
              thumbnail: item.thumbnail,
              url:       item.url,
            });
          } else {
            router.push({
              pathname: "/(tabs)/search/album",
              params: {
                id:        item.id,
                title:     item.title,
                subtitle:  item.subtitle,
                thumbnail: item.thumbnail,
                artist:    artistData?.title ?? "",
              },
            });
          }
        }}
        onLongPress={() => {
          if (item.type !== "video") return;
          triggerHaptic(Haptics.AndroidHaptics.Long_Press);
          router.push({
            pathname: "/(modals)/menu",
            params: {
              songData: JSON.stringify({
                id:        item.id,
                title:     item.title,
                artist:    item.subtitle.split(" • ")[0] ?? item.subtitle,
                thumbnail: item.thumbnail,
              }),
              type: "song",
            },
          });
        }}
      >
        <Image
          source={{ uri: item.thumbnail }}
          style={[
            styles.largeItemThumbnail,
            item.type === "video" && styles.largeVideoThumbnail,
          ]}
          contentFit="cover"
        />
        <Text style={styles.largeItemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.largeItemSubtitle} numberOfLines={1}>
          {item.subtitle}
        </Text>
      </TouchableOpacity>
    ),
    [artistData?.title, handleSongSelect, router]
  );

  // ── List data assembly ─────────────────────────────────────────────────────

  type ListRow =
    | { type: "songs_header" | "songs_footer" | "albums_header" | "singles_header" | "videos_header"; id: string }
    | { type: "song"; id: string; data: Song }
    | { type: "albums_carousel" | "singles_carousel" | "videos_carousel"; id: string; data: ArtistPageItem[] };

  const listData: ListRow[] = [];

  if (artistData?.songs.length) {
    listData.push({ type: "songs_header", id: "songs_header" });
    artistData.songs.forEach((s) =>
      listData.push({ type: "song", id: s.id, data: s })
    );
    listData.push({ type: "songs_footer", id: "songs_footer" });
  }
  if (artistData?.albums.length) {
    listData.push({ type: "albums_header", id: "albums_header" });
    listData.push({ type: "albums_carousel", id: "albums_carousel", data: artistData.albums });
  }
  if (artistData?.singlesAndEPs.length) {
    listData.push({ type: "singles_header", id: "singles_header" });
    listData.push({ type: "singles_carousel", id: "singles_carousel", data: artistData.singlesAndEPs });
  }
  if (artistData?.videos.length) {
    listData.push({ type: "videos_header", id: "videos_header" });
    listData.push({ type: "videos_carousel", id: "videos_carousel", data: artistData.videos });
  }

  const renderItem = ({ item }: { item: ListRow }) => {
    switch (item.type) {
      case "songs_header":
        return <Text style={styles.sectionHeader}>Top Songs</Text>;

      case "song":
        return renderSong({ item: (item as { type: "song"; id: string; data: Song }).data });

      case "songs_footer":
        return (
          <TouchableOpacity
            style={styles.showMoreButton}
            onPress={handleShowMoreSongs}
          >
            <Text style={styles.showMoreText}>Show More</Text>
          </TouchableOpacity>
        );

      case "albums_header":
        return <Text style={styles.sectionHeader}>Albums</Text>;

      case "albums_carousel":
      case "singles_carousel": {
        const d = (item as { data: ArtistPageItem[] }).data;
        return (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
          >
            <View style={styles.carouselRow}>
              {d.map((i) => renderLargeItem(i))}
            </View>
          </ScrollView>
        );
      }

      case "singles_header":
        return <Text style={styles.sectionHeader}>Singles & EPs</Text>;

      case "videos_header":
        return <Text style={styles.sectionHeader}>Videos</Text>;

      case "videos_carousel": {
        const d = (item as { data: ArtistPageItem[] }).data;
        return (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
          >
            <View style={styles.carouselRow}>
              {d.map((i) => renderLargeItem(i))}
            </View>
          </ScrollView>
        );
      }

      default:
        return null;
    }
  };

  // ── Header ─────────────────────────────────────────────────────────────────

  const ListHeader = () => (
    <View
      style={[styles.headerContainer, { height: moderateScale(HEADER_HEIGHT) }]}
    >
      <ImageBackground
        source={artistData?.thumbnail ? { uri: artistData.thumbnail } : undefined}
        style={styles.headerImage}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,1)"]}
          style={StyleSheet.absoluteFill}
        />
      </ImageBackground>

      <View style={[styles.topNav, { top }]}>
        <TouchableOpacity
          onPress={() => {
            triggerHaptic();
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={moderateScale(26)} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.artistInfoContainer}>
        <Text style={styles.artistName}>{artistData?.title ?? ""}</Text>
        <Text style={styles.artistSubtext}>
          {artistData?.subscriberCount ||
            (params.subtitle ?? "").replace("Artist • ", "")}
        </Text>
      </View>
    </View>
  );

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (error || !artistData) {
    return (
      <View style={styles.centeredContainer}>
        <Ionicons
          name="alert-circle-outline"
          size={moderateScale(40)}
          color="#888"
        />
        <Text style={styles.errorText}>
          {error ?? "Artist not found."}
        </Text>
        <TouchableOpacity
          style={styles.showMoreButton}
          onPress={() => router.back()}
        >
          <Text style={styles.showMoreText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <FlashList
      style={StyleSheet.flatten(styles.container)}
      contentContainerStyle={{ paddingBottom: verticalScale(138) + bottom }}
      showsVerticalScrollIndicator={false}
      data={listData}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={ListHeader}
      estimatedItemSize={60}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  // ── Layout ──
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },

  // ── Error ──
  errorText: {
    color: "#888",
    fontSize: "14@ms",
    textAlign: "center",
    paddingHorizontal: 20,
  },

  // ── Header ──
  headerContainer: {
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerImage: {
    width: "100%",
    height: "100%",
  },
  topNav: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  artistInfoContainer: {
    position: "absolute",
    bottom: 0,
    left: 15,
    right: 15,
    paddingBottom: 12,
  },
  artistName: {
    color: "white",
    fontSize: "45@ms",
    fontWeight: "bold",
  },
  artistSubtext: {
    color: "#E0E0E0",
    fontSize: "14@ms",
    fontWeight: "500",
  },

  // ── Sections ──
  sectionHeader: {
    color: Colors.text,
    fontSize: "20@ms",
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    marginLeft: 20,
  },

  // ── Song row ──
  song: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "8@ms",
    paddingLeft: 10,
    paddingRight: 20,
  },
  songTouchableArea: {
    flex: 1,                // pushes three-dot button to the far right
    flexDirection: "row",
    alignItems: "center",
  },
  songThumbnail: {
    width: "50@ms",
    height: "50@ms",
    marginHorizontal: 10,
    borderRadius: 5,
  },
  songTextContainer: {
    flex: 1,
  },
  songTitle: {
    color: Colors.text,
    fontSize: "14@ms",
  },
  songArtist: {
    color: Colors.textMuted,
    fontSize: "12@ms",
  },

  // ── Show More ──
  showMoreButton: {
    backgroundColor: "transparent",
    borderColor: "#949392",
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 32,
    alignSelf: "flex-start",
    marginHorizontal: 12,
    marginBottom: 4,
  },
  showMoreText: {
    color: "white",
    fontSize: "12@ms",
    fontWeight: "bold",
    textAlign: "center",
  },

  // ── Carousel ──
  carouselContent: {
    paddingLeft: 13,
  },
  carouselRow: {
    flexDirection: "row",
    marginBottom: "10@vs",
  },

  // ── Large item card ──
  largeItemContainer: {
    marginRight: "10@ms",
    width: "100@ms",
    height: "145@ms",
  },
  largeVideoContainer: {
    width: scale(160),
    height: scale(135),
  },
  largeItemThumbnail: {
    borderRadius: 12,
    width: "100@ms",
    height: "100@ms",
  },
  largeVideoThumbnail: {
    width: scale(160),
    height: scale(90),
    borderRadius: 8,
  },
  largeItemTitle: {
    color: Colors.text,
    fontSize: "14@ms",
    fontWeight: "bold",
    marginTop: 5,
  },
  largeItemSubtitle: {
    fontSize: "12@ms",
    color: "#888",
  },
});