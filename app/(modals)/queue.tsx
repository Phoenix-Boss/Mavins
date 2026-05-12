/**
 * (modals)/queue.tsx
 *
 * EXPORT-QUEUE MODAL — Uses PlayerEngineContext (expo-video)
 * 
 * This modal displays the current playback queue from the engine.
 * All operations use the engine's queue state — no RNTP.
 */

import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { triggerHaptic } from "@/helpers/haptics";
import { usePlayerEngine, type ResolvedTrack } from "@/libs/playerSetup";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  surfaceRaised: "#1F1F1F",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.08)",
  goldFillStrong: "rgba(212,175,55,0.15)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  activeBg: "rgba(212,175,55,0.07)",
  activeBorder: "rgba(212,175,55,0.3)",
  danger: "#E05C5C",
  dangerFill: "rgba(224,92,92,0.1)",
};

// ─────────────────────────────────────────────────────────────────────────────
// QueueReorderModal — bottom sheet for reordering queue items
// ─────────────────────────────────────────────────────────────────────────────

interface QueueReorderModalProps {
  visible: boolean;
  onClose: () => void;
  queue: ResolvedTrack[];
  currentIndex: number;
  onMoveItem: (fromIndex: number, toIndex: number) => void;
}

function QueueReorderModal({
  visible,
  onClose,
  queue,
  currentIndex,
  onMoveItem,
}: QueueReorderModalProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    triggerHaptic();
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      onMoveItem(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      setDragOverIndex(targetIndex);
    }
  };

  const renderReorderItem = ({ item, index }: { item: ResolvedTrack; index: number }) => {
    const isDragging = draggedIndex === index;
    const isDragOver = dragOverIndex === index && draggedIndex !== index;
    const isCurrent = index === currentIndex;

    return (
      <TouchableOpacity
        style={[
          reorderStyles.row,
          isDragging && reorderStyles.rowDragging,
          isDragOver && reorderStyles.rowDragOver,
          isCurrent && reorderStyles.rowCurrent,
        ]}
        onLongPress={() => handleDragStart(index)}
        onPressOut={handleDragEnd}
        activeOpacity={0.7}
        delayLongPress={300}
      >
        <View style={reorderStyles.dragHandle}>
          <Ionicons name="menu" size={18} color={C.textMuted} />
        </View>

        {item.artwork ? (
          <Image source={{ uri: item.artwork }} style={reorderStyles.artwork} contentFit="cover" />
        ) : (
          <View style={[reorderStyles.artwork, reorderStyles.artworkPlaceholder]}>
            <Ionicons name="musical-notes" size={16} color={C.textMuted} />
          </View>
        )}

        <View style={reorderStyles.info}>
          <Text style={[reorderStyles.title, isCurrent && reorderStyles.titleCurrent]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={reorderStyles.artist} numberOfLines={1}>
            {item.artist || "Unknown Artist"}
          </Text>
        </View>

        {isCurrent && (
          <View style={reorderStyles.nowPlayingBadge}>
            <Ionicons name="musical-note" size={10} color={C.gold} />
            <Text style={reorderStyles.nowPlayingText}>Now</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={reorderStyles.modalOverlay}>
        <View style={reorderStyles.modalContent}>
          <View style={reorderStyles.modalHandle} />
          
          <View style={reorderStyles.modalHeader}>
            <Text style={reorderStyles.modalTitle}>Reorder Queue</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={C.textSub} />
            </TouchableOpacity>
          </View>

          <View style={reorderStyles.divider} />

          <FlatList
            data={queue}
            keyExtractor={(item, idx) => `${item.id}-${idx}`}
            renderItem={renderReorderItem}
            contentContainerStyle={reorderStyles.listContent}
            ItemSeparatorComponent={() => <View style={reorderStyles.separator} />}
            onTouchEnd={handleDragEnd}
          />

          <TouchableOpacity style={reorderStyles.closeBtn} onPress={onClose}>
            <Text style={reorderStyles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const reorderStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
  },
  divider: {
    height: 0.5,
    backgroundColor: C.borderGold,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  rowDragging: {
    opacity: 0.5,
    backgroundColor: C.goldFill,
  },
  rowDragOver: {
    borderWidth: 1,
    borderColor: C.gold,
    borderStyle: "dashed",
    backgroundColor: C.goldFillStrong,
  },
  rowCurrent: {
    backgroundColor: C.activeBg,
    borderWidth: 0.5,
    borderColor: C.activeBorder,
  },
  dragHandle: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  artworkPlaceholder: {
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0.5,
    borderColor: C.border,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
    marginBottom: 2,
  },
  titleCurrent: {
    color: C.gold,
  },
  artist: {
    fontSize: 12,
    color: C.textSub,
  },
  nowPlayingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.goldFill,
    borderWidth: 0.5,
    borderColor: C.borderGold,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nowPlayingText: {
    fontSize: 9,
    fontWeight: "700",
    color: C.gold,
  },
  separator: {
    height: 0.5,
    backgroundColor: C.border,
    marginLeft: 68,
  },
  closeBtn: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.text,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ClearQueueConfirmModal — confirmation dialog
// ─────────────────────────────────────────────────────────────────────────────

interface ClearQueueConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemCount: number;
}

function ClearQueueConfirmModal({ visible, onClose, onConfirm, itemCount }: ClearQueueConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={clearStyles.overlay}>
        <View style={clearStyles.dialog}>
          <View style={clearStyles.iconWrap}>
            <Ionicons name="trash-outline" size={28} color={C.danger} />
          </View>
          <Text style={clearStyles.title}>Clear Queue?</Text>
          <Text style={clearStyles.message}>
            Remove all {itemCount} track{itemCount !== 1 ? "s" : ""} from your queue?
          </Text>
          <View style={clearStyles.buttonRow}>
            <TouchableOpacity style={clearStyles.cancelBtn} onPress={onClose}>
              <Text style={clearStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={clearStyles.clearBtn} onPress={onConfirm}>
              <Text style={clearStyles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const clearStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  dialog: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    width: "80%",
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: C.borderGold,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.dangerFill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: C.textSub,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: C.surfaceRaised,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textSub,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: C.danger,
    alignItems: "center",
  },
  clearText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main QueueModal Component
// ─────────────────────────────────────────────────────────────────────────────

export default function QueueModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const engine = usePlayerEngine();

  const [showReorder, setShowReorder] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [localQueue, setLocalQueue] = useState<ResolvedTrack[]>([]);

  // Sync local queue with engine queue
  useEffect(() => {
    setLocalQueue([...engine.queue]);
  }, [engine.queue]);

  const handlePlayTrack = useCallback(
    async (index: number) => {
      triggerHaptic();
      await engine.skipToIndex(index);
      router.back();
    },
    [engine, router]
  );

  const handleRemoveTrack = useCallback(
    (index: number) => {
      triggerHaptic();
      const newQueue = [...localQueue];
      newQueue.splice(index, 1);
      
      // Update engine queue by rebuilding
      if (newQueue.length === 0) {
        // If queue becomes empty, stop playback
        engine.pause();
        // Force engine queue update via a small hack — reload empty array
        // Since engine doesn't have a direct remove method, we rebuild
        engine.skipToIndex(-1); // Invalidate current
      } else {
        // Rebuild queue by loading the first track and enqueuing the rest
        const currentTrackId = engine.currentTrack?.id;
        const wasPlaying = engine.isPlaying;
        
        // Find if current track still exists
        const newIndex = newQueue.findIndex(t => t.id === currentTrackId);
        
        if (newIndex !== -1) {
          // Current track still in queue — load at that position
          engine.loadQueue(newQueue, newIndex).then(() => {
            if (wasPlaying) engine.play();
          });
        } else if (newIndex === -1 && newQueue.length > 0) {
          // Current track was removed — load first track
          engine.loadQueue(newQueue, 0).then(() => {
            engine.play();
          });
        }
      }
      
      setLocalQueue(newQueue);
    },
    [localQueue, engine]
  );

  const handleMoveItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      triggerHaptic();
      const newQueue = [...localQueue];
      const [movedItem] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, movedItem);
      
      // Rebuild engine queue
      const currentTrackId = engine.currentTrack?.id;
      const newCurrentIndex = newQueue.findIndex(t => t.id === currentTrackId);
      const wasPlaying = engine.isPlaying;
      
      engine.loadQueue(newQueue, newCurrentIndex !== -1 ? newCurrentIndex : 0).then(() => {
        if (wasPlaying) engine.play();
      });
      
      setLocalQueue(newQueue);
    },
    [localQueue, engine]
  );

  const handleClearQueue = useCallback(() => {
    triggerHaptic();
    engine.pause();
    engine.loadQueue([], -1);
    setLocalQueue([]);
    setShowClearConfirm(false);
    router.back();
  }, [engine, router]);

  const renderItem = ({ item, index }: { item: ResolvedTrack; index: number }) => {
    const isActive = engine.currentTrack?.id === item.id;
    const isFirst = index === 0;

    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => handlePlayTrack(index)}
        activeOpacity={0.7}
      >
        {/* Artwork */}
        {item.artwork ? (
          <Image
            source={{ uri: item.artwork }}
            style={styles.artwork}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]}>
            <Ionicons name="musical-notes" size={18} color={C.textMuted} />
          </View>
        )}

        {/* Queue position indicator */}
        <View style={styles.positionIndicator}>
          <Text style={[styles.positionText, isActive && styles.positionTextActive]}>
            {isFirst && !isActive ? "1" : index + 1}
          </Text>
          {isFirst && !isActive && (
            <View style={styles.positionNextBadge}>
              <Text style={styles.positionNextText}>Next</Text>
            </View>
          )}
        </View>

        {/* Track info */}
        <View style={styles.info}>
          <Text
            style={[styles.trackTitle, isActive && styles.trackTitleActive]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {item.artist || "Unknown Artist"}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.rowActions}>
          {isActive ? (
            <View style={styles.playingBadge}>
              <Ionicons name="musical-note" size={12} color={C.gold} />
              <Text style={styles.playingText}>Now Playing</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => handleRemoveTrack(index)}
              hitSlop={12}
              style={styles.removeBtn}
            >
              <Ionicons name="close" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom + 16 }]}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Up Next</Text>
          {localQueue.length > 0 && (
            <Text style={styles.subtitle}>
              {localQueue.length} track{localQueue.length !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {localQueue.length > 1 && (
            <TouchableOpacity
              onPress={() => setShowReorder(true)}
              hitSlop={10}
              style={styles.headerBtn}
            >
              <MaterialIcons name="reorder" size={20} color={C.textSub} />
            </TouchableOpacity>
          )}
          {localQueue.length > 0 && (
            <TouchableOpacity
              onPress={() => setShowClearConfirm(true)}
              hitSlop={10}
              style={styles.headerBtn}
            >
              <Ionicons name="trash-outline" size={18} color={C.danger} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              triggerHaptic();
              router.back();
            }}
            hitSlop={10}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={18} color={C.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Gold hairline */}
      <View style={styles.divider} />

      {/* Queue list */}
      <FlatList
        data={localQueue}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          localQueue.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginLeft: 72 }} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="list-outline" size={48} color={C.textMuted} style={{ marginBottom: 14 }} />
            <Text style={styles.emptyTitle}>Queue is empty</Text>
            <Text style={styles.emptySub}>Play a track to start building your queue.</Text>
          </View>
        }
      />

      {/* Reorder modal */}
      <QueueReorderModal
        visible={showReorder}
        onClose={() => setShowReorder(false)}
        queue={localQueue}
        currentIndex={localQueue.findIndex(t => t.id === engine.currentTrack?.id)}
        onMoveItem={handleMoveItem}
      />

      {/* Clear confirmation modal */}
      <ClearQueueConfirmModal
        visible={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearQueue}
        itemCount={localQueue.length}
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
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
  },
  artworkPlaceholder: {
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  positionIndicator: {
    width: 36,
    alignItems: "center",
    marginLeft: 8,
  },
  positionText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textMuted,
  },
  positionTextActive: {
    color: C.gold,
  },
  positionNextBadge: {
    marginTop: 4,
    backgroundColor: C.goldFillStrong,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  positionNextText: {
    fontSize: 8,
    fontWeight: "700",
    color: C.gold,
  },
  info: {
    flex: 1,
    marginLeft: 12,
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
  rowActions: {
    minWidth: 80,
    alignItems: "flex-end",
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