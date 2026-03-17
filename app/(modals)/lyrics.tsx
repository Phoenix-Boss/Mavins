/**
 * (modals)/lyrics.tsx
 *
 * Receives params:
 *   songId: string
 *   title:  string
 *   artist: string
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";

const C = {
  bg: "#000000",
  surface: "#0D0D0D",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
};

export default function LyricsModal() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { songId, title, artist } = useLocalSearchParams<{
    songId: string;
    title: string;
    artist: string;
  }>();

  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: fetch lyrics from your lyrics API using songId / title / artist
    const timer = setTimeout(() => {
      setLyrics(null); // replace null with real lyrics string
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [songId]);

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { triggerHaptic(); router.back(); }}
          style={styles.backBtn}
          hitSlop={10}
        >
          <Ionicons name="chevron-down" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{artist}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.divider} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={C.gold} />
          <Text style={styles.loadingText}>Fetching lyrics…</Text>
        </View>
      ) : lyrics ? (
        <ScrollView
          contentContainerStyle={[styles.lyricsContent, { paddingBottom: bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lyricsText}>{lyrics}</Text>
        </ScrollView>
      ) : (
        <View style={styles.centered}>
          <Ionicons name="musical-notes-outline" size={48} color={C.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>No Lyrics Found</Text>
          <Text style={styles.emptySub}>
            Lyrics for "{title}" aren't available yet.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 12, color: C.textSub, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginHorizontal: 16, marginBottom: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingText: { fontSize: 13, color: C.textSub, marginTop: 12 },
  lyricsContent: { paddingHorizontal: 24, paddingTop: 16 },
  lyricsText: { fontSize: 16, color: C.text, lineHeight: 28, textAlign: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: C.textSub, textAlign: "center", lineHeight: 20 },
});