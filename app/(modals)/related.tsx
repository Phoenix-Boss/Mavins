/**
 * (modals)/related.tsx
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
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { triggerHaptic } from "@/helpers/haptics";

const C = {
  bg: "#000000",
  surface: "#0D0D0D",
  surfaceRaised: "#161616",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
};

// Replace with your real track type from the store
interface RelatedTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number;
}

export default function RelatedModal() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { songId, title, artist } = useLocalSearchParams<{
    songId: string;
    title: string;
    artist: string;
  }>();

  const { playAudio } = useMusicPlayer();
  const [tracks, setTracks] = useState<RelatedTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: fetch related tracks from your API using songId / title / artist
    const timer = setTimeout(() => {
      setTracks([]); // replace with API result
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [songId]);

  const handlePlay = (track: RelatedTrack) => {
    triggerHaptic();
    playAudio(track as any, tracks as any);
    router.back();
    router.navigate("/player");
  };

  const renderItem = ({ item }: { item: RelatedTrack }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => handlePlay(item)}
      activeOpacity={0.7}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.cover} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Ionicons name="musical-notes" size={18} color={C.textMuted} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
      </View>
      <Ionicons name="play-circle-outline" size={24} color={C.gold} />
    </TouchableOpacity>
  );

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
          <Text style={styles.headerTitle}>Related Songs</Text>
          {artist && (
            <Text style={styles.headerSub} numberOfLines={1}>Similar to {artist}</Text>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.divider} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={C.gold} />
          <Text style={styles.loadingText}>Finding related tracks…</Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 32 }}
          ItemSeparatorComponent={() => (
            <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 68 }} />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="git-network-outline" size={48} color={C.textMuted} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>No Related Songs</Text>
              <Text style={styles.emptySub}>We couldn't find related tracks right now.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 12, color: C.textSub, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  cover: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  coverPlaceholder: { backgroundColor: C.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  trackTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  trackArtist: { fontSize: 12, color: C.textSub, marginTop: 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingText: { fontSize: 13, color: C.textSub, marginTop: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: C.textSub, textAlign: "center" },
});