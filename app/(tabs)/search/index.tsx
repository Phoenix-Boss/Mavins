// app/(tabs)/search/index.tsx
/**
 * Search Screen — expo-av version
 * 
 * Changes from RNTP version:
 *   - Replaced useActiveTrack from react-native-track-player with expo-av version
 *   - All other MavinEngine logic remains unchanged
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Keyboard,
  Platform,
  Animated as RNAnimated,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import LoaderKit from "react-native-loader-kit";
import { moderateScale, verticalScale } from "react-native-size-matters/extend";

// expo-av version of useActiveTrack
import { useActiveTrack } from "@/hooks/useActiveTrack";

import { setPendingTrack } from '@/helpers/pendingTrack';
import MavinEngine, {
  StreamInfoItem,
  PlaylistInfoItem,
  ChannelInfoItem,
  InfoItem,
} from "@/modules/mavin-engine";
import { cache, supabaseCache } from "@/libs/cache";
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
  skeletonBase:  "#1A1A1A",
  skeletonHigh:  "#2A2A2A",
};

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_CACHE_KEY   = "search:history:v1";
const HISTORY_CACHE_TTL   = 365 * 24 * 60 * 60 * 1000;
const HISTORY_MAX         = 20;
const DEBOUNCE_MS         = 400;
const SKELETON_COUNT      = 8;

// Predefined list of 10 genres
const PREDEFINED_GENRES = [
  "Afrobeats", "Hip-Hop", "Pop", "R&B",
  "Dancehall", "Reggae", "Gospel", "Rock",
  "Electronic", "Amapiano"
];

type FilterTab = "all" | "songs" | "albums" | "artists" | "playlists";

// ─── Result types ─────────────────────────────────────────────────────────────

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

interface DynamicFolder {
  id: string;
  groupKey: string;
  songs: SongResult[];
  coverArt: string;
  artistNames: string;
  itemCount: number;
}

interface SongWithMetadata extends SongResult {
  lastPlayed?: string;
  genre?: string[];
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonResultRow() {
  const anim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const bg = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [COLORS.skeletonBase, COLORS.skeletonHigh],
  });

  return (
    <View style={skRow.row}>
      <RNAnimated.View style={[skRow.thumb, { backgroundColor: bg }]} />
      <View style={skRow.info}>
        <RNAnimated.View style={[skRow.titleLine, { backgroundColor: bg, width: "60%" }]} />
        <RNAnimated.View style={[skRow.subLine,   { backgroundColor: bg, width: "40%" }]} />
      </View>
      <RNAnimated.View style={[skRow.badge, { backgroundColor: bg }]} />
    </View>
  );
}

const skRow = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.surfaceLight, paddingHorizontal: 16, },
  thumb: { width: moderateScale(52), height: moderateScale(52), borderRadius: 8, },
  info: { flex: 1, gap: 8 },
  titleLine: { height: 13, borderRadius: 4 },
  subLine: { height: 11, borderRadius: 4 },
  badge: { width: 44, height: 20, borderRadius: 6 },
});

// ─── Skeleton list ─────────────────────────────────────────────────────────────

function SkeletonResultList() {
  return (
    <View style={{ flex: 1, paddingTop: 4 }}>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => <SkeletonResultRow key={i} />)}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const bestThumb = (thumbs: { url: string; resolutionLevel: string }[]): string =>
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K subscribers`;
  return `${n} subscribers`;
};

const mapEngineResults = (items: InfoItem[]): SearchResults => {
  const out: SearchResults = { songs: [], albums: [], artists: [], playlists: [] };
  for (const item of items) {
    if (item.type === "stream") {
      const s = item as StreamInfoItem;
      if (s.isLive || s.isShortFormContent) continue;
      const videoId = s.url.includes("v=") ? s.url.split("v=")[1]?.split("&")[0] ?? "" :
                      s.url.includes("youtu.be/") ? s.url.split("youtu.be/")[1]?.split("?")[0] ?? "" : "";
      out.songs.push({
        type: "song", id: videoId || s.url, title: s.name, artist: s.uploaderName,
        thumbnail: bestThumb(s.thumbnails), url: s.url, videoId,
        duration: s.duration, viewCount: s.viewCount,
      });
    } else if (item.type === "playlist") {
      const p = item as PlaylistInfoItem;
      const base = { id: p.url, title: p.name, artist: p.uploaderName, thumbnail: bestThumb(p.thumbnails), url: p.url, streamCount: p.streamCount };
      if (p.uploaderName) out.albums.push({ type: "album", ...base });
      else out.playlists.push({ type: "playlist", ...base });
    } else if (item.type === "channel") {
      const c = item as ChannelInfoItem;
      out.artists.push({
        type: "artist", id: c.url, title: c.name, subtitle: formatSubs(c.subscriberCount),
        thumbnail: bestThumb(c.thumbnails), url: c.url, subscriberCount: c.subscriberCount,
      });
    }
  }
  return out;
};

const persistResultsToSupabase = async (query: string, results: SearchResults) => {
  try {
    for (const artist of results.artists.slice(0, 5)) {
      await supabaseCache.saveArtist(artist.title, {
        name: artist.title, topTracks: [], albums: [], similar: [],
        lastUpdated: new Date().toISOString(),
      }).catch(() => {});
    }
    for (const song of results.songs.slice(0, 10)) {
      await supabaseCache.saveTrack({
        title: song.title, artist: song.artist, duration: song.duration,
        artworkUrl: song.thumbnail, youtubeId: song.id,
        metadata: { source: "search", query, viewCount: song.viewCount },
      }).then((trackId) => {
        if (trackId) supabaseCache.saveSearch(query, trackId).catch(() => {});
      }).catch(() => {});
    }
  } catch {}
};

const deviceCacheKey = (q: string) => `search:results:${q.toLowerCase().trim()}`;

const loadHistory = async (): Promise<string[]> => {
  try { const h = await cache.get(HISTORY_CACHE_KEY); if (Array.isArray(h)) return h as string[]; } catch {}
  return [];
};

const saveToHistory = async (query: string, existing: string[]): Promise<string[]> => {
  const next = [query, ...existing.filter((q) => q !== query)].slice(0, HISTORY_MAX);
  await cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

const clearAllHistory = () => cache.delete(HISTORY_CACHE_KEY).catch(() => {});

const removeHistoryItem = async (query: string, existing: string[]): Promise<string[]> => {
  const next = existing.filter((q) => q !== query);
  await cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

// ─── Genre Helpers ─────────────────────────────────────────────────────────────

// Fetch all songs from search history (real implementation)
const fetchSongsFromHistory = async (): Promise<SongWithMetadata[]> => {
  try {
    const historyQueries = await loadHistory();
    const allSongs: SongWithMetadata[] = [];

    for (const query of historyQueries) {
      const cacheKey = deviceCacheKey(query);
      const cachedResults = await cache.get(cacheKey);
      if (cachedResults?.songs) {
        allSongs.push(...cachedResults.songs.map((song: SongResult) => ({
          ...song,
          genre: [],
          lastPlayed: new Date().toISOString(),
        })));
      }
    }

    return allSongs;
  } catch (error) {
    console.error("Error fetching songs from history:", error);
    return [];
  }
};

// Assign a genre to a song based on real metadata or title/artist
const detectGenre = (song: SongWithMetadata): string => {
  if (song.genre && song.genre.length > 0) {
    const matchedGenre = PREDEFINED_GENRES.find(g =>
      song.genre!.some(genre => genre.toLowerCase().includes(g.toLowerCase()))
    );
    if (matchedGenre) return matchedGenre;
  }

  const titleLower = song.title.toLowerCase();
  const artistLower = song.artist.toLowerCase();

  if (titleLower.includes("afro") || artistLower.includes("afro")) return "Afrobeats";
  if (titleLower.includes("hip") || artistLower.includes("hip")) return "Hip-Hop";
  if (titleLower.includes("gospel") || artistLower.includes("gospel")) return "Gospel";
  if (titleLower.includes("dancehall") || artistLower.includes("dancehall")) return "Dancehall";
  if (titleLower.includes("reggae") || artistLower.includes("reggae")) return "Reggae";
  if (titleLower.includes("pop") || artistLower.includes("pop")) return "Pop";
  if (titleLower.includes("r&b") || artistLower.includes("r&b")) return "R&B";
  if (titleLower.includes("rock") || artistLower.includes("rock")) return "Rock";
  if (titleLower.includes("electronic") || artistLower.includes("electronic")) return "Electronic";
  if (titleLower.includes("amapiano") || artistLower.includes("amapiano")) return "Amapiano";

  return "Pop";
};

// Group songs by genre and format into folders
const getGenreFolders = async (): Promise<DynamicFolder[]> => {
  const allSongs = await fetchSongsFromHistory();
  const genreMap: Record<string, SongWithMetadata[]> = {};

  PREDEFINED_GENRES.forEach(genre => {
    genreMap[genre] = [];
  });

  allSongs.forEach(song => {
    const genre = detectGenre(song);
    genreMap[genre].push(song);
  });

  return PREDEFINED_GENRES
    .map(genre => {
      let genreSongs = genreMap[genre];
      if (genreSongs.length === 0) return null;

      genreSongs = genreSongs.sort((a, b) =>
        new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime()
      );

      const topArtists = [...new Set(genreSongs.slice(0, 3).map(s => s.artist))].join(", ");

      return {
        id: genre.toLowerCase(),
        groupKey: genre,
        songs: genreSongs,
        coverArt: genreSongs[0].thumbnail,
        artistNames: topArtists,
        itemCount: genreSongs.length,
      };
    })
    .filter(Boolean) as DynamicFolder[];
};

// ─── Folder Component ───────────────────────────────────────────────────────────

const GenreFolder = ({ folder, onPress }: { folder: DynamicFolder; onPress: () => void }) => (
  <TouchableOpacity style={folderStyles.container} onPress={onPress}>
    <Image
      source={{ uri: folder.coverArt }}
      style={folderStyles.cover}
      contentFit="cover"
    />
    <View style={folderStyles.info}>
      <Text style={folderStyles.title} numberOfLines={1}>
        {folder.artistNames}
      </Text>
      <Text style={folderStyles.subtitle} numberOfLines={1}>
        {folder.groupKey} • {folder.itemCount} {folder.itemCount === 1 ? "song" : "songs"}
      </Text>
    </View>
  </TouchableOpacity>
);

const folderStyles = StyleSheet.create({
  container: { width: "48%", marginBottom: 16, },
  cover: { width: "100%", aspectRatio: 1, borderRadius: 8, backgroundColor: COLORS.surfaceLight, },
  info: { marginTop: 8, },
  title: { color: COLORS.text, fontSize: moderateScale(14), fontWeight: "600", },
  subtitle: { color: COLORS.textTertiary, fontSize: moderateScale(11), marginTop: 2, },
});

// ─── Genre Folder Grid Component ───────────────────────────────────────────────

interface GenreFolderGridProps {
  setQuery: (query: string) => void;
  performSearch: (query: string) => Promise<void>;
}

const GenreFolderGrid = ({ setQuery, performSearch }: GenreFolderGridProps) => {
  const [folders, setFolders] = useState<DynamicFolder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadFolders = async () => {
      try {
        const genreFolders = await getGenreFolders();
        setFolders(genreFolders);
      } catch (error) {
        console.error("Error loading genre folders:", error);
      } finally {
        setLoading(false);
      }
    };

    loadFolders();
  }, []);

  if (loading) {
    return <SkeletonResultList />;
  }

  if (folders.length === 0) {
    return <Text style={styles.emptyStateText}>No genres found. Search for music!</Text>;
  }

  return (
    <FlatList
      data={folders}
      renderItem={({ item: folder }) => (
        <GenreFolder
          folder={folder}
          onPress={() => {
            setQuery(folder.groupKey);
            performSearch(folder.groupKey);
          }}
        />
      )}
      keyExtractor={(folder) => folder.id}
      numColumns={2}
      columnWrapperStyle={{ justifyContent: "space-between", marginBottom: 16 }}
      contentContainerStyle={{ paddingHorizontal: 16 }}
    />
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // expo-av version of useActiveTrack
  const activeTrack = useActiveTrack();
  const { playAudio } = useMusicPlayer();

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadHistory().then(setHistory);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  // ── Suggestions ─────────────────────────────────────────────────────────────
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

  // ── Core search ──────────────────────────────────────────────────────────────
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

    // L1: device cache
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        const sr = cached as SearchResults;
        const has = sr.songs?.length > 0 || sr.albums?.length > 0 ||
                    sr.artists?.length > 0 || sr.playlists?.length > 0;
        if (has) {
          setResults(sr); setLoading(false);
          setHistory(await saveToHistory(trimmed, history)); return;
        }
        cache.delete(cacheKey).catch(() => {});
      }
    } catch {}

    // L2: Supabase cache
    try {
      const sbResult = await supabaseCache.findBySearch(trimmed);
      if (sbResult) {
        const song: SongResult = {
          type: "song", id: sbResult.youtubeId ?? sbResult.id ?? "",
          title: sbResult.title, artist: sbResult.artist,
          thumbnail: sbResult.artworkUrl ?? "",
          url: sbResult.youtubeId ? `https://www.youtube.com/watch?v=${sbResult.youtubeId}` : "",
          videoId: sbResult.youtubeId ?? "",
          duration: sbResult.duration ?? 0, viewCount: sbResult.accessCount ?? 0,
        };
        const mapped: SearchResults = { songs: [song], albums: [], artists: [], playlists: [] };
        setResults(mapped);
        cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
        setLoading(false);
        setHistory(await saveToHistory(trimmed, history)); return;
      }
    } catch {}

    // L3: MavinEngine
    try {
      const raw = await MavinEngine.search(trimmed, "", undefined, 0);
      let items = raw.results ?? [];

      if (items.length === 0 && raw.success) {
        const retry = await MavinEngine.search(trimmed, "", undefined, 0);
        items = retry.results ?? [];
      }

      const mapped = mapEngineResults(items);
      setResults(mapped);

      const has = mapped.songs.length > 0 || mapped.albums.length > 0 ||
                  mapped.artists.length > 0 || mapped.playlists.length > 0;
      if (has) {
        cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
        persistResultsToSupabase(trimmed, mapped);
      }
      setHistory(await saveToHistory(trimmed, history));

    } catch (e: any) {
      try {
        const raw2 = await MavinEngine.search(trimmed, "", undefined, 0);
        const mapped2 = mapEngineResults(raw2.results ?? []);
        setResults(mapped2);
        const has2 = mapped2.songs.length > 0 || mapped2.albums.length > 0 ||
                     mapped2.artists.length > 0 || mapped2.playlists.length > 0;
        if (has2) {
          cache.set(cacheKey, mapped2, SEARCH_CACHE_TTL_MS).catch(() => {});
          persistResultsToSupabase(trimmed, mapped2);
        }
        setHistory(await saveToHistory(trimmed, history));
      } catch (retryErr: any) {
        setError(retryErr?.message ?? "Search failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [history]);

  const handleSubmit = () => performSearch(query);
  const handleHistoryTap = (q: string) => { setQuery(q); performSearch(q); };
  const handleSuggestionTap = (s: string) => { setQuery(s); performSearch(s); };
  const handleClearHistory = async () => { await clearAllHistory(); setHistory([]); };
  const handleRemoveHistory = async (q: string) => setHistory(await removeHistoryItem(q, history));

  // ── Song press — FloatingPlayer-first playback ──────────────────────────────
  const handleSongPress = useCallback(async (song: SongResult) => {
    triggerHaptic();
    setPendingTrack({ title: song.title, artist: song.artist, artwork: song.thumbnail });

    const queue = (results?.songs ?? []).map((s) => ({
      id: s.id, title: s.title, artist: s.artist,
      thumbnail: s.thumbnail, url: s.url, videoId: s.videoId || undefined,
    }));

    await playAudio({
      id: song.id, title: song.title, artist: song.artist,
      thumbnail: song.thumbnail, url: song.url, videoId: song.videoId || undefined,
    }, queue);
  }, [results, playAudio]);

  // ── Non-song routing ─────────────────────────────────────────────────────────
  const handleAlbumPress = (a: AlbumResult) => { triggerHaptic(); router.push(`/album/${encodeURIComponent(a.url)}`); };
  const handleArtistPress = (a: ArtistResult) => { triggerHaptic(); router.push({ pathname: "/artist/[id]", params: { id: encodeURIComponent(a.url), subtitle: a.subtitle } }); };
  const handlePlaylistPress = (p: PlaylistResult) => { triggerHaptic(); router.push(`/playlist/${encodeURIComponent(p.url)}`); };

  // ── Visible items by tab ─────────────────────────────────────────────────────
  const getVisible = (): SearchResult[] => {
    if (!results) return [];
    switch (activeTab) {
      case "songs": return results.songs;
      case "albums": return results.albums;
      case "artists": return results.artists;
      case "playlists": return results.playlists;
      default: return [
        ...results.songs.slice(0, 5),
        ...results.albums.slice(0, 3),
        ...results.artists.slice(0, 3),
        ...results.playlists.slice(0, 3),
      ];
    }
  };

  const totalCount = results
    ? results.songs.length + results.albums.length +
      results.artists.length + results.playlists.length
    : 0;

  // ── Render result row ─────────────────────────────────────────────────────────
  const renderResult = ({ item }: { item: SearchResult }) => {
    const isActive = item.type === "song" && activeTrack?.id === item.id;
    return (
      <TouchableOpacity
        style={styles.resultRow}
        onPress={() => {
          if (item.type === "song") handleSongPress(item);
          if (item.type === "album") handleAlbumPress(item);
          if (item.type === "artist") handleArtistPress(item);
          if (item.type === "playlist") handlePlaylistPress(item);
        }}
        activeOpacity={0.7}
      >
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
                  item.type === "artist" ? "person" :
                  item.type === "album" ? "disc" :
                  item.type === "playlist" ? "list" : "musical-notes"
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

        <View style={styles.resultInfo}>
          <Text style={[styles.resultTitle, isActive && { color: COLORS.goldPrimary }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.resultSub} numberOfLines={1}>
            {item.type === "song" ? `${item.artist}${item.duration ? ` • ${formatDuration(item.duration)}` : ""}` :
             item.type === "album" ? `Album • ${item.artist}` :
             item.type === "artist" ? item.subtitle : `Playlist • ${item.streamCount} songs`}
          </Text>
        </View>

        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {item.type === "song" ? "SONG" :
             item.type === "album" ? "ALBUM" :
             item.type === "artist" ? "ARTIST" : "PLAYLIST"}
          </Text>
        </View>

        {item.type === "song" && (
          <TouchableOpacity
            onPress={() => {
              triggerHaptic();
              router.push({
                pathname: "/(modals)/menu",
                params: {
                  songData: JSON.stringify({ id: item.id, title: item.title, artist: item.artist, thumbnail: item.thumbnail }),
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
  const showHistory = !query && !results && history.length > 0;
  const showSuggestions = query.length >= 2 && suggestions.length > 0 && !results && !loading;
  const showResults = !!results && !loading;

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
            <TouchableOpacity key={s} style={styles.suggestionRow} onPress={() => handleSuggestionTap(s)}>
              <Ionicons name="search-outline" size={14} color={COLORS.textTertiary} style={{ marginRight: 10 }} />
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Genre Folders ────────────────────────────────────────────────────── */}
      {showHistory && (
        <View style={styles.historySection}>
          <Text style={styles.sectionLabel}>Browse by Genre</Text>
          <GenreFolderGrid setQuery={setQuery} performSearch={performSearch} />
        </View>
      )}

      {/* ── Empty placeholder ───────────────────────────────────────────────── */}
      {!query && !results && history.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="search" size={48} color={COLORS.textTertiary} />
          <Text style={styles.emptyStateText}>Search for music, artists, albums</Text>
        </View>
      )}

      {/* ── Skeleton loading ─────────────────────────────────────────────── */}
      {loading && <SkeletonResultList />}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!!error && !loading && (
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
            style={styles.tabsScroll}
          >
            {(["all", "songs", "albums", "artists", "playlists"] as FilterTab[]).map((tab) => {
              const count =
                tab === "all" ? totalCount :
                tab === "songs" ? results!.songs.length :
                tab === "albums" ? results!.albums.length :
                tab === "artists" ? results!.artists.length :
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

          <FlatList
            data={getVisible()}
            renderItem={renderResult}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            extraData={activeTrack}
            contentContainerStyle={{ paddingBottom: verticalScale(140) + insets.bottom }}
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
  container: { flex: 1, backgroundColor: COLORS.background },
  searchBarRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  searchBar: {
    flex: 1, flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surfaceLight, borderRadius: 24,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 8,
    borderWidth: 1, borderColor: COLORS.goldPrimary + "40",
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: moderateScale(15), padding: 0 },
  suggestionsBox: { marginHorizontal: 16, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceLight, overflow: "hidden", marginBottom: 8 },
  suggestionRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.surfaceLight },
  suggestionText: { color: COLORS.text, fontSize: moderateScale(14) },
  historySection: { paddingHorizontal: 16, paddingTop: 8 },
  sectionLabel: { color: COLORS.text, fontSize: moderateScale(16), fontWeight: "600" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: verticalScale(80), gap: 12 },
  emptyStateText: { color: COLORS.textTertiary, fontSize: moderateScale(15), textAlign: "center" },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 24 },
  errorText: { color: COLORS.textSecondary, fontSize: moderateScale(14), textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 9, backgroundColor: COLORS.goldPrimary + "20", borderRadius: 20, borderWidth: 1, borderColor: COLORS.goldPrimary },
  retryText: { color: COLORS.goldPrimary, fontSize: moderateScale(13), fontWeight: "600" },
  tabsScroll: { flexGrow: 0 },
  tabsRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.surfaceLight },
  tabActive: { backgroundColor: COLORS.goldPrimary + "25", borderWidth: 1, borderColor: COLORS.goldPrimary },
  tabText: { color: COLORS.textTertiary, fontSize: moderateScale(13), fontWeight: "500" },
  tabTextActive: { color: COLORS.goldPrimary, fontWeight: "600" },
  resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.surfaceLight, paddingHorizontal: 16 },
  thumbWrapper: { position: "relative" },
  thumb: { width: moderateScale(52), height: moderateScale(52), borderRadius: 8, backgroundColor: COLORS.surfaceLight },
  thumbCircle: { borderRadius: moderateScale(26) },
  thumbFallback: { justifyContent: "center", alignItems: "center" },
  playingIndicator: { position: "absolute", top: moderateScale(16), left: moderateScale(16), width: moderateScale(20), height: moderateScale(20) },
  resultInfo: { flex: 1 },
  resultTitle: { color: COLORS.text, fontSize: moderateScale(14), fontWeight: "600", marginBottom: 3 },
  resultSub: { color: COLORS.textTertiary, fontSize: moderateScale(12) },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: COLORS.surfaceLight, marginRight: 4 },
  typeBadgeText: { color: COLORS.textTertiary, fontSize: moderateScale(9), fontWeight: "700", letterSpacing: 0.5 },
});