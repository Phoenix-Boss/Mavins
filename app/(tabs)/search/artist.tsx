// app/(tabs)/search/artist.tsx
/**
 * ArtistPageScreen — v6 (YouTube-style channel page) - expo-av version
 *
 * Layout mirrors YouTube Music / YouTube channel pages.
 * Data source: MavinEngine.getChannelInfo() + getChannelTabItems()
 *
 * Fixes applied
 * ─────────────
 * 1. decodeURIComponent guard — params.id could be undefined; calling
 *    decodeURIComponent(undefined) throws at runtime. Now guarded with
 *    a nullish coalesce before the decode.
 * 2. switch-case lexical scoping — `const albums = …` inside a case branch
 *    without its own block is a scoping hazard (flagged by strict ESLint /
 *    some engines). Each case that needs block-scoped vars now has braces.
 * 3. Animated.loop cleanup — ArtistPageSkeleton and TabSkeleton started an
 *    infinite animation loop but never stopped it on unmount, leaking the
 *    animation after the skeleton was removed. useEffect now returns a
 *    cleanup function that calls anim.stop().
 * 4. SongRow now receives isPlaying as a prop and highlights the title in
 *    gold + shows a LoaderKit indicator when playing, matching the behaviour
 *    of renderSongItem in playlist.tsx. activeTrack is passed down from the
 *    parent via the `extraData` prop on FlashList and a wrapper renderItem.
 * 5. extraData={activeTrack} added to the videos FlashList so VideoRow
 *    re-renders when the active track changes (was missing, causing stale UI).
 * 6. handleVideoPlay inline object now typed explicitly and url is taken
 *    directly from the VideoItem — no silent undefined risk.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated as RNAnimated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Entypo, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList, FlashListProps } from "@shopify/flash-list";
import {
  moderateScale,
  scale,
  ScaledSheet,
  verticalScale,
} from "react-native-size-matters/extend";

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import { useActiveTrack } from "@/hooks/useActiveTrack";
import MavinEngine, {
  ChannelInfo,
  ChannelTab,
  InfoItem,
  StreamInfoItem,
  PlaylistInfoItem,
  NativeImage,
} from "@/modules/mavin-engine";
import LoaderKit from "react-native-loader-kit";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  duration?: number;
  viewCount?: number;
  videoId?: string;
}

interface AlbumItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  url: string;
}

interface VideoItem {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
  viewCount?: number;
  duration?: number;
  textualUploadDate?: string;
}

type TabKey = "songs" | "albums" | "singles" | "playlists" | "videos";

interface TabDef {
  key: TabKey;
  label: string;
  channelTab: ChannelTab;
}

interface ChannelMeta {
  name: string;
  description: string;
  avatarUrl: string;
  bannerUrl: string;
  subscriberCount: number;
  isVerified: boolean;
  tags: string[];
}

// ─── Typed FlashList wrapper (estimatedItemSize missing from installed types) ─
type FlashListPropsWithEstimated<T> = FlashListProps<T> & {
  estimatedItemSize?: number;
};
const TypedFlashListSong = FlashList as React.ComponentType<FlashListPropsWithEstimated<Song>>;
const TypedFlashListAlbum = FlashList as React.ComponentType<FlashListPropsWithEstimated<AlbumItem>>;
const TypedFlashListVideo = FlashList as React.ComponentType<FlashListPropsWithEstimated<VideoItem>>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const cleanName = (raw: string): string => {
  if (!raw) return raw;
  let s = raw;
  s = s.replace(/vevo/gi, "");
  s = s.replace(/(\d)([a-zA-Z])/g, "$1 $2");
  s = s.replace(/([a-zA-Z])(\d)/g, "$1 $2");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return s.replace(/\s{2,}/g, " ").trim();
};

const formatSubscribers = (count: number): string => {
  if (count <= 0) return "";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B subscribers`;
  if (count >= 1_000_000)     return `${(count / 1_000_000).toFixed(1)}M subscribers`;
  if (count >= 1_000)         return `${(count / 1_000).toFixed(0)}K subscribers`;
  return `${count} subscribers`;
};

const formatCount = (n: number): string => {
  if (!n || n <= 0) return "";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const bestImage = (
  images: NativeImage[],
  level: NativeImage["resolutionLevel"] = "HIGH",
): string => {
  const levels: NativeImage["resolutionLevel"][] = [
    "VERY_HIGH", "HIGH", "MEDIUM", "LOW", "UNKNOWN",
  ];
  const startIdx = levels.indexOf(level);
  for (let i = startIdx; i < levels.length; i++) {
    const found = images.find((img) => img.resolutionLevel === levels[i]);
    if (found) return found.url;
  }
  return images[0]?.url ?? "";
};

const channelUrlFromId = (id: string): string =>
  id.startsWith("UC")
    ? `https://www.youtube.com/channel/${id}`
    : `https://music.youtube.com/channel/${id}`;

const streamItemToSong = (item: StreamInfoItem, fallbackArtist: string): Song => {
  const videoId =
    item.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] ??
    item.url.split("youtu.be/")[1]?.split("?")[0] ??
    item.url;
  return {
    id:        videoId,
    title:     item.name,
    artist:    cleanName(item.uploaderName || fallbackArtist),
    thumbnail: bestImage(item.thumbnails, "MEDIUM"),
    url:       item.url,
    duration:  item.duration,
    viewCount: item.viewCount,
    videoId,
  };
};

const infoItemToAlbum = (item: InfoItem, fallbackArtist: string): AlbumItem | null => {
  if (item.type === "stream") {
    const s = item as StreamInfoItem;
    return {
      id:        s.url.split("v=")[1]?.split("&")[0] ?? s.url,
      title:     s.name,
      subtitle:  cleanName(s.uploaderName || fallbackArtist),
      thumbnail: bestImage(s.thumbnails, "MEDIUM"),
      url:       s.url,
    };
  }
  if (item.type === "playlist") {
    const p = item as PlaylistInfoItem;
    return {
      id:        p.url,
      title:     p.name,
      subtitle:  cleanName(p.uploaderName || fallbackArtist),
      thumbnail: p.thumbnails[0]?.url ?? "",
      url:       p.url,
    };
  }
  return null;
};

const infoItemToVideo = (item: InfoItem): VideoItem | null => {
  if (item.type !== "stream") return null;
  const s = item as StreamInfoItem;
  const videoId =
    s.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] ??
    s.url.split("youtu.be/")[1]?.split("?")[0] ??
    s.url;
  return {
    id:                videoId,
    title:             s.name,
    thumbnail:         bestImage(s.thumbnails, "MEDIUM"),
    url:               s.url,
    viewCount:         s.viewCount,
    duration:          s.duration,
    textualUploadDate: s.textualUploadDate,
  };
};

const findTab = (tabs: ChannelTab[], ...keywords: string[]): ChannelTab | undefined =>
  tabs.find((tab) =>
    keywords.some((kw) =>
      tab.contentFilters.some((f) => f.toLowerCase().includes(kw.toLowerCase())),
    ),
  );

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

function ArtistPageSkeleton() {
  const anim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    // FIX 3: stop the animation when the skeleton unmounts to avoid leaks
    return () => loop.stop();
  }, [anim]);

  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [SK.base, SK.highlight] });
  const Bone = ({
    w,
    h,
    r = 6,
    style,
  }: {
    w: number | string;
    h: number;
    r?: number;
    style?: object;
  }) => (
    <RNAnimated.View
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: bg }, style]}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Bone w="100%" h={moderateScale(180)} r={0} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          paddingHorizontal: 16,
          marginTop: -30,
          gap: 12,
        }}
      >
        <Bone w={moderateScale(72)} h={moderateScale(72)} r={36} />
        <View style={{ flex: 1, gap: 6, paddingBottom: 4 }}>
          <Bone w="55%" h={18} r={5} />
          <Bone w="40%" h={13} r={4} />
        </View>
      </View>
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginTop: 20, gap: 10 }}>
        {[80, 60, 70, 55].map((w, i) => (
          <Bone key={i} w={w} h={32} r={20} />
        ))}
      </View>
      <View style={{ marginTop: 16 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 12,
            }}
          >
            <Bone w={50} h={50} r={4} />
            <View style={{ flex: 1, gap: 7 }}>
              <Bone w="60%" h={13} r={4} />
              <Bone w="40%" h={11} r={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SongRow
// FIX 4: now accepts isPlaying so the currently active track is highlighted
// ─────────────────────────────────────────────────────────────────────────────

function SongRow({
  item,
  isPlaying,
  onPlay,
  onMenu,
}: {
  item: Song;
  isPlaying: boolean;
  onPlay: () => void;
  onMenu: () => void;
}) {
  return (
    <View style={rowStyles.row}>
      <TouchableOpacity style={rowStyles.touchable} onPress={onPlay} activeOpacity={0.7}>
        <View style={{ position: "relative" }}>
          <Image source={{ uri: item.thumbnail }} style={rowStyles.thumb} contentFit="cover" />
          {isPlaying && (
            <LoaderKit
              style={rowStyles.playingIndicator}
              name="LineScalePulseOutRapid"
              color="white"
            />
          )}
        </View>
        <View style={rowStyles.textBlock}>
          <Text
            style={[rowStyles.title, isPlaying && { color: "#D4AF37" }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={rowStyles.sub} numberOfLines={1}>
            {[
              formatCount(item.viewCount ?? 0) && `${formatCount(item.viewCount ?? 0)} views`,
              formatDuration(item.duration ?? 0),
            ]
              .filter(Boolean)
              .join(" • ")}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onMenu}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
      >
        <Entypo
          name="dots-three-vertical"
          size={moderateScale(15)}
          color="rgba(255,255,255,0.6)"
        />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AlbumCard
// ─────────────────────────────────────────────────────────────────────────────

function AlbumCard({ item, onPress }: { item: AlbumItem; onPress: () => void }) {
  return (
    <TouchableOpacity style={cardStyles.card} onPress={onPress} activeOpacity={0.75}>
      <Image source={{ uri: item.thumbnail }} style={cardStyles.image} contentFit="cover" />
      <Text style={cardStyles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={cardStyles.sub} numberOfLines={1}>{item.subtitle}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoRow
// ─────────────────────────────────────────────────────────────────────────────

function VideoRow({
  item,
  isPlaying,
  onPlay,
  onMenu,
}: {
  item: VideoItem;
  isPlaying: boolean;
  onPlay: () => void;
  onMenu: () => void;
}) {
  return (
    <View style={rowStyles.row}>
      <TouchableOpacity style={rowStyles.touchable} onPress={onPlay} activeOpacity={0.7}>
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: item.thumbnail }}
            style={rowStyles.videoThumb}
            contentFit="cover"
          />
          {!!item.duration && !isPlaying && (
            <View style={rowStyles.durationBadge}>
              <Text style={rowStyles.durationText}>{formatDuration(item.duration)}</Text>
            </View>
          )}
          {isPlaying && (
            <LoaderKit
              style={rowStyles.videoPlayingIndicator}
              name="LineScalePulseOutRapid"
              color="white"
            />
          )}
        </View>
        <View style={rowStyles.textBlock}>
          <Text
            style={[rowStyles.title, isPlaying && { color: "#D4AF37" }]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <Text style={rowStyles.sub} numberOfLines={1}>
            {[
              formatCount(item.viewCount ?? 0) && `${formatCount(item.viewCount ?? 0)} views`,
              item.textualUploadDate,
            ]
              .filter(Boolean)
              .join(" • ")}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onMenu}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
      >
        <Entypo
          name="dots-three-vertical"
          size={moderateScale(15)}
          color="rgba(255,255,255,0.6)"
        />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabBar
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: TabDef[];
  activeKey: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={tabBarStyles.container}
      style={tabBarStyles.scroll}
    >
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[tabBarStyles.pill, activeKey === t.key && tabBarStyles.pillActive]}
          onPress={() => {
            triggerHaptic();
            onSelect(t.key);
          }}
          activeOpacity={0.7}
        >
          <Text
            style={[
              tabBarStyles.label,
              activeKey === t.key && tabBarStyles.labelActive,
            ]}
          >
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ArtistPageScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router           = useRouter();
  const params           = useLocalSearchParams<{ id: string; subtitle?: string }>();

  // FIX 1: guard against undefined before decodeURIComponent
  const artistId = decodeURIComponent(params.id ?? "");

  const { playAudio } = useMusicPlayer();
  const activeTrack = useActiveTrack();

  const [meta, setMeta]           = useState<ChannelMeta | null>(null);
  const [tabs, setTabs]           = useState<TabDef[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("songs");
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const [songsData,     setSongsData]     = useState<Song[]>([]);
  const [albumsData,    setAlbumsData]    = useState<AlbumItem[]>([]);
  const [singlesData,   setSinglesData]   = useState<AlbumItem[]>([]);
  const [playlistsData, setPlaylistsData] = useState<AlbumItem[]>([]);
  const [videosData,    setVideosData]    = useState<VideoItem[]>([]);

  const [tabLoading, setTabLoading] = useState<Record<TabKey, boolean>>({
    songs: false, albums: false, singles: false, playlists: false, videos: false,
  });

  const loadedTabs      = useRef<Set<TabKey>>(new Set());
  const channelUrlRef   = useRef("");
  const metaRef         = useRef<ChannelMeta | null>(null);

  // ── Step 1: load channel metadata ─────────────────────────────────────────

  useEffect(() => {
    if (!artistId) {
      setError("No artist ID provided.");
      setMetaLoading(false);
      return;
    }

    const url = channelUrlFromId(artistId);
    channelUrlRef.current = url;

    (async () => {
      setMetaLoading(true);
      setError(null);
      try {
        const info: ChannelInfo = await MavinEngine.getChannelInfo(url, 0);

        const m: ChannelMeta = {
          name:            info.name,
          description:     info.description,
          avatarUrl:       bestImage(info.avatars, "HIGH"),
          bannerUrl:       bestImage(info.banners, "HIGH"),
          subscriberCount: info.subscriberCount,
          isVerified:      info.isVerified,
          tags:            info.tags,
        };
        metaRef.current = m;
        setMeta(m);

        const built: TabDef[] = [];
        const songsTab    = findTab(info.tabs, "videos", "songs");
        const albumsTab   = findTab(info.tabs, "albums", "releases");
        const singlesTab  = findTab(info.tabs, "singles", "eps");
        const playlistTab = findTab(info.tabs, "playlists");
        const videosTab   = findTab(info.tabs, "shorts", "live", "streams");

        if (songsTab)    built.push({ key: "songs",     label: "Songs",         channelTab: songsTab    });
        if (albumsTab)   built.push({ key: "albums",    label: "Albums",        channelTab: albumsTab   });
        if (singlesTab)  built.push({ key: "singles",   label: "Singles & EPs", channelTab: singlesTab  });
        if (playlistTab) built.push({ key: "playlists", label: "Playlists",     channelTab: playlistTab });
        if (videosTab)   built.push({ key: "videos",    label: "Videos",        channelTab: videosTab   });

        setTabs(built);
        if (built.length > 0) setActiveTab(built[0].key);
      } catch (e) {
        console.error("[ArtistPage] metadata failed:", e);
        setError("Could not load artist. Please try again.");
      } finally {
        setMetaLoading(false);
      }
    })();
  }, [artistId]);

  // ── Step 2: lazy-load tab content ─────────────────────────────────────────

  const loadTab = useCallback(
    async (key: TabKey) => {
      if (loadedTabs.current.has(key)) return;
      const tabDef = tabs.find((t) => t.key === key);
      if (!tabDef) return;

      const url        = channelUrlRef.current;
      const artistName = metaRef.current?.name ?? "";

      setTabLoading((p) => ({ ...p, [key]: true }));
      try {
        const page = await MavinEngine.getChannelTabItems(
          url,
          tabDef.channelTab.contentFilters[0],
          undefined,
          0,
        );
        loadedTabs.current.add(key);

        // FIX 2: each case now has its own block to avoid lexical-scoping issues
        switch (key) {
          case "songs": {
            setSongsData(
              page.items
                .filter((i): i is StreamInfoItem => i.type === "stream")
                .slice(0, 20)
                .map((i) => streamItemToSong(i, artistName)),
            );
            break;
          }
          case "albums": {
            const albums = page.items
              .map((i) => infoItemToAlbum(i, artistName))
              .filter((i): i is AlbumItem => i !== null)
              .slice(0, 20);
            setAlbumsData(albums);
            break;
          }
          case "singles": {
            const singles = page.items
              .map((i) => infoItemToAlbum(i, artistName))
              .filter((i): i is AlbumItem => i !== null)
              .slice(0, 20);
            setSinglesData(singles);
            break;
          }
          case "playlists": {
            setPlaylistsData(
              page.items
                .map((i) => infoItemToAlbum(i, artistName))
                .filter((i): i is AlbumItem => i !== null)
                .slice(0, 20),
            );
            break;
          }
          case "videos": {
            setVideosData(
              page.items
                .map(infoItemToVideo)
                .filter((i): i is VideoItem => i !== null)
                .slice(0, 20),
            );
            break;
          }
        }
      } catch (e) {
        console.warn(`[ArtistPage] tab ${key} failed:`, e);
      } finally {
        setTabLoading((p) => ({ ...p, [key]: false }));
      }
    },
    [tabs],
  );

  useEffect(() => {
    if (tabs.length > 0 && activeTab) loadTab(activeTab);
  }, [activeTab, tabs, loadTab]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSongPlay = useCallback(
    (song: Song) => {
      triggerHaptic();
      playAudio(song);
    },
    [playAudio],
  );

  const handleSongMenu = useCallback(
    (song: Song) => {
      triggerHaptic();
      router.push({
        pathname: "/(modals)/menu",
        params: {
          songData: JSON.stringify({
            id: song.id,
            title: song.title,
            artist: song.artist,
            thumbnail: song.thumbnail,
          }),
          type: "song",
        },
      });
    },
    [router],
  );

  const handleAlbumPress = useCallback(
    (album: AlbumItem) => {
      triggerHaptic();
      router.push({
        pathname: "/(tabs)/search/album",
        params: {
          id:        album.id,
          title:     album.title,
          thumbnail: album.thumbnail,
          artist:    album.subtitle || metaRef.current?.name || "",
        },
      });
    },
    [router],
  );

  const handleVideoPlay = useCallback(
    (video: VideoItem) => {
      triggerHaptic();
      // FIX 6: typed explicitly; url taken directly from VideoItem
      const track: Song = {
        id:        video.id,
        title:     video.title,
        artist:    metaRef.current?.name ?? "",
        thumbnail: video.thumbnail,
        url:       video.url,
      };
      playAudio(track);
    },
    [playAudio],
  );

  const handleVideoMenu = useCallback(
    (video: VideoItem) => {
      triggerHaptic();
      router.push({
        pathname: "/(modals)/menu",
        params: {
          songData: JSON.stringify({
            id:        video.id,
            title:     video.title,
            artist:    metaRef.current?.name ?? "",
            thumbnail: video.thumbnail,
          }),
          type: "song",
        },
      });
    },
    [router],
  );

  // ── Tab content renderer ──────────────────────────────────────────────────

  const renderTabContent = () => {
    if (tabLoading[activeTab]) return <TabSkeleton />;

    switch (activeTab) {
      case "songs": {
        if (!songsData.length) return <EmptyTab label="No songs found" />;
        return (
          <TypedFlashListSong
            data={songsData}
            renderItem={({ item }) => (
              // FIX 4: isPlaying passed to SongRow
              <SongRow
                item={item}
                isPlaying={activeTrack?.id === item.id}
                onPlay={() => handleSongPlay(item)}
                onMenu={() => handleSongMenu(item)}
              />
            )}
            keyExtractor={(item) => item.id}
            estimatedItemSize={70}
            scrollEnabled={false}
            extraData={activeTrack}
          />
        );
      }

      case "albums":
      case "singles": {
        const data = activeTab === "albums" ? albumsData : singlesData;
        if (!data.length) return <EmptyTab label={`No ${activeTab} found`} />;
        return (
          <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 12 }}>
            {data.map((item) => (
              <AlbumCard key={item.id} item={item} onPress={() => handleAlbumPress(item)} />
            ))}
          </View>
        );
      }

      case "playlists": {
        if (!playlistsData.length) return <EmptyTab label="No playlists found" />;
        return (
          <TypedFlashListAlbum
            data={playlistsData}
            renderItem={({ item }) => (
              <View style={rowStyles.row}>
                <TouchableOpacity
                  style={rowStyles.touchable}
                  onPress={() => handleAlbumPress(item)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: item.thumbnail }}
                    style={rowStyles.thumb}
                    contentFit="cover"
                  />
                  <View style={rowStyles.textBlock}>
                    <Text style={rowStyles.title} numberOfLines={1}>{item.title}</Text>
                    <Text style={rowStyles.sub} numberOfLines={1}>{item.subtitle}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            keyExtractor={(item) => item.id}
            estimatedItemSize={70}
            scrollEnabled={false}
          />
        );
      }

      case "videos": {
        if (!videosData.length) return <EmptyTab label="No videos found" />;
        return (
          // FIX 5: extraData added so VideoRow re-renders when active track changes
          <TypedFlashListVideo
            data={videosData}
            renderItem={({ item }) => (
              <VideoRow
                item={item}
                isPlaying={activeTrack?.id === item.id}
                onPlay={() => handleVideoPlay(item)}
                onMenu={() => handleVideoMenu(item)}
              />
            )}
            keyExtractor={(item) => item.id}
            estimatedItemSize={80}
            scrollEnabled={false}
            extraData={activeTrack}
          />
        );
      }

      default:
        return null;
    }
  };

  // ── Loading / error ────────────────────────────────────────────────────────

  if (metaLoading) return <ArtistPageSkeleton />;

  if (error || !meta) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={moderateScale(40)} color="#888" />
        <Text style={styles.errorText}>{error ?? "Artist not found."}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: verticalScale(138) + bottom }}
      showsVerticalScrollIndicator={false}
    >
      {/* BANNER */}
      <View style={styles.bannerContainer}>
        {meta.bannerUrl ? (
          <Image source={{ uri: meta.bannerUrl }} style={styles.banner} contentFit="cover" />
        ) : (
          <View style={[styles.banner, { backgroundColor: "#1a1a1a" }]} />
        )}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={StyleSheet.absoluteFill}
        />
        <TouchableOpacity
          style={[styles.backIcon, { top: top + 8 }]}
          onPress={() => {
            triggerHaptic();
            router.back();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={moderateScale(24)} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* AVATAR + NAME ROW */}
      <View style={styles.headerRow}>
        <View style={styles.avatarWrapper}>
          {meta.avatarUrl ? (
            <Image source={{ uri: meta.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: "#333" }]} />
          )}
        </View>

        <View style={styles.nameBlock}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.artistName} numberOfLines={1}>{meta.name}</Text>
            {meta.isVerified && (
              <MaterialIcons name="verified" size={moderateScale(18)} color="#3ea6ff" />
            )}
          </View>
          {!!meta.subscriberCount && (
            <Text style={styles.subscriberText}>{formatSubscribers(meta.subscriberCount)}</Text>
          )}
        </View>
      </View>

      {/* TAB BAR */}
      {tabs.length > 0 && (
        <TabBar tabs={tabs} activeKey={activeTab} onSelect={setActiveTab} />
      )}

      <View style={styles.divider} />

      {/* TAB CONTENT */}
      <View style={{ minHeight: 300 }}>{renderTabContent()}</View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabSkeleton / EmptyTab
// ─────────────────────────────────────────────────────────────────────────────

function TabSkeleton() {
  const anim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    // FIX 3: cleanup
    return () => loop.stop();
  }, [anim]);

  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [SK.base, SK.highlight] });
  const Bone = ({ w, h, r = 4 }: { w: number | string; h: number; r?: number }) => (
    <RNAnimated.View style={{ width: w, height: h, borderRadius: r, backgroundColor: bg }} />
  );

  return (
    <View style={{ paddingTop: 8 }}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 12,
          }}
        >
          <Bone w={52} h={52} r={4} />
          <View style={{ flex: 1, gap: 8 }}>
            <Bone w="60%" h={13} />
            <Bone w="40%" h={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", paddingTop: verticalScale(40) }}>
      <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: moderateScale(14) }}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered:  { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center", gap: 12 },
  errorText: { color: "#888", fontSize: "14@ms", textAlign: "center", paddingHorizontal: 20 },
  backBtn:   { borderColor: "#949392", borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 32 },
  backBtnText: { color: "white", fontSize: "12@ms", fontWeight: "bold" },
  bannerContainer: { width: "100%", height: "180@ms", position: "relative" },
  banner:          { width: "100%", height: "180@ms" },
  backIcon:        {
    position: "absolute",
    left: 14,
    zIndex: 10,
    padding: 6,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 20,
  },
  headerRow:     { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, marginTop: -28, gap: 12 },
  avatarWrapper: {
    width: "72@ms",
    height: "72@ms",
    borderRadius: "36@ms",
    borderWidth: 3,
    borderColor: "#000",
    overflow: "hidden",
  },
  avatar:         { width: "72@ms", height: "72@ms" },
  nameBlock:      { flex: 1, paddingBottom: 4, gap: 2 },
  artistName:     { color: "#fff", fontSize: "22@ms", fontWeight: "700" },
  subscriberText: { color: "rgba(255,255,255,0.6)", fontSize: "13@ms" },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginTop: 4,
  },
});

const tabBarStyles = StyleSheet.create({
  scroll:      { flexGrow: 0, marginTop: 14 },
  container:   { paddingHorizontal: 14, gap: 8, paddingVertical: 4 },
  pill:        {
    paddingHorizontal: scale(14),
    paddingVertical:   verticalScale(7),
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  pillActive:  { backgroundColor: "#fff" },
  label:       { color: "rgba(255,255,255,0.7)", fontSize: moderateScale(13), fontWeight: "500" },
  labelActive: { color: "#000", fontWeight: "700" },
});

const rowStyles = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  touchable:{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb:    { width: moderateScale(52), height: moderateScale(52), borderRadius: 4 },
  videoThumb: { width: moderateScale(120), height: moderateScale(68), borderRadius: 4 },
  textBlock:{ flex: 1 },
  title:    { color: "#fff", fontSize: moderateScale(14), fontWeight: "500", marginBottom: 3 },
  sub:      { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(12) },
  // FIX 4: new styles for playing indicators on song and video rows
  playingIndicator: {
    position: "absolute",
    top: moderateScale(16),
    left: moderateScale(16),
    width: moderateScale(20),
    height: moderateScale(20),
  },
  videoPlayingIndicator: {
    position: "absolute",
    top: moderateScale(24),
    left: moderateScale(50),
    width: moderateScale(20),
    height: moderateScale(20),
  },
  durationBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  durationText: { color: "#fff", fontSize: moderateScale(10), fontWeight: "600" },
});

const cardStyles = StyleSheet.create({
  card:  { width: (SCREEN_WIDTH - 48) / 2, marginBottom: 4 },
  image: { width: "100%", aspectRatio: 1, borderRadius: 8, marginBottom: 6 },
  title: { color: "#fff", fontSize: moderateScale(13), fontWeight: "600", marginBottom: 2 },
  sub:   { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(11) },
});