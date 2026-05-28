// app/search/index.tsx
//
// FIXED: Discover/Beats song taps play via expo-audio in collapsed miniplayer
// FIXED: No expanded player on discovery tap — collapsePlayer used
// FIXED: Trending section shows cover art thumbnails when available (restored from v1)
// FIXED: handleDiscoveryPress explicitly calls deactivateAudio before playAudio
//        so expo-video always releases focus before expo-audio picks it up
// FIXED: Trending tap plays in miniplayer (collapsed), not expanded
// FIXED: expo-audio and expo-video session separation ensured on every play

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Keyboard,
  Dimensions,
  Animated,
  Easing,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, MaterialIcons, Entypo } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { setPendingTrack } from "@/helpers/pendingTrack";
import MavinEngine, {
  StreamInfoItem,
  PlaylistInfoItem,
  ChannelInfoItem,
  InfoItem,
} from "@/modules/mavin-engine";
import { cache } from "@/libs/cache";
import { useMusicPlayer } from "@/libs/playerSetup";
import { preloadSearchResults } from "@/libs/preload";
import { triggerHaptic } from "@/helpers/haptics";
import { extractVideoId, toWatchUrl } from "@/helpers/youtube";
import { DEVICE_CACHE_TTL } from "@/constants/cacheTTL";
import { useTheme } from "@/contexts/ThemeContext";
import { useAlert } from "@/contexts/AlertContext";
import { useSearchStore } from "@/store/search";
import { supabase } from "@/libs/supabase";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const SEARCH_CACHE_TTL_MS = DEVICE_CACHE_TTL.SEARCH_RESULT;
const DEBOUNCE_MS = 300;
const GLOBAL_HISTORY_LIMIT = 20;

const GRID_CARD_WIDTH = (SCREEN_WIDTH - 32 - 8) / 2.3;
const GRID_CARD_HEIGHT = 100;

const TRENDING_ITEM_WIDTH = 68;
const TRENDING_ITEM_GAP = 16;
const TRENDING_ITEM_FULL = TRENDING_ITEM_WIDTH + TRENDING_ITEM_GAP;

type FilterTab = "all" | "songs" | "albums" | "artists" | "playlists";

interface SongResult {
  type: "song";
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  videoId: string;
  duration: number;
  viewCount: number;
}

interface AlbumResult {
  type: "album";
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  streamCount: number;
}

interface ArtistResult {
  type: "artist";
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  url: string;
  subscriberCount: number;
}

interface PlaylistResult {
  type: "playlist";
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  streamCount: number;
}

type SearchResult = SongResult | AlbumResult | ArtistResult | PlaylistResult;

interface SearchResults {
  songs: SongResult[];
  albums: AlbumResult[];
  artists: ArtistResult[];
  playlists: PlaylistResult[];
}

interface DiscoveryItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: "song" | "album" | "artist" | "playlist" | "beat";
  url: string;
  data: any;
  bpm?: number;
  key?: string;
}

interface GlobalSearchItem {
  id: string;
  query: string;
  thumbnail_url: string;
  artist_name: string;
  search_count: number;
  last_searched: string;
  track_uuid: string | null;
}

const bestThumb = (thumbs: { url: string; resolutionLevel: string }[]): string =>
  thumbs.find(t => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find(t => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ?? "";

const formatSubs = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K subscribers`;
  return `${n} subscribers`;
};

const accentColor = (seed: string): string => {
  const palette = [
    "#1DB954", "#E91429", "#8D67AB", "#E13300",
    "#148A08", "#DC148C", "#1E3264", "#0D73EC",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
};

const mapEngineResults = (items: InfoItem[]): SearchResults => {
  const out: SearchResults = { songs: [], albums: [], artists: [], playlists: [] };
  for (const item of items) {
    if (item.type === "stream") {
      const s = item as StreamInfoItem;
      if (s.isLive || s.isShortFormContent) continue;
      const videoId = extractVideoId(s.url);
      if (!videoId) continue;
      out.songs.push({
        type: "song",
        id: videoId,
        title: s.name,
        artist: s.uploaderName,
        thumbnail: bestThumb(s.thumbnails),
        url: toWatchUrl(videoId),
        videoId,
        duration: s.duration,
        viewCount: s.viewCount,
      });
    } else if (item.type === "playlist") {
      const p = item as PlaylistInfoItem;
      const base = {
        id: p.url,
        title: p.name,
        artist: p.uploaderName,
        thumbnail: bestThumb(p.thumbnails),
        url: p.url,
        streamCount: p.streamCount,
      };
      if (p.uploaderName) out.albums.push({ type: "album", ...base });
      else out.playlists.push({ type: "playlist", ...base });
    } else if (item.type === "channel") {
      const c = item as ChannelInfoItem;
      out.artists.push({
        type: "artist",
        id: c.url,
        title: c.name,
        subtitle: formatSubs(c.subscriberCount),
        thumbnail: bestThumb(c.thumbnails),
        url: c.url,
        subscriberCount: c.subscriberCount,
      });
    }
  }
  return out;
};

const deviceCacheKey = (q: string) => `search:results:${q.toLowerCase().trim()}`;

async function saveToGlobalHistory(
  query: string,
  thumbnail = "",
  artist = "",
  trackUuid = "",
): Promise<void> {
  try {
    const { error: upsertError } = await supabase.from("global_search_history").upsert(
      {
        query: query.trim(),
        thumbnail_url: thumbnail,
        artist_name: artist,
        track_uuid: trackUuid || null,
        last_searched: new Date().toISOString(),
      },
      { onConflict: "query" },
    );

    if (upsertError) {
      console.error("[Search] Upsert error:", upsertError);
      return;
    }

    await supabase.rpc("increment_search_count", { search_query: query.trim() });
  } catch (e) {
    console.warn("[Search] saveToGlobalHistory:", e);
  }
}

async function getGlobalSearchHistory(): Promise<GlobalSearchItem[]> {
  try {
    const since = new Date();
    since.setHours(since.getHours() - 24);
    const { data, error } = await supabase
      .from("global_search_history")
      .select("id, query, thumbnail_url, artist_name, track_uuid, search_count, last_searched")
      .gte("last_searched", since.toISOString())
      .order("search_count", { ascending: false })
      .limit(GLOBAL_HISTORY_LIMIT);

    if (error || !data?.length) return [];
    return data;
  } catch {
    return [];
  }
}

async function getStreamUrlByTrackUuid(trackUuid: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("streams")
      .select("stream_url")
      .eq("track_id", trackUuid)
      .eq("stream_type", "audio")
      .maybeSingle();

    if (error || !data) return null;
    return data.stream_url;
  } catch (e) {
    console.warn("[Search] getStreamUrlByTrackUuid error:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING SEARCHES CONVEYOR
// Shows cover art thumbnail when available, falls back to initial-letter avatar
// ─────────────────────────────────────────────────────────────────────────────
function TrendingConveyorBelt({
  history,
  onSelect,
  colors,
}: {
  history: GlobalSearchItem[];
  onSelect: (item: GlobalSearchItem) => void;
  colors: any;
}) {
  const scrollX = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const doubled = [...history].reverse().concat([...history].reverse());
  const totalWidth = history.length * TRENDING_ITEM_FULL;

  useEffect(() => {
    if (!history.length) return;

    scrollX.setValue(0);

    const startLoop = () => {
      animRef.current = Animated.loop(
        Animated.timing(scrollX, {
          toValue: -totalWidth,
          duration: history.length * 2800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animRef.current.start();
    };

    startLoop();
    return () => {
      animRef.current?.stop();
    };
  }, [history.length, totalWidth]);

  if (!history.length) return null;

  return (
    <View style={conveyorStyles.wrapper}>
      <Text style={[conveyorStyles.heading, { color: colors.text }]}>🔥 Trending Searches</Text>
      <View style={conveyorStyles.track}>
        <Animated.View
          style={[conveyorStyles.belt, { transform: [{ translateX: scrollX }] }]}
        >
          {doubled.map((item, index) => {
            const bg = accentColor(item.query);
            return (
              <TouchableOpacity
                key={`${item.id}-${index}`}
                style={conveyorStyles.item}
                onPress={() => onSelect(item)}
                activeOpacity={0.75}
              >
                {/* RESTORED: show thumbnail cover art when available, fall back to initial avatar */}
                <View style={[conveyorStyles.avatarRing, { borderColor: bg + "70" }]}>
                  {item.thumbnail_url ? (
                    <Image
                      source={{ uri: item.thumbnail_url }}
                      style={conveyorStyles.avatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[conveyorStyles.avatar, { backgroundColor: bg + "22" }]}>
                      <Text style={[conveyorStyles.initial, { color: bg }]}>
                        {item.query.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[conveyorStyles.label, { color: colors.textSub }]}
                  numberOfLines={1}
                >
                  {item.query.length > 10 ? item.query.slice(0, 9) + "…" : item.query}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
}

const conveyorStyles = StyleSheet.create({
  wrapper: { marginBottom: 22 },
  heading: {
    fontSize: 13, fontWeight: "700", marginBottom: 12,
    paddingHorizontal: 16, letterSpacing: 0.4, textTransform: "uppercase",
  },
  track: { overflow: "hidden", paddingLeft: 16 },
  belt: { flexDirection: "row", alignItems: "flex-start", gap: TRENDING_ITEM_GAP },
  item: { alignItems: "center", width: TRENDING_ITEM_WIDTH },
  avatarRing: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 1.5,
    padding: 2, justifyContent: "center", alignItems: "center", overflow: "hidden",
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: "center", alignItems: "center",
  },
  initial: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 10, marginTop: 5, textAlign: "center", maxWidth: 68 },
});

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTIONS OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function SuggestionsOverlay({
  suggestions,
  onSelect,
  colors,
  visible,
}: {
  suggestions: string[];
  onSelect: (s: string) => void;
  colors: any;
  visible: boolean;
}) {
  if (!visible || !suggestions.length) return null;

  return (
    <View
      style={[
        suggStyles.container,
        { backgroundColor: colors.background + "F5", borderColor: colors.border },
      ]}
    >
      {suggestions.map((s, i) => (
        <TouchableOpacity
          key={i}
          style={[
            suggStyles.row,
            { borderBottomColor: colors.border },
            i === suggestions.length - 1 && { borderBottomWidth: 0 },
          ]}
          onPress={() => onSelect(s)}
          activeOpacity={0.7}
        >
          <Ionicons name="search-outline" size={14} color={colors.gold} style={{ marginRight: 10 }} />
          <Text style={[suggStyles.text, { color: colors.text }]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const suggStyles = StyleSheet.create({
  container: {
    position: "absolute", top: 0, left: 16, right: 16, zIndex: 99,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 14, elevation: 10,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 14, flex: 1 },
});

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDED PLAYLISTS
// ─────────────────────────────────────────────────────────────────────────────
function RecommendedPlaylists({
  items,
  onPress,
  colors,
  loading,
}: {
  items: DiscoveryItem[];
  onPress: (item: DiscoveryItem) => void;
  colors: any;
  loading: boolean;
}) {
  return (
    <View style={plStyles.wrapper}>
      <Text style={[plStyles.heading, { color: colors.text }]}>Playlists For You</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={plStyles.row}
      >
        {loading
          ? [1, 2, 3].map(i => (
              <View key={i} style={[plStyles.card, { backgroundColor: colors.surfaceRaised }]}>
                <View style={[plStyles.thumb, { backgroundColor: colors.surfaceHigh }]} />
                <View style={{ flex: 1, gap: 6, paddingHorizontal: 10 }}>
                  <View style={{ height: 11, width: "80%", borderRadius: 4, backgroundColor: colors.surfaceHigh }} />
                  <View style={{ height: 9, width: "55%", borderRadius: 4, backgroundColor: colors.surfaceHigh }} />
                </View>
              </View>
            ))
          : items.map(item => {
              const bg = accentColor(item.title);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[plStyles.card, { backgroundColor: colors.surfaceRaised }]}
                  onPress={() => onPress(item)}
                  activeOpacity={0.8}
                >
                  {item.thumbnail ? (
                    <Image source={{ uri: item.thumbnail }} style={plStyles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[plStyles.thumb, { backgroundColor: bg + "22" }]}>
                      <Ionicons name="musical-notes" size={20} color={bg} />
                    </View>
                  )}
                  <View style={{ flex: 1, paddingHorizontal: 10, justifyContent: "center" }}>
                    <Text style={[plStyles.title, { color: colors.text }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={[plStyles.sub, { color: colors.textSub }]} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
      </ScrollView>
    </View>
  );
}

const plStyles = StyleSheet.create({
  wrapper: { marginBottom: 24 },
  heading: {
    fontSize: 13, fontWeight: "700", marginBottom: 12,
    paddingHorizontal: 16, letterSpacing: 0.4, textTransform: "uppercase",
  },
  row: { paddingHorizontal: 16, gap: 10 },
  card: {
    flexDirection: "row", alignItems: "center",
    width: 210, borderRadius: 10, overflow: "hidden", height: 64,
  },
  thumb: { width: 64, height: 64, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 12, fontWeight: "600", marginBottom: 3 },
  sub: { fontSize: 11 },
});

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVER GRID
// ─────────────────────────────────────────────────────────────────────────────
function DiscoverGrid({
  items,
  onPress,
  colors,
  loading,
}: {
  items: DiscoveryItem[];
  onPress: (item: DiscoveryItem) => void;
  colors: any;
  loading: boolean;
}) {
  const pages: DiscoveryItem[][] = [];
  if (!loading) {
    for (let i = 0; i < items.length; i += 4) pages.push(items.slice(i, i + 4));
  }

  const PAGE_WIDTH = GRID_CARD_WIDTH * 2 + 8;
  const skeletonPage = [0, 1, 2, 3];

  const renderPage = (pageItems: DiscoveryItem[], pageIdx: number) => (
    <View key={pageIdx} style={[dgStyles.page, { width: PAGE_WIDTH }]}>
      {pageItems.map(item => {
        const bg = accentColor(item.title);
        return (
          <TouchableOpacity
            key={item.id}
            style={[dgStyles.card, { width: GRID_CARD_WIDTH, backgroundColor: colors.surface }]}
            onPress={() => onPress(item)}
            activeOpacity={0.8}
          >
            {item.thumbnail ? (
              <Image source={{ uri: item.thumbnail }} style={dgStyles.cardImage} contentFit="cover" />
            ) : (
              <View style={[dgStyles.cardImage, { backgroundColor: bg + "18" }]}>
                <MaterialIcons name="audiotrack" size={26} color={bg} />
              </View>
            )}
            <View style={dgStyles.cardInfo}>
              <Text style={[dgStyles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[dgStyles.cardSub, { color: colors.textSub }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderSkeletonPage = (pageIdx: number) => (
    <View key={pageIdx} style={[dgStyles.page, { width: PAGE_WIDTH }]}>
      {skeletonPage.map(idx => (
        <View
          key={idx}
          style={[dgStyles.card, { width: GRID_CARD_WIDTH, backgroundColor: colors.surfaceRaised }]}
        >
          <View style={[dgStyles.cardImage, { backgroundColor: colors.surfaceHigh }]} />
          <View style={dgStyles.cardInfo}>
            <View style={{ height: 10, width: "75%", borderRadius: 4, backgroundColor: colors.surfaceHigh, marginBottom: 4 }} />
            <View style={{ height: 9, width: "50%", borderRadius: 4, backgroundColor: colors.surfaceHigh }} />
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={dgStyles.wrapper}>
      <Text style={[dgStyles.heading, { color: colors.text }]}>Discover</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={PAGE_WIDTH + 12}
        snapToAlignment="start"
        contentContainerStyle={dgStyles.scroll}
      >
        {loading
          ? [0, 1].map(i => renderSkeletonPage(i))
          : pages.map((pageItems, idx) => renderPage(pageItems, idx))}
      </ScrollView>
    </View>
  );
}

const dgStyles = StyleSheet.create({
  wrapper: { marginBottom: 24 },
  heading: {
    fontSize: 13, fontWeight: "700", marginBottom: 12,
    paddingHorizontal: 16, letterSpacing: 0.4, textTransform: "uppercase",
  },
  scroll: { paddingHorizontal: 16, gap: 12 },
  page: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderRadius: 10, overflow: "hidden" },
  cardImage: {
    width: "100%", height: GRID_CARD_HEIGHT * 0.6,
    justifyContent: "center", alignItems: "center",
  },
  cardInfo: { paddingHorizontal: 8, paddingVertical: 6 },
  cardTitle: { fontSize: 11, fontWeight: "600", marginBottom: 2 },
  cardSub: { fontSize: 10 },
});

// ─────────────────────────────────────────────────────────────────────────────
// BEATS SECTION
// ─────────────────────────────────────────────────────────────────────────────
function BeatsSection({
  items,
  onPress,
  colors,
  loading,
}: {
  items: DiscoveryItem[];
  onPress: (item: DiscoveryItem) => void;
  colors: any;
  loading: boolean;
}) {
  const pages: DiscoveryItem[][] = [];
  if (!loading) {
    for (let i = 0; i < items.length; i += 4) pages.push(items.slice(i, i + 4));
  }

  const PAGE_WIDTH = GRID_CARD_WIDTH * 2 + 8;

  const renderPage = (pageItems: DiscoveryItem[], pageIdx: number) => (
    <View key={pageIdx} style={[bStyles.page, { width: PAGE_WIDTH }]}>
      {pageItems.map(item => {
        const bg = accentColor(item.title);
        return (
          <TouchableOpacity
            key={item.id}
            style={[bStyles.card, { width: GRID_CARD_WIDTH, backgroundColor: colors.surface }]}
            onPress={() => onPress(item)}
            activeOpacity={0.8}
          >
            {item.thumbnail ? (
              <Image source={{ uri: item.thumbnail }} style={bStyles.cardImage} contentFit="cover" />
            ) : (
              <View style={[bStyles.cardImage, { backgroundColor: bg + "18" }]}>
                <MaterialIcons name="equalizer" size={26} color={bg} />
              </View>
            )}
            <View style={bStyles.cardInfo}>
              <Text style={[bStyles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[bStyles.cardSub, { color: colors.textSub }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
              {item.bpm && item.key && (
                <View style={bStyles.metaRow}>
                  <Text style={[bStyles.metaChip, { color: bg, borderColor: bg + "50" }]}>
                    {item.bpm} BPM
                  </Text>
                  <Text style={[bStyles.metaChip, { color: bg, borderColor: bg + "50" }]}>
                    {item.key}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (loading) {
    return (
      <View style={bStyles.wrapper}>
        <Text style={[bStyles.heading, { color: colors.text }]}>Beats</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={bStyles.scroll}
        >
          {[0, 1].map(i => (
            <View key={i} style={[bStyles.page, { width: PAGE_WIDTH }]}>
              {[0, 1, 2, 3].map(idx => (
                <View
                  key={idx}
                  style={[bStyles.card, { width: GRID_CARD_WIDTH, backgroundColor: colors.surfaceRaised }]}
                >
                  <View style={[bStyles.cardImage, { backgroundColor: colors.surfaceHigh }]} />
                  <View style={bStyles.cardInfo}>
                    <View style={{ height: 10, width: "80%", borderRadius: 4, backgroundColor: colors.surfaceHigh }} />
                    <View style={{ height: 9, width: "50%", borderRadius: 4, backgroundColor: colors.surfaceHigh, marginTop: 4 }} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (!items.length) return null;

  return (
    <View style={bStyles.wrapper}>
      <Text style={[bStyles.heading, { color: colors.text }]}>Beats</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={PAGE_WIDTH + 12}
        snapToAlignment="start"
        contentContainerStyle={bStyles.scroll}
      >
        {pages.map((pageItems, idx) => renderPage(pageItems, idx))}
      </ScrollView>
    </View>
  );
}

const bStyles = StyleSheet.create({
  wrapper: { marginBottom: 28 },
  heading: {
    fontSize: 13, fontWeight: "700", marginBottom: 12,
    paddingHorizontal: 16, letterSpacing: 0.4, textTransform: "uppercase",
  },
  scroll: { paddingHorizontal: 16, gap: 12 },
  page: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderRadius: 10, overflow: "hidden" },
  cardImage: {
    width: "100%", height: GRID_CARD_HEIGHT * 0.6,
    justifyContent: "center", alignItems: "center",
  },
  cardInfo: { paddingHorizontal: 8, paddingVertical: 6 },
  cardTitle: { fontSize: 11, fontWeight: "600", marginBottom: 2 },
  cardSub: { fontSize: 10, marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 4 },
  metaChip: {
    fontSize: 9, fontWeight: "600", borderWidth: 1,
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// RESULT ROWS
// ─────────────────────────────────────────────────────────────────────────────
function SongResultRow({
  item, onPress, onMenu, colors,
}: {
  item: SongResult;
  onPress: () => void;
  onMenu: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={[rowStyles.container, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={rowStyles.thumb} contentFit="cover" />
      ) : (
        <View style={[rowStyles.thumb, rowStyles.thumbFallback, { backgroundColor: colors.surfaceRaised }]}>
          <Ionicons name="musical-notes" size={20} color={colors.gold} />
        </View>
      )}
      <View style={rowStyles.info}>
        <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[rowStyles.sub, { color: colors.textSub }]} numberOfLines={1}>{item.artist}</Text>
      </View>
      <TouchableOpacity
        onPress={onMenu}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={rowStyles.menuBtn}
      >
        <Entypo name="dots-three-vertical" size={15} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function OtherResultRow({
  item, onPress, colors,
}: {
  item: AlbumResult | ArtistResult | PlaylistResult;
  onPress: () => void;
  colors: any;
}) {
  const isArtist = item.type === "artist";
  const icon = isArtist ? "person" : item.type === "album" ? "disc" : "list";
  const subtitle = isArtist
    ? (item as ArtistResult).subtitle
    : item.type === "album"
    ? `Album · ${item.artist}`
    : `Playlist · ${(item as PlaylistResult).streamCount} songs`;

  return (
    <TouchableOpacity
      style={[rowStyles.container, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {item.thumbnail ? (
        <Image
          source={{ uri: item.thumbnail }}
          style={[rowStyles.thumb, isArtist && rowStyles.thumbCircle]}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            rowStyles.thumb, rowStyles.thumbFallback,
            isArtist && rowStyles.thumbCircle,
            { backgroundColor: colors.surfaceRaised },
          ]}
        >
          <Ionicons name={icon} size={20} color={colors.gold} />
        </View>
      )}
      <View style={rowStyles.info}>
        <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[rowStyles.sub, { color: colors.textSub }]} numberOfLines={1}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 9, paddingHorizontal: 16,
    gap: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 50, height: 50, borderRadius: 6 },
  thumbCircle: { borderRadius: 25 },
  thumbFallback: { justifyContent: "center", alignItems: "center" },
  info: { flex: 1 },
  title: { fontSize: 14, fontWeight: "500", marginBottom: 3 },
  sub: { fontSize: 12 },
  menuBtn: { padding: 4 },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOP RESULT CARD
// ─────────────────────────────────────────────────────────────────────────────
function TopResultCard({
  item, onPress, onPlay, colors,
}: {
  item: SearchResult;
  onPress: () => void;
  onPlay: () => void;
  colors: any;
}) {
  const isArtist = item.type === "artist";
  const icon = isArtist ? "person" : item.type === "album" ? "disc" : "musical-notes";
  const subtitle = isArtist
    ? "Artist"
    : item.type === "album"
    ? `Album · ${item.artist}`
    : item.type === "playlist"
    ? "Playlist"
    : `Song · ${item.artist}`;

  return (
    <TouchableOpacity
      style={[topStyles.card, { backgroundColor: colors.surface }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {item.thumbnail ? (
        <Image
          source={{ uri: item.thumbnail }}
          style={[topStyles.image, isArtist && topStyles.imageCircle]}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            topStyles.image, topStyles.imageFallback,
            isArtist && topStyles.imageCircle,
            { backgroundColor: colors.surfaceLight },
          ]}
        >
          <Ionicons name={icon} size={38} color={colors.gold} />
        </View>
      )}
      <Text style={[topStyles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
      <Text style={[topStyles.sub, { color: colors.textSub }]} numberOfLines={1}>{subtitle}</Text>
      <TouchableOpacity
        style={[topStyles.playBtn, { backgroundColor: colors.gold }]}
        onPress={e => { e.stopPropagation?.(); onPlay(); }}
      >
        <Ionicons name="play" size={20} color="#000" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const topStyles = StyleSheet.create({
  card: {
    borderRadius: 10, padding: 14, marginRight: 8,
    position: "relative", overflow: "hidden", width: 178,
  },
  image: { width: 100, height: 100, borderRadius: 8, marginBottom: 10 },
  imageCircle: { borderRadius: 50 },
  imageFallback: { justifyContent: "center", alignItems: "center" },
  title: { fontSize: 15, fontWeight: "700", marginBottom: 3 },
  sub: { fontSize: 11 },
  playBtn: {
    position: "absolute", right: 12, bottom: 12,
    width: 38, height: 38, borderRadius: 19,
    justifyContent: "center", alignItems: "center",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// FILTER CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function FilterChips({
  activeTab, setActiveTab, colors,
}: {
  activeTab: FilterTab;
  setActiveTab: (t: FilterTab) => void;
  colors: any;
}) {
  const tabs: FilterTab[] = ["all", "songs", "albums", "artists", "playlists"];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={chipStyles.row}
    >
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab}
          style={[
            chipStyles.chip,
            { backgroundColor: activeTab === tab ? colors.gold + "18" : colors.surfaceRaised },
            activeTab === tab && { borderColor: colors.gold, borderWidth: 1 },
          ]}
          onPress={() => { triggerHaptic(); setActiveTab(tab); }}
          activeOpacity={0.7}
        >
          <Text
            style={[
              chipStyles.chipText,
              { color: activeTab === tab ? colors.gold : colors.textSub },
            ]}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const chipStyles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "transparent",
  },
  chipText: { fontSize: 13, fontWeight: "500" },
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────
function EmptyResultsView({ colors }: { colors: any }) {
  return (
    <View style={{ alignItems: "center", paddingTop: 64, gap: 12 }}>
      <Ionicons name="search-outline" size={44} color={colors.textMuted} />
      <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: "500" }}>
        No results found
      </Text>
      <Text style={{ color: colors.textSub, fontSize: 13, textAlign: "center" }}>
        Try searching for songs, artists, or albums
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON ROW
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonResultRow({ colors }: { colors: any }) {
  return (
    <View style={[rowStyles.container, { borderBottomColor: colors.border }]}>
      <View style={[rowStyles.thumb, { backgroundColor: colors.surfaceLight }]} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={{ height: 12, width: "70%", borderRadius: 4, backgroundColor: colors.surfaceLight }} />
        <View style={{ height: 10, width: "45%", borderRadius: 4, backgroundColor: colors.surfaceLight }} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH RESULTS VIEW
// ─────────────────────────────────────────────────────────────────────────────
function SearchResultsView({
  results, activeTab, setActiveTab,
  onSongPress, onAlbumPress, onArtistPress, onPlaylistPress, onMenuPress,
  colors, isRefreshing,
}: {
  results: SearchResults;
  activeTab: FilterTab;
  setActiveTab: (t: FilterTab) => void;
  onSongPress: (s: SongResult) => void;
  onAlbumPress: (a: AlbumResult) => void;
  onArtistPress: (a: ArtistResult) => void;
  onPlaylistPress: (p: PlaylistResult) => void;
  onMenuPress: (s: SongResult) => void;
  colors: any;
  isRefreshing: boolean;
}) {
  const topResult: SearchResult | null =
    results.artists[0] ?? results.songs[0] ?? results.albums[0] ?? results.playlists[0] ?? null;

  const renderTabContent = () => {
    switch (activeTab) {
      case "songs":
        if (!results.songs.length) return <EmptyResultsView colors={colors} />;
        return results.songs.map(s => (
          <SongResultRow
            key={s.id} item={s}
            onPress={() => onSongPress(s)}
            onMenu={() => onMenuPress(s)}
            colors={colors}
          />
        ));
      case "albums":
        if (!results.albums.length) return <EmptyResultsView colors={colors} />;
        return results.albums.map(a => (
          <OtherResultRow key={a.id} item={a} onPress={() => onAlbumPress(a)} colors={colors} />
        ));
      case "artists":
        if (!results.artists.length) return <EmptyResultsView colors={colors} />;
        return results.artists.map(a => (
          <OtherResultRow key={a.id} item={a} onPress={() => onArtistPress(a)} colors={colors} />
        ));
      case "playlists":
        if (!results.playlists.length) return <EmptyResultsView colors={colors} />;
        return results.playlists.map(p => (
          <OtherResultRow key={p.id} item={p} onPress={() => onPlaylistPress(p)} colors={colors} />
        ));
      default:
        return null;
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 140 }}
    >
      {isRefreshing && (
        <View style={{ paddingVertical: 12, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      )}
      <FilterChips activeTab={activeTab} setActiveTab={setActiveTab} colors={colors} />
      {activeTab === "all" ? (
        <>
          <View style={resStyles.topSection}>
            <View style={resStyles.topLeft}>
              <Text style={[resStyles.sectionLabel, { color: colors.text }]}>Top result</Text>
              {topResult && (
                <TopResultCard
                  item={topResult}
                  onPress={() => {
                    if (topResult.type === "song") onSongPress(topResult as SongResult);
                    else if (topResult.type === "album") onAlbumPress(topResult as AlbumResult);
                    else if (topResult.type === "artist") onArtistPress(topResult as ArtistResult);
                    else onPlaylistPress(topResult as PlaylistResult);
                  }}
                  onPlay={() => {
                    const song = results.songs[0];
                    if (song) onSongPress(song);
                    else if (topResult.type === "song") onSongPress(topResult as SongResult);
                  }}
                  colors={colors}
                />
              )}
            </View>
            {results.songs.length > 0 && (
              <View style={resStyles.topRight}>
                <Text style={[resStyles.sectionLabel, { color: colors.text }]}>Songs</Text>
                {results.songs.slice(0, 4).map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={resStyles.sideSongRow}
                    onPress={() => onSongPress(s)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={{ uri: s.thumbnail }}
                      style={resStyles.sideSongThumb}
                      contentFit="cover"
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[resStyles.sideSongTitle, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {s.title}
                      </Text>
                      <Text
                        style={[resStyles.sideSongArtist, { color: colors.textSub }]}
                        numberOfLines={1}
                      >
                        {s.artist}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => onMenuPress(s)} hitSlop={8}>
                      <Entypo name="dots-three-vertical" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {results.albums.length > 0 && (
            <View style={resStyles.section}>
              <Text style={[resStyles.sectionLabel, { color: colors.text }]}>Albums</Text>
              {results.albums.slice(0, 4).map(a => (
                <OtherResultRow key={a.id} item={a} onPress={() => onAlbumPress(a)} colors={colors} />
              ))}
            </View>
          )}
          {results.artists.length > 1 && (
            <View style={resStyles.section}>
              <Text style={[resStyles.sectionLabel, { color: colors.text }]}>Artists</Text>
              {results.artists.slice(0, 4).map(a => (
                <OtherResultRow key={a.id} item={a} onPress={() => onArtistPress(a)} colors={colors} />
              ))}
            </View>
          )}
          {results.playlists.length > 0 && (
            <View style={resStyles.section}>
              <Text style={[resStyles.sectionLabel, { color: colors.text }]}>Playlists</Text>
              {results.playlists.slice(0, 4).map(p => (
                <OtherResultRow key={p.id} item={p} onPress={() => onPlaylistPress(p)} colors={colors} />
              ))}
            </View>
          )}
        </>
      ) : (
        renderTabContent()
      )}
    </ScrollView>
  );
}

const resStyles = StyleSheet.create({
  topSection: { flexDirection: "row", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  topLeft: { flex: 1.1 },
  topRight: { flex: 1 },
  sectionLabel: { fontSize: 16, fontWeight: "700", marginBottom: 12, letterSpacing: 0.1 },
  sideSongRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  sideSongThumb: { width: 42, height: 42, borderRadius: 4 },
  sideSongTitle: { fontSize: 12, fontWeight: "500", marginBottom: 2 },
  sideSongArtist: { fontSize: 10 },
  section: { marginTop: 16, marginBottom: 4, paddingHorizontal: 16 },
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL ABORT CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
let searchAbortController: AbortController | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { playAudio, collapsePlayer, deactivateAudio } = useMusicPlayer();
  const { colors } = useTheme();
  const { showAlert } = useAlert();

  const { data: searchData, loading: searchDataLoading, hasAnyData: searchHasData } = useSearchStore();

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [globalHistory, setGlobalHistory] = useState<GlobalSearchItem[]>([]);

  const discoverItems = searchData?.discoverSongs || [];
  const playlists = searchData?.playlists || [];
  const beats = searchData?.beats || [];
  const discoveryLoading = searchDataLoading && !searchHasData();

  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadHistory = async () => {
      const history = await getGlobalSearchHistory();
      setGlobalHistory(history);
    };
    loadHistory();
    setTimeout(() => inputRef.current?.focus(), 150);

    return () => {
      if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
      }
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (results || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await MavinEngine.getSearchSuggestions(query.trim(), 0);
        setSuggestions(res.suggestions?.slice(0, 6) ?? []);
      } catch {
        setSuggestions([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, results]);

  const performSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    Keyboard.dismiss();
    setSuggestions([]);
    setLoading(true);
    setError(null);
    setActiveTab("all");

    // Save to global history async (fire-and-forget)
    (async () => {
      try {
        const preview = await MavinEngine.search(trimmed, "", undefined, 0);
        const first = preview?.results?.find((i: any) => i.type === "stream");
        const videoId = first ? extractVideoId(first.url) : "";

        let trackUuid = "";
        if (videoId) {
          const { data: songData } = await supabase
            .from("songs")
            .select("id")
            .eq("video_id", videoId)
            .maybeSingle();
          if (songData) trackUuid = songData.id;
        }

        await saveToGlobalHistory(
          trimmed,
          first ? bestThumb(first.thumbnails) : "",
          first?.uploaderName ?? "",
          trackUuid,
        );
        const updated = await getGlobalSearchHistory();
        setGlobalHistory(updated);
      } catch {}
    })();

    const cacheKey = deviceCacheKey(trimmed);
    try {
      const cached = await cache.get(cacheKey);
      if (cached && (cached as SearchResults).songs?.length) {
        setResults(cached as SearchResults);
        setLoading(false);
        return;
      }
    } catch {}

    try {
      const raw = await MavinEngine.search(trimmed, "", undefined, 0);
      if (searchAbortController?.signal.aborted) return;

      const mapped = mapEngineResults(raw.results ?? []);
      setResults(mapped);

      if (mapped.songs && mapped.songs.length > 0) {
        const songsToPreload = mapped.songs.slice(0, 4).map(song => ({
          id: song.id, title: song.title, artist: song.artist,
          thumbnail: song.thumbnail, url: song.url, videoId: song.videoId,
          duration: song.duration,
        }));
        preloadSearchResults(songsToPreload);
      }

      if (
        mapped.songs.length ||
        mapped.albums.length ||
        mapped.artists.length ||
        mapped.playlists.length
      ) {
        cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
      }
    } catch (e: any) {
      if (searchAbortController?.signal.aborted) return;
      setError(e?.message ?? "Search failed");
    } finally {
      if (!searchAbortController?.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const handleSubmit = () => performSearch(query);
  const handleSuggestionTap = (s: string) => { setQuery(s); performSearch(s); };

  const handleCancel = () => {
    Keyboard.dismiss();
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
    if (results || query) {
      setQuery("");
      setResults(null);
      setSuggestions([]);
    } else {
      router.back();
    }
  };

  // ── Play helper — always uses expo-audio, always in collapsed miniplayer ─────
  const playInMiniplayer = useCallback(
    async (song: {
      id: string;
      title: string;
      artist: string;
      thumbnail: string;
      url: string;
      videoId?: string;
    }, queue?: Array<typeof song>) => {
      triggerHaptic();

      try {
        await deactivateAudio();
      } catch (e) {
        console.warn("[Search] deactivateAudio failed:", e);
      }

      setPendingTrack({
        title: song.title,
        artist: song.artist,
        artwork: song.thumbnail,
      });

      const playQueue = (queue ?? [song]).map(s => ({
        id: s.id, title: s.title, artist: s.artist,
        thumbnail: s.thumbnail, url: s.url, videoId: s.videoId,
      }));

      await playAudio(
        {
          id: song.id, title: song.title, artist: song.artist,
          thumbnail: song.thumbnail, url: song.url, videoId: song.videoId,
        },
        playQueue,
        undefined,
      );
    },
    [deactivateAudio, playAudio],
  );

  // ── Song press from search results ─────────────────────────────────────────
  const handleSongPress = useCallback(
    async (song: SongResult) => {
      const queue = (results?.songs ?? []).map(s => ({
        id: s.id, title: s.title, artist: s.artist,
        thumbnail: s.thumbnail, url: s.url, videoId: s.videoId,
      }));
      await playInMiniplayer(
        {
          id: song.id, title: song.title, artist: song.artist,
          thumbnail: song.thumbnail, url: song.url, videoId: song.videoId,
        },
        queue,
      );
    },
    [results, playInMiniplayer],
  );

  // ── Album / Artist / Playlist press ───────────────────────────────────────
  const handleAlbumPress = (a: AlbumResult) => {
    triggerHaptic();
    router.push({
      pathname: "./search/album",
      params: { id: encodeURIComponent(a.url), artist: a.artist },
    });
  };

  const handleArtistPress = (a: ArtistResult) => {
    triggerHaptic();
    router.push({
      pathname: "./search/artist",
      params: { id: encodeURIComponent(a.url), subtitle: a.subtitle },
    });
  };

  const handlePlaylistPress = (p: PlaylistResult) => {
    triggerHaptic();
    router.push({
      pathname: "./search/playlist",
      params: { id: encodeURIComponent(p.url) },
    });
  };

  const handleMenuPress = (s: SongResult) => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/menu",
      params: {
        songData: JSON.stringify({
          id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail,
        }),
        type: "song",
      },
    });
  };

  // ── Trending tap ──────────────────────────────────────────────────────────
  const handleTrendingTap = useCallback(
    async (item: GlobalSearchItem) => {
      triggerHaptic();
      setQuery(item.query);

      if (item.track_uuid) {
        const streamUrl = await getStreamUrlByTrackUuid(item.track_uuid);
        if (streamUrl) {
          await playInMiniplayer({
            id: item.track_uuid,
            title: item.query,
            artist: item.artist_name || "Trending",
            thumbnail: item.thumbnail_url,
            url: streamUrl,
            videoId: "",
          });
          return;
        }
      }

      performSearch(item.query);
    },
    [playInMiniplayer, performSearch],
  );

  // ── Discovery press ────────────────────────────────────────────────────────
  const handleDiscoveryPress = useCallback(
    async (item: DiscoveryItem) => {
      triggerHaptic();

      if ((item.type === "song" || item.type === "beat") && item.url) {
        await playInMiniplayer({
          id: item.id,
          title: item.title,
          artist: item.subtitle,
          thumbnail: item.thumbnail,
          url: item.url,
          videoId: item.id,
        });
        return;
      }

      if (item.type === "playlist" && item.url) {
        router.push({
          pathname: "./search/playlist",
          params: { id: encodeURIComponent(item.url) },
        });
        return;
      }

      if (item.type === "album" && item.url) {
        router.push({
          pathname: "./search/album",
          params: { id: encodeURIComponent(item.url), artist: item.subtitle },
        });
        return;
      }

      if (item.type === "artist" && item.url) {
        router.push({
          pathname: "./search/artist",
          params: { id: encodeURIComponent(item.url), subtitle: item.subtitle },
        });
      }
    },
    [playInMiniplayer, router],
  );

  const showDiscovery = !results && !error;
  const showResults = !!results;
  const showSuggestions = !results && suggestions.length > 0 && query.trim().length >= 2;

  return (
    <View style={[mainStyles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Search Bar */}
      <View style={mainStyles.searchRow}>
        <View style={[mainStyles.searchBar, { backgroundColor: colors.surfaceRaised }]}>
          {loading && !results ? (
            <ActivityIndicator size="small" color={colors.gold} style={{ marginRight: 8 }} />
          ) : (
            <Ionicons name="search" size={17} color={colors.textMuted} style={{ marginRight: 8 }} />
          )}
          <TextInput
            ref={inputRef}
            style={[mainStyles.searchInput, { color: colors.text }]}
            value={query}
            onChangeText={t => {
              setQuery(t);
              if (!t) { setResults(null); setSuggestions([]); }
            }}
            onSubmitEditing={handleSubmit}
            placeholder="Search songs, artists, albums…"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={colors.gold}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { setQuery(""); setResults(null); setSuggestions([]); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {(query.length > 0 || !!results) && (
          <TouchableOpacity onPress={handleCancel} style={mainStyles.cancelBtn}>
            <Text style={[mainStyles.cancelText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <View style={mainStyles.contentArea}>
        {showDiscovery && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 140, paddingTop: 8 }}
          >
            <TrendingConveyorBelt
              history={globalHistory}
              onSelect={handleTrendingTap}
              colors={colors}
            />
            <RecommendedPlaylists
              items={playlists}
              onPress={handleDiscoveryPress}
              colors={colors}
              loading={discoveryLoading}
            />
            <DiscoverGrid
              items={discoverItems}
              onPress={handleDiscoveryPress}
              colors={colors}
              loading={discoveryLoading}
            />
            <BeatsSection
              items={beats}
              onPress={handleDiscoveryPress}
              colors={colors}
              loading={discoveryLoading}
            />
          </ScrollView>
        )}

        {!!error && !loading && (
          <View style={mainStyles.errorBox}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
            <Text style={[mainStyles.errorText, { color: colors.textSub }]}>{error}</Text>
            <TouchableOpacity
              style={[mainStyles.retryBtn, { borderColor: colors.gold }]}
              onPress={handleSubmit}
              activeOpacity={0.8}
            >
              <Text style={[mainStyles.retryText, { color: colors.gold }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {showResults && (
          <SearchResultsView
            results={results!}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onSongPress={handleSongPress}
            onAlbumPress={handleAlbumPress}
            onArtistPress={handleArtistPress}
            onPlaylistPress={handlePlaylistPress}
            onMenuPress={handleMenuPress}
            colors={colors}
            isRefreshing={loading && !!results}
          />
        )}

        <SuggestionsOverlay
          suggestions={suggestions}
          onSelect={handleSuggestionTap}
          colors={colors}
          visible={showSuggestions}
        />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const mainStyles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10,
  },
  searchBar: {
    flex: 1, flexDirection: "row", alignItems: "center",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  cancelBtn: { paddingVertical: 8 },
  cancelText: { fontSize: 15, fontWeight: "500" },
  contentArea: { flex: 1, position: "relative" },
  errorBox: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 14, paddingHorizontal: 28,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 22, borderWidth: 1, marginTop: 4,
  },
  retryText: { fontSize: 13, fontWeight: "600" },
});