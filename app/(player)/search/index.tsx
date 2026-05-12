/**
 * Search Screen — app/(player)/search/index.tsx  v18
 *
 * FIXED: SkeletonPulse style split into [staticLayout, animatedBg] array
 * so TypeScript no longer complains about `width: string | number` being
 * incompatible with RNAnimated.View's strict style type.
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
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { setPendingTrack } from "@/helpers/pendingTrack";
import MavinEngine, {
  StreamInfoItem,
  PlaylistInfoItem,
  ChannelInfoItem,
  InfoItem,
} from "@/modules/mavin-engine";
import { cache, supabaseCache } from "@/libs/cache";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { triggerHaptic } from "@/helpers/haptics";
import { extractVideoId, toWatchUrl } from "@/helpers/youtube";
import { DEVICE_CACHE_TTL, CACHE_LIMITS } from "@/constants/cacheTTL";

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const COLORS = {
  background:   "#000000",
  surface:      "#121212",
  surfaceLight: "#1F1F1F",
  surfaceMid:   "#2A2A2A",
  goldPrimary:  "#D4AF37",
  goldShimmer:  "#E6C16A",
  text:         "#FFFFFF",
  textSecondary:"#B3B3B3",
  textTertiary: "#808080",
  danger:       "#EF4444",
  skeletonBase: "#1A1A1A",
  skeletonHigh: "#2A2A2A",
};

const GENRE_COLORS: Record<string, string> = {
  "Afrobeats":  "#1DB954",
  "Hip-Hop":    "#E91429",
  "Pop":        "#8D67AB",
  "R&B":        "#E13300",
  "Dancehall":  "#148A08",
  "Reggae":     "#DC148C",
  "Gospel":     "#1E3264",
  "Rock":       "#E91429",
  "Electronic": "#0D73EC",
  "Amapiano":   "#E8642E",
  "Mixed":      "#608108",
};

const SEARCH_CACHE_TTL_MS = DEVICE_CACHE_TTL.SEARCH_RESULT;
const HISTORY_CACHE_KEY   = "search:history:v2";
const HISTORY_CACHE_TTL   = DEVICE_CACHE_TTL.SEARCH_HISTORY;
const HISTORY_MAX         = CACHE_LIMITS.SEARCH_HISTORY_MAX;
const DEBOUNCE_MS         = 400;
const SKELETON_COUNT      = 6;

const PREDEFINED_GENRES = [
  "Afrobeats", "Hip-Hop", "Pop", "R&B",
  "Dancehall", "Reggae", "Gospel", "Rock",
  "Electronic", "Amapiano",
];

type FilterTab = "all" | "songs" | "albums" | "artists" | "playlists";

// ─── Priority Artist Map ──────────────────────────────────────────────────────

const PRIORITY_ARTIST_GENRE_MAP: Record<string, string> = {
  "burna boy": "Afrobeats", "wizkid": "Afrobeats", "davido": "Afrobeats",
  "rema": "Afrobeats", "fireboy dml": "Afrobeats", "asake": "Afrobeats",
  "omah lay": "Afrobeats", "ckay": "Afrobeats", "kizz daniel": "Afrobeats",
  "tekno": "Afrobeats", "ruger": "Afrobeats", "bnxn": "Afrobeats",
  "victony": "Afrobeats", "ayo maff": "Afrobeats", "oxlade": "Afrobeats",
  "joeboy": "Afrobeats", "mrx": "Afrobeats", "lil kesh": "Afrobeats",
  "orezi": "Afrobeats", "peruzzi": "Afrobeats", "mayorkun": "Afrobeats",
  "simi": "Afrobeats", "tiwa savage": "Afrobeats", "yemi alade": "Afrobeats",
  "teni": "Afrobeats", "niniola": "Afrobeats", "sima": "Afrobeats",
  "stonebwoy": "Afrobeats", "shatta wale": "Afrobeats", "kuami eugene": "Afrobeats",
  "king promise": "Afrobeats", "kiDi": "Afrobeats", "camidoh": "Afrobeats",
  "black sherif": "Afrobeats",
  "pheelz": "Amapiano", "young stunna": "Amapiano", "sir trill": "Amapiano",
  "focalistic": "Amapiano", "mellow & sleazy": "Amapiano", "dj mapa": "Amapiano",
  "djy ma'ten": "Amapiano", "kamo mphela": "Amapiano", "semi tee": "Amapiano",
  "browne": "Hip-Hop", "odumodublvck": "Hip-Hop", "blaqbonez": "Hip-Hop",
  "psycho yp": "Hip-Hop", "alpha ojini": "Hip-Hop",
  "nathaniel bassey": "Gospel", "mercy chinwo": "Gospel", "sinach": "Gospel",
  "dunsin oyekan": "Gospel", "tope alabi": "Gospel",
  "tems": "R&B", "ayra starr": "R&B", "chike": "R&B",
  "johnny drille": "R&B",
};

// ─── Types ────────────────────────────────────────────────────────────────────

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
  songs: SongWithMetadata[];
  coverArt: string;
  artistNames: string;
  itemCount: number;
}

interface SongWithMetadata extends SongResult {
  lastPlayed?: string;
  genre?: string[];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * FIX: Split style into two objects in an array:
 *  1. Static layout props (width, height, borderRadius) — cast `as any` to
 *     satisfy RN's `${number}%` constraint when width is a percentage string.
 *  2. Animated backgroundColor — isolated so TS sees only the animated value.
 */
function SkeletonPulse({
  width,
  height,
  borderRadius = 4,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
}) {
  const anim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, [anim]);

  const bg = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [COLORS.skeletonBase, COLORS.skeletonHigh],
  });

  return (
    <RNAnimated.View
      style={[
        // Static layout — `as any` handles "60%" strings that TS rejects
        { width: width as any, height, borderRadius } as any,
        // Animated value kept separate so it type-checks cleanly
        { backgroundColor: bg },
      ]}
    />
  );
}

function SkeletonResultRow() {
  return (
    <View style={sk.row}>
      <SkeletonPulse width={52} height={52} borderRadius={6} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonPulse width="60%" height={13} />
        <SkeletonPulse width="40%" height={11} />
      </View>
    </View>
  );
}

function SkeletonResultList() {
  return (
    <View style={{ flex: 1, paddingTop: 8 }}>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <SkeletonResultRow key={i} />
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.surfaceLight,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const bestThumb = (thumbs: { url: string; resolutionLevel: string }[]): string =>
  thumbs.find(t => t.resolutionLevel === "MEDIUM")?.url ??
  thumbs.find(t => t.resolutionLevel === "HIGH")?.url ??
  thumbs[0]?.url ?? "";

const formatSubs = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K subscribers`;
  return `${n} subscribers`;
};

const mapEngineResults = (items: InfoItem[]): SearchResults => {
  const out: SearchResults = { songs: [], albums: [], artists: [], playlists: [] };
  for (const item of items) {
    if (item.type === "stream") {
      const s = item as StreamInfoItem;
      if (s.isLive || s.isShortFormContent) continue;
      const videoId = extractVideoId(s.url);
      if (!videoId) {
        console.warn(`[Search] Skipping stream — could not extract videoId from: ${s.url}`);
        continue;
      }
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
        id: p.url, title: p.name, artist: p.uploaderName,
        thumbnail: bestThumb(p.thumbnails), url: p.url, streamCount: p.streamCount,
      };
      if (p.uploaderName) out.albums.push({ type: "album", ...base });
      else                out.playlists.push({ type: "playlist", ...base });
    } else if (item.type === "channel") {
      const c = item as ChannelInfoItem;
      out.artists.push({
        type: "artist", id: c.url, title: c.name,
        subtitle: formatSubs(c.subscriberCount),
        thumbnail: bestThumb(c.thumbnails), url: c.url,
        subscriberCount: c.subscriberCount,
      });
    }
  }
  return out;
};

const detectGenre = (song: SongWithMetadata): string => {
  const artistLower = song.artist.toLowerCase();
  for (const [key, genre] of Object.entries(PRIORITY_ARTIST_GENRE_MAP)) {
    if (artistLower.includes(key)) return genre;
  }
  if (song.genre?.length) {
    const matched = PREDEFINED_GENRES.find(g =>
      song.genre!.some(sg => sg.toLowerCase().includes(g.toLowerCase()))
    );
    if (matched) return matched;
  }
  const t = song.title.toLowerCase();
  if (t.includes("afro")      || artistLower.includes("afro"))      return "Afrobeats";
  if (t.includes("amapiano"))                                         return "Amapiano";
  if (t.includes("hip")       || artistLower.includes("hip"))        return "Hip-Hop";
  if (t.includes("gospel")    || artistLower.includes("gospel"))     return "Gospel";
  if (t.includes("dancehall") || artistLower.includes("dancehall"))  return "Dancehall";
  if (t.includes("reggae")    || artistLower.includes("reggae"))     return "Reggae";
  if (t.includes("pop")       || artistLower.includes("pop"))        return "Pop";
  if (t.includes("r&b")       || artistLower.includes("r&b"))        return "R&B";
  if (t.includes("rock")      || artistLower.includes("rock"))       return "Rock";
  if (t.includes("electronic")|| artistLower.includes("electronic")) return "Electronic";
  return "Mixed";
};

const fetchSongsFromHistory = async (): Promise<SongWithMetadata[]> => {
  try {
    const historyQueries = await loadHistory();
    const allSongs: SongWithMetadata[] = [];
    for (const q of historyQueries) {
      const cached = await cache.get(deviceCacheKey(q));
      if (cached?.songs && Array.isArray(cached.songs)) {
        allSongs.push(
          ...cached.songs.map((s: SongResult) => ({
            ...s,
            genre: [] as string[],
            lastPlayed: new Date().toISOString(),
          }))
        );
      } else {
        const sb = await supabaseCache.findBySearch(q);
        if (sb) {
          const vid = sb.youtubeId || extractVideoId(sb.title);
          if (vid) {
            allSongs.push({
              type: "song", id: vid, title: sb.title, artist: sb.artist,
              thumbnail: sb.artworkUrl || "", url: toWatchUrl(vid), videoId: vid,
              duration: sb.duration || 0, viewCount: 0,
              lastPlayed: new Date().toISOString(),
            });
          }
        }
      }
    }
    return allSongs;
  } catch { return []; }
};

const getGenreFolders = async (): Promise<DynamicFolder[]> => {
  const allSongs = await fetchSongsFromHistory();
  const genreMap: Record<string, SongWithMetadata[]> = {};
  [...PREDEFINED_GENRES, "Mixed"].forEach(g => { genreMap[g] = []; });
  allSongs.forEach(song => {
    const genre = detectGenre(song);
    (genreMap[genre] ?? genreMap["Mixed"]).push(song);
  });
  return [...PREDEFINED_GENRES, "Mixed"]
    .map(genre => {
      const songs = (genreMap[genre] ?? []).sort(
        (a, b) => new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime()
      );
      if (!songs.length) return null;
      return {
        id: genre.toLowerCase(), groupKey: genre, songs,
        coverArt: songs[0].thumbnail,
        artistNames: [...new Set(songs.slice(0, 3).map(s => s.artist))].join(", "),
        itemCount: songs.length,
      };
    })
    .filter(Boolean) as DynamicFolder[];
};

const deviceCacheKey = (q: string) => `search:results:${q.toLowerCase().trim()}`;

const loadHistory = async (): Promise<string[]> => {
  try {
    const h = await cache.get(HISTORY_CACHE_KEY);
    if (Array.isArray(h)) return h as string[];
  } catch {}
  return [];
};

const saveToHistory = async (query: string, existing: string[]): Promise<string[]> => {
  const next = [query, ...existing.filter(q => q !== query)].slice(0, HISTORY_MAX);
  await cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

const clearAllHistory  = () => cache.delete(HISTORY_CACHE_KEY).catch(() => {});

const removeHistoryItem = async (query: string, existing: string[]): Promise<string[]> => {
  const next = existing.filter(q => q !== query);
  await cache.set(HISTORY_CACHE_KEY, next, HISTORY_CACHE_TTL).catch(() => {});
  return next;
};

async function persistResultsToSupabase(query: string, results: SearchResults) {
  try {
    for (const artist of results.artists.slice(0, 5)) {
      await supabaseCache.saveArtist(artist.title, {
        name: artist.title, topTracks: [], albums: [], similar: [],
        lastUpdated: new Date().toISOString(),
      }).catch(() => {});
    }
    for (const song of results.songs.slice(0, 10)) {
      const videoId = extractVideoId(song.url);
      await supabaseCache
        .saveTrack({
          id: videoId ?? song.id, title: song.title, artist: song.artist,
          duration: song.duration, artworkUrl: song.thumbnail,
          youtubeId: videoId ?? song.videoId,
          metadata: { source: "search", query, viewCount: song.viewCount },
        })
        .then(tid => { if (tid) supabaseCache.saveSearch(query, tid).catch(() => {}); })
        .catch(() => {});
    }
  } catch {}
}

// ─── Genre Category Card ──────────────────────────────────────────────────────

const CARD_GAP       = 8;
const CARD_H_PADDING = 16;
const CARD_WIDTH     = (SCREEN_WIDTH - CARD_H_PADDING * 2 - CARD_GAP) / 2;

interface GenreCategoryCardProps {
  genre: string;
  color: string;
  coverArt?: string;
  onPress: () => void;
}

const GenreCategoryCard = ({ genre, color, coverArt, onPress }: GenreCategoryCardProps) => (
  <TouchableOpacity
    style={[catStyles.card, { backgroundColor: color, width: CARD_WIDTH }]}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <Text style={catStyles.label} numberOfLines={2}>{genre}</Text>
    {coverArt ? (
      <Image source={{ uri: coverArt }} style={catStyles.artwork} contentFit="cover" />
    ) : (
      <View style={[catStyles.artwork, catStyles.artworkPlaceholder]}>
        <Ionicons name="musical-note" size={28} color="rgba(255,255,255,0.5)" />
      </View>
    )}
  </TouchableOpacity>
);

const catStyles = StyleSheet.create({
  card: {
    height: 104, borderRadius: 8, overflow: "hidden",
    marginBottom: CARD_GAP, position: "relative",
    justifyContent: "flex-start", padding: 14,
  },
  label: {
    color: "#fff", fontSize: 16, fontWeight: "700",
    lineHeight: 20, zIndex: 2, maxWidth: "70%",
  },
  artwork: {
    position: "absolute", right: -8, bottom: -8,
    width: 80, height: 80, borderRadius: 6,
    transform: [{ rotate: "25deg" }],
  },
  artworkPlaceholder: {
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center", alignItems: "center",
  },
});

// ─── Browse All ───────────────────────────────────────────────────────────────

interface BrowseAllProps {
  onGenrePress: (genre: string) => void;
}

const BrowseAll = ({ onGenrePress }: BrowseAllProps) => {
  const [folders, setFolders] = useState<DynamicFolder[]>([]);

  useEffect(() => {
    getGenreFolders().then(setFolders);
  }, []);

  const allCategories = PREDEFINED_GENRES.map(genre => ({
    genre,
    color: GENRE_COLORS[genre] ?? "#333",
    coverArt: folders.find(f => f.groupKey === genre)?.coverArt,
  }));

  const rows: typeof allCategories[] = [];
  for (let i = 0; i < allCategories.length; i += 2) {
    rows.push(allCategories.slice(i, i + 2));
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={browseStyles.container}
    >
      <Text style={browseStyles.heading}>Browse all</Text>
      {rows.map((row, ri) => (
        <View key={ri} style={browseStyles.row}>
          {row.map(item => (
            <GenreCategoryCard
              key={item.genre}
              genre={item.genre}
              color={item.color}
              coverArt={item.coverArt}
              onPress={() => onGenrePress(item.genre)}
            />
          ))}
          {row.length === 1 && <View style={{ width: CARD_WIDTH }} />}
        </View>
      ))}
    </ScrollView>
  );
};

const browseStyles = StyleSheet.create({
  container: { paddingHorizontal: CARD_H_PADDING, paddingBottom: 140 },
  heading:   { color: COLORS.text, fontSize: 22, fontWeight: "700", marginBottom: 16, marginTop: 8 },
  row:       { flexDirection: "row", gap: CARD_GAP },
});

// ─── Top Result Card ──────────────────────────────────────────────────────────

interface TopResultCardProps {
  item: SearchResult;
  onPress: () => void;
  onPlay: () => void;
}

const topResultIcon = (item: SearchResult): React.ComponentProps<typeof Ionicons>["name"] => {
  switch (item.type) {
    case "artist":   return "person";
    case "album":    return "disc";
    default:         return "musical-notes";
  }
};

const topResultSub = (item: SearchResult): string => {
  switch (item.type) {
    case "artist":   return "Artist";
    case "album":    return `Album • ${item.artist}`;
    case "playlist": return "Playlist";
    default:         return `Song • ${item.artist}`;
  }
};

const TopResultCard = ({ item, onPress, onPlay }: TopResultCardProps) => {
  const isArtist = item.type === "artist";
  return (
    <TouchableOpacity style={topStyles.card} onPress={onPress} activeOpacity={0.85}>
      {item.thumbnail ? (
        <Image
          source={{ uri: item.thumbnail }}
          style={[topStyles.image, isArtist && topStyles.imageCircle]}
          contentFit="cover"
        />
      ) : (
        <View style={[topStyles.image, topStyles.imageFallback, isArtist && topStyles.imageCircle]}>
          <Ionicons
            name={topResultIcon(item)}
            size={40}
            color={COLORS.goldShimmer}
          />
        </View>
      )}
      <Text style={topStyles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={topStyles.sub} numberOfLines={1}>
        {topResultSub(item)}
      </Text>
      <TouchableOpacity
        style={topStyles.playBtn}
        onPress={e => { e.stopPropagation?.(); onPlay(); }}
      >
        <Ionicons name="play" size={22} color="#000" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const topStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface, borderRadius: 8,
    padding: 16, marginRight: 8,
    position: "relative", overflow: "hidden",
  },
  image: {
    width: 104, height: 104, borderRadius: 6,
    backgroundColor: COLORS.surfaceLight, marginBottom: 12,
  },
  imageCircle:   { borderRadius: 52 },
  imageFallback: { justifyContent: "center", alignItems: "center" },
  title: { color: COLORS.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  sub:   { color: COLORS.textSecondary, fontSize: 13 },
  playBtn: {
    position: "absolute", right: 14, bottom: 14,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.goldPrimary,
    justifyContent: "center", alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 4, elevation: 6,
  },
});

// ─── Song Row ─────────────────────────────────────────────────────────────────

interface SongRowProps {
  item: SongResult;
  onPress: () => void;
  onMenu: () => void;
}

const SongRow = ({ item, onPress, onMenu }: SongRowProps) => (
  <TouchableOpacity style={songRowStyles.container} onPress={onPress} activeOpacity={0.7}>
    {item.thumbnail ? (
      <Image source={{ uri: item.thumbnail }} style={songRowStyles.thumb} contentFit="cover" />
    ) : (
      <View style={[songRowStyles.thumb, songRowStyles.thumbFallback]}>
        <Ionicons name="musical-notes" size={20} color={COLORS.goldShimmer} />
      </View>
    )}
    <View style={songRowStyles.info}>
      <Text style={songRowStyles.title} numberOfLines={1}>{item.title}</Text>
      <Text style={songRowStyles.sub}   numberOfLines={1}>{item.artist}</Text>
    </View>
    <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Entypo name="dots-three-vertical" size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  </TouchableOpacity>
);

const songRowStyles = StyleSheet.create({
  container:    { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 16, gap: 12 },
  thumb:        { width: 52, height: 52, borderRadius: 4, backgroundColor: COLORS.surfaceLight },
  thumbFallback:{ justifyContent: "center", alignItems: "center" },
  info:         { flex: 1 },
  title:        { color: COLORS.text,          fontSize: 14, fontWeight: "500", marginBottom: 3 },
  sub:          { color: COLORS.textSecondary, fontSize: 12 },
});

// ─── Generic Result Row ───────────────────────────────────────────────────────

interface ResultRowProps {
  item: AlbumResult | ArtistResult | PlaylistResult;
  onPress: () => void;
}

type NonSongResult = AlbumResult | ArtistResult | PlaylistResult;

const resultRowIcon = (item: NonSongResult): React.ComponentProps<typeof Ionicons>["name"] => {
  switch (item.type) {
    case "artist": return "person";
    case "album":  return "disc";
    default:       return "list";
  }
};

const resultRowSub = (item: NonSongResult): string => {
  switch (item.type) {
    case "artist": return item.subtitle;
    case "album":  return `Album • ${item.artist}`;
    default:       return `Playlist • ${item.streamCount} songs`;
  }
};

const ResultRow = ({ item, onPress }: ResultRowProps) => {
  const isArtist = item.type === "artist";
  return (
    <TouchableOpacity style={resultRowStyles.container} onPress={onPress} activeOpacity={0.7}>
      {item.thumbnail ? (
        <Image
          source={{ uri: item.thumbnail }}
          style={[resultRowStyles.thumb, isArtist && resultRowStyles.thumbCircle]}
          contentFit="cover"
        />
      ) : (
        <View style={[resultRowStyles.thumb, resultRowStyles.thumbFallback, isArtist && resultRowStyles.thumbCircle]}>
          <Ionicons name={resultRowIcon(item)} size={20} color={COLORS.goldShimmer} />
        </View>
      )}
      <View style={resultRowStyles.info}>
        <Text style={resultRowStyles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={resultRowStyles.sub}   numberOfLines={1}>{resultRowSub(item)}</Text>
      </View>
    </TouchableOpacity>
  );
};

const resultRowStyles = StyleSheet.create({
  container:    { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 16, gap: 12 },
  thumb:        { width: 52, height: 52, borderRadius: 4, backgroundColor: COLORS.surfaceLight },
  thumbCircle:  { borderRadius: 26 },
  thumbFallback:{ justifyContent: "center", alignItems: "center" },
  info:         { flex: 1 },
  title:        { color: COLORS.text,          fontSize: 14, fontWeight: "500", marginBottom: 3 },
  sub:          { color: COLORS.textSecondary, fontSize: 12 },
});

// ─── Search Results Layout ────────────────────────────────────────────────────

interface SearchResultsViewProps {
  results: SearchResults;
  activeTab: FilterTab;
  setActiveTab: (t: FilterTab) => void;
  onSongPress: (s: SongResult) => void;
  onAlbumPress: (a: AlbumResult) => void;
  onArtistPress: (a: ArtistResult) => void;
  onPlaylistPress: (p: PlaylistResult) => void;
  onMenuPress: (s: SongResult) => void;
  query: string;
  insets: { bottom: number };
}

const SearchResultsView = ({
  results, activeTab, setActiveTab, onSongPress, onAlbumPress,
  onArtistPress, onPlaylistPress, onMenuPress, query, insets,
}: SearchResultsViewProps) => {
  const topResult: SearchResult | null =
    results.artists[0] ?? results.songs[0] ?? results.albums[0] ?? results.playlists[0] ?? null;

  const handleTopPress = () => {
    if (!topResult) return;
    if      (topResult.type === "song")    onSongPress(topResult);
    else if (topResult.type === "album")   onAlbumPress(topResult);
    else if (topResult.type === "artist")  onArtistPress(topResult);
    else                                   onPlaylistPress(topResult as PlaylistResult);
  };

  const handleTopPlay = () => {
    const song = results.songs[0];
    if (song) onSongPress(song);
    else      handleTopPress();
  };

  const tabs: FilterTab[] = ["all", "songs", "albums", "artists", "playlists"];

  const renderInTab = () => {
    switch (activeTab) {
      case "songs":
        return results.songs.length === 0
          ? <EmptyResults query={query} />
          : results.songs.map(s => (
              <SongRow key={s.id} item={s} onPress={() => onSongPress(s)} onMenu={() => onMenuPress(s)} />
            ));
      case "albums":
        return results.albums.length === 0
          ? <EmptyResults query={query} />
          : results.albums.map(a => <ResultRow key={a.id} item={a} onPress={() => onAlbumPress(a)} />);
      case "artists":
        return results.artists.length === 0
          ? <EmptyResults query={query} />
          : results.artists.map(a => <ResultRow key={a.id} item={a} onPress={() => onArtistPress(a)} />);
      case "playlists":
        return results.playlists.length === 0
          ? <EmptyResults query={query} />
          : results.playlists.map(p => <ResultRow key={p.id} item={p} onPress={() => onPlaylistPress(p)} />);
      default:
        return null;
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
    >
      {/* Filter chip tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={srStyles.tabsRow}
      >
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[srStyles.chip, activeTab === tab && srStyles.chipActive]}
            onPress={() => { triggerHaptic(); setActiveTab(tab); }}
          >
            <Text style={[srStyles.chipText, activeTab === tab && srStyles.chipTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeTab === "all" ? (
        <>
          {topResult && (
            <View style={srStyles.topSection}>
              <View style={srStyles.topLeft}>
                <Text style={srStyles.sectionLabel}>Top result</Text>
                <TopResultCard item={topResult} onPress={handleTopPress} onPlay={handleTopPlay} />
              </View>

              {results.songs.length > 0 && (
                <View style={srStyles.topRight}>
                  <Text style={srStyles.sectionLabel}>Songs</Text>
                  {results.songs.slice(0, 4).map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={srStyles.sideSongRow}
                      onPress={() => onSongPress(s)}
                      activeOpacity={0.7}
                    >
                      {s.thumbnail ? (
                        <Image source={{ uri: s.thumbnail }} style={srStyles.sideSongThumb} contentFit="cover" />
                      ) : (
                        <View style={[srStyles.sideSongThumb, { backgroundColor: COLORS.surfaceLight, justifyContent: "center", alignItems: "center" }]}>
                          <Ionicons name="musical-notes" size={14} color={COLORS.goldShimmer} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={srStyles.sideSongTitle} numberOfLines={1}>{s.title}</Text>
                        <Text style={srStyles.sideSongArtist} numberOfLines={1}>{s.artist}</Text>
                      </View>
                      <TouchableOpacity onPress={() => onMenuPress(s)} hitSlop={8}>
                        <Entypo name="dots-three-vertical" size={14} color={COLORS.textTertiary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {results.albums.length > 0 && (
            <View style={srStyles.section}>
              <Text style={srStyles.sectionLabel}>Albums</Text>
              {results.albums.slice(0, 4).map(a => (
                <ResultRow key={a.id} item={a} onPress={() => onAlbumPress(a)} />
              ))}
            </View>
          )}

          {results.artists.length > 1 && (
            <View style={srStyles.section}>
              <Text style={srStyles.sectionLabel}>Artists</Text>
              {results.artists.slice(0, 4).map(a => (
                <ResultRow key={a.id} item={a} onPress={() => onArtistPress(a)} />
              ))}
            </View>
          )}

          {results.playlists.length > 0 && (
            <View style={srStyles.section}>
              <Text style={srStyles.sectionLabel}>Playlists</Text>
              {results.playlists.slice(0, 4).map(p => (
                <ResultRow key={p.id} item={p} onPress={() => onPlaylistPress(p)} />
              ))}
            </View>
          )}

          {!topResult && <EmptyResults query={query} />}
        </>
      ) : (
        <View>{renderInTab()}</View>
      )}
    </ScrollView>
  );
};

const EmptyResults = ({ query }: { query: string }) => (
  <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
    <Text style={{ color: COLORS.textTertiary, fontSize: 15, textAlign: "center" }}>
      No results for "{query}"
    </Text>
  </View>
);

const srStyles = StyleSheet.create({
  tabsRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: COLORS.surfaceLight,
  },
  chipActive: {
    backgroundColor: COLORS.goldPrimary + "25",
    borderWidth: 1, borderColor: COLORS.goldPrimary,
  },
  chipText:       { color: COLORS.textSecondary, fontSize: 13, fontWeight: "500" },
  chipTextActive: { color: COLORS.goldPrimary,   fontSize: 13, fontWeight: "600" },
  topSection: { flexDirection: "row", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  topLeft:    { flex: 1.1 },
  topRight:   { flex: 1 },
  sectionLabel: { color: COLORS.text, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  sideSongRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  sideSongThumb: { width: 44, height: 44, borderRadius: 4, backgroundColor: COLORS.surfaceLight },
  sideSongTitle:  { color: COLORS.text,          fontSize: 13, fontWeight: "500", marginBottom: 2 },
  sideSongArtist: { color: COLORS.textSecondary, fontSize: 11 },
  section: { marginTop: 16, marginBottom: 4 },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { playAudio } = useMusicPlayer();

  const [query,      setQuery]      = useState("");
  const [activeTab,  setActiveTab]  = useState<FilterTab>("all");
  const [results,    setResults]    = useState<SearchResults | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [history,    setHistory]    = useState<string[]>([]);
  const [suggestions,setSuggestions]= useState<string[]>([]);
  const [isFocused,  setIsFocused]  = useState(false);

  const inputRef    = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadHistory().then(setHistory);
    setTimeout(() => { inputRef.current?.focus(); setIsFocused(true); }, 150);
  }, []);

  // Suggestions debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await MavinEngine.getSearchSuggestions(query.trim(), 0);
        setSuggestions(res.suggestions?.slice(0, 7) ?? []);
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
    setIsFocused(false);
    setLoading(true);
    setError(null);
    setResults(null);
    setActiveTab("all");

    const cacheKey = deviceCacheKey(trimmed);

    // 1. Device cache
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        const sr = cached as SearchResults;
        const has = sr.songs?.length || sr.albums?.length || sr.artists?.length || sr.playlists?.length;
        if (has) {
          setResults(sr);
          setLoading(false);
          setHistory(await saveToHistory(trimmed, history));
          return;
        }
        cache.delete(cacheKey).catch(() => {});
      }
    } catch {}

    // 2. Supabase cache
    try {
      const sbResult = await supabaseCache.findBySearch(trimmed);
      if (sbResult) {
        const videoId = sbResult.youtubeId || extractVideoId(sbResult.title);
        if (videoId) {
          const song: SongResult = {
            type: "song", id: videoId, title: sbResult.title, artist: sbResult.artist,
            thumbnail: sbResult.artworkUrl ?? "", url: toWatchUrl(videoId), videoId,
            duration: sbResult.duration ?? 0, viewCount: sbResult.accessCount ?? 0,
          };
          const mapped: SearchResults = { songs: [song], albums: [], artists: [], playlists: [] };
          setResults(mapped);
          cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
          setLoading(false);
          setHistory(await saveToHistory(trimmed, history));
          return;
        }
      }
    } catch {}

    // 3. Live search
    const doSearch = async (): Promise<SearchResults> => {
      const raw = await MavinEngine.search(trimmed, "", undefined, 0);
      const items = raw.results ?? [];
      return mapEngineResults(items.length ? items : (await MavinEngine.search(trimmed, "", undefined, 0)).results ?? []);
    };

    try {
      const mapped = await doSearch();
      setResults(mapped);
      const has = mapped.songs.length || mapped.albums.length || mapped.artists.length || mapped.playlists.length;
      if (has) {
        cache.set(cacheKey, mapped, SEARCH_CACHE_TTL_MS).catch(() => {});
        persistResultsToSupabase(trimmed, mapped);
      }
      setHistory(await saveToHistory(trimmed, history));
    } catch (e: any) {
      try {
        const mapped2 = await doSearch();
        setResults(mapped2);
        const has2 = mapped2.songs.length || mapped2.albums.length || mapped2.artists.length || mapped2.playlists.length;
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

  const handleSubmit          = () => performSearch(query);
  const handleSuggestionTap  = (s: string) => { setQuery(s); performSearch(s); };
  const handleHistoryTap     = (q: string) => { setQuery(q); performSearch(q); };
  const handleClearHistory   = async () => { await clearAllHistory(); setHistory([]); };
  const handleRemoveHistory  = async (q: string) => setHistory(await removeHistoryItem(q, history));

  const handleCancel = () => {
    Keyboard.dismiss();
    if (results) { setQuery(""); setResults(null); setSuggestions([]); setIsFocused(false); }
    else         { router.back(); }
  };

  // ── Navigation handlers — all use typed { pathname, params } ────────────────

  const handleSongPress = useCallback(async (song: SongResult) => {
    triggerHaptic();
    setPendingTrack({ title: song.title, artist: song.artist, artwork: song.thumbnail });
    const queue = (results?.songs ?? []).map(s => ({
      id: s.id, title: s.title, artist: s.artist,
      thumbnail: s.thumbnail, url: s.url, videoId: s.videoId || undefined,
    }));
    await playAudio(
      { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, url: song.url, videoId: song.videoId || undefined },
      queue,
    );
  }, [results, playAudio]);

  const handleAlbumPress = (a: AlbumResult) => {
    triggerHaptic();
    router.push({
      pathname: "/album/[id]" as any,
      params: { id: encodeURIComponent(a.url) },
    });
  };

  const handleArtistPress = (a: ArtistResult) => {
    triggerHaptic();
    router.push({
      pathname: "/artist/[id]" as any,
      params: { id: encodeURIComponent(a.url), subtitle: a.subtitle },
    });
  };

  const handlePlaylistPress = (p: PlaylistResult) => {
    triggerHaptic();
    router.push({
      pathname: "/playlist/[id]" as any,
      params: { id: encodeURIComponent(p.url) },
    });
  };

  const handleMenuPress = (s: SongResult) => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/menu" as any,
      params: {
        songData: JSON.stringify({
          id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail,
        }),
        type: "song",
      },
    });
  };

  // ── Derived display state ─────────────────────────────────────────────────
  const showSuggestions = isFocused && query.trim().length >= 2 && suggestions.length > 0 && !results && !loading;
  const showHistory     = !query && !results && history.length > 0 && isFocused;
  const showResults     = !!results && !loading;

  return (
    <View style={[mainStyles.container, { paddingTop: insets.top }]}>

      {/* Search bar */}
      <View style={mainStyles.searchRow}>
        <View style={[mainStyles.searchBar, isFocused && mainStyles.searchBarFocused]}>
          <Ionicons name="search" size={18} color={COLORS.textTertiary} style={{ marginRight: 8 }} />
          <TextInput
            ref={inputRef}
            style={mainStyles.searchInput}
            value={query}
            onChangeText={t => { setQuery(t); if (!t) { setResults(null); setSuggestions([]); } }}
            onSubmitEditing={handleSubmit}
            onFocus={() => setIsFocused(true)}
            placeholder="What do you want to listen to?"
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
        {(isFocused || results) && (
          <TouchableOpacity onPress={handleCancel} style={mainStyles.cancelBtn}>
            <Text style={mainStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Suggestions */}
      {showSuggestions && (
        <View style={mainStyles.suggestionsBox}>
          {suggestions.map(s => (
            <TouchableOpacity key={s} style={mainStyles.suggRow} onPress={() => handleSuggestionTap(s)}>
              <Ionicons name="search-outline" size={16} color={COLORS.textTertiary} style={{ marginRight: 14 }} />
              <Text style={mainStyles.suggText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent searches */}
      {showHistory && !showSuggestions && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          <View style={mainStyles.historyHeader}>
            <Text style={mainStyles.historyTitle}>Recent searches</Text>
            <TouchableOpacity onPress={handleClearHistory}>
              <Text style={mainStyles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
          {history.map(item => (
            <View key={item} style={mainStyles.historyRow}>
              <TouchableOpacity style={mainStyles.historyRowMain} onPress={() => handleHistoryTap(item)}>
                <Ionicons name="time-outline" size={18} color={COLORS.textTertiary} style={{ marginRight: 14 }} />
                <Text style={mainStyles.historyText}>{item}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRemoveHistory(item)} hitSlop={10}>
                <Ionicons name="close" size={18} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Browse all (idle) */}
      {!showSuggestions && !showHistory && !loading && !results && !error && (
        <BrowseAll onGenrePress={genre => { setQuery(genre); performSearch(genre); }} />
      )}

      {/* Loading skeleton */}
      {loading && <SkeletonResultList />}

      {/* Error */}
      {!!error && !loading && (
        <View style={mainStyles.errorBox}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.danger} />
          <Text style={mainStyles.errorText}>{error}</Text>
          <TouchableOpacity style={mainStyles.retryBtn} onPress={handleSubmit}>
            <Text style={mainStyles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Results */}
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
          query={query}
          insets={insets}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const mainStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, gap: 10,
  },
  searchBar: {
    flex: 1, flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surfaceLight, borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  searchBarFocused: { backgroundColor: "#2A2A2A" },
  searchInput:  { flex: 1, color: COLORS.text, fontSize: 15, padding: 0 },
  cancelBtn:    { paddingVertical: 8 },
  cancelText:   { color: COLORS.text, fontSize: 15, fontWeight: "500" },
  suggestionsBox: {
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: 8, overflow: "hidden", marginBottom: 4,
  },
  suggRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.surfaceLight,
  },
  suggText: { color: COLORS.text, fontSize: 14 },
  historyHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
  },
  historyTitle: { color: COLORS.text,       fontSize: 16, fontWeight: "700" },
  clearText:    { color: COLORS.goldShimmer,fontSize: 13, fontWeight: "600" },
  historyRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.surfaceLight,
  },
  historyRowMain: { flex: 1, flexDirection: "row", alignItems: "center" },
  historyText:    { color: COLORS.text, fontSize: 14 },
  errorBox:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 24 },
  errorText: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn:  {
    paddingHorizontal: 20, paddingVertical: 9,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.goldPrimary,
  },
  retryText: { color: COLORS.goldPrimary, fontSize: 13, fontWeight: "600" },
});