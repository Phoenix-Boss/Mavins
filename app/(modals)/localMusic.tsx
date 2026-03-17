/**
 * local/index.tsx — Local Music Library
 *
 * PowerAmp-style folder management:
 *   - On first launch: "Add Folders" prompt (no spinner, no auto-scan)
 *   - Folder picker browses MediaLibrary albums
 *   - Each registered folder is watched via MediaStore ContentObserver
 *   - File additions/deletions reflect instantly (no manual refresh)
 *   - Tracks are grouped by folder with sub-tabs: All · Albums · Artists
 *   - Swipe folder card to remove (also purges its tracks from store)
 *
 * Design: matches Mavin dark luxury — black base, gold accents, Meriva font.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
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
import * as MediaLibrary from "expo-media-library";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { useActiveTrack } from "react-native-track-player";
import { useMediaStore, type LocalTrack, type WatchedFolder } from "@/hooks/useMediaStore";

// ─────────────────────────────────────────────────────────────────────────────
// Palette (mirrors LibraryScreen)
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
  local: "#4A90E2",
  localFill: "rgba(74,144,226,0.1)",
  localBorder: "rgba(74,144,226,0.22)",
  danger: "#E05C5C",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CoverArt
// ─────────────────────────────────────────────────────────────────────────────

function CoverArt({ uri, size, radius = 8, circle = false }: {
  uri?: string; size: number; radius?: number; circle?: boolean;
}) {
  const r = circle ? size / 2 : radius;
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r }} />;
  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
      borderWidth: 0.5, borderColor: C.border,
    }}>
      <Ionicons name="musical-notes" size={size * 0.38} color={C.textMuted} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// First-launch empty state
// ─────────────────────────────────────────────────────────────────────────────

function NoFoldersState({ onAddFolder }: { onAddFolder: () => void }) {
  return (
    <View style={emStyles.container}>
      {/* Decorative rings */}
      <View style={emStyles.ring3} />
      <View style={emStyles.ring2} />
      <View style={emStyles.ring1} />
      <View style={emStyles.iconWrap}>
        <MaterialCommunityIcons name="folder-music-outline" size={moderateScale(44)} color={C.local} />
      </View>

      <Text style={emStyles.headline}>Your Local Library</Text>
      <Text style={emStyles.body}>
        Mavin watches folders you choose — just like PowerAmp. Add a folder once and any
        music you copy in or delete will automatically appear or disappear. No refresh needed.
      </Text>

      <View style={emStyles.featureList}>
        {[
          { icon: "eye-outline", text: "Real-time sync via MediaStore" },
          { icon: "folder-open-outline", text: "You control which folders are scanned" },
          { icon: "wifi-off-outline", text: "Plays fully offline — no internet needed" },
          { icon: "flash-outline", text: "Zero-spinner instant launch from cache" },
        ].map(({ icon, text }) => (
          <View key={icon} style={emStyles.featureRow}>
            <Ionicons name={icon as any} size={moderateScale(15)} color={C.local} style={{ marginRight: 10 }} />
            <Text style={emStyles.featureText}>{text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={emStyles.addBtn} onPress={() => { triggerHaptic(); onAddFolder(); }} activeOpacity={0.85}>
        <Ionicons name="folder-open-outline" size={moderateScale(18)} color={C.bg} style={{ marginRight: 8 }} />
        <Text style={emStyles.addBtnText}>Add Music Folder</Text>
      </TouchableOpacity>
    </View>
  );
}

const emStyles = ScaledSheet.create({
  container: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: "32@s", paddingVertical: "40@vs",
  },
  ring3: {
    position: "absolute",
    width: "180@ms", height: "180@ms", borderRadius: "90@ms",
    borderWidth: 1, borderColor: "rgba(74,144,226,0.06)",
  },
  ring2: {
    position: "absolute",
    width: "130@ms", height: "130@ms", borderRadius: "65@ms",
    borderWidth: 1, borderColor: "rgba(74,144,226,0.1)",
  },
  ring1: {
    position: "absolute",
    width: "88@ms", height: "88@ms", borderRadius: "44@ms",
    borderWidth: 1, borderColor: "rgba(74,144,226,0.18)",
  },
  iconWrap: {
    width: "72@ms", height: "72@ms", borderRadius: "36@ms",
    backgroundColor: "rgba(74,144,226,0.12)",
    alignItems: "center", justifyContent: "center",
    marginBottom: "24@vs",
  },
  headline: {
    fontSize: "22@ms", fontFamily: "Meriva", color: C.text,
    letterSpacing: 0.5, marginBottom: "12@vs", textAlign: "center",
  },
  body: {
    fontSize: "13@ms", color: C.textSub, textAlign: "center",
    lineHeight: "20@ms", marginBottom: "24@vs",
  },
  featureList: {
    width: "100%", marginBottom: "32@vs",
    backgroundColor: C.surfaceRaised, borderRadius: "14@ms",
    borderWidth: 0.5, borderColor: C.localBorder,
    paddingVertical: "12@vs", paddingHorizontal: "16@s",
  },
  featureRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: "7@vs",
  },
  featureText: { fontSize: "13@ms", color: C.textSub },
  addBtn: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.local, borderRadius: "28@ms",
    paddingHorizontal: "28@s", paddingVertical: "14@vs",
    shadowColor: C.local,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  addBtnText: { fontSize: "15@ms", color: C.bg, fontWeight: "700" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Folder picker modal
// ─────────────────────────────────────────────────────────────────────────────

function FolderPickerModal({
  visible,
  onClose,
  onAdd,
  watchedIds,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (album: MediaLibrary.Album) => Promise<void>;
  watchedIds: Set<string>;
}) {
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false })
      .then(setAlbums)
      .finally(() => setLoading(false));
  }, [visible]);

  const handleAdd = async (album: MediaLibrary.Album) => {
    triggerHaptic();
    setAdding(album.id);
    await onAdd(album);
    setAdding(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={fpStyles.backdrop} onPress={onClose} />
      <View style={fpStyles.sheet}>
        <View style={fpStyles.handle} />
        <View style={fpStyles.header}>
          <Text style={fpStyles.title}>Choose Folders</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={moderateScale(20)} color={C.textSub} />
          </TouchableOpacity>
        </View>
        <Text style={fpStyles.hint}>
          Select folders to watch. Mavin will detect changes automatically.
        </Text>

        {loading ? (
          <View style={fpStyles.loadingWrap}>
            <ActivityIndicator color={C.local} size="small" />
            <Text style={fpStyles.loadingText}>Scanning device…</Text>
          </View>
        ) : (
          <FlatList
            data={albums}
            keyExtractor={(a) => a.id}
            contentContainerStyle={fpStyles.list}
            renderItem={({ item }) => {
              const isAdded = watchedIds.has(item.id);
              const isLoading = adding === item.id;
              return (
                <TouchableOpacity
                  style={[fpStyles.albumRow, isAdded && fpStyles.albumRowAdded]}
                  onPress={() => !isAdded && handleAdd(item)}
                  activeOpacity={isAdded ? 1 : 0.7}
                >
                  <View style={fpStyles.albumIcon}>
                    <Ionicons
                      name={isAdded ? "folder" : "folder-outline"}
                      size={moderateScale(20)}
                      color={isAdded ? C.local : C.textSub}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[fpStyles.albumName, isAdded && { color: C.local }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={fpStyles.albumCount}>{item.assetCount} items</Text>
                  </View>
                  {isLoading ? (
                    <ActivityIndicator size="small" color={C.local} />
                  ) : isAdded ? (
                    <View style={fpStyles.addedBadge}>
                      <Ionicons name="checkmark" size={moderateScale(12)} color={C.local} />
                      <Text style={fpStyles.addedText}>Added</Text>
                    </View>
                  ) : (
                    <View style={fpStyles.addBadge}>
                      <Ionicons name="add" size={moderateScale(14)} color={C.bg} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => (
              <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(52) }} />
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const fpStyles = ScaledSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  } as any,
  sheet: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    backgroundColor: C.surfaceRaised,
    borderTopLeftRadius: "20@ms",
    borderTopRightRadius: "20@ms",
    borderWidth: 0.5,
    borderColor: C.localBorder,
    paddingBottom: "40@vs",
    maxHeight: "75%",
  },
  handle: {
    width: "36@ms", height: "4@vs", borderRadius: "2@ms",
    backgroundColor: C.surfaceHigh, alignSelf: "center", marginTop: "12@vs",
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: "20@s", paddingTop: "16@vs", paddingBottom: "8@vs",
  },
  title: { fontSize: "18@ms", fontFamily: "Meriva", color: C.text, letterSpacing: 0.4 },
  hint: { fontSize: "12@ms", color: C.textMuted, paddingHorizontal: "20@s", marginBottom: "8@vs" },
  list: { paddingBottom: "20@vs" },
  loadingWrap: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: "40@vs", gap: "12@s",
  },
  loadingText: { fontSize: "13@ms", color: C.textSub },
  albumRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: "20@s", paddingVertical: "12@vs",
  },
  albumRowAdded: { opacity: 0.7 },
  albumIcon: {
    width: "36@ms", height: "36@ms", borderRadius: "8@ms",
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
    marginRight: "12@s",
  },
  albumName: { fontSize: "14@ms", color: C.text, fontWeight: "600" },
  albumCount: { fontSize: "11@ms", color: C.textMuted, marginTop: "2@vs" },
  addedBadge: {
    flexDirection: "row", alignItems: "center", gap: "4@s",
    backgroundColor: C.localFill, borderRadius: "12@ms",
    paddingHorizontal: "8@s", paddingVertical: "4@vs",
    borderWidth: 0.5, borderColor: C.localBorder,
  },
  addedText: { fontSize: "11@ms", color: C.local, fontWeight: "600" },
  addBadge: {
    width: "24@ms", height: "24@ms", borderRadius: "12@ms",
    backgroundColor: C.local, alignItems: "center", justifyContent: "center",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Watched folder card
// ─────────────────────────────────────────────────────────────────────────────

function FolderCard({ folder, trackCount, onRemove, onPress }: {
  folder: WatchedFolder;
  trackCount: number;
  onRemove: () => void;
  onPress: () => void;
}) {
  const handleLongPress = () => {
    triggerHaptic();
    Alert.alert(
      "Remove Folder",
      `Remove "${folder.name}" from your library? The files on your device won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: onRemove },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={fcStyles.card}
      onPress={() => { triggerHaptic(); onPress(); }}
      onLongPress={handleLongPress}
      activeOpacity={0.75}
      delayLongPress={500}
    >
      <View style={fcStyles.iconWrap}>
        <MaterialCommunityIcons name="folder-music" size={moderateScale(28)} color={C.local} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={fcStyles.name} numberOfLines={1}>{folder.name}</Text>
        <Text style={fcStyles.meta}>{trackCount} tracks · watching</Text>
      </View>
      <View style={fcStyles.liveDot} />
      <Ionicons name="chevron-forward" size={moderateScale(14)} color={C.textMuted} />
    </TouchableOpacity>
  );
}

const fcStyles = ScaledSheet.create({
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surfaceRaised, borderRadius: "14@ms",
    borderWidth: 0.5, borderColor: C.localBorder,
    paddingVertical: "14@vs", paddingHorizontal: "14@s",
    marginBottom: "10@vs",
  },
  iconWrap: {
    width: "46@ms", height: "46@ms", borderRadius: "12@ms",
    backgroundColor: C.localFill, alignItems: "center", justifyContent: "center",
    marginRight: "12@s", borderWidth: 0.5, borderColor: C.localBorder,
  },
  name: { fontSize: "14@ms", color: C.text, fontWeight: "600" },
  meta: { fontSize: "11@ms", color: C.textSub, marginTop: "3@vs" },
  liveDot: {
    width: "7@ms", height: "7@ms", borderRadius: "4@ms",
    backgroundColor: C.local, marginRight: "10@s", opacity: 0.9,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Track row
// ─────────────────────────────────────────────────────────────────────────────

function TrackRow({ item, isPlaying, onPress, onMore }: {
  item: LocalTrack; isPlaying: boolean; onPress: () => void; onMore: () => void;
}) {
  const SIZE = moderateScale(48);
  return (
    <TouchableOpacity style={trStyles.row} onPress={() => { triggerHaptic(); onPress(); }} activeOpacity={0.7}>
      <View>
        <CoverArt uri={item.artworkUri} size={SIZE} />
        {isPlaying && (
          <View style={trStyles.playDot}>
            <Ionicons name="musical-note" size={moderateScale(8)} color={C.gold} />
          </View>
        )}
      </View>
      <View style={trStyles.info}>
        <Text style={[trStyles.title, isPlaying && { color: C.gold }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={trStyles.sub} numberOfLines={1}>
          {item.artist} · {formatDuration(item.duration)}
        </Text>
      </View>
      <TouchableOpacity hitSlop={12} onPress={() => { triggerHaptic(); onMore(); }}>
        <Ionicons name="ellipsis-vertical" size={moderateScale(18)} color={C.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const trStyles = ScaledSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: "16@s", paddingVertical: "10@vs",
  },
  info: { flex: 1, marginLeft: "12@s", marginRight: "8@s" },
  title: { fontSize: "14@ms", color: C.text, fontWeight: "600" },
  sub: { fontSize: "12@ms", color: C.textSub, marginTop: "2@vs" },
  playDot: {
    position: "absolute", bottom: -2, right: -2,
    width: "16@ms", height: "16@ms", borderRadius: "8@ms",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderGold,
    alignItems: "center", justifyContent: "center",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tabs: All Tracks · Albums · Artists
// ─────────────────────────────────────────────────────────────────────────────

const SUB_TABS = ["All Tracks", "Albums", "Artists"] as const;
type SubTab = (typeof SUB_TABS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

// Need StyleSheet for backdrop absolute fill
import { StyleSheet } from "react-native";

export default function LocalMusicScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const activeTrack = useActiveTrack();
  const { playLocalTrack } = useMusicPlayer();

  const {
    tracks, folders, hydrated, permissionGranted,
    addFolder, removeFolder, tracksByFolder,
  } = useMediaStore();

  const [folderPickerVisible, setFolderPickerVisible] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("All Tracks");
  const [activeFolderFilter, setActiveFolderFilter] = useState<string | null>(null); // null = all

  const watchedIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);

  // Filtered tracks (by folder if one is selected)
  const displayTracks = useMemo(() => {
    if (!activeFolderFilter) return tracks;
    return tracks.filter((t) => t.albumId === activeFolderFilter);
  }, [tracks, activeFolderFilter]);

  // Derived albums
  const albums = useMemo(() => {
    const map = new Map<string, { name: string; artist: string; cover?: string; count: number }>();
    displayTracks.forEach((t) => {
      const key = t.album || "Unknown Album";
      if (!map.has(key)) map.set(key, { name: key, artist: t.artist, cover: t.artworkUri, count: 1 });
      else map.get(key)!.count++;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [displayTracks]);

  // Derived artists
  const artists = useMemo(() => {
    const map = new Map<string, { name: string; cover?: string; count: number }>();
    displayTracks.forEach((t) => {
      const name = t.artist || "Unknown Artist";
      if (!map.has(name)) map.set(name, { name, cover: t.artworkUri, count: 1 });
      else map.get(name)!.count++;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [displayTracks]);

  const handleShuffleAll = useCallback(async () => {
    if (displayTracks.length === 0) return;
    triggerHaptic();
    const shuffled = [...displayTracks].sort(() => Math.random() - 0.5);
    await playLocalTrack(shuffled[0], shuffled);
    router.navigate("/player");
  }, [displayTracks]);

  const hasFolders = folders.length > 0;

  return (
    <View style={[scStyles.container, { paddingTop: top }]}>

      {/* Header */}
      <View style={scStyles.header}>
        <TouchableOpacity
          style={scStyles.backBtn}
          onPress={() => { triggerHaptic(); router.back(); }}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={moderateScale(20)} color={C.text} />
        </TouchableOpacity>
        <Text style={scStyles.title}>Local Music</Text>
        <View style={scStyles.headerRight}>
          {hasFolders && (
            <TouchableOpacity
              style={scStyles.headerBtn}
              onPress={() => { triggerHaptic(); handleShuffleAll(); }}
              hitSlop={10}
            >
              <Ionicons name="shuffle" size={moderateScale(18)} color={C.textSub} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[scStyles.headerBtn, { backgroundColor: C.localFill, borderColor: C.localBorder }]}
            onPress={() => { triggerHaptic(); setFolderPickerVisible(true); }}
            hitSlop={10}
          >
            <Ionicons name="folder-open-outline" size={moderateScale(18)} color={C.local} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={scStyles.divider} />

      {/* Folder picker modal */}
      <FolderPickerModal
        visible={folderPickerVisible}
        onClose={() => setFolderPickerVisible(false)}
        onAdd={addFolder}
        watchedIds={watchedIds}
      />

      {!hasFolders ? (
        <NoFoldersState onAddFolder={() => setFolderPickerVisible(true)} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: verticalScale(100) + bottom }}
          keyboardShouldPersistTaps="handled"
        >

          {/* Watched folder chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={scStyles.folderRow}
          >
            <TouchableOpacity
              style={[scStyles.folderChip, activeFolderFilter === null && scStyles.folderChipActive]}
              onPress={() => { triggerHaptic(); setActiveFolderFilter(null); }}
              activeOpacity={0.7}
            >
              <Text style={[scStyles.folderChipText, activeFolderFilter === null && scStyles.folderChipTextActive]}>
                All ({tracks.length})
              </Text>
            </TouchableOpacity>
            {folders.map((f) => {
              const count = (tracksByFolder.get(f.id) ?? []).length;
              const isActive = activeFolderFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[scStyles.folderChip, isActive && scStyles.folderChipActive]}
                  onPress={() => { triggerHaptic(); setActiveFolderFilter(isActive ? null : f.id); }}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name="folder-music-outline"
                    size={moderateScale(12)}
                    color={isActive ? C.local : C.textMuted}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[scStyles.folderChipText, isActive && scStyles.folderChipTextActive]}>
                    {f.name} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Folder management section */}
          <View style={scStyles.sectionHeader}>
            <Text style={scStyles.sectionLabel}>Watched Folders</Text>
            <TouchableOpacity onPress={() => { triggerHaptic(); setFolderPickerVisible(true); }}>
              <Text style={scStyles.sectionAction}>+ Add</Text>
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: scale(16), marginBottom: verticalScale(8) }}>
            {folders.map((f) => (
              <FolderCard
                key={f.id}
                folder={f}
                trackCount={(tracksByFolder.get(f.id) ?? []).length}
                onRemove={() => removeFolder(f.id)}
                onPress={() => setActiveFolderFilter(f.id)}
              />
            ))}
          </View>

          {/* Sub-tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={scStyles.subTabRow}
          >
            {SUB_TABS.map((tab) => {
              const active = tab === activeSubTab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[scStyles.subTab, active && scStyles.subTabActive]}
                  onPress={() => { triggerHaptic(); setActiveSubTab(tab); }}
                  activeOpacity={0.75}
                >
                  <Text style={[scStyles.subTabText, active && scStyles.subTabTextActive]}>{tab}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Content */}
          {activeSubTab === "All Tracks" && (
            <>
              {displayTracks.length === 0 ? (
                <View style={{ paddingVertical: verticalScale(40), alignItems: "center" }}>
                  <Text style={{ color: C.textMuted, fontSize: moderateScale(13) }}>No tracks found in this folder</Text>
                </View>
              ) : (
                <FlatList
                  data={displayTracks}
                  keyExtractor={(i) => i.id}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TrackRow
                      item={item}
                      isPlaying={activeTrack?.id === item.id}
                      onPress={async () => {
                        await playLocalTrack(item, displayTracks);
                        router.navigate("/player");
                      }}
                      onMore={() => {
                        router.push({
                          pathname: "/(modals)/menu",
                          params: {
                            songData: JSON.stringify({
                              id: item.id,
                              title: item.title,
                              artist: item.artist,
                              thumbnail: item.artworkUri,
                              url: item.uri,
                              duration: item.duration,
                            }),
                            type: "localSong",
                          },
                        });
                      }}
                    />
                  )}
                  ItemSeparatorComponent={() => (
                    <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(76) }} />
                  )}
                />
              )}
            </>
          )}

          {activeSubTab === "Albums" && (
            <FlatList
              data={albums}
              keyExtractor={(i) => i.name}
              scrollEnabled={false}
              numColumns={2}
              columnWrapperStyle={{ justifyContent: "space-around", paddingHorizontal: scale(16) }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={gridStyles.cell}
                  onPress={() => triggerHaptic()}
                  activeOpacity={0.7}
                >
                  <CoverArt uri={item.cover} size={moderateScale(90)} />
                  <Text style={gridStyles.cellTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={gridStyles.cellSub} numberOfLines={1}>{item.artist} · {item.count} tracks</Text>
                </TouchableOpacity>
              )}
            />
          )}

          {activeSubTab === "Artists" && (
            <FlatList
              data={artists}
              keyExtractor={(i) => i.name}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={trStyles.row}
                  onPress={() => triggerHaptic()}
                  activeOpacity={0.7}
                >
                  <CoverArt uri={item.cover} size={moderateScale(52)} circle />
                  <View style={trStyles.info}>
                    <Text style={trStyles.title} numberOfLines={1}>{item.name}</Text>
                    <Text style={trStyles.sub} numberOfLines={1}>{item.count} tracks</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={moderateScale(14)} color={C.textMuted} />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => (
                <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: scale(76) }} />
              )}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const gridStyles = ScaledSheet.create({
  cell: { width: "46%", alignItems: "center", paddingVertical: "12@vs" },
  cellTitle: { fontSize: "13@ms", color: C.text, fontWeight: "600", marginTop: "8@vs", textAlign: "center" },
  cellSub: { fontSize: "11@ms", color: C.textSub, marginTop: "2@vs", textAlign: "center" },
});

const scStyles = ScaledSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: "16@s", paddingTop: "6@vs", paddingBottom: "14@vs",
  },
  backBtn: {
    width: "36@ms", height: "36@ms", borderRadius: "18@ms",
    backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
    marginRight: "12@s",
  },
  title: {
    flex: 1, fontSize: "22@ms", fontFamily: "Meriva",
    color: C.text, letterSpacing: 0.5,
  },
  headerRight: { flexDirection: "row", gap: "8@s" },
  headerBtn: {
    width: "36@ms", height: "36@ms", borderRadius: "18@ms",
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  divider: {
    height: 0.5, backgroundColor: C.localBorder,
    marginHorizontal: "20@s", marginBottom: "4@vs",
  },
  folderRow: {
    paddingHorizontal: "16@s", paddingVertical: "12@vs", gap: "8@s",
  },
  folderChip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: "14@s", paddingVertical: "6@vs",
    borderRadius: "20@ms", backgroundColor: C.surface,
    borderWidth: 0.5, borderColor: C.border,
  },
  folderChipActive: { backgroundColor: C.localFill, borderColor: C.localBorder },
  folderChipText: { fontSize: "12@ms", color: C.textSub, fontWeight: "500" },
  folderChipTextActive: { color: C.local },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: "16@s", paddingBottom: "8@vs",
  },
  sectionLabel: { fontSize: "12@ms", color: C.textMuted, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  sectionAction: { fontSize: "13@ms", color: C.local, fontWeight: "600" },
  subTabRow: {
    paddingHorizontal: "16@s", paddingVertical: "10@vs", gap: "8@s",
  },
  subTab: {
    paddingHorizontal: "18@s", paddingVertical: "8@vs",
    borderRadius: "24@ms", backgroundColor: C.surface,
    borderWidth: 0.5, borderColor: C.border,
  },
  subTabActive: { backgroundColor: C.localFill, borderColor: C.localBorder },
  subTabText: { fontSize: "13@ms", color: C.textSub, fontWeight: "600" },
  subTabTextActive: { color: C.local },
});