/**
 * (modals)/lyrics.tsx  — v3
 *
 * FIXED: Removed react-native-track-player dependency
 * Uses PlayerEngineContext for playback position instead of RNTP useProgress
 *
 * Lyrics priority:
 *   1. Supabase cache (via LyricsFetcher context)   — fastest
 *   2. LRCLib synced  → animated karaoke display
 *   3. LRCLib plain   → static scrollable text
 *   4. Nothing found  → "No lyrics" state with ➕ Add Lyrics button
 *
 * Add Lyrics:
 *   - User pastes plain text or LRC-formatted lyrics.
 *   - Saved to Supabase `lyrics` table via submitUserLyrics().
 *   - Instantly reflected in the UI without re-fetch.
 *
 * Params from PlayerScreen.handleLyrics:
 *   title:    string
 *   artist:   string
 *   duration: string  (seconds)
 *   videoId:  string  (bare YouTube ID — used as Supabase key)
 */

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
  Platform,
  Alert,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  bg:         "#000000",
  surface:    "#111111",
  surfaceAlt: "#1A1A1A",
  border:     "rgba(255,255,255,0.08)",
  borderGold: "rgba(212,175,55,0.22)",
  gold:       "#D4AF37",
  goldDim:    "rgba(212,175,55,0.40)",
  text:       "#FFFFFF",
  textSub:    "#888888",
  textMuted:  "#444444",
  textPlain:  "rgba(255,255,255,0.80)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function LyricsModal() {
  const router          = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  
  // FIXED: Use PlayerEngineContext instead of RNTP useProgress
  const engine = usePlayerEngine();
  const position = engine.position;
  const duration = engine.duration;

  const { title, artist, duration: durationParam, videoId, leadIn } = useLocalSearchParams<{
    title:    string;
    artist:   string;
    duration: string;
    videoId:  string;
    leadIn?:  string;
  }>();

  // Parse lead-in — PlayerScreen passes LYRICS_LEAD_IN_S (default 0.25 s)
  const LEAD_IN = leadIn ? parseFloat(leadIn) : 0.25;

  // FIXED: Use local position state that updates from engine
  const seekTime = useSharedValue(0);
  
  // Add lead-in offset so the highlight lands before the syllable starts
  useEffect(() => { 
    seekTime.value = position + LEAD_IN; 
  }, [position, LEAD_IN]);

  // Pull lyrics from context (LyricsFetcher drives the fetch)
  const { lyrics, isFetchingLyrics } = useLyricsContext();

  // Modal for adding lyrics
  const [addModalVisible, setAddModalVisible] = useState(false);

  // ── Derived state ──────────────────────────────────────────────────────────

  const hasSynced = lyrics.length > 0 && lyrics.some((l) => l.synced);
  const hasPlain  = lyrics.length > 0 && lyrics.every((l) => !l.synced);
  const isEmpty   = !isFetchingLyrics && lyrics.length === 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleLyricsSubmitted = useCallback((newLines: LyricLine[]) => {
    setAddModalVisible(false);
    Alert.alert("Thanks!", "Your lyrics have been saved and will appear for future listeners.");
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: top }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { triggerHaptic(); router.back(); }}
          style={styles.backBtn}
          hitSlop={10}
        >
          <Ionicons name="chevron-down" size={22} color={C.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title ?? "Lyrics"}</Text>
          <Text style={styles.headerSub}   numberOfLines={1}>{artist ?? ""}</Text>
        </View>

        {/* Add-lyrics shortcut in header (visible when empty) */}
        {isEmpty ? (
          <TouchableOpacity
            onPress={() => { triggerHaptic(); setAddModalVisible(true); }}
            style={styles.addHeaderBtn}
            hitSlop={8}
          >
            <Ionicons name="add-circle-outline" size={24} color={C.gold} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <View style={styles.divider} />

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {isFetchingLyrics && (
        <View style={styles.centered}>
          <ActivityIndicator color={C.gold} size="large" />
          <Text style={styles.statusText}>Fetching lyrics…</Text>
        </View>
      )}

      {/* ── Synced karaoke ──────────────────────────────────────────────────── */}
      {!isFetchingLyrics && hasSynced && (
        <SyncedView
          lines={lyrics}
          seekTime={seekTime}
          position={position}
          bottom={bottom}
          leadIn={LEAD_IN}
        />
      )}

      {/* ── Plain text ──────────────────────────────────────────────────────── */}
      {!isFetchingLyrics && hasPlain && (
        <PlainView lines={lyrics} bottom={bottom} />
      )}

      {/* ── Nothing found ───────────────────────────────────────────────────── */}
      {isEmpty && (
        <View style={styles.centered}>
          <Ionicons
            name="musical-notes-outline"
            size={52}
            color={C.textMuted}
            style={{ marginBottom: 16 }}
          />
          <Text style={styles.emptyTitle}>
            No lyrics found for
          </Text>
          <Text style={styles.emptyTrackName} numberOfLines={2}>
            "{title ?? "this track"}"
          </Text>
          <Text style={styles.emptySub}>
            Know the lyrics? Help other listeners by adding them.
          </Text>

          <TouchableOpacity
            style={styles.addLyricsBtn}
            onPress={() => { triggerHaptic(); setAddModalVisible(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={18} color="#000" style={{ marginRight: 6 }} />
            <Text style={styles.addLyricsBtnText}>Add Lyrics</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Add Lyrics Modal ─────────────────────────────────────────────────── */}
      <AddLyricsModal
        visible={addModalVisible}
        title={title ?? ""}
        artist={artist ?? ""}
        videoId={videoId ?? ""}
        onClose={() => setAddModalVisible(false)}
        onSubmitted={handleLyricsSubmitted}
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
}

function SyncedView({ lines, seekTime, position, bottom, leadIn }: SyncedViewProps) {
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

  // Calculate endTime for a line based on next line's startTime
  const getLineEndTime = useCallback((index: number, currentStartTime: number): number => {
    // Look for the next non-empty line with a startTime
    for (let i = index + 1; i < lines.length; i++) {
      const nextLine = lines[i];
      if (nextLine.text !== "" && nextLine.startTime !== undefined) {
        return nextLine.startTime;
      }
    }
    // If no next line, assume 5 seconds duration
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
          <View
            key={i}
            onLayout={(e) => { lineHeights.current[i] = e.nativeEvent.layout.height; }}
          >
            <AnimatedLyricLine
              text={line.text}
              startTime={startTime}
              endTime={endTime}
              seekTime={seekTime}
            />
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
}

function AnimatedLyricLine({ text, startTime, endTime, seekTime }: AnimatedLyricLineProps) {
  const color = useDerivedValue(() => {
    // seekTime already has lead-in baked in from LyricsModal
    const active = seekTime.value >= startTime && seekTime.value < endTime;
    return withTiming(active ? "#FFFFFF" : "rgba(255,255,255,0.30)", {
      duration: active ? 80 : 400,
    });
  });

  const animStyle = useAnimatedStyle(() => ({ color: color.value }));

  return (
    <Animated.Text style={[styles.syncedLine, animStyle]}>
      {text}
    </Animated.Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlainView — static scrollable plain lyrics
// ─────────────────────────────────────────────────────────────────────────────

interface PlainViewProps {
  lines:  LyricLine[];
  bottom: number;
}

function PlainView({ lines, bottom }: PlainViewProps) {
  return (
    <ScrollView
      contentContainerStyle={[styles.plainContent, { paddingBottom: bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((line, i) =>
        line.text === "" ? (
          <View key={i} style={styles.spacer} />
        ) : (
          <Text key={i} style={styles.plainLine}>
            {line.text}
          </Text>
        )
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddLyricsModal — inline modal for submitting lyrics to Supabase
// ─────────────────────────────────────────────────────────────────────────────

interface AddLyricsModalProps {
  visible:     boolean;
  title:       string;
  artist:      string;
  videoId:     string;
  onClose:     () => void;
  onSubmitted: (lines: LyricLine[]) => void;
}

function AddLyricsModal({
  visible, title, artist, videoId, onClose, onSubmitted,
}: AddLyricsModalProps) {
  const [text,     setText]     = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const isSynced = /^\[\d{2}:\d{2}\.\d{2,3}\]/m.test(text.trim());

  const handleSave = async () => {
    if (!text.trim()) { setError("Please paste the lyrics first."); return; }
    if (!videoId)     { setError("No video ID — cannot save."); return; }

    triggerHaptic();
    setSaving(true);
    setError(null);

    const result = await submitUserLyrics(videoId, title, artist, text.trim());

    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Save failed. Please try again.");
      return;
    }

    // Build preview lines to pass back
    const lines: LyricLine[] = isSynced
      ? text.trim().split("\n")
          .filter((l) => /^\[\d{2}:\d{2}\.\d{2,3}\]/.test(l))
          .map((l) => ({
            text:   l.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, ""),
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={addStyles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={addStyles.sheet}>

          {/* Handle */}
          <View style={addStyles.handle} />

          {/* Header */}
          <View style={addStyles.header}>
            <TouchableOpacity onPress={() => { triggerHaptic(); onClose(); }} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textSub} />
            </TouchableOpacity>
            <Text style={addStyles.headerTitle}>Add Lyrics</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || !text.trim()}
              hitSlop={8}
            >
              {saving ? (
                <ActivityIndicator size="small" color={C.gold} />
              ) : (
                <Text style={[
                  addStyles.saveBtn,
                  (!text.trim()) && addStyles.saveBtnDisabled,
                ]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Track info */}
          <Text style={addStyles.trackInfo} numberOfLines={1}>
            {title}{artist ? ` · ${artist}` : ""}
          </Text>

          {/* Format hint */}
          <View style={addStyles.hintRow}>
            <Ionicons
              name={isSynced ? "checkmark-circle" : "information-circle-outline"}
              size={14}
              color={isSynced ? C.gold : C.textSub}
            />
            <Text style={[addStyles.hintText, isSynced && { color: C.gold }]}>
              {isSynced
                ? "LRC format detected — will display as synced karaoke"
                : "Paste plain lyrics or LRC format (with [mm:ss.xx] timestamps)"}
            </Text>
          </View>

          {/* Text input */}
          <TextInput
            style={addStyles.input}
            value={text}
            onChangeText={(t) => { setText(t); setError(null); }}
            placeholder="[00:12.00] First line of the song\n[00:15.50] Second line...\n\nOr paste plain text without timestamps"
            placeholderTextColor={C.textMuted}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            selectionColor={C.gold}
            textAlignVertical="top"
          />

          {error && (
            <Text style={addStyles.errorText}>{error}</Text>
          )}

          <Text style={addStyles.footerNote}>
            Lyrics you submit will be visible to all listeners of this track.
            Please only submit accurate lyrics.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: "center", justifyContent: "center",
  },
  addHeaderBtn: {
    width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle:  { fontSize: "15@ms", fontWeight: "700", color: C.text },
  headerSub:    { fontSize: "12@ms", color: C.textSub, marginTop: 2 },

  divider: {
    height: 0.5,
    backgroundColor: C.borderGold,
    marginHorizontal: 16,
    marginBottom: 8,
  },

  centered: {
    flex: 1, alignItems: "center", justifyContent: "center", padding: 32,
  },
  statusText:     { fontSize: "13@ms", color: C.textSub, marginTop: 12 },
  emptyTitle:     { fontSize: "17@ms", fontWeight: "600", color: C.text, textAlign: "center" },
  emptyTrackName: { fontSize: "15@ms", color: C.textSub, textAlign: "center", marginTop: 4, marginBottom: 12 },
  emptySub:       { fontSize: "13@ms", color: C.textSub, textAlign: "center", lineHeight: 20, marginBottom: 24 },

  addLyricsBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.gold,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 4,
  },
  addLyricsBtnText: {
    color: "#000",
    fontSize: "14@ms",
    fontWeight: "700",
  },

  syncedContent: {
    paddingHorizontal: "24@ms",
    paddingTop: "40@vs",
    alignItems: "center",
  },
  syncedLine: {
    fontWeight: "700",
    fontSize: "24@ms",
    paddingVertical: 9,
    textAlign: "center",
  },

  plainContent: {
    paddingHorizontal: "24@ms",
    paddingTop: "32@vs",
  },
  plainLine: {
    fontSize: "17@ms",
    color: C.textPlain,
    lineHeight: 28,
    textAlign: "center",
    paddingVertical: 2,
  },

  spacer: { height: "20@vs" },
});

const addStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#111111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerTitle: {
    color: "#fff",
    fontSize: moderateScale(16),
    fontWeight: "700",
  },
  saveBtn: {
    color: C.gold,
    fontSize: moderateScale(15),
    fontWeight: "700",
  },
  saveBtnDisabled: {
    color: "rgba(212,175,55,0.3)",
  },
  trackInfo: {
    color: C.textSub,
    fontSize: moderateScale(13),
    marginBottom: 10,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: 10,
  },
  hintText: {
    color: C.textSub,
    fontSize: moderateScale(12),
    flex: 1,
    lineHeight: 18,
  },
  input: {
    color: "#fff",
    fontSize: moderateScale(14),
    lineHeight: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 14,
    minHeight: 220,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 10,
  },
  errorText: {
    color: "#EF4444",
    fontSize: moderateScale(12),
    marginBottom: 8,
  },
  footerNote: {
    color: "rgba(255,255,255,0.25)",
    fontSize: moderateScale(11),
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
});