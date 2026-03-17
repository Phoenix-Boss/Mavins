/**
 * LibraryScreen — Mavin Music Platform
 *
 * Unified library for both streaming (online) and local device music.
 *
 * Tabs:     Playlists · Albums · Artists · Songs · Downloads
 * Quick Access: Favourites · Recently Played · Most Played · Local Music
 *
 * Features:
 *   - Real data from Redux store hooks (playlists, favorites, downloads, local)
 *   - Per-tab sort/filter with persistence
 *   - Grid/List view toggle (Albums, Artists)
 *   - Shuffle all per tab
 *   - Pull-to-refresh
 *   - Create playlist FAB (Playlists tab)
 *   - Import local music button (Songs tab)
 *   - Search within library
 *   - Pinned quick-access row
 *   - Empty states per tab
 *
 * Design: dark luxury — black base, gold accents, Meriva display font.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  TextInput,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { useLastActiveTrack } from "@/hooks/useLastActiveTrack";
import { useActiveTrack } from "react-native-track-player";
import {
  usePlaylists,
  useFavorites,
  useDownloadedTracks,
  useActiveDownloads,
  type Song,
  type DownloadedSongMetadata,
  type Playlist,
  type SmartPlaylist,
} from "@/store/library";
import { unknownTrackImageUri } from "@/constants/images";

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#000000",
  surface: "#0D0D0D",
  surfaceRaised: "#161616",
  surfaceHigh: "#1F1F1F",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldShimmer: "#E6C16A",
  goldDim: "rgba(212,175,55,0.35)",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  online: "#1DB954",
  local: "#4A90E2",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

const TABS = ["Playlists", "Albums", "Artists", "Songs", "Downloads"] as const;
type Tab = (typeof TABS)[number];

const SORT_OPTIONS: Record<Tab, string[]> = {
  Playlists: ["Recent", "A–Z", "By You", "Saved"],
  Albums: ["Recent", "A–Z", "By Artist", "Year"],
  Artists: ["Recent", "A–Z", "Most Played"],
  Songs: ["Recent", "A–Z", "Artist", "Duration"],
  Downloads: ["Recent", "A–Z", "Size", "Duration"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Derives a sorted array of playlist entries from the playlists map. */
function useSortedPlaylists(sort: string) {
  // usePlaylists() returns Record<id, Playlist|SmartPlaylist> directly — not { playlists }
  const playlists = usePlaylists();
  return useMemo(() => {
    if (!playlists) return [];
    const entries = Object.values(playlists).map((pl) => ({
      id: pl.id,
      name: pl.name,
      cover: pl.thumbnail,
      count: pl.trackCount,
      createdBy: pl.createdBy,
    }));
    if (sort === "A–Z") return entries.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "By You") return entries.filter((p) => p.createdBy === "user");
    if (sort === "Saved") return entries.filter((p) => p.createdBy === "shared");
    return entries; // "Recent" keeps insertion order
  }, [playlists, sort]);
}

/** Derives sorted downloaded tracks. */
function useSortedDownloads(sort: string) {
  const raw = useDownloadedTracks();
  return useMemo(() => {
    const copy = [...raw];
    if (sort === "A–Z") return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "Duration") return copy.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return copy.reverse(); // Recent first by default
  }, [raw, sort]);
}

/** Derives sorted favorite tracks. */
function useSortedFavorites(sort: string) {
  const { favoriteTracks } = useFavorites();
  return useMemo(() => {
    const copy: Song[] = [...favoriteTracks];
    if (sort === "A–Z") return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "Artist") return copy.sort((a, b) => a.artist.localeCompare(b.artist));
    return copy;
  }, [favoriteTracks, sort]);
}

/** Derives albums from downloaded tracks (grouped by album field or artist). */
function useDerivedAlbums(sort: string) {
  const downloads = useDownloadedTracks();
  const favorites = useFavorites().favoriteTracks;
  return useMemo(() => {
    const map = new Map<string, { id: string; title: string; artist: string; cover?: string; count: number }>();
    const allSongs = [...downloads, ...favorites] as any[];
    allSongs.forEach((s) => {
      const key = s.album ?? `${s.artist ?? "Unknown"} – Singles`;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title: key,
          artist: s.artist ?? "Unknown Artist",
          cover: s.localArtworkUri ?? s.thumbnail,
          count: 1,
        });
      } else {
        map.get(key)!.count += 1;
      }
    });
    const arr = Array.from(map.values());
    if (sort === "A–Z") return arr.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "By Artist") return arr.sort((a, b) => a.artist.localeCompare(b.artist));
    return arr;
  }, [downloads, favorites, sort]);
}

/** Derives artists from downloaded tracks and favorites. */
function useDerivedArtists(sort: string) {
  const downloads = useDownloadedTracks();
  const favorites = useFavorites().favoriteTracks;
  return useMemo(() => {
    const map = new Map<string, { id: string; name: string; cover?: string; count: number }>();
    const allSongs = [...downloads, ...favorites] as any[];
    allSongs.forEach((s) => {
      const name = s.artist ?? "Unknown Artist";
      if (!map.has(name)) {
        map.set(name, {
          id: name,
          name,
          cover: s.localArtworkUri ?? s.thumbnail,
          count: 1,
        });
      } else {
        map.get(name)!.count += 1;
      }
    });
    const arr = Array.from(map.values());
    if (sort === "A–Z") return arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [downloads, favorites, sort]);
}

// ─────────────────────────────────────────────────────────────────────────────
// QuickPill
// ─────────────────────────────────────────────────────────────────────────────

interface QuickPillProps {
  icon: string;
  label: string;
  sub: string;
  onPress: () => void;
  badge?: number;
  tint?: string;
}

function QuickPill({ icon, label, sub, onPress, badge, tint = C.gold }: QuickPillProps) {
  return (
    <TouchableOpacity
      style={qStyles.pill}
      onPress={() => { triggerHaptic(); onPress(); }}
      activeOpacity={0.7}
    >
      <View style={[qStyles.pillIcon, { backgroundColor: `${tint}18` }]}>
        <Ionicons name={icon as any} size={moderateScale(20)} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={qStyles.pillLabel} numberOfLines={1}>{label}</Text>
        <Text style={qStyles.pillSub} numberOfLines={1}>{sub}</Text>
      </View>
      {badge != null && badge > 0 && (
        <View style={[qStyles.badge, { backgroundColor: `${tint}22`, borderColor: `${tint}44` }]}>
          <Text style={[qStyles.badgeText, { color: tint }]}>{badge > 999 ? "999+" : badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={moderateScale(13)} color={C.textMuted} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

const qStyles = ScaledSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceRaised,
    borderRadius: "12@ms",
    borderWidth: 0.5,
    borderColor: C.borderGold,
    paddingVertical: "11@vs",
    paddingHorizontal: "14@s",
    marginBottom: "9@vs",
  },
  pillIcon: {
    width: "38@ms",
    height: "38@ms",
    borderRadius: "10@ms",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12@s",
  },
  pillLabel: { fontSize: "14@ms", color: C.text, fontWeight: "600" },
  pillSub: { fontSize: "11@ms", color: C.textSub, marginTop: "2@vs" },
  badge: {
    borderRadius: "10@ms",
    borderWidth: 1,
    paddingHorizontal: "7@s",
    paddingVertical: "2@vs",
    minWidth: "26@ms",
    alignItems: "center",
  },
  badgeText: { fontSize: "11@ms", fontWeight: "700" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sort + View toggle row
// ─────────────────────────────────────────────────────────────────────────────

function SortRow({
  options, active, onSelect,
  showViewToggle, gridView, onToggleView,
  onShuffle,
}: {
  options: string[];
  active: string;
  onSelect: (s: string) => void;
  showViewToggle?: boolean;
  gridView?: boolean;
  onToggleView?: () => void;
  onShuffle?: () => void;
}) {
  return (
    <View style={sStyles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={sStyles.sortRow}
        style={{ flex: 1 }}
      >
        {options.map((opt) => {
          const isSel = opt === active;
          return (
            <TouchableOpacity
              key={opt}
              style={[sStyles.sortPill, isSel && sStyles.sortPillActive]}
              onPress={() => { triggerHaptic(); onSelect(opt); }}
              activeOpacity={0.7}
            >
              <Text style={[sStyles.sortText, isSel && sStyles.sortTextActive]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={sStyles.actions}>
        {onShuffle && (
          <TouchableOpacity style={sStyles.actionBtn} onPress={() => { triggerHaptic(); onShuffle(); }} hitSlop={8}>
            <Ionicons name="shuffle" size={moderateScale(17)} color={C.textSub} />
          </TouchableOpacity>
        )}
        {showViewToggle && onToggleView && (
          <TouchableOpacity style={sStyles.actionBtn} onPress={() => { triggerHaptic(); onToggleView(); }} hitSlop={8}>
            <Ionicons
              name={gridView ? "list" : "grid-outline"}
              size={moderateScale(17)}
              color={C.textSub}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const sStyles = ScaledSheet.create({
  wrapper: { flexDirection: "row", alignItems: "center" },
  sortRow: { paddingLeft: "16@s", paddingRight: "4@s", paddingVertical: "8@vs", gap: "8@s" },
  sortPill: {
    paddingHorizontal: "14@s",
    paddingVertical: "6@vs",
    borderRadius: "20@ms",
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  sortPillActive: { backgroundColor: C.goldFill, borderColor: C.borderGold },
  sortText: { fontSize: "12@ms", color: C.textSub, fontWeight: "500" },
  sortTextActive: { color: C.gold },
  actions: { flexDirection: "row", paddingRight: "12@s", gap: "4@s" },
  actionBtn: {
    width: "32@ms",
    height: "32@ms",
    borderRadius: "8@ms",
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CoverArt
// ─────────────────────────────────────────────────────────────────────────────

function CoverArt({
  uri, size, radius = 10, placeholder,
}: {
  uri?: string; size: number; radius?: number; placeholder?: string;
}) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: radius,
      backgroundColor: C.surfaceHigh,
      alignItems: "center", justifyContent: "center",
      borderWidth: 0.5, borderColor: C.border,
    }}>
      <Ionicons name={(placeholder ?? "musical-notes") as any} size={size * 0.38} color={C.textMuted} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source badge (streaming vs local)
// ─────────────────────────────────────────────────────────────────────────────

function SourceBadge({ isLocal }: { isLocal?: boolean }) {
  if (!isLocal) return null;
  return (
    <View style={badgeStyles.wrap}>
      <MaterialCommunityIcons name="cellphone" size={moderateScale(8)} color={C.local} />
      <Text style={badgeStyles.text}>Local</Text>
    </View>
  );
}

const badgeStyles = ScaledSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(74,144,226,0.12)",
    borderRadius: "4@ms",
    paddingHorizontal: "4@s",
    paddingVertical: "1@vs",
    gap: "2@s",
    alignSelf: "flex-start",
    marginTop: "2@vs",
  },
  text: { fontSize: "9@ms", color: C.local, fontWeight: "600" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({
  icon, title, sub, actionLabel, onAction,
}: {
  icon: string; title: string; sub: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <View style={emStyles.wrap}>
      <View style={emStyles.iconRing}>
        <Ionicons name={icon as any} size={moderateScale(36)} color={C.goldDim} />
      </View>
      <Text style={emStyles.title}>{title}</Text>
      <Text style={emStyles.sub}>{sub}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={emStyles.btn} onPress={() => { triggerHaptic(); onAction(); }} activeOpacity={0.8}>
          <Text style={emStyles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const emStyles = ScaledSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: "60@vs",
    paddingHorizontal: "32@s",
  },
  iconRing: {
    width: "72@ms", height: "72@ms", borderRadius: "36@ms",
    backgroundColor: C.goldFill, borderWidth: 1, borderColor: C.borderGold,
    alignItems: "center", justifyContent: "center", marginBottom: "20@vs",
  },
  title: { fontSize: "18@ms", color: C.text, fontWeight: "700", textAlign: "center", marginBottom: "8@vs" },
  sub: { fontSize: "13@ms", color: C.textSub, textAlign: "center", lineHeight: "19@ms" },
  btn: {
    marginTop: "24@vs",
    paddingHorizontal: "24@s",
    paddingVertical: "12@vs",
    borderRadius: "24@ms",
    backgroundColor: C.goldFill,
    borderWidth: 1,
    borderColor: C.borderGold,
  },
  btnText: { fontSize: "14@ms", color: C.gold, fontWeight: "700" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Row components
// ─────────────────────────────────────────────────────────────────────────────

function PlaylistRow({
  name, cover, count,
  onPress, onMore,
}: {
  name: string; cover?: string; count: number;
  onPress: () => void; onMore: () => void;
}) {
  const COVER = moderateScale(52);
  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <CoverArt uri={cover} size={COVER} placeholder="musical-notes-outline" />
      <View style={rowStyles.info}>
        <Text style={rowStyles.title} numberOfLines={1}>{name}</Text>
        <Text style={rowStyles.sub} numberOfLines={1}>{count} {count === 1 ? "track" : "tracks"}</Text>
      </View>
      <TouchableOpacity hitSlop={12} onPress={() => { triggerHaptic(); onMore(); }}>
        <Ionicons name="ellipsis-vertical" size={moderateScale(18)} color={C.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function AlbumRow({
  item, onPress, gridMode,
}: {
  item: { id: string; title: string; artist: string; cover?: string; count: number };
  onPress: () => void;
  gridMode?: boolean;
}) {
  const COVER = moderateScale(gridMode ? 90 : 52);
  if (gridMode) {
    return (
      <TouchableOpacity style={gridStyles.cell} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
        <CoverArt uri={item.cover} size={COVER} placeholder="disc-outline" />
        <Text style={gridStyles.cellTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={gridStyles.cellSub} numberOfLines={1}>{item.artist}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <CoverArt uri={item.cover} size={COVER} placeholder="disc-outline" />
      <View style={rowStyles.info}>
        <Text style={rowStyles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={rowStyles.sub} numberOfLines={1}>{item.artist} · {item.count} tracks</Text>
      </View>
      <Ionicons name="chevron-forward" size={moderateScale(15)} color={C.textMuted} />
    </TouchableOpacity>
  );
}

function ArtistRow({
  item, onPress, gridMode,
}: {
  item: { id: string; name: string; cover?: string; count: number };
  onPress: () => void;
  gridMode?: boolean;
}) {
  const COVER = moderateScale(gridMode ? 80 : 52);
  if (gridMode) {
    return (
      <TouchableOpacity style={gridStyles.cell} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
        <CoverArt uri={item.cover} size={COVER} radius={COVER / 2} placeholder="person-outline" />
        <Text style={gridStyles.cellTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={gridStyles.cellSub} numberOfLines={1}>{item.count} tracks</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <CoverArt uri={item.cover} size={COVER} radius={COVER / 2} placeholder="person-outline" />
      <View style={rowStyles.info}>
        <Text style={rowStyles.title} numberOfLines={1}>{item.name}</Text>
        <Text style={rowStyles.sub} numberOfLines={1}>{item.count} {item.count === 1 ? "track" : "tracks"}</Text>
      </View>
      <Ionicons name="chevron-forward" size={moderateScale(15)} color={C.textMuted} />
    </TouchableOpacity>
  );
}

function SongRow({
  item, isPlaying, onPress, onMore,
}: {
  item: Song; isPlaying: boolean; onPress: () => void; onMore: () => void;
}) {
  const COVER = moderateScale(48);
  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <View>
        <CoverArt uri={item.thumbnail} size={COVER} placeholder="musical-notes-outline" />
        {isPlaying && (
          <View style={rowStyles.playingDot}>
            <Ionicons name="musical-note" size={moderateScale(8)} color={C.gold} />
          </View>
        )}
      </View>
      <View style={rowStyles.info}>
        <Text style={[rowStyles.title, isPlaying && { color: C.gold }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={rowStyles.sub} numberOfLines={1}>{item.artist}</Text>
      </View>
      <TouchableOpacity hitSlop={12} onPress={() => { triggerHaptic(); onMore(); }}>
        <Ionicons name="ellipsis-vertical" size={moderateScale(18)} color={C.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function DownloadRow({
  item, isPlaying, onPress, onMore,
}: {
  item: DownloadedSongMetadata; isPlaying: boolean; onPress: () => void; onMore: () => void;
}) {
  const COVER = moderateScale(52);
  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <View>
        <CoverArt uri={item.localArtworkUri ?? item.thumbnail} size={COVER} placeholder="arrow-down-circle-outline" />
        <View style={rowStyles.dlBadge}>
          <Ionicons name="arrow-down" size={moderateScale(8)} color={C.gold} />
        </View>
        {isPlaying && (
          <View style={rowStyles.playingDot}>
            <Ionicons name="musical-note" size={moderateScale(8)} color={C.gold} />
          </View>
        )}
      </View>
      <View style={rowStyles.info}>
        <Text style={[rowStyles.title, isPlaying && { color: C.gold }]} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={rowStyles.sub} numberOfLines={1}>{item.artist}</Text>
          <SourceBadge isLocal />
        </View>
      </View>
      <TouchableOpacity hitSlop={12} onPress={() => { triggerHaptic(); onMore(); }}>
        <Ionicons name="ellipsis-vertical" size={moderateScale(18)} color={C.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const rowStyles = ScaledSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: "16@s",
    paddingVertical: "10@vs",
  },
  info: { flex: 1, marginLeft: "12@s", marginRight: "8@s" },
  title: { fontSize: "14@ms", color: C.text, fontWeight: "600" },
  sub: { fontSize: "12@ms", color: C.textSub, marginTop: "2@vs" },
  playingDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: "16@ms",
    height: "16@ms",
    borderRadius: "8@ms",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderGold,
    alignItems: "center",
    justifyContent: "center",
  },
  dlBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: "16@ms",
    height: "16@ms",
    borderRadius: "8@ms",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderGold,
    alignItems: "center",
    justifyContent: "center",
  },
});

const gridStyles = ScaledSheet.create({
  cell: { width: "46%", alignItems: "center", paddingVertical: "12@vs" },
  cellTitle: { fontSize: "13@ms", color: C.text, fontWeight: "600", marginTop: "8@vs", textAlign: "center" },
  cellSub: { fontSize: "11@ms", color: C.textSub, marginTop: "2@vs", textAlign: "center" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Active download progress items
// ─────────────────────────────────────────────────────────────────────────────

function ActiveDownloadItem({ song }: { song: { id: string; title: string; thumbnail?: string; progress: number } }) {
  return (
    <View style={adStyles.item}>
      <CoverArt uri={song.thumbnail} size={moderateScale(48)} placeholder="cloud-download-outline" />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={adStyles.title} numberOfLines={1}>{song.title}</Text>
        <View style={adStyles.progressBg}>
          <View style={[adStyles.progressFill, { width: `${Math.min(100, song.progress)}%` }]} />
        </View>
        <Text style={adStyles.pct}>{song.progress.toFixed(0)}%</Text>
      </View>
    </View>
  );
}

const adStyles = ScaledSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: "16@s",
    paddingVertical: "10@vs",
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  title: { fontSize: "13@ms", color: C.text, fontWeight: "500", marginBottom: "6@vs" },
  progressBg: { height: "3@vs", backgroundColor: C.surfaceHigh, borderRadius: "2@ms", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: C.gold, borderRadius: "2@ms" },
  pct: { fontSize: "10@ms", color: C.textSub, marginTop: "3@vs" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Section header row with track count
// ─────────────────────────────────────────────────────────────────────────────

function SectionCount({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <Text style={scStyles.text}>
      {count} {label}{count !== 1 ? "s" : ""}
    </Text>
  );
}

const scStyles = ScaledSheet.create({
  text: {
    fontSize: "12@ms",
    color: C.textMuted,
    paddingHorizontal: "16@s",
    paddingBottom: "6@vs",
    fontWeight: "500",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab content panels
// ─────────────────────────────────────────────────────────────────────────────

function PlaylistsPanel({
  sort, router, onCreatePlaylist,
}: {
  sort: string; router: ReturnType<typeof useRouter>; onCreatePlaylist: () => void;
}) {
  const playlists = useSortedPlaylists(sort);

  if (playlists.length === 0) {
    return (
      <EmptyState
        icon="musical-notes-outline"
        title="No playlists yet"
        sub="Create your first playlist or save songs from the streaming feed."
        actionLabel="Create Playlist"
        onAction={onCreatePlaylist}
      />
    );
  }

  return (
    <>
      <SectionCount count={playlists.length} label="Playlist" />
      <FlatList
        data={playlists}
        keyExtractor={(i) => i.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <PlaylistRow
            name={item.name}
            cover={item.cover}
            count={item.count}
            onPress={() => router.push({ pathname: "/(library)/[playlistName]", params: { playlistName: item.id } })}
            onMore={() => {
              router.push({
                pathname: "/(modals)/menu",
                params: { type: "playlist", playlistName: item.id },
              });
            }}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(80) }} />}
      />
    </>
  );
}

function AlbumsPanel({
  sort, router,
}: {
  sort: string; router: ReturnType<typeof useRouter>;
}) {
  const [gridView, setGridView] = useState(false);
  const albums = useDerivedAlbums(sort);

  if (albums.length === 0) {
    return (
      <EmptyState
        icon="disc-outline"
        title="No albums yet"
        sub="Albums are built from your downloaded songs and favorites."
      />
    );
  }

  if (gridView) {
    return (
      <>
        <SectionCount count={albums.length} label="Album" />
        <FlatList
          data={albums}
          keyExtractor={(i) => i.id}
          scrollEnabled={false}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-around", paddingHorizontal: 16 }}
          renderItem={({ item }) => (
            <AlbumRow item={item} onPress={() => {}} gridMode />
          )}
        />
      </>
    );
  }

  return (
    <>
      <SectionCount count={albums.length} label="Album" />
      <FlatList
        data={albums}
        keyExtractor={(i) => i.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <AlbumRow item={item} onPress={() => {}} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(80) }} />}
      />
    </>
  );
}

function ArtistsPanel({
  sort, router,
}: {
  sort: string; router: ReturnType<typeof useRouter>;
}) {
  const [gridView, setGridView] = useState(false);
  const artists = useDerivedArtists(sort);

  if (artists.length === 0) {
    return (
      <EmptyState
        icon="person-outline"
        title="No artists yet"
        sub="Artists are derived from your downloaded songs and favorite tracks."
      />
    );
  }

  if (gridView) {
    return (
      <>
        <SectionCount count={artists.length} label="Artist" />
        <FlatList
          data={artists}
          keyExtractor={(i) => i.id}
          scrollEnabled={false}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-around", paddingHorizontal: 16 }}
          renderItem={({ item }) => (
            <ArtistRow item={item} onPress={() => {}} gridMode />
          )}
        />
      </>
    );
  }

  return (
    <>
      <SectionCount count={artists.length} label="Artist" />
      <FlatList
        data={artists}
        keyExtractor={(i) => i.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <ArtistRow item={item} onPress={() => {}} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(80) }} />}
      />
    </>
  );
}

function SongsPanel({
  sort, router,
}: {
  sort: string; router: ReturnType<typeof useRouter>;
}) {
  const favorites = useSortedFavorites(sort);
  const activeTrack = useActiveTrack();
  const { playAudio } = useMusicPlayer();

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon="heart-outline"
        title="No songs saved yet"
        sub="Heart songs from the streaming feed or import music from your device."
        actionLabel="Go to Home"
        onAction={() => router.push("/(tabs)")}
      />
    );
  }

  return (
    <>
      <SectionCount count={favorites.length} label="Song" />
      <FlatList
        data={favorites}
        keyExtractor={(i) => i.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <SongRow
            item={item}
            isPlaying={activeTrack?.id === item.id}
            onPress={() => { playAudio(item, favorites); router.navigate("/player"); }}
            onMore={() => {
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
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(76) }} />}
      />
    </>
  );
}

function DownloadsPanel({
  sort, router,
}: {
  sort: string; router: ReturnType<typeof useRouter>;
}) {
  const tracks = useSortedDownloads(sort);
  const activeDownloads = useActiveDownloads();
  const activeTrack = useActiveTrack();
  const { playDownloadedSong } = useMusicPlayer();

  return (
    <>
      {/* Active downloads progress section */}
      {activeDownloads.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[scStyles.text, { marginBottom: 4, color: C.goldShimmer }]}>
            Downloading ({activeDownloads.length})
          </Text>
          {activeDownloads.map((dl) => (
            <ActiveDownloadItem key={dl.id} song={dl} />
          ))}
        </View>
      )}

      {tracks.length === 0 && activeDownloads.length === 0 ? (
        <EmptyState
          icon="cloud-download-outline"
          title="No downloads yet"
          sub="Download songs and albums to listen offline anywhere, even without a connection."
        />
      ) : (
        <>
          <SectionCount count={tracks.length} label="Download" />
          <FlatList
            data={tracks}
            keyExtractor={(i) => i.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <DownloadRow
                item={item}
                isPlaying={activeTrack?.id === item.id && activeTrack?.url === item.localTrackUri}
                onPress={() => { playDownloadedSong(item, tracks); router.navigate("/player"); }}
                onMore={() => {
                  router.push({
                    pathname: "/(modals)/menu",
                    params: {
                      songData: JSON.stringify({
                        id: item.id, title: item.title,
                        artist: item.artist,
                        thumbnail: item.localArtworkUri,
                        url: item.localTrackUri,
                        duration: item.duration,
                      }),
                      type: "downloadedSong",
                    },
                  });
                }}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(80) }} />}
          />
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LibraryScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const activeTrack = useActiveTrack();
  const lastActiveTrack = useLastActiveTrack();
  const { playPlaylist, playAllDownloadedSongs } = useMusicPlayer();

  const [activeTab, setActiveTab] = useState<Tab>("Playlists");
  const [sort, setSort] = useState<Record<Tab, string>>({
    Playlists: "Recent",
    Albums: "Recent",
    Artists: "Recent",
    Songs: "Recent",
    Downloads: "Recent",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  // Live counts for quick-access badges
  const { favoriteTracks } = useFavorites();
  const downloadedTracks = useDownloadedTracks();
  const playlists = usePlaylists();
  const playlistCount = playlists ? Object.keys(playlists).length : 0;

  const isFloatingPlayerVisible = !!(activeTrack ?? lastActiveTrack);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }, []);

  const handleTabPress = (tab: Tab) => {
    triggerHaptic();
    setActiveTab(tab);
  };

  const handleCreatePlaylist = () => {
    triggerHaptic();
    router.push("/(modals)/createPlaylist");
  };

  const handleShuffleAll = async () => {
    triggerHaptic();
    if (activeTab === "Songs" && favoriteTracks.length > 0) {
      await playPlaylist([...favoriteTracks].sort(() => Math.random() - 0.5));
      router.navigate("/player");
    } else if (activeTab === "Downloads" && downloadedTracks.length > 0) {
      await playAllDownloadedSongs([...downloadedTracks].sort(() => Math.random() - 0.5));
      router.navigate("/player");
    }
  };

  const activeSort = sort[activeTab];
  const setActiveSort = (s: string) =>
    setSort((prev) => ({ ...prev, [activeTab]: s }));

  const showShuffle = activeTab === "Songs" || activeTab === "Downloads";
  const showViewToggle = activeTab === "Albums" || activeTab === "Artists";

  return (
    <View style={[lStyles.container, { paddingTop: top }]}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <View style={lStyles.pageHeader}>
        <Text style={lStyles.pageTitle}>Your Library</Text>
        <View style={lStyles.headerActions}>
          <TouchableOpacity
            style={lStyles.headerBtn}
            onPress={() => { triggerHaptic(); setSearchFocused((v) => !v); }}
            hitSlop={10}
          >
            <Ionicons name="search" size={moderateScale(20)} color={C.goldShimmer} />
          </TouchableOpacity>
          <TouchableOpacity
            style={lStyles.headerBtn}
            onPress={() => { triggerHaptic(); router.push("/(modals)/settings"); }}
            hitSlop={10}
          >
            <Ionicons name="settings-outline" size={moderateScale(20)} color={C.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Inline search bar ─────────────────────────────────────────────── */}
      {searchFocused && (
        <View style={lStyles.searchWrap}>
          <Ionicons name="search" size={moderateScale(16)} color={C.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={lStyles.searchInput}
            placeholder={`Search in ${activeTab.toLowerCase()}…`}
            placeholderTextColor={C.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={moderateScale(16)} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Gold hairline ─────────────────────────────────────────────────── */}
      <View style={lStyles.divider} />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.gold}
            colors={[C.gold]}
          />
        }
        contentContainerStyle={{ paddingBottom: (isFloatingPlayerVisible ? verticalScale(140) : 90) + bottom }}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Quick access pills ─────────────────────────────────────────── */}
        {!searchFocused && (
          <View style={lStyles.quickSection}>
            <QuickPill
              icon="heart"
              label="Favourites"
              sub="Songs you've liked"
              badge={favoriteTracks.length}
              onPress={() => router.push("/(library)/favorites")}
            />
            <QuickPill
              icon="cloud-download-outline"
              label="Downloads"
              sub="Offline listening"
              badge={downloadedTracks.length}
              tint={C.gold}
              onPress={() => router.push("/(library)/downloads")}
            />
            <QuickPill
              icon="time-outline"
              label="Recently Played"
              sub="Jump back in"
              onPress={() => router.push("/(modals)/recentlyPlayed")}
            />
            <QuickPill
              icon="trending-up-outline"
              label="Most Played"
              sub="Your top tracks"
              onPress={() => router.push("/(modals)/mostPlayed")}
            />
            <QuickPill
              icon="cellphone"
              label="Local Music"
              sub="Files on this device"
              tint={C.local}
              onPress={() => router.push("/(modals)/localMusic")}
            />
          </View>
        )}

        {/* ── Tab row ───────────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={lStyles.tabRow}
        >
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <TouchableOpacity
                key={tab}
                style={[lStyles.tabPill, active && lStyles.tabPillActive]}
                onPress={() => handleTabPress(tab)}
                activeOpacity={0.75}
              >
                <Text style={[lStyles.tabText, active && lStyles.tabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Sort + view row ────────────────────────────────────────────── */}
        <SortRow
          options={SORT_OPTIONS[activeTab]}
          active={activeSort}
          onSelect={setActiveSort}
          showViewToggle={showViewToggle}
          onShuffle={showShuffle ? handleShuffleAll : undefined}
        />

        {/* ── Tab content ───────────────────────────────────────────────── */}
        <View style={lStyles.panel}>
          {activeTab === "Playlists" && (
            <PlaylistsPanel sort={activeSort} router={router} onCreatePlaylist={handleCreatePlaylist} />
          )}
          {activeTab === "Albums" && (
            <AlbumsPanel sort={activeSort} router={router} />
          )}
          {activeTab === "Artists" && (
            <ArtistsPanel sort={activeSort} router={router} />
          )}
          {activeTab === "Songs" && (
            <SongsPanel sort={activeSort} router={router} />
          )}
          {activeTab === "Downloads" && (
            <DownloadsPanel sort={activeSort} router={router} />
          )}
        </View>

      </ScrollView>

      {/* ── Create playlist FAB ─────────────────────────────────────────── */}
      {activeTab === "Playlists" && (
        <TouchableOpacity
          style={[lStyles.fab, { bottom: (isFloatingPlayerVisible ? verticalScale(138) : 60) + bottom + 8 }]}
          onPress={handleCreatePlaylist}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={moderateScale(26)} color={C.bg} />
        </TouchableOpacity>
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const lStyles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: "20@s",
    paddingTop: "8@vs",
    paddingBottom: "14@vs",
  },
  pageTitle: {
    fontSize: "28@ms",
    fontFamily: "Meriva",
    color: C.text,
    letterSpacing: 0.5,
  },
  headerActions: { flexDirection: "row", gap: "8@s" },
  headerBtn: {
    width: "36@ms",
    height: "36@ms",
    borderRadius: "18@ms",
    backgroundColor: C.goldFill,
    borderWidth: 0.5,
    borderColor: C.borderGold,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: "16@s",
    marginBottom: "8@vs",
    backgroundColor: C.surfaceRaised,
    borderRadius: "12@ms",
    borderWidth: 0.5,
    borderColor: C.border,
    paddingHorizontal: "12@s",
    paddingVertical: "8@vs",
  },
  searchInput: {
    flex: 1,
    fontSize: "14@ms",
    color: C.text,
  },
  divider: {
    height: 0.5,
    backgroundColor: C.borderGold,
    marginHorizontal: "20@s",
    marginBottom: "4@vs",
  },
  quickSection: {
    paddingHorizontal: "16@s",
    paddingTop: "16@vs",
    paddingBottom: "4@vs",
  },
  tabRow: {
    paddingHorizontal: "16@s",
    paddingVertical: "12@vs",
    gap: "8@s",
  },
  tabPill: {
    paddingHorizontal: "18@s",
    paddingVertical: "8@vs",
    borderRadius: "24@ms",
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  tabPillActive: {
    backgroundColor: C.goldFill,
    borderColor: C.borderGold,
  },
  tabText: {
    fontSize: "13@ms",
    color: C.textSub,
    fontWeight: "600",
  },
  tabTextActive: { color: C.gold },
  panel: { marginTop: "4@vs" },
  fab: {
    position: "absolute",
    right: "20@s",
    width: "52@ms",
    height: "52@ms",
    borderRadius: "26@ms",
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
});