/**
 * (modals)/addToPlaylist.tsx
 *
 * Receives params:
 *   songId:    string
 *   songTitle: string
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { usePlaylists } from "@/store/library";
import { triggerHaptic } from "@/helpers/haptics";

const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  surfaceRaised: "#1F1F1F",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
};

export default function AddToPlaylistModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { songId, songTitle } = useLocalSearchParams<{
    songId: string;
    songTitle: string;
  }>();

  const playlistsMap = usePlaylists();
  const playlists = useMemo(
    () => (playlistsMap ? Object.values(playlistsMap) : []),
    [playlistsMap]
  );

  const handleAdd = (playlistId: string, playlistName: string) => {
    triggerHaptic();
    // TODO: dispatch addSongToPlaylist(playlistId, songId) via Redux
    Alert.alert("Added", `"${songTitle}" added to "${playlistName}"`);
    router.back();
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom + 16 }]}>
      {/* Handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Add to Playlist</Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={20} color={C.textSub} />
        </TouchableOpacity>
      </View>
      {songTitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          "{songTitle}"
        </Text>
      )}

      <View style={styles.divider} />

      {/* Create new */}
      <TouchableOpacity
        style={styles.createRow}
        onPress={() => {
          triggerHaptic();
          router.back();
          router.push("/(modals)/createPlaylist");
        }}
        activeOpacity={0.7}
      >
        <View style={styles.createIcon}>
          <Ionicons name="add" size={20} color={C.gold} />
        </View>
        <Text style={styles.createLabel}>New Playlist</Text>
      </TouchableOpacity>

      {/* Existing playlists */}
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No playlists yet. Create one above.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => handleAdd(item.id, item.name)}
            activeOpacity={0.7}
          >
            {item.thumbnail ? (
              <Image
                source={{ uri: item.thumbnail }}
                style={styles.cover}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder]}>
                <Ionicons name="musical-notes" size={18} color={C.textMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>{item.trackCount} tracks</Text>
            </View>
            <Ionicons name="add-circle-outline" size={22} color={C.gold} />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 68 }} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: {
    alignSelf: "center", width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)", marginTop: 10, marginBottom: 16,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 6,
  },
  title: { fontSize: 18, fontWeight: "700", color: C.text },
  subtitle: { fontSize: 12, color: C.textSub, paddingHorizontal: 16, marginBottom: 12 },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginHorizontal: 16, marginBottom: 8 },
  createRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  createIcon: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: C.goldFill, borderWidth: 0.5, borderColor: C.borderGold,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  createLabel: { fontSize: 15, fontWeight: "600", color: C.gold },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  cover: { width: 44, height: 44, borderRadius: 8, marginRight: 12 },
  coverPlaceholder: { backgroundColor: C.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  rowTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  rowSub: { fontSize: 12, color: C.textSub, marginTop: 2 },
  empty: { fontSize: 13, color: C.textMuted, textAlign: "center", paddingVertical: 32 },
});