/**
 * (modals)/deletePlaylist.tsx
 *
 * Receives params:
 *   playlistName: string  (the playlist id)
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { usePlaylists } from "@/store/library";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";

export default function DeletePlaylistModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { playlistName: playlistId } = useLocalSearchParams<{ playlistName: string }>();
  const { colors } = useTheme();

  const playlists = usePlaylists();
  const playlist = playlists && playlistId ? playlists[playlistId] : null;
  const displayName = playlist?.name ?? playlistId ?? "this playlist";
  const trackCount = playlist?.trackCount ?? 0;

  const handleDelete = () => {
    triggerHaptic();
    router.back();
    router.back();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottom + 24 }]}>
      <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />

      <View style={[styles.iconWrap, { backgroundColor: `${colors.error}15`, borderColor: `${colors.error}40` }]}>
        <Ionicons name="trash-outline" size={32} color={colors.error} />
      </View>

      <Text style={[styles.heading, { color: colors.text }]}>Delete Playlist?</Text>
      <Text style={[styles.body, { color: colors.textSub }]}>
        <Text style={[styles.playlistName, { color: colors.text }]}>"{displayName}"</Text>
        {trackCount > 0
          ? ` (${trackCount} track${trackCount !== 1 ? "s" : ""}) will be permanently removed. This cannot be undone.`
          : " will be permanently removed. This cannot be undone."}
      </Text>

      <TouchableOpacity
        style={[styles.deleteBtn, { backgroundColor: colors.error }]}
        onPress={handleDelete}
        activeOpacity={0.85}
      >
        <Ionicons name="trash" size={16} color="#fff" style={{ marginRight: 6 }} />
        <Text style={styles.deleteBtnText}>Delete Playlist</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.cancelBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={[styles.cancelBtnText, { color: colors.textSub }]}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, alignItems: "center" },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 32 },
  iconWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  body: { fontSize: 14, textAlign: "center", lineHeight: 21, marginBottom: 32 },
  playlistName: { fontWeight: "600" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 28, paddingVertical: 15, width: "100%", marginBottom: 12, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  deleteBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  cancelBtn: { width: "100%", paddingVertical: 15, borderRadius: 28, borderWidth: 0.5, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "600" },
});
