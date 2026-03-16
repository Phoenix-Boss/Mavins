/**
 * Search Screen — app/(tabs)/search/index.tsx
 *
 * Search flow (cache-first, MavinEngine as last resort):
 *
 *   1. Check deviceCache (L1 — AsyncStorage, instant)
 *   2. Check supabaseCache (L2 — tracks + cache_metadata tables)
 *   3. If still a miss → call MavinEngine.search() (NewPipe)
 *   4. Cache results in deviceCache + supabaseCache (fire & forget)
 *   5. Silently push tracks / artists to their Supabase tables
 *
 * On subsequent searches for the same query, MavinEngine is never called —
 * Supabase returns the data directly.
 *
 * Routing:
 *   Song     → playAudio(song, queue) via MusicPlayerContext
 *   Album    → /album/[encoded-url]
 *   Artist   → /artist/[encoded-url]
 *   Playlist → /playlist/[encoded-url]
 *
 * Search history: persisted in deviceCache under "search:history:v1" (1 year TTL)
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import LoaderKit from "react-native-loader-kit";
import { useActiveTrack } from "react-native-track-player";
import { moderateScale, verticalScale } from "react-native-size-matters/extend";

import MavinEngine, {
  StreamInfoItem,
  PlaylistInfoItem,
  ChannelInfoItem,
  InfoItem,
} from "@/modules/mavin-engine";
import { cache, supabaseCache } from "@/libs/cache";
import { supabase } from "@/libs/supabase";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { triggerHaptic } from "@/helpers/haptics";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  background:    "#000000",
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
  danger:        "#EF4444",
};

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;   // 30 min device cache
const HISTORY_CACHE_KEY   = "search:history:v1";
const HISTORY_CACHE_TTL   = 365 * 24 * 60 * 60 * 1000; // 1 year
const HISTORY_MAX         = 20;
const DEBOUNCE_MS         = 400;

type FilterTab = "all" | "songs" | "albums" | "artists" | "playlists";

// ─── Result types ─────────────────────────────────────────────────────────────

interface SongResult {
  type: "song";
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;         // full YouTube watch URL
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
  songs:     SongResult[];
  albums:    AlbumResult[];
  artists:   ArtistResult[];
  playlists: PlaylistResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const bestThumb = (
  thumbs: { url: string; resolutionLevel: string }[]
): string =>
  thumbs.find((t) => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find((t) => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ?? "";

const formatDuration = (s: number): string => {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const formatSubs = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K subscribers`;
  return `${n} subscribers`;
};

/** Map raw MavinEngine InfoItem[] → typed SearchResults */
const mapEngineResults = (items: InfoItem[]): SearchResults => {
  const out: SearchResults = { songs: [], albums: [], artists: [], playlists: [] };

  for (const item of items) {
    if (item.type === "stream") {
      const s = item as StreamInfoItem;
      if (s.isLive || s.isShortFormContent) continue;
      out.songs.push({
        type:      "song",
        id:        s.url.split("v=")[1]?.split("&")[0] ?? s.url,
        title:     s.name,
        artist:    s.uploaderName,
        thumbnail: bestThumb(s.thumbnails),
        url:       s.url,
        duration:  s.duration,
        viewCount: s.viewCount,
      });
    } else if (item.type === "playlist") {
      const p = item as PlaylistInfoItem;
      const base = {
        id:          p.url,
        title:       p.name,
        artist:      p.uploaderName,
        thumbnail:   bestThumb(p.thumbnails),
        url:         p.url,
        streamCount: p.streamCount,
      };
      // Treat named-uploader playlists as albums
      if (p.uploaderName) {
        out.albums.push({ type: "album", ...base });
      } else {
        out.playlists.push({ type: "playlist", ...base });
      }
    } else if (item.type === "channel") {
      const c = item as ChannelInfoItem;
      out.artists.push({
        type:            "artist",
        id:              c.url,
        title:           c.name,
        subtitle:        formatSubs(c.subscriberCount),
        thumbnail:       bestThumb(c.thumbnails),
        url:             c.url,
        subscriberCount: c.subscriberCount,
      });
    }
  }

  return out;
};

// ─── Silent Supabase persist ──────────────────────────────────────────────────

/**
 * Push search results to their respective Supabase tables.
 * Fully fire-and-forget — never blocks the UI.
 *
 * Tables written:
 *   tracks  ← songs (via supabaseCache.saveTrack)
 *   artists ← artists (via supabaseCache.saveArtist)
 *   cache_metadata ← search query → track mapping
 */
const persistResultsToSupabase = async (
  query: string,
  results: SearchResults
): Promise<void> => {
  try {
    // 1. Save artists
    for (const artist of results.artists.slice(0, 5)) {
      supabaseCache.saveArtist(artist.title, {
        name:        artist.title,
        topTracks:   [],
        albums:      [],
        similar:     [],
        lastUpdated: new Date().toISOString(),
      }).catch(() => {});
    }

    // 2. Save songs as tracks
    for (const song of results.songs.slice(0, 10)) {
      supabaseCache.saveTrack({
        title:      song.title,
        artist:     song.artist,
        duration:   song.duration,
        artworkUrl: song.thumbnail,
        youtubeId:  song.id,
        metadata:   { source: "search", query, viewCount: song.viewCount },
      }).then((trackId) => {
        if (!trackId) return;
        // 3. Record cache_metadata entry for this query → track mapping
        supabaseCache.saveSearch(query, trackId).catch(() => {});
      }).catch(() => {});
    }
  } catch {
    // Silent — never surface errors from background persist
  }
};

// ─── Cache key helpers ────────────────────────────────────────────────────────

const deviceCacheKey  = (q: string) => `search:results:${q.toLowerCase().trim()}`;

// ─── History helpers ──────────────────────────────────────────────────────────

const loadHistory = async (): Promise<string[]> => {
  try {
    const h = await cache.get(HISTORY_CACHE_KEY);
    if (Array.isArray(h)) return h as string[];
  } catch {}
  return [];
};

const saveToHistory = async (
  query: string,
  existing: string[]
): Promise<string[]> => {
  const next = [query, ...existing.filter((q) => q !== query)].slice(0, HISTORY_MAX);
  cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

const clearAllHistory = () =>
  cache.delete(HISTORY_CACHE_KEY).catch(() => {});

const removeHistoryItem = async (
  query: string,
  existing: string[]
): Promise<string[]> => {
  const next = existing.filter((q) => q !== query);
  cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const insets      = useSafeAreaInsets();
  const router      = useRouter();
  const activeTrack = useActiveTrack();
  const { playAudio } = useMusicPlayer();

  const [query,       setQuery]       = useState("");
  const [activeTab,   setActiveTab]   = useState<FilterTab>("all");
  const [results,     setResults]     = useState<SearchResults | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [history,     setHistory]     = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const inputRef    = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load history on mount + auto-focus
  useEffect(() => {
    loadHistory().then(setHistory);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  // ── Suggestions (debounced) ──────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await MavinEngine.getSearchSuggestions(query.trim(), 0);
        setSuggestions(res.suggestions?.slice(0, 6) ?? []);
      } catch { setSuggestions([]); }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── Core search ─────────────────────────────────────────────────────────────
  const performSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    setSuggestions([]);
    setLoading(true);
    setError(null);
    setResults(null);
    setActiveTab("all");

    const cacheKey = deviceCacheKey(trimmed);

    // ── L1: device cache ─────────────────────────────────────────────────────
    try {
      const cached = await cache.get(cacheKey);
      if (cached && (cached as SearchResults).songs) {
        console.log(`📦 [Search] L1 hit: "${trimmed}"`);
        setResults(cached as SearchResults);
        setLoading(false);
        setHistory(await saveToHistory(trimmed, history));
        return;
      }
    } catch {}

    // ── L2: Supabase cache ───────────────────────────────────────────────────
    try {
      const sbResult = await supabaseCache.findBySearch(trimmed);
      if (sbResult) {
        console.log(`📦 [Search] L2 hit: "${trimmed}"`);
        // Reconstruct a SearchResults shell from the single track
        const song: SongResult = {
          type:      "song",
          id:        sbResult.youtubeId ?? sbResult.id ?? "",
          title:     sbResult.title,
          artist:    sbResult.artist,
          thumbnail: sbResult.artworkUrl ?? "",
          url:       sbResult.youtubeId
            ? `https://www.youtube.com/watch?v=${sbResult.youtubeId}`
            : "",
          duration:  sbResult.duration ?? 0,
          viewCount: sbResult.accessCount ?? 0,
        };
        const mapped: SearchResults = {
          songs:     [song],
          albums:    [],
          artists:   [],
          playlists: [],
        };
        setResults(mapped);
        // Promote to device cache
        cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
        setLoading(false);
        setHistory(await saveToHistory(trimmed, history));
        return;
      }
    } catch {}

    // ── L3: MavinEngine (NewPipe) ────────────────────────────────────────────
    try {
      console.log(`🔍 [Search] L3 MavinEngine: "${trimmed}"`);
      const raw = await MavinEngine.search(trimmed, undefined, 0);
      const mapped = mapEngineResults(raw.items ?? []);

      setResults(mapped);

      // Cache in L1
      cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});

      // Persist to Supabase tables silently (fire & forget)
      persistResultsToSupabase(trimmed, mapped);

      // Save history
      setHistory(await saveToHistory(trimmed, history));
    } catch (e: any) {
      setError(e?.message ?? "Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [history]);

  const handleSubmit           = ()  => performSearch(query);
  const handleHistoryTap       = (q: string) => { setQuery(q); performSearch(q); };
  const handleSuggestionTap    = (s: string) => { setQuery(s); performSearch(s); };
  const handleClearHistory     = async () => { await clearAllHistory(); setHistory([]); };
  const handleRemoveHistory    = async (q: string) =>
    setHistory(await removeHistoryItem(q, history));

  // ── Routing ──────────────────────────────────────────────────────────────────
  const handleSongPress = async (song: SongResult) => {
    triggerHaptic();
    await playAudio(
      { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, url: song.url },
      (results?.songs ?? []).map((s) => ({
        id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, url: s.url,
      }))
    );
  };

  const handleAlbumPress = (a: AlbumResult) => {
    triggerHaptic();
    router.push(`/album/${encodeURIComponent(a.url)}`);
  };

  const handleArtistPress = (a: ArtistResult) => {
    triggerHaptic();
    router.push({ pathname: "/artist/[id]", params: { id: encodeURIComponent(a.url), subtitle: a.subtitle } });
  };

  const handlePlaylistPress = (p: PlaylistResult) => {
    triggerHaptic();
    router.push(`/playlist/${encodeURIComponent(p.url)}`);
  };

  // ── Visible items by tab ─────────────────────────────────────────────────────
  const getVisible = (): SearchResult[] => {
    if (!results) return [];
    switch (activeTab) {
      case "songs":     return results.songs;
      case "albums":    return results.albums;
      case "artists":   return results.artists;
      case "playlists": return results.playlists;
      default:
        return [
          ...results.songs.slice(0, 5),
          ...results.albums.slice(0, 3),
          ...results.artists.slice(0, 3),
          ...results.playlists.slice(0, 3),
        ];
    }
  };

  const totalCount = results
    ? results.songs.length + results.albums.length + results.artists.length + results.playlists.length
    : 0;

  // ── Render result row ─────────────────────────────────────────────────────────
  const renderResult = ({ item }: { item: SearchResult }) => {
    const isActive = item.type === "song" && activeTrack?.id === item.id;
    return (
      <TouchableOpacity
        style={styles.resultRow}
        onPress={() => {
          if (item.type === "song")     handleSongPress(item);
          if (item.type === "album")    handleAlbumPress(item);
          if (item.type === "artist")   handleArtistPress(item);
          if (item.type === "playlist") handlePlaylistPress(item);
        }}
        activeOpacity={0.7}
      >
        {/* Thumbnail */}
        <View style={styles.thumbWrapper}>
          {item.thumbnail ? (
            <Image
              source={{ uri: item.thumbnail }}
              style={[styles.thumb, item.type === "artist" && styles.thumbCircle]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Ionicons
                name={
                  item.type === "artist"   ? "person"        :
                  item.type === "album"    ? "disc"           :
                  item.type === "playlist" ? "list"           :
                                             "musical-notes"
                }
                size={20}
                color={COLORS.goldShimmer}
              />
            </View>
          )}
          {isActive && (
            <LoaderKit
              style={styles.playingIndicator}
              name="LineScalePulseOutRapid"
              color="white"
            />
          )}
        </View>

        {/* Info */}
        <View style={styles.resultInfo}>
          <Text
            style={[styles.resultTitle, isActive && { color: COLORS.goldPrimary }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.resultSub} numberOfLines={1}>
            {item.type === "song"
              ? `${item.artist}${item.duration ? ` • ${formatDuration(item.duration)}` : ""}`
              : item.type === "album"
              ? `Album • ${item.artist}`
              : item.type === "artist"
              ? item.subtitle
              : `Playlist • ${item.streamCount} songs`}
          </Text>
        </View>

        {/* Type badge */}
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {item.type === "song" ? "SONG" :
             item.type === "album" ? "ALBUM" :
             item.type === "artist" ? "ARTIST" : "PLAYLIST"}
          </Text>
        </View>

        {/* Three-dot for songs */}
        {item.type === "song" && (
          <TouchableOpacity
            onPress={() => {
              triggerHaptic();
              router.push({
                pathname: "/(modals)/menu",
                params: {
                  songData: JSON.stringify({
                    id: item.id, title: item.title,
                    artist: item.artist, thumbnail: item.thumbnail,
                  }),
                  type: "song",
                },
              });
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Entypo name="dots-three-vertical" size={14} color={COLORS.textTertiary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // ── State booleans ───────────────────────────────────────────────────────────
  const showHistory     = !query && !results && history.length > 0;
  const showSuggestions = query.length >= 2 && suggestions.length > 0 && !results && !loading;
  const showResults     = !!results && !loading;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <View style={styles.searchBarRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={COLORS.textTertiary} style={{ marginRight: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            placeholder="Search songs, artists, albums..."
            placeholderTextColor={COLORS.textTertiary}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={COLORS.goldPrimary}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(""); setResults(null); setSuggestions([]); }}>
              <Ionicons name="close-circle" size={18} color={COLORS.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Suggestions ─────────────────────────────────────────────────────── */}
      {showSuggestions && (
        <View style={styles.suggestionsBox}>
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.suggestionRow}
              onPress={() => handleSuggestionTap(s)}
            >
              <Ionicons name="search-outline" size={14} color={COLORS.textTertiary} style={{ marginRight: 10 }} />
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {showHistory && (
        <View style={styles.historySection}>
          <View style={styles.historySectionHeader}>
            <Text style={styles.sectionLabel}>Recent Searches</Text>
            <TouchableOpacity onPress={handleClearHistory}>
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          </View>
          {history.map((q) => (
            <View key={q} style={styles.historyRow}>
              <TouchableOpacity style={styles.historyRowMain} onPress={() => handleHistoryTap(q)}>
                <Ionicons name="time-outline" size={16} color={COLORS.textTertiary} style={{ marginRight: 12 }} />
                <Text style={styles.historyText}>{q}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRemoveHistory(q)} hitSlop={10}>
                <Ionicons name="close" size={16} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── Empty placeholder ───────────────────────────────────────────────── */}
      {!query && !results && history.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="search" size={48} color={COLORS.textTertiary} />
          <Text style={styles.emptyStateText}>Search for music, artists, albums</Text>
        </View>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.loadingText}>Searching…</Text>
        </View>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!!error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleSubmit}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {showResults && (
        <>
          {/* Filter tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
            style={styles.tabsScroll}
          >
            {(["all", "songs", "albums", "artists", "playlists"] as FilterTab[]).map((tab) => {
              const count =
                tab === "all"       ? totalCount :
                tab === "songs"     ? results!.songs.length :
                tab === "albums"    ? results!.albums.length :
                tab === "artists"   ? results!.artists.length :
                                      results!.playlists.length;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === tab && styles.tabActive]}
                  onPress={() => { triggerHaptic(); setActiveTab(tab); }}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {count > 0 ? ` (${count})` : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Result list */}
          <FlatList
            data={getVisible()}
            renderItem={renderResult}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            extraData={activeTrack}
            contentContainerStyle={{
              paddingBottom: verticalScale(140) + insets.bottom,
              paddingHorizontal: 16,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No results for "{query}"</Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  searchBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + "40",
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: moderateScale(15),
    padding: 0,
  },
  suggestionsBox: {
    marginHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
    overflow: "hidden",
    marginBottom: 8,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.surfaceLight,
  },
  suggestionText: {
    color: COLORS.text,
    fontSize: moderateScale(14),
  },
  historySection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  historySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionLabel: {
    color: COLORS.text,
    fontSize: moderateScale(16),
    fontWeight: "600",
  },
  clearText: {
    color: COLORS.goldShimmer,
    fontSize: moderateScale(13),
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.surfaceLight,
  },
  historyRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  historyText: {
    color: COLORS.textSecondary,
    fontSize: moderateScale(14),
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
  },
  tabActive: {
    backgroundColor: COLORS.goldPrimary + "25",
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  tabText: {
    color: COLORS.textTertiary,
    fontSize: moderateScale(13),
    fontWeight: "500",
  },
  tabTextActive: {
    color: COLORS.goldPrimary,
    fontWeight: "600",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.surfaceLight,
  },
  thumbWrapper: {
    position: "relative",
  },
  thumb: {
    width: moderateScale(52),
    height: moderateScale(52),
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  thumbCircle: {
    borderRadius: moderateScale(26),
  },
  thumbFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  playingIndicator: {
    position: "absolute",
    top: moderateScale(16),
    left: moderateScale(16),
    width: moderateScale(20),
    height: moderateScale(20),
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    color: COLORS.text,
    fontSize: moderateScale(14),
    fontWeight: "600",
    marginBottom: 3,
  },
  resultSub: {
    color: COLORS.textTertiary,
    fontSize: moderateScale(12),
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceLight,
    marginRight: 4,
  },
  typeBadgeText: {
    color: COLORS.textTertiary,
    fontSize: moderateScale(9),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: verticalScale(80),
    gap: 12,
  },
  emptyStateText: {
    color: COLORS.textTertiary,
    fontSize: moderateScale(15),
    textAlign: "center",
  },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: COLORS.textTertiary,
    fontSize: moderateScale(14),
  },
  errorBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: moderateScale(14),
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: moderateScale(13),
    fontWeight: "600",
  },
});