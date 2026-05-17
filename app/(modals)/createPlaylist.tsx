/**
 * (modals)/createPlaylist.tsx
 *
 * Used for both creating a new playlist and renaming an existing one.
 *
 * Params (optional):
 *   editId: string — if present, loads the existing playlist name for rename
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { usePlaylists } from "@/store/library";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";

export default function CreatePlaylistModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { colors } = useTheme();

  const playlists = usePlaylists();
  const isEditing = !!editId;
  const existingName = editId && playlists ? (playlists[editId]?.name ?? "") : "";

  const [name, setName] = useState(existingName);

  useEffect(() => {
    if (existingName) setName(existingName);
  }, [existingName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name required", "Please enter a playlist name.");
      return;
    }
    triggerHaptic();

    if (isEditing && editId) {
      // TODO: dispatch renamePlaylist(editId, trimmed)
    } else {
      // TODO: dispatch createPlaylist(trimmed)
    }

    router.back();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottom + 24 }]}>
        <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />

        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {isEditing ? "Rename Playlist" : "New Playlist"}
          </Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.textSub} />
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

        <View style={styles.inputSection}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Playlist Name</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderGold }]}>
            <Ionicons name="musical-notes-outline" size={18} color={colors.textMuted} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Morning Vibes"
              placeholderTextColor={colors.textMuted}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {name.length > 0 && (
              <TouchableOpacity onPress={() => setName("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.charCount, { color: colors.textMuted }]}>{name.length}/60</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.gold }, !name.trim() && styles.saveBtnDisabled]}
          onPress={handleSave}
          activeOpacity={0.85}
          disabled={!name.trim()}
        >
          <Ionicons name={isEditing ? "checkmark" : "add"} size={18} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.saveBtnText}>{isEditing ? "Save Changes" : "Create Playlist"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  divider: { height: 0.5, marginBottom: 24 },
  inputSection: { marginBottom: 32 },
  inputLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 0.5, paddingHorizontal: 14, paddingVertical: 12 },
  input: { flex: 1, fontSize: 15 },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 6 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 28, paddingVertical: 15, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#000" },
});
