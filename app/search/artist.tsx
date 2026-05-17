/**
 * ArtistPageScreen — Fixed for Overlay Mode
 *
 * FIXES:
 *   - Added useTheme for full light/dark mode support
 *   - Fixed handleAlbumPress route: was "/(tabs)/search/album" → "/(player)/search/album"
 *   - Background color from theme, text colors from theme throughout
 *   - All hooks unconditional
 *   - Works as overlay (no route change, just modal presentation)
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
import { FlashList } from "@shopify/flash-list";
import {
  moderateScale,
  scale,
  ScaledSheet,
  verticalScale,
} from "react-native-size-matters/extend";

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { triggerHaptic } from "@/helpers/haptics";
import MavinEngine, {
  ChannelInfo,
  ChannelTab,
  InfoItem,
  StreamInfoItem,
  PlaylistInfoItem,
  NativeImage,
} from "@/modules/mavin-engine";
import { usePlayerEngine } from "@/libs/playerSetup";
import { extractVideoId } from "@/helpers/youtube";
import { useTheme } from "@/contexts/ThemeContext";

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

const bestImage = (images: NativeImage[], level: NativeImage["resolutionLevel"] = "HIGH"): string => {
  const levels: NativeImage["resolutionLevel"][] = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
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
    : id.startsWith("http")
    ? id
    : `https://music.youtube.com/channel/${id}`;

const streamItemToSong = (item: StreamInfoItem, fallbackArtist: string): Song => {
  const videoId = extractVideoId(item.url);
  return {
    id: videoId ?? item.url,
    title: item.name,
    artist: cleanName(item.uploaderName || fallbackArtist),
    thumbnail: bestImage(item.thumbnails, "MEDIUM"),
    url: item.url,
    duration: item.duration,
    viewCount: item.viewCount,
    videoId: videoId ?? undefined,
  };
};

const infoItemToAlbum = (item: InfoItem, fallbackArtist: string): AlbumItem | null => {
  if (item.type === "stream") {
    const s = item as StreamInfoItem;
    const videoId = extractVideoId(s.url);
    return { id: videoId ?? s.url, title: s.name, subtitle: cleanName(s.uploaderName || fallbackArtist), thumbnail: bestImage(s.thumbnails, "MEDIUM"), url: s.url };
  }
  if (item.type === "playlist") {
    const p = item as PlaylistInfoItem;
    return { id: p.url, title: p.name, subtitle: cleanName(p.uploaderName || fallbackArtist), thumbnail: p.thumbnails[0]?.url ?? "", url: p.url };
  }
  return null;
};

const infoItemToVideo = (item: InfoItem): VideoItem | null => {
  if (item.type !== "stream") return null;
  const s = item as StreamInfoItem;
  const videoId = extractVideoId(s.url);
  return { id: videoId ?? s.url, title: s.name, thumbnail: bestImage(s.thumbnails, "MEDIUM"), url: s.url, viewCount: s.viewCount, duration: s.duration, textualUploadDate: s.textualUploadDate };
};

const findTab = (tabs: ChannelTab[], ...keywords: string[]): ChannelTab | undefined =>
  tabs.find((tab) => keywords.some((kw) => tab.contentFilters.some((f) => f.toLowerCase().includes(kw.toLowerCase()))));

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

function ArtistPageSkeleton({ colors }: { colors: any }) {
  const { top } = useSafeAreaInsets();
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, []);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [SK.base, SK.highlight] });
  const Bone = ({ w, h, r = 6 }: { w: number | string; h: number; r?: number }) => (
    <RNAnimated.View style={{ width: w as any, height: h, borderRadius: r, backgroundColor: bg }} />
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Bone w="100%" h={moderateScale(180)} r={0} />
      <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, marginTop: -30, gap: 12 }}>
        <Bone w={moderateScale(72)} h={moderateScale(72)} r={36} />
        <View style={{ flex: 1, gap: 6, paddingBottom: 4 }}>
          <Bone w="55%" h={18} r={5} />
          <Bone w="40%" h={13} r={4} />
        </View>
      </View>
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginTop: 20, gap: 10 }}>
        {[80, 60, 70, 55].map((w, i) => <Bone key={i} w={w} h={32} r={20} />)}
      </View>
      <View style={{ marginTop: 16 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 12 }}>
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
// ─────────────────────────────────────────────────────────────────────────────

function SongRow({ item, onPlay, onMenu, colors }: { item: Song; onPlay: () => void; onMenu: () => void; colors: any }) {
  return (
    <View style={rowStyles.row}>
      <TouchableOpacity style={rowStyles.touchable} onPress={onPlay} activeOpacity={0.7}>
        <Image source={{ uri: item.thumbnail }} style={rowStyles.thumb} contentFit="cover" />
        <View style={rowStyles.textBlock}>
          <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
          <Text style={[rowStyles.sub, { color: colors.textSub }]} numberOfLines={1}>
            {[formatCount(item.viewCount ?? 0) && `${formatCount(item.viewCount ?? 0)} views`, formatDuration(item.duration ?? 0)]
              .filter(Boolean).join(" • ")}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onMenu} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Entypo name="dots-three-vertical" size={moderateScale(15)} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AlbumCard
// ─────────────────────────────────────────────────────────────────────────────

function AlbumCard({ item, onPress, colors }: { item: AlbumItem; onPress: () => void; colors: any }) {
  return (
    <TouchableOpacity style={[cardStyles.card, { backgroundColor: colors.surface }]} onPress={onPress} activeOpacity={0.75}>
      <Image source={{ uri: item.thumbnail }} style={cardStyles.image} contentFit="cover" />
      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
      <Text style={[cardStyles.sub, { color: colors.textSub }]} numberOfLines={1}>{item.subtitle}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoRow
// ─────────────────────────────────────────────────────────────────────────────

function VideoRow({ item, onPlay, onMenu, colors }: { item: VideoItem; onPlay: () => void; onMenu: () => void; colors: any }) {
  return (
    <View style={rowStyles.row}>
      <TouchableOpacity style={rowStyles.touchable} onPress={onPlay} activeOpacity={0.7}>
        <View style={{ position: "relative" }}>
          <Image source={{ uri: item.thumbnail }} style={rowStyles.videoThumb} contentFit="cover" />
          {!!item.duration && (
            <View style={rowStyles.durationBadge}>
              <Text style={rowStyles.durationText}>{formatDuration(item.duration)}</Text>
            </View>
          )}
        </View>
        <View style={rowStyles.textBlock}>
          <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
          <Text style={[rowStyles.sub, { color: colors.textSub }]} numberOfLines={1}>
            {[formatCount(item.viewCount ?? 0) && `${formatCount(item.viewCount ?? 0)} views`, item.textualUploadDate]
              .filter(Boolean).join(" • ")}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onMenu} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Entypo name="dots-three-vertical" size={moderateScale(15)} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabBar
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({ tabs, activeKey, onSelect, colors }: { tabs: TabDef[]; activeKey: TabKey; onSelect: (key: TabKey) => void; colors: any }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabBarStyles.container} style={tabBarStyles.scroll}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[tabBarStyles.pill, { backgroundColor: colors.surfaceRaised }, activeKey === t.key && { backgroundColor: colors.gold }]}
          onPress={() => { triggerHaptic(); onSelect(t.key); }}
          activeOpacity={0.7}
        >
          <Text style={[tabBarStyles.label, { color: colors.textSub }, activeKey === t.key && { color: colors.textInverse, fontWeight: "700" }]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabSkeleton / EmptyTab
// ─────────────────────────────────────────────────────────────────────────────

function TabSkeleton({ colors }: { colors: any }) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, []);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.surfaceLight, colors.surfaceHigh] });
  const Bone = ({ w, h, r = 4 }: { w: number | string; h: number; r?: number }) => (
    <RNAnimated.View style={{ width: w as any, height: h, borderRadius: r, backgroundColor: bg }} />
  );
  return (
    <View style={{ paddingTop: 8 }}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 12 }}>
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

function EmptyTab({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={{ alignItems: "center", paddingTop: verticalScale(40) }}>
      <Text style={{ color: colors.textMuted, fontSize: moderateScale(14) }}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ArtistPageScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; subtitle?: string }>();
  const artistId = decodeURIComponent(params.id ?? "");

  // ALL HOOKS UNCONDITIONAL
  const { colors } = useTheme();
  const engine = usePlayerEngine();
  const { playAudio } = useMusicPlayer();
  const currentTrackId = engine.currentTrack?.id;

  const [meta, setMeta]       = useState<ChannelMeta | null>(null);
  const [tabs, setTabs]       = useState<TabDef[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("songs");
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [songsData,     setSongsData]     = useState<Song[]>([]);
  const [albumsData,    setAlbumsData]    = useState<AlbumItem[]>([]);
  const [singlesData,   setSinglesData]   = useState<AlbumItem[]>([]);
  const [playlistsData, setPlaylistsData] = useState<AlbumItem[]>([]);
  const [videosData,    setVideosData]    = useState<VideoItem[]>([]);

  const [tabLoading, setTabLoading] = useState<Record<TabKey, boolean>>({
    songs: false, albums: false, singles: false, playlists: false, videos: false,
  });
  const loadedTabs = useRef<Set<TabKey>>(new Set());
  const channelUrlRef = useRef("");
  const metaRef = useRef<ChannelMeta | null>(null);

  // ── Load channel metadata ──────────────────────────────────────────────────

  useEffect(() => {
    if (!artistId) { setError("No artist ID provided."); setMetaLoading(false); return; }

    const url = channelUrlFromId(artistId);
    channelUrlRef.current = url;

    (async () => {
      setMetaLoading(true);
      setError(null);
      try {
        const info: ChannelInfo = await MavinEngine.getChannelInfo(url, 0);
        const m: ChannelMeta = {
          name: info.name, description: info.description,
          avatarUrl: bestImage(info.avatars, "HIGH"),
          bannerUrl: bestImage(info.banners, "HIGH"),
          subscriberCount: info.subscriberCount,
          isVerified: info.isVerified, tags: info.tags,
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

  // ── Lazy-load tab data ─────────────────────────────────────────────────────

  const loadTab = useCallback(async (key: TabKey) => {
    if (loadedTabs.current.has(key)) return;
    const tabDef = tabs.find((t) => t.key === key);
    if (!tabDef) return;

    const url = channelUrlRef.current;
    const artistName = metaRef.current?.name ?? "";

    setTabLoading((p) => ({ ...p, [key]: true }));
    try {
      const page = await MavinEngine.getChannelTabItems(url, tabDef.channelTab.contentFilters[0], undefined, 0);
      loadedTabs.current.add(key);

      switch (key) {
        case "songs":
          setSongsData(
            page.items.filter((i): i is StreamInfoItem => i.type === "stream")
              .slice(0, 20).map((i) => streamItemToSong(i, artistName))
          );
          break;
        case "albums":
        case "singles": {
          const albums = page.items.map((i) => infoItemToAlbum(i, artistName)).filter((i): i is AlbumItem => i !== null).slice(0, 20);
          if (key === "albums") setAlbumsData(albums);
          else setSinglesData(albums);
          break;
        }
        case "playlists":
          setPlaylistsData(
            page.items.map((i) => infoItemToAlbum(i, artistName)).filter((i): i is AlbumItem => i !== null).slice(0, 20)
          );
          break;
        case "videos":
          setVideosData(
            page.items.map(infoItemToVideo).filter((i): i is VideoItem => i !== null).slice(0, 20)
          );
          break;
      }
    } catch (e) {
      console.warn(`[ArtistPage] tab ${key} failed:`, e);
    } finally {
      setTabLoading((p) => ({ ...p, [key]: false }));
    }
  }, [tabs]);

  useEffect(() => {
    if (tabs.length > 0 && activeTab) loadTab(activeTab);
  }, [activeTab, tabs, loadTab]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSongPlay = useCallback((song: Song) => {
    triggerHaptic();
    playAudio(song);
  }, [playAudio]);

  const handleSongMenu = useCallback((song: Song) => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/menu",
      params: { songData: JSON.stringify({ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail }), type: "song" },
    });
  }, [router]);

  const handleAlbumPress = useCallback((album: AlbumItem) => {
    triggerHaptic();
    router.push({
      pathname: "/(player)/search/album",
      params: { id: encodeURIComponent(album.url || album.id), artist: album.subtitle || metaRef.current?.name || "" },
    });
  }, [router]);

  const handlePlaylistPress = useCallback((playlist: AlbumItem) => {
    triggerHaptic();
    router.push({
      pathname: "/(player)/search/playlist",
      params: { id: encodeURIComponent(playlist.url || playlist.id) },
    });
  }, [router]);

  const handleVideoPlay = useCallback((video: VideoItem) => {
    triggerHaptic();
    playAudio({ id: video.id, title: video.title, artist: metaRef.current?.name ?? "", thumbnail: video.thumbnail, url: video.url, videoId: video.id });
  }, [playAudio]);

  const handleVideoMenu = useCallback((video: VideoItem) => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/menu",
      params: { songData: JSON.stringify({ id: video.id, title: video.title, artist: metaRef.current?.name ?? "", thumbnail: video.thumbnail }), type: "song" },
    });
  }, [router]);

  // ── Tab content ────────────────────────────────────────────────────────────

  const renderTabContent = () => {
    if (tabLoading[activeTab]) return <TabSkeleton colors={colors} />;

    switch (activeTab) {
      case "songs":
        if (!songsData.length) return <EmptyTab label="No songs found" colors={colors} />;
        return (
          <FlashList
            data={songsData}
            renderItem={({ item }) => <SongRow item={item} onPlay={() => handleSongPlay(item)} onMenu={() => handleSongMenu(item)} colors={colors} />}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            estimatedItemSize={70}
          />
        );

      case "albums":
      case "singles": {
        const data = activeTab === "albums" ? albumsData : singlesData;
        if (!data.length) return <EmptyTab label={`No ${activeTab} found`} colors={colors} />;
        return (
          <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 12 }}>
            {data.map((item) => (
              <AlbumCard key={item.id} item={item} onPress={() => handleAlbumPress(item)} colors={colors} />
            ))}
          </View>
        );
      }

      case "playlists":
        if (!playlistsData.length) return <EmptyTab label="No playlists found" colors={colors} />;
        return (
          <FlashList
            data={playlistsData}
            renderItem={({ item }) => (
              <View style={rowStyles.row}>
                <TouchableOpacity style={rowStyles.touchable} onPress={() => handlePlaylistPress(item)} activeOpacity={0.7}>
                  <Image source={{ uri: item.thumbnail }} style={rowStyles.thumb} contentFit="cover" />
                  <View style={rowStyles.textBlock}>
                    <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[rowStyles.sub, { color: colors.textSub }]} numberOfLines={1}>{item.subtitle}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            estimatedItemSize={70}
          />
        );

      case "videos":
        if (!videosData.length) return <EmptyTab label="No videos found" colors={colors} />;
        return (
          <FlashList
            data={videosData}
            renderItem={({ item }) => <VideoRow item={item} onPlay={() => handleVideoPlay(item)} onMenu={() => handleVideoMenu(item)} colors={colors} />}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            estimatedItemSize={90}
          />
        );

      default:
        return null;
    }
  };

  // ── Loading / error ────────────────────────────────────────────────────────

  if (metaLoading) return <ArtistPageSkeleton colors={colors} />;

  if (error || !meta) {
    return (
      <View style={[localStyles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={moderateScale(40)} color={colors.textSub} />
        <Text style={[localStyles.errorText, { color: colors.textSub }]}>{error ?? "Artist not found."}</Text>
        <TouchableOpacity style={[localStyles.backBtn, { borderColor: colors.gold }]} onPress={() => router.back()}>
          <Text style={[localStyles.backBtnText, { color: colors.gold }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[localStyles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: verticalScale(138) + bottom }}
      showsVerticalScrollIndicator={false}
    >
      {/* Banner */}
      <View style={localStyles.bannerContainer}>
        {meta.bannerUrl ? (
          <Image source={{ uri: meta.bannerUrl }} style={localStyles.banner} contentFit="cover" />
        ) : (
          <View style={[localStyles.banner, { backgroundColor: colors.surface }]} />
        )}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={StyleSheet.absoluteFill} />
        <TouchableOpacity
          style={[localStyles.backIcon, { top: top + 8 }]}
          onPress={() => { triggerHaptic(); router.back(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={moderateScale(24)} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Avatar + Name */}
      <View style={localStyles.headerRow}>
        <View style={localStyles.avatarWrapper}>
          {meta.avatarUrl ? (
            <Image source={{ uri: meta.avatarUrl }} style={localStyles.avatar} contentFit="cover" />
          ) : (
            <View style={[localStyles.avatar, { backgroundColor: colors.surface }]} />
          )}
        </View>
        <View style={localStyles.nameBlock}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[localStyles.artistName, { color: colors.text }]} numberOfLines={1}>{meta.name}</Text>
            {meta.isVerified && <MaterialIcons name="verified" size={moderateScale(18)} color="#3ea6ff" />}
          </View>
          {!!meta.subscriberCount && (
            <Text style={[localStyles.subscriberText, { color: colors.textSub }]}>
              {formatSubscribers(meta.subscriberCount)}
            </Text>
          )}
        </View>
      </View>

      {/* Tab bar */}
      {tabs.length > 0 && <TabBar tabs={tabs} activeKey={activeTab} onSelect={setActiveTab} colors={colors} />}

      <View style={[localStyles.divider, { backgroundColor: colors.border }]} />

      <View style={{ minHeight: 300 }}>
        {renderTabContent()}
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const localStyles = ScaledSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText: { fontSize: "14@ms", textAlign: "center", paddingHorizontal: 20 },
  backBtn:   { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 32 },
  backBtnText: { fontSize: "12@ms", fontWeight: "bold" },
  bannerContainer: { width: "100%", height: "180@ms", position: "relative" },
  banner:          { width: "100%", height: "180@ms" },
  backIcon:        { position: "absolute", left: 14, zIndex: 10, padding: 6, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 20 },
  headerRow:     { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, marginTop: -28, gap: 12 },
  avatarWrapper: { width: "72@ms", height: "72@ms", borderRadius: "36@ms", borderWidth: 3, borderColor: "#000", overflow: "hidden" },
  avatar:        { width: "72@ms", height: "72@ms" },
  nameBlock:     { flex: 1, paddingBottom: 4, gap: 2 },
  artistName:    { fontSize: "22@ms", fontWeight: "700" },
  subscriberText:{ fontSize: "13@ms" },
  divider:       { height: StyleSheet.hairlineWidth, marginTop: 4 },
});

const tabBarStyles = StyleSheet.create({
  scroll:    { flexGrow: 0, marginTop: 14 },
  container: { paddingHorizontal: 14, gap: 8, paddingVertical: 4 },
  pill:      { paddingHorizontal: scale(14), paddingVertical: verticalScale(7), borderRadius: 20 },
  label:     { fontSize: moderateScale(13), fontWeight: "500" },
});

const rowStyles = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  touchable:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb:      { width: moderateScale(52), height: moderateScale(52), borderRadius: 4 },
  videoThumb: { width: moderateScale(120), height: moderateScale(68), borderRadius: 4 },
  textBlock:  { flex: 1 },
  title:      { fontSize: moderateScale(14), fontWeight: "500", marginBottom: 3 },
  sub:        { fontSize: moderateScale(12) },
  durationBadge: { position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.8)", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  durationText:  { color: "#fff", fontSize: moderateScale(10), fontWeight: "600" },
});

const cardStyles = StyleSheet.create({
  card:  { width: (SCREEN_WIDTH - 48) / 2, marginBottom: 4, borderRadius: 10, overflow: "hidden" },
  image: { width: "100%", aspectRatio: 1, borderRadius: 8, marginBottom: 6 },
  title: { fontSize: moderateScale(13), fontWeight: "600", marginBottom: 2 },
  sub:   { fontSize: moderateScale(11) },
});
