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
import { useTheme } from "@/contexts/ThemeContext";

export default function AddToPlaylistModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { songId, songTitle } = useLocalSearchParams<{
    songId: string;
    songTitle: string;
  }>();
  const { colors } = useTheme();

  const playlistsMap = usePlaylists();
  const playlists = useMemo(
    () => (playlistsMap ? Object.values(playlistsMap) : []),
    [playlistsMap]
  );

  const handleAdd = (playlistId: string, playlistName: string) => {
    triggerHaptic();
    Alert.alert("Added", `"${songTitle}" added to "${playlistName}"`);
    router.back();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottom + 16 }]}>
      <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />
      
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Add to Playlist</Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textSub} />
        </TouchableOpacity>
      </View>
      
      {songTitle && (
        <Text style={[styles.subtitle, { color: colors.textSub }]} numberOfLines={1}>
          "{songTitle}"
        </Text>
      )}

      <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

      <TouchableOpacity
        style={[styles.createRow, { borderBottomColor: colors.border }]}
        onPress={() => {
          triggerHaptic();
          router.back();
          router.push("/(modals)/createPlaylist");
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.createIcon, { backgroundColor: `${colors.gold}15`, borderColor: `${colors.gold}40` }]}>
          <Ionicons name="add" size={20} color={colors.gold} />
        </View>
        <Text style={[styles.createLabel, { color: colors.gold }]}>New Playlist</Text>
      </TouchableOpacity>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>No playlists yet. Create one above.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => handleAdd(item.id, item.name)}
            activeOpacity={0.7}
          >
            {item.thumbnail ? (
              <Image source={{ uri: item.thumbnail }} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Ionicons name="musical-notes" size={18} color={colors.textMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.rowSub, { color: colors.textSub }]}>{item.trackCount} tracks</Text>
            </View>
            <Ionicons name="add-circle-outline" size={22} color={colors.gold} />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 0.5, backgroundColor: colors.border, marginLeft: 68 }} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12, paddingHorizontal: 16, marginBottom: 12 },
  divider: { height: 0.5, marginHorizontal: 16, marginBottom: 8 },
  createRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  createIcon: { width: 44, height: 44, borderRadius: 10, borderWidth: 0.5, alignItems: "center", justifyContent: "center", marginRight: 12 },
  createLabel: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  cover: { width: 44, height: 44, borderRadius: 8, marginRight: 12 },
  coverPlaceholder: { alignItems: "center", justifyContent: "center", borderWidth: 0.5 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 32 },
});
