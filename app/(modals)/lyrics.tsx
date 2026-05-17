// app/(modals)/lyrics.tsx
//
// LYRICS MODAL - Displays synced or plain lyrics
// ANDROID-ONLY: No iOS references
// Accepts onClose prop for overlay dismissal
// FIXED: Theme-aware with gold accent (no purple)

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Alert,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSharedValue } from "react-native-reanimated";
import Animated, {
  useAnimatedStyle,
  withTiming,
  useDerivedValue,
} from "react-native-reanimated";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { triggerHaptic } from "@/helpers/haptics";
import { useLyricsContext, submitUserLyrics } from "@/hooks/useLyricsContext";
import type { LyricLine } from "@/hooks/useLyricsContext";
import { usePlayerEngine } from "@/libs/playerSetup";
import { useTheme } from "@/contexts/ThemeContext";

interface LyricsModalProps {
  title: string;
  artist: string;
  videoId: string;
  leadIn?: string;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function LyricsModal({ title, artist, videoId, leadIn = "0.25", onClose }: LyricsModalProps) {
  const { top, bottom } = useSafeAreaInsets();
  const engine = usePlayerEngine();
  const { colors, isDark } = useTheme();
  const position = engine.position;
  
  const LEAD_IN = parseFloat(leadIn);
  const seekTime = useSharedValue(0);
  
  useEffect(() => { 
    seekTime.value = position + LEAD_IN; 
  }, [position, LEAD_IN]);

  const { lyrics, isFetchingLyrics } = useLyricsContext();
  
  const [addModalVisible, setAddModalVisible] = useState(false);

  const hasSynced = lyrics.length > 0 && lyrics.some((l) => l.synced);
  const hasPlain  = lyrics.length > 0 && lyrics.every((l) => !l.synced);
  const isEmpty   = !isFetchingLyrics && lyrics.length === 0;

  const handleLyricsSubmitted = useCallback((newLines: LyricLine[]) => {
    setAddModalVisible(false);
    Alert.alert("Thanks!", "Your lyrics have been saved and will appear for future listeners.");
  }, []);

  return (
    <View style={[styles.container, { paddingTop: top, backgroundColor: colors.background }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} style={[styles.backBtn, { backgroundColor: colors.surface }]} hitSlop={10}>
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{title ?? "Lyrics"}</Text>
          <Text style={[styles.headerSub, { color: colors.textSub }]} numberOfLines={1}>{artist ?? ""}</Text>
        </View>

        {isEmpty ? (
          <TouchableOpacity onPress={() => { triggerHaptic(); setAddModalVisible(true); }} style={styles.addHeaderBtn} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={24} color={colors.gold} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

      {/* Loading */}
      {isFetchingLyrics && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={[styles.statusText, { color: colors.textSub }]}>Fetching lyrics…</Text>
        </View>
      )}

      {/* Synced karaoke */}
      {!isFetchingLyrics && hasSynced && (
        <SyncedView lines={lyrics} seekTime={seekTime} position={position} bottom={bottom} leadIn={LEAD_IN} colors={colors} />
      )}

      {/* Plain text */}
      {!isFetchingLyrics && hasPlain && (
        <PlainView lines={lyrics} bottom={bottom} colors={colors} />
      )}

      {/* Nothing found */}
      {isEmpty && (
        <View style={styles.centered}>
          <Ionicons name="musical-notes-outline" size={52} color={colors.textMuted} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No lyrics found for</Text>
          <Text style={[styles.emptyTrackName, { color: colors.textSub }]} numberOfLines={2}>"{title ?? "this track"}"</Text>
          <Text style={[styles.emptySub, { color: colors.textSub }]}>Know the lyrics? Help other listeners by adding them.</Text>

          <TouchableOpacity style={[styles.addLyricsBtn, { backgroundColor: colors.gold }]} onPress={() => { triggerHaptic(); setAddModalVisible(true); }} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={18} color={colors.textInverse} style={{ marginRight: 6 }} />
            <Text style={[styles.addLyricsBtnText, { color: colors.textInverse }]}>Add Lyrics</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Lyrics Modal */}
      <AddLyricsModal
        visible={addModalVisible}
        title={title ?? ""}
        artist={artist ?? ""}
        videoId={videoId ?? ""}
        onClose={() => setAddModalVisible(false)}
        onSubmitted={handleLyricsSubmitted}
        colors={colors}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SyncedView — animated karaoke, auto-scrolls to active line
// ─────────────────────────────────────────────────────────────────────────────

interface SyncedViewProps {
  lines:    LyricLine[];
  seekTime: ReturnType<typeof useSharedValue<number>>;
  position: number;
  bottom:   number;
  leadIn:   number;
  colors:   any;
}

function SyncedView({ lines, seekTime, position, bottom, leadIn, colors }: SyncedViewProps) {
  const scrollRef   = useRef<ScrollView>(null);
  const lineHeights = useRef<number[]>([]);
  const [userScrolling, setUserScrolling] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScrollBeginDrag = useCallback(() => {
    setUserScrolling(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }, []);

  const handleScrollEnd = useCallback(() => {
    resumeTimer.current = setTimeout(() => setUserScrolling(false), 4000);
  }, []);

  const activeIndex = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i].startTime ?? 0) <= position + leadIn) idx = i;
      else break;
    }
    return idx;
  }, [lines, position, leadIn]);

  useEffect(() => {
    if (userScrolling || lineHeights.current.length === 0) return;
    let offset = 0;
    for (let i = 0; i < activeIndex; i++) offset += lineHeights.current[i] ?? 52;
    offset = Math.max(0, offset - 200);
    scrollRef.current?.scrollTo({ y: offset, animated: true });
  }, [activeIndex, userScrolling]);

  const getLineEndTime = useCallback((index: number, currentStartTime: number): number => {
    for (let i = index + 1; i < lines.length; i++) {
      const nextLine = lines[i];
      if (nextLine.text !== "" && nextLine.startTime !== undefined) {
        return nextLine.startTime;
      }
    }
    return currentStartTime + 5;
  }, [lines]);

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.syncedContent, { paddingBottom: bottom + 80 }]}
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={handleScrollBeginDrag}
      onMomentumScrollEnd={handleScrollEnd}
      onScrollEndDrag={handleScrollEnd}
    >
      {lines.map((line, i) => {
        if (line.text === "") return <View key={i} style={styles.spacer} />;

        const startTime = line.startTime ?? 0;
        const endTime = getLineEndTime(i, startTime);

        return (
          <View key={i} onLayout={(e) => { lineHeights.current[i] = e.nativeEvent.layout.height; }}>
            <AnimatedLyricLine text={line.text} startTime={startTime} endTime={endTime} seekTime={seekTime} colors={colors} />
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedLyricLine — single synced line with colour animation
// ─────────────────────────────────────────────────────────────────────────────

interface AnimatedLyricLineProps {
  text:      string;
  startTime: number;
  endTime:   number;
  seekTime:  ReturnType<typeof useSharedValue<number>>;
  colors:    any;
}

function AnimatedLyricLine({ text, startTime, endTime, seekTime, colors }: AnimatedLyricLineProps) {
  const color = useDerivedValue(() => {
    const active = seekTime.value >= startTime && seekTime.value < endTime;
    return withTiming(active ? colors.text : colors.textMuted, {
      duration: active ? 80 : 400,
    });
  });

  const animStyle = useAnimatedStyle(() => ({ color: color.value }));

  return <Animated.Text style={[styles.syncedLine, animStyle]}>{text}</Animated.Text>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlainView — static scrollable plain lyrics
// ─────────────────────────────────────────────────────────────────────────────

interface PlainViewProps {
  lines:  LyricLine[];
  bottom: number;
  colors: any;
}

function PlainView({ lines, bottom, colors }: PlainViewProps) {
  return (
    <ScrollView contentContainerStyle={[styles.plainContent, { paddingBottom: bottom + 80 }]} showsVerticalScrollIndicator={false}>
      {lines.map((line, i) =>
        line.text === "" ? (
          <View key={i} style={styles.spacer} />
        ) : (
          <Text key={i} style={[styles.plainLine, { color: colors.textSub }]}>{line.text}</Text>
        )
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddLyricsModal — inline modal for submitting lyrics
// ─────────────────────────────────────────────────────────────────────────────

interface AddLyricsModalProps {
  visible:     boolean;
  title:       string;
  artist:      string;
  videoId:     string;
  onClose:     () => void;
  onSubmitted: (lines: LyricLine[]) => void;
  colors:      any;
}

function AddLyricsModal({ visible, title, artist, videoId, onClose, onSubmitted, colors }: AddLyricsModalProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSynced = /^\[\d{2}:\d{2}\.\d{2,3}\]/m.test(text.trim());

  const handleSave = async () => {
    if (!text.trim()) { setError("Please paste the lyrics first."); return; }
    if (!videoId) { setError("No video ID — cannot save."); return; }

    triggerHaptic();
    setSaving(true);
    setError(null);

    const result = await submitUserLyrics(videoId, title, artist, text.trim());

    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Save failed. Please try again.");
      return;
    }

    const lines: LyricLine[] = isSynced
      ? text.trim().split("\n")
          .filter((l) => /^\[\d{2}:\d{2}\.\d{2,3}\]/.test(l))
          .map((l) => ({
            text: l.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, ""),
            synced: true,
            startTime: 0,
          }))
      : text.trim().split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => ({ text: l, synced: false }));

    setText("");
    onSubmitted(lines);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={addStyles.overlay} behavior="height">
        <View style={[addStyles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[addStyles.handle, { backgroundColor: colors.textMuted }]} />
          
          <View style={addStyles.header}>
            <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSub} />
            </TouchableOpacity>
            <Text style={[addStyles.headerTitle, { color: colors.text }]}>Add Lyrics</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving || !text.trim()} hitSlop={8}>
              {saving ? (
                <ActivityIndicator size="small" color={colors.gold} />
              ) : (
                <Text style={[addStyles.saveBtn, { color: colors.gold }, (!text.trim()) && { opacity: 0.3 }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={[addStyles.trackInfo, { color: colors.textSub }]} numberOfLines={1}>{title}{artist ? ` · ${artist}` : ""}</Text>

          <View style={[addStyles.hintRow, { backgroundColor: colors.surfaceRaised }]}>
            <Ionicons name={isSynced ? "checkmark-circle" : "information-circle-outline"} size={14} color={isSynced ? colors.gold : colors.textSub} />
            <Text style={[addStyles.hintText, { color: colors.textSub }, isSynced && { color: colors.gold }]}>
              {isSynced ? "LRC format detected — will display as synced karaoke" : "Paste plain lyrics or LRC format (with [mm:ss.xx] timestamps)"}
            </Text>
          </View>

          <TextInput
            style={[addStyles.input, { color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            value={text}
            onChangeText={(t) => { setText(t); setError(null); }}
            placeholder="[00:12.00] First line of the song\n[00:15.50] Second line...\n\nOr paste plain text without timestamps"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            selectionColor={colors.gold}
            textAlignVertical="top"
          />

          {error && <Text style={[addStyles.errorText, { color: colors.error }]}>{error}</Text>}

          <Text style={[addStyles.footerNote, { color: colors.textMuted }]}>Lyrics you submit will be visible to all listeners of this track. Please only submit accurate lyrics.</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  addHeaderBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: "15@ms", fontWeight: "700" },
  headerSub: { fontSize: "12@ms", marginTop: 2 },
  divider: { height: 0.5, marginHorizontal: 16, marginBottom: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  statusText: { fontSize: "13@ms", marginTop: 12 },
  emptyTitle: { fontSize: "17@ms", fontWeight: "600", textAlign: "center" },
  emptyTrackName: { fontSize: "15@ms", textAlign: "center", marginTop: 4, marginBottom: 12 },
  emptySub: { fontSize: "13@ms", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  addLyricsBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 4 },
  addLyricsBtnText: { fontSize: "14@ms", fontWeight: "700" },
  syncedContent: { paddingHorizontal: "24@ms", paddingTop: "40@vs", alignItems: "center" },
  syncedLine: { fontWeight: "700", fontSize: "24@ms", paddingVertical: 9, textAlign: "center" },
  plainContent: { paddingHorizontal: "24@ms", paddingTop: "32@vs" },
  plainLine: { fontSize: "17@ms", lineHeight: 28, textAlign: "center", paddingVertical: 2 },
  spacer: { height: "20@vs" },
});

const addStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 36, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  headerTitle: { fontSize: moderateScale(16), fontWeight: "700" },
  saveBtn: { fontSize: moderateScale(15), fontWeight: "700" },
  trackInfo: { fontSize: moderateScale(13), marginBottom: 10 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, borderRadius: 8, padding: 10 },
  hintText: { fontSize: moderateScale(12), flex: 1, lineHeight: 18 },
  input: { fontSize: moderateScale(14), lineHeight: 22, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 220, marginBottom: 10 },
  errorText: { fontSize: moderateScale(12), marginBottom: 8 },
  footerNote: { fontSize: moderateScale(11), textAlign: "center", lineHeight: 16, marginTop: 4 },
});
