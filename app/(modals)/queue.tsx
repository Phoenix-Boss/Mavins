// app/(modals)/queue.tsx

import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import {
  Track,
  useActiveTrack,
  getQueue,
  skip,
  play,
  remove,
} from "@/modules/mavin-eq";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  surfaceRaised: "#1F1F1F",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.08)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  activeBg: "rgba(212,175,55,0.07)",
  activeBorder: "rgba(212,175,55,0.3)",
};

// ─────────────────────────────────────────────────────────────────────────────
// QueueModal
// ─────────────────────────────────────────────────────────────────────────────
export default function QueueModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  const [queue, setQueue] = useState<Track[]>([]);
  const activeTrack = useActiveTrack();

  // ── Load queue ─────────────────────────────────────────────────────────────
  useEffect(() => {
    getQueue().then(setQueue).catch(() => setQueue([]));
  }, []);

  // ── Play a track by index ──────────────────────────────────────────────────
  const handlePlay = async (index: number) => {
    triggerHaptic();
    await skip(index);
    await play();
  };

  // ── Remove a track from queue ──────────────────────────────────────────────
  const handleRemove = async (index: number) => {
    triggerHaptic();
    await remove(index);
    const updated = await getQueue();
    setQueue(updated);
  };

  // ── Render each track row ──────────────────────────────────────────────────
  const renderItem = ({ item, index }: { item: Track; index: number }) => {
    const isActive = activeTrack?.id === item.id;

    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => handlePlay(index)}
        activeOpacity={0.7}
      >
        {/* Artwork */}
        {item.artwork ? (
          <Image
            source={{ uri: item.artwork as string }}
            style={styles.artwork}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]}>
            <Ionicons name="musical-notes" size={18} color={C.textMuted} />
          </View>
        )}

        {/* Track info */}
        <View style={styles.info}>
          <Text
            style={[styles.trackTitle, isActive && styles.trackTitleActive]}
            numberOfLines={1}
          >
            {item.title ?? "Unknown Title"}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {item.artist ?? "Unknown Artist"}
          </Text>
        </View>

        {/* Playing indicator / remove button */}
        {isActive ? (
          <View style={styles.playingBadge}>
            <Ionicons name="musical-note" size={12} color={C.gold} />
            <Text style={styles.playingText}>Now Playing</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => handleRemove(index)}
            hitSlop={10}
            style={styles.removeBtn}
          >
            <Ionicons name="close" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: bottom + 16 }]}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Up Next</Text>
          {queue.length > 0 && (
            <Text style={styles.subtitle}>
              {queue.length} track{queue.length !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => { triggerHaptic(); router.back(); }}
          hitSlop={10}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={18} color={C.textSub} />
        </TouchableOpacity>
      </View>

      {/* Gold hairline */}
      <View style={styles.divider} />

      {/* Queue list */}
      <FlatList
        data={queue}
        keyExtractor={(item, index) =>
          item.id != null ? item.id.toString() : index.toString()
        }
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          queue.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: C.border,
              marginLeft: 72,
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons
              name="list-outline"
              size={48}
              color={C.textMuted}
              style={{ marginBottom: 14 }}
            />
            <Text style={styles.emptyTitle}>Queue is empty</Text>
            <Text style={styles.emptySub}>
              Play a track to start building your queue.
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: 10,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
  },
  subtitle: {
    fontSize: 12,
    color: C.textSub,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.borderGold,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  listContentEmpty: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    paddingHorizontal: 4,
  },
  rowActive: {
    backgroundColor: C.activeBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.activeBorder,
    paddingHorizontal: 8,
    marginHorizontal: -4,
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
  },
  artworkPlaceholder: {
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
    marginBottom: 3,
  },
  trackTitleActive: {
    color: C.gold,
  },
  trackArtist: {
    fontSize: 12,
    color: C.textSub,
  },
  playingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.goldFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.borderGold,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  playingText: {
    fontSize: 10,
    fontWeight: "700",
    color: C.gold,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13,
    color: C.textSub,
    textAlign: "center",
    lineHeight: 20,
  },
});