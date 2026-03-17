/**
 * (modals)/comments.tsx
 *
 * Receives params:
 *   songId: string
 *   title:  string
 */

import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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

// Mock comment type — replace with your API type
interface Comment {
  id: string;
  user: string;
  avatar?: string;
  text: string;
  timestamp: string;
  likes: number;
}

const MOCK_COMMENTS: Comment[] = [
  { id: "1", user: "Adeola", text: "This track is 🔥🔥", timestamp: "2h ago", likes: 14 },
  { id: "2", user: "Chibuike", text: "Been on repeat all morning", timestamp: "5h ago", likes: 7 },
  { id: "3", user: "Ngozi", text: "The beat drop at 1:30 is insane", timestamp: "1d ago", likes: 31 },
];

export default function CommentsModal() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { songId, title } = useLocalSearchParams<{
    songId: string;
    title: string;
  }>();

  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);
  const [draft, setDraft] = useState("");

  const handlePost = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    triggerHaptic();
    // TODO: POST comment to API
    setComments((prev) => [
      {
        id: Date.now().toString(),
        user: "You",
        text: trimmed,
        timestamp: "just now",
        likes: 0,
      },
      ...prev,
    ]);
    setDraft("");
  };

  const renderComment = ({ item }: { item: Comment }) => (
    <View style={styles.commentRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial}>{item.user[0]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.commentHeader}>
          <Text style={styles.commentUser}>{item.user}</Text>
          <Text style={styles.commentTime}>{item.timestamp}</Text>
        </View>
        <Text style={styles.commentText}>{item.text}</Text>
        <TouchableOpacity style={styles.likeRow} hitSlop={8}>
          <Ionicons name="heart-outline" size={13} color={C.textMuted} />
          <Text style={styles.likeCount}>{item.likes}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
            <Text style={styles.headerTitle}>Comments</Text>
            {title && (
              <Text style={styles.headerSub} numberOfLines={1}>{title}</Text>
            )}
          </View>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.divider} />

        <FlatList
          data={comments}
          keyExtractor={(i) => i.id}
          renderItem={renderComment}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 80 }}
          ItemSeparatorComponent={() => (
            <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 50 }} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubble-outline" size={40} color={C.textMuted} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment…"
            placeholderTextColor={C.textMuted}
            returnKeyType="send"
            onSubmitEditing={handlePost}
            multiline
          />
          <TouchableOpacity
            onPress={handlePost}
            disabled={!draft.trim()}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
          >
            <Ionicons name="send" size={16} color="#000" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  commentRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12 },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.surfaceRaised, alignItems: "center", justifyContent: "center",
    marginRight: 10, borderWidth: 0.5, borderColor: C.border,
  },
  avatarInitial: { fontSize: 13, fontWeight: "700", color: C.gold },
  commentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  commentUser: { fontSize: 13, fontWeight: "700", color: C.text },
  commentTime: { fontSize: 11, color: C.textMuted },
  commentText: { fontSize: 14, color: C.text, lineHeight: 20 },
  likeRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 4 },
  likeCount: { fontSize: 11, color: C.textMuted },
  emptyWrap: { paddingVertical: 60, alignItems: "center" },
  emptyText: { fontSize: 13, color: C.textMuted },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end",
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 0.5, borderTopColor: C.borderGold,
    backgroundColor: C.bg, gap: 10,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    backgroundColor: C.surfaceRaised, borderRadius: 20,
    borderWidth: 0.5, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: C.text,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.gold, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.35 },
});