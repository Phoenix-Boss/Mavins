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
import { usePlaylists, useLibraryStore } from "@/store/library";
import { triggerHaptic } from "@/helpers/haptics";

const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  danger: "#E05C5C",
  dangerFill: "rgba(224,92,92,0.1)",
  dangerBorder: "rgba(224,92,92,0.25)",
};

export default function DeletePlaylistModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { playlistName: playlistId } = useLocalSearchParams<{
    playlistName: string;
  }>();

  const playlists = usePlaylists();
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);

  const playlist = playlists && playlistId ? playlists[playlistId] : null;
  const displayName = playlist?.name ?? playlistId ?? "this playlist";
  const trackCount = playlist?.trackCount ?? 0;

  const handleDelete = () => {
    triggerHaptic();
    if (playlistId) {
      deletePlaylist(playlistId);
    }
    router.back();
    router.back(); // also dismiss the library screen back to the playlists tab
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom + 24 }]}>
      {/* Handle */}
      <View style={styles.handle} />

      {/* Icon */}
      <View style={styles.iconWrap}>
        <Ionicons name="trash-outline" size={32} color={C.danger} />
      </View>

      {/* Text */}
      <Text style={styles.heading}>Delete Playlist?</Text>
      <Text style={styles.body}>
        <Text style={styles.playlistName}>&ldquo;{displayName}&rdquo;</Text>
        {trackCount > 0
          ? ` (${trackCount} track${trackCount !== 1 ? "s" : ""}) will be permanently removed. This cannot be undone.`
          : " will be permanently removed. This cannot be undone."}
      </Text>

      {/* Buttons */}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={handleDelete}
        activeOpacity={0.85}
      >
        <Ionicons name="trash" size={16} color="#fff" style={{ marginRight: 6 }} />
        <Text style={styles.deleteBtnText}>Delete Playlist</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelBtn}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: C.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, alignItems: "center",
  },
  handle: {
    alignSelf: "center", width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)", marginTop: 10, marginBottom: 32,
  },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.dangerFill, borderWidth: 1, borderColor: C.dangerBorder,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  heading: { fontSize: 20, fontWeight: "700", color: C.text, marginBottom: 10, textAlign: "center" },
  body: { fontSize: 14, color: C.textSub, textAlign: "center", lineHeight: 21, marginBottom: 32 },
  playlistName: { color: C.text, fontWeight: "600" },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: C.danger, borderRadius: 28,
    paddingVertical: 15, width: "100%", marginBottom: 12,
    shadowColor: C.danger, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  deleteBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  cancelBtn: {
    width: "100%", paddingVertical: 15, borderRadius: 28,
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    alignItems: "center",
  },
  cancelBtnText: { fontSize: 15, fontWeight: "600", color: C.textSub },
});