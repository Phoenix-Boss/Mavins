// app/(modals)/comments.tsx
//
// COMMENTS MODAL — Fetches real comments from YouTube via MavinEngine
// ANDROID-ONLY: No iOS references
// Accepts onClose prop for overlay dismissal

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { triggerHaptic } from "@/helpers/haptics";
import MavinEngine, { type CommentItem, type NativePage } from "@/modules/mavin-engine";

interface CommentsModalProps {
  songId: string;
  title: string;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CommentAuthor {
  name: string;
  avatarUrl?: string;
  channelUrl?: string;
  isVerified?: boolean;
  isUploader?: boolean;
}

interface LocalComment {
  id: string;
  author: CommentAuthor;
  text: string;
  timestamp: string;
  likeCount: number;
  replyCount: number;
  isLikedByUser?: boolean;
  replies?: LocalComment[];
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#000000",
  surface: "#0D0D0D",
  surfaceRaised: "#161616",
  surfaceHigh: "#1F1F1F",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
  verified: "#1DA1F2",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function formatTimestamp(secondsAgo: number): string {
  if (secondsAgo < 60) return `${Math.floor(secondsAgo)}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`;
  return `${Math.floor(secondsAgo / 604800)}w ago`;
}

function parseCommentItem(raw: CommentItem): LocalComment {
  const now = Date.now() / 1000;
  const publishedTimestamp = raw.publishedTimestamp || now;
  const secondsAgo = Math.max(0, now - publishedTimestamp);

  return {
    id: raw.commentId,
    author: {
      name: raw.authorName || "Unknown User",
      avatarUrl: raw.authorAvatars?.[0]?.url,
      channelUrl: raw.authorUrl,
      isVerified: raw.authorVerified || false,
      isUploader: raw.isChannelOwner || false,
    },
    text: raw.commentText || "",
    timestamp: formatTimestamp(secondsAgo),
    likeCount: raw.likeCount || 0,
    replyCount: raw.replyCount || 0,
    isLikedByUser: false,
    createdAt: publishedTimestamp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CommentItem Component
// ─────────────────────────────────────────────────────────────────────────────

interface CommentItemProps {
  comment: LocalComment;
  depth?: number;
  onLike: (commentId: string) => void;
  onReply: (commentId: string, authorName: string) => void;
}

function CommentItemComponent({ comment, depth = 0, onLike, onReply }: CommentItemProps) {
  const maxDepth = 2;
  const isNested = depth > 0;
  const hasReplies = (comment.replies && comment.replies.length > 0) || comment.replyCount > 0;
  const [showReplies, setShowReplies] = useState(false);

  const handleLike = () => {
    triggerHaptic();
    onLike(comment.id);
  };

  return (
    <View style={[ciStyles.container, isNested && ciStyles.nestedContainer]}>
      <View style={ciStyles.row}>
        <View style={ciStyles.avatarContainer}>
          {comment.author.avatarUrl ? (
            <Image source={{ uri: comment.author.avatarUrl }} style={ciStyles.avatar} contentFit="cover" />
          ) : (
            <View style={ciStyles.avatarPlaceholder}>
              <Text style={ciStyles.avatarInitial}>{comment.author.name[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}
        </View>

        <View style={ciStyles.content}>
          <View style={ciStyles.authorRow}>
            <Text style={ciStyles.authorName} numberOfLines={1}>{comment.author.name}</Text>
            {comment.author.isVerified && (
              <Ionicons name="checkmark-circle" size={12} color={C.verified} style={ciStyles.verifiedIcon} />
            )}
            {comment.author.isUploader && (
              <View style={ciStyles.uploaderBadge}>
                <Text style={ciStyles.uploaderText}>Creator</Text>
              </View>
            )}
            <Text style={ciStyles.timestamp}>{comment.timestamp}</Text>
          </View>

          <Text style={ciStyles.commentText}>{comment.text}</Text>

          <View style={ciStyles.actionsRow}>
            <TouchableOpacity style={ciStyles.actionBtn} onPress={handleLike} hitSlop={8}>
              <Ionicons name={comment.isLikedByUser ? "heart" : "heart-outline"} size={14} color={comment.isLikedByUser ? C.gold : C.textSub} />
              {comment.likeCount > 0 && (
                <Text style={[ciStyles.actionText, comment.isLikedByUser && ciStyles.actionTextActive]}>{comment.likeCount}</Text>
              )}
            </TouchableOpacity>

            {depth < maxDepth && (
              <TouchableOpacity style={ciStyles.actionBtn} onPress={() => onReply(comment.id, comment.author.name)} hitSlop={8}>
                <Ionicons name="chatbubble-outline" size={14} color={C.textSub} />
                <Text style={ciStyles.actionText}>Reply</Text>
              </TouchableOpacity>
            )}

            {hasReplies && !isNested && (
              <TouchableOpacity style={ciStyles.actionBtn} onPress={() => { triggerHaptic(); setShowReplies(!showReplies); }} hitSlop={8}>
                <Ionicons name={showReplies ? "chevron-up" : "chevron-down"} size={14} color={C.gold} />
                <Text style={[ciStyles.actionText, ciStyles.replyCountText]}>{comment.replyCount} {comment.replyCount === 1 ? "reply" : "replies"}</Text>
              </TouchableOpacity>
            )}
          </View>

          {showReplies && comment.replies && comment.replies.length > 0 && (
            <View style={ciStyles.repliesContainer}>
              {comment.replies.map((reply) => (
                <CommentItemComponent key={reply.id} comment={reply} depth={depth + 1} onLike={onLike} onReply={onReply} />
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const ciStyles = StyleSheet.create({
  container: { paddingVertical: 12 },
  nestedContainer: { marginLeft: 40, borderLeftWidth: 1, borderLeftColor: C.borderGold, paddingLeft: 12 },
  row: { flexDirection: "row" },
  avatarContainer: { marginRight: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  avatarInitial: { fontSize: 14, fontWeight: "700", color: C.gold },
  content: { flex: 1 },
  authorRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  authorName: { fontSize: 13, fontWeight: "700", color: C.text },
  verifiedIcon: { marginLeft: -2 },
  uploaderBadge: { backgroundColor: C.goldFill, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 0.5, borderColor: C.borderGold },
  uploaderText: { fontSize: 9, fontWeight: "700", color: C.gold },
  timestamp: { fontSize: 11, color: C.textMuted },
  commentText: { fontSize: 14, color: C.text, lineHeight: 20, marginBottom: 8 },
  actionsRow: { flexDirection: "row", gap: 16 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 12, color: C.textSub },
  actionTextActive: { color: C.gold },
  replyCountText: { color: C.gold },
  repliesContainer: { marginTop: 8 },
});

// ─────────────────────────────────────────────────────────────────────────────
// ReplyModal Component
// ─────────────────────────────────────────────────────────────────────────────

interface ReplyModalProps {
  visible: boolean;
  parentCommentId: string;
  parentAuthorName: string;
  onClose: () => void;
  onPost: (parentId: string, text: string) => Promise<void>;
}

function ReplyModal({ visible, parentCommentId, parentAuthorName, onClose, onPost }: ReplyModalProps) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    triggerHaptic();
    setPosting(true);
    try {
      await onPost(parentCommentId, trimmed);
      setText("");
      onClose();
    } catch (error) {
      Alert.alert("Error", "Failed to post reply. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={rmStyles.overlay} behavior="height">
        <View style={rmStyles.sheet}>
          <View style={rmStyles.handle} />
          <View style={rmStyles.header}>
            <Text style={rmStyles.title}>Reply to @{parentAuthorName}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={C.textSub} />
            </TouchableOpacity>
          </View>
          <View style={rmStyles.divider} />
          <TextInput
            style={rmStyles.input}
            value={text}
            onChangeText={setText}
            placeholder={`Reply to ${parentAuthorName}...`}
            placeholderTextColor={C.textMuted}
            multiline
            autoFocus
            maxLength={500}
          />
          <View style={rmStyles.charCount}>
            <Text style={rmStyles.charCountText}>{text.length}/500</Text>
          </View>
          <TouchableOpacity
            style={[rmStyles.postBtn, (!text.trim() || posting) && rmStyles.postBtnDisabled]}
            onPress={handlePost}
            disabled={!text.trim() || posting}
          >
            {posting ? <ActivityIndicator size="small" color="#000" /> : <Text style={rmStyles.postBtnText}>Post Reply</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const rmStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 36 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", alignSelf: "center", marginTop: 10, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "700", color: C.text },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginBottom: 16 },
  input: { backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, fontSize: 14, color: C.text, minHeight: 100, textAlignVertical: "top", borderWidth: 0.5, borderColor: C.border },
  charCount: { alignItems: "flex-end", marginTop: 8 },
  charCountText: { fontSize: 11, color: C.textMuted },
  postBtn: { backgroundColor: C.gold, borderRadius: 28, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { fontSize: 15, fontWeight: "700", color: "#000" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CommentsModal({ songId, title, onClose }: CommentsModalProps) {
  const { top, bottom } = useSafeAreaInsets();

  const [comments, setComments] = useState<LocalComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  
  const [replyModalVisible, setReplyModalVisible] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyingToAuthor, setReplyingToAuthor] = useState("");
  
  const [nextPage, setNextPage] = useState<NativePage | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Fetch comments
  const fetchComments = useCallback(async (page?: NativePage, isLoadMore = false) => {
    if (!songId) {
      setError("No video ID provided");
      setLoading(false);
      return;
    }

    try {
      if (!isLoadMore) setLoading(true);
      else setLoadingMore(true);

      const watchUrl = `https://www.youtube.com/watch?v=${songId}`;
      const pageUrl = page?.url || undefined;
      const result = await MavinEngine.getComments(watchUrl, pageUrl, 0);

      if (!result.success) {
        const errorMsg = (result as any).errors?.[0] || "Failed to load comments";
        throw new Error(errorMsg);
      }

      const rawComments = result.comments || [];
      const parsedComments = rawComments.map(parseCommentItem);
      const nextPageData = result.hasNextPage && result.nextPage ? result.nextPage : null;
      
      if (isLoadMore) {
        setComments(prev => [...prev, ...parsedComments]);
      } else {
        setComments(parsedComments);
      }

      setNextPage(nextPageData);
      setHasMore(!!nextPageData && parsedComments.length > 0);
      setError(null);
    } catch (err: any) {
      console.error("[CommentsModal] Fetch error:", err);
      setError(err.message || "Failed to load comments");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [songId]);

  // Load more
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    if (nextPage) fetchComments(nextPage, true);
  }, [hasMore, loadingMore, loading, nextPage, fetchComments]);

  // Initial load
  useEffect(() => {
    fetchComments();
  }, [songId]);

  // Like/unlike (optimistic)
  const handleLike = useCallback((commentId: string) => {
    setComments(prev => {
      const updateComment = (comment: LocalComment): LocalComment => {
        if (comment.id === commentId) {
          return {
            ...comment,
            isLikedByUser: !comment.isLikedByUser,
            likeCount: comment.isLikedByUser ? comment.likeCount - 1 : comment.likeCount + 1,
          };
        }
        if (comment.replies) {
          return { ...comment, replies: comment.replies.map(updateComment) };
        }
        return comment;
      };
      return prev.map(updateComment);
    });
  }, []);

  // Post new comment (optimistic)
  const handlePostComment = useCallback(async () => {
    const trimmed = newCommentText.trim();
    if (!trimmed) return;

    triggerHaptic();
    setPostingComment(true);

    try {
      const optimisticComment: LocalComment = {
        id: `temp-${Date.now()}`,
        author: { name: "You", avatarUrl: undefined, isVerified: false },
        text: trimmed,
        timestamp: "just now",
        likeCount: 0,
        replyCount: 0,
        isLikedByUser: false,
        createdAt: Date.now() / 1000,
      };

      setComments(prev => [optimisticComment, ...prev]);
      setNewCommentText("");

      setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
    } catch (err) {
      console.error("[CommentsModal] Post error:", err);
      Alert.alert("Error", "Failed to post comment. Please try again.");
      fetchComments();
    } finally {
      setPostingComment(false);
    }
  }, [newCommentText, fetchComments]);

  // Post reply (optimistic)
  const handlePostReply = useCallback(async (parentId: string, text: string) => {
    const optimisticReply: LocalComment = {
      id: `temp-reply-${Date.now()}`,
      author: { name: "You", avatarUrl: undefined, isVerified: false },
      text: text,
      timestamp: "just now",
      likeCount: 0,
      replyCount: 0,
      isLikedByUser: false,
      createdAt: Date.now() / 1000,
    };

    setComments(prev => {
      const updateCommentReplies = (comment: LocalComment): LocalComment => {
        if (comment.id === parentId) {
          return {
            ...comment,
            replies: [optimisticReply, ...(comment.replies || [])],
            replyCount: comment.replyCount + 1,
          };
        }
        if (comment.replies) {
          return { ...comment, replies: comment.replies.map(updateCommentReplies) };
        }
        return comment;
      };
      return prev.map(updateCommentReplies);
    });
  }, []);

  const handleReply = useCallback((commentId: string, authorName: string) => {
    setReplyingToId(commentId);
    setReplyingToAuthor(authorName);
    setReplyModalVisible(true);
  }, []);

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    if (error) {
      return (
        <View style={styles.emptyWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} style={{ marginBottom: 14 }} />
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySub}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchComments()}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="chatbubble-outline" size={48} color={C.textMuted} style={{ marginBottom: 14 }} />
        <Text style={styles.emptyTitle}>No comments yet</Text>
        <Text style={styles.emptySub}>Be the first to comment on this track!</Text>
      </View>
    );
  }, [loading, error, fetchComments]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <View style={[styles.container, { paddingTop: top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="chevron-down" size={22} color={C.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Comments</Text>
            {title && <Text style={styles.headerSub} numberOfLines={1}>{title}</Text>}
          </View>

          <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} style={styles.closeBtn} hitSlop={10}>
            <Ionicons name="close" size={20} color={C.textSub} />
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {loading && comments.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.gold} />
            <Text style={styles.loadingText}>Loading comments...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={comments}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={({ item }) => (
              <CommentItemComponent comment={item} onLike={handleLike} onReply={handleReply} />
            )}
            contentContainerStyle={[styles.listContent, comments.length === 0 && styles.listContentEmpty]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 48 }} />}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={C.gold} />
              </View>
            ) : null}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
          />
        )}

        <View style={[styles.inputBar, { paddingBottom: bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={newCommentText}
            onChangeText={setNewCommentText}
            placeholder="Add a comment..."
            placeholderTextColor={C.textMuted}
            returnKeyType="send"
            onSubmitEditing={handlePostComment}
            multiline
            editable={!postingComment}
          />
          <TouchableOpacity
            onPress={handlePostComment}
            disabled={!newCommentText.trim() || postingComment}
            style={[styles.sendBtn, (!newCommentText.trim() || postingComment) && styles.sendBtnDisabled]}
          >
            {postingComment ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="send" size={16} color="#000" />}
          </TouchableOpacity>
        </View>

        <ReplyModal
          visible={replyModalVisible}
          parentCommentId={replyingToId || ""}
          parentAuthorName={replyingToAuthor}
          onClose={() => { setReplyModalVisible(false); setReplyingToId(null); setReplyingToAuthor(""); }}
          onPost={handlePostReply}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 12, color: C.textSub, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: C.borderGold, marginHorizontal: 16, marginBottom: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { fontSize: 13, color: C.textSub, marginTop: 12 },
  listContent: { paddingHorizontal: 16, paddingBottom: 80 },
  listContentEmpty: { flex: 1 },
  footerLoader: { paddingVertical: 20, alignItems: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: C.textSub, textAlign: "center", lineHeight: 20 },
  retryBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.goldFill, borderRadius: 20, borderWidth: 0.5, borderColor: C.borderGold },
  retryBtnText: { fontSize: 13, fontWeight: "600", color: C.gold },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: C.borderGold, backgroundColor: C.bg, gap: 10 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: C.surfaceRaised, borderRadius: 20, borderWidth: 0.5, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: C.text },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.4 },
});
