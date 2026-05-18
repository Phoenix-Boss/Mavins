// app/(player)/library/index.tsx - COMPLETE FILE WITH FIXES
import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  FlatList,
  RefreshControl,
  Image,
  Animated,
  PanResponder,
  Dimensions,
  StyleSheet,
  Platform,
  TextInput,
  Keyboard,
  LayoutChangeEvent,
  findNodeHandle,
  UIManager,
  Modal,
  Alert,
  BackHandler,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ScaledSheet,
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer } from "@/libs/playerSetup";
import {
  useFavorites,
  useDownloadedTracks,
  type DownloadedSongMetadata,
} from "@/store/library";
import { useLocalMusicStore } from "@/store/localMusicStore";
import { FolderBrowserOverlay } from "@/components/localMusic/FolderBrowserOverlay";
import { useTheme } from "@/contexts/ThemeContext";
import { getTracksByAlbum, type LocalTrack } from "@/db/localDatabase";
import { usePlayerEngine } from "@/libs/playerSetup";
import {
  useLocalSorting,
  SORT_KEYS,
  SORT_META,
  type SortEntry,
  type SortKey,
} from "@/hooks/useLocalSorting";

// ─── Import normalizeLocalUri from player setup ─────────────────────────────
import { normalizeLocalUri } from "@/libs/playerSetup";

// ─── Self-contained sort engine ───────────────────────────────────────────────
// applySorts() from the hook maps SortKeys to field names that don't match
// the actual LocalTrack DB schema (album_tracks table). Real columns are:
//
//   title, artist, album, duration, file_uri,
//   last_modified (Unix ms int), added_to_library (Unix ms int), album_id
//
// Fields the hook assumes but that DON'T EXIST: date_modified, date_added,
// track_number, rating, play_count, year, folder, name, filename.
// Comparing undefined vs undefined returns 0 → list never moves.
//
// This maps every SortKey to the field that actually exists in the schema.

function applyLocalSorts(tracks: LocalTrack[], sorts: SortEntry[]): LocalTrack[] {
  if (!sorts || sorts.length === 0) return tracks;

  const UNKNOWN = "\u{10FFFF}"; // sorts last regardless of direction

  return [...tracks].sort((a, b) => {
    for (const { key, dir } of sorts) {
      let va: any;
      let vb: any;

      switch (key) {
        case "name":
          // "name" key → real column is "title"
          va = (a.title || "").trim();
          vb = (b.title || "").trim();
          break;

        case "artist":
          // Push "Unknown Artist" to the end regardless of sort direction
          va = (!a.artist || a.artist === "Unknown Artist") ? UNKNOWN : a.artist.trim();
          vb = (!b.artist || b.artist === "Unknown Artist") ? UNKNOWN : b.artist.trim();
          break;

        case "album":
          va = (a.album || "").trim();
          vb = (b.album || "").trim();
          break;

        case "filename":
          // "filename" key → real column is "file_uri"; extract basename only
          va = (a.file_uri || "").split("/").pop() || "";
          vb = (b.file_uri || "").split("/").pop() || "";
          break;

        case "folder":
          // No folder column — album_id is the folder identifier
          va = (a.album_id || "").trim();
          vb = (b.album_id || "").trim();
          break;

        case "duration":
          va = Number(a.duration) || 0;
          vb = Number(b.duration) || 0;
          break;

        case "dateModified":
          // "dateModified" key → real column is "last_modified" (Unix ms)
          va = Number(a.last_modified) || 0;
          vb = Number(b.last_modified) || 0;
          break;

        case "dateAdded":
          // "dateAdded" key → real column is "added_to_library" (Unix ms)
          va = Number(a.added_to_library) || 0;
          vb = Number(b.added_to_library) || 0;
          break;

        case "trackNumber":
        case "rating":
        case "playCount":
        case "year":
          // These columns don't exist in the schema — stable no-op
          va = 0;
          vb = 0;
          break;

        default:
          va = 0;
          vb = 0;
      }

      let cmp: number;
      if (typeof va === "string") {
        // numeric:true → "Track 2" sorts before "Track 10"
        // sensitivity:"base" → case-insensitive
        cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: "base" });
      } else {
        cmp = va - vb;
      }

      if (dir === "desc") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}
import { mediaStoreManager } from "@/utils/localMediaStoreManager";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const EDGE_HIT_SLOP = scale(32);
const SWIPE_THRESHOLD = scale(40);
const SORT_PANEL_W = scale(200);

// ─── Theme tokens ─────────────────────────────────────────────────────────────

function useExtendedColors(colors: any) {
  return useMemo(
    () => ({
      ...colors,
      glassOverlay: colors.glassOverlay ?? "rgba(255,255,255,0.04)",
      glassBorder: colors.glassBorder ?? "rgba(255,255,255,0.10)",
      goldGlow: colors.goldGlow ?? "rgba(212,175,55,0.18)",
    }),
    [colors]
  );
}

// ─── Themed Alert Modal ──────────────────────────────────────────────────────

interface ThemedAlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

interface ThemedAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: ThemedAlertButton[];
  colors: any;
  isDark: boolean;
  onDismiss: () => void;
}

function ThemedAlert({
  visible,
  title,
  message,
  buttons,
  colors,
  isDark,
  onDismiss,
}: ThemedAlertProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale$ = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale$, { toValue: 1, tension: 100, friction: 14, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(scale$, { toValue: 0.92, duration: 140, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[taStyles.overlay, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />
        <Animated.View
          style={[
            taStyles.sheet,
            {
              backgroundColor: isDark ? colors.surface : "#ffffff",
              borderColor: `${colors.gold}35`,
              transform: [{ scale: scale$ }],
            },
          ]}
        >
          <View style={[taStyles.topAccent, { backgroundColor: colors.gold }]} />
          <View style={[taStyles.iconRing, { borderColor: `${colors.gold}40`, backgroundColor: `${colors.gold}12` }]}>
            <Ionicons name="alert-circle-outline" size={moderateScale(26)} color={colors.gold} />
          </View>
          <Text style={[taStyles.title, { color: colors.text }]}>{title}</Text>
          {message ? (
            <Text style={[taStyles.message, { color: isDark ? colors.textMuted : "#555" }]}>{message}</Text>
          ) : null}
          <View style={[taStyles.divider, { backgroundColor: `${colors.gold}22` }]} />
          <View style={taStyles.btnRow}>
            {buttons.map((btn, i) => {
              const isDestructive = btn.style === "destructive";
              const isCancel = btn.style === "cancel";
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    taStyles.btn,
                    i < buttons.length - 1 && { borderRightWidth: 0.5, borderRightColor: `${colors.gold}22` },
                    isDestructive && { backgroundColor: "rgba(220,60,60,0.08)" },
                    !isDestructive && !isCancel && { backgroundColor: `${colors.gold}10` },
                  ]}
                  onPress={() => {
                    btn.onPress?.();
                    onDismiss();
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      taStyles.btnText,
                      isDestructive && { color: "#e04444", fontWeight: "700" },
                      isCancel && { color: isDark ? colors.textMuted : "#888", fontWeight: "500" },
                      !isDestructive && !isCancel && { color: colors.gold, fontWeight: "700" },
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const taStyles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: "32@s",
  },
  sheet: {
    width: "100%",
    borderRadius: "18@ms",
    borderWidth: 0.5,
    overflow: "hidden",
    alignItems: "center",
    paddingBottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
  },
  topAccent: { height: "3@vs", width: "100%" },
  iconRing: {
    width: "54@ms",
    height: "54@ms",
    borderRadius: "27@ms",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: "20@vs",
    marginBottom: "12@vs",
  },
  title: { fontSize: "16@ms", fontWeight: "700", marginBottom: "6@vs", textAlign: "center", paddingHorizontal: "16@s" },
  message: { fontSize: "13@ms", textAlign: "center", lineHeight: "19@ms", paddingHorizontal: "16@s", marginBottom: "20@vs" },
  divider: { height: 0.5, width: "100%" },
  btnRow: { flexDirection: "row", width: "100%" },
  btn: {
    flex: 1,
    paddingVertical: "15@vs",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: "14@ms" },
});

// ─── Inline Filter Row ───────────────────────────────────────────────────────

function InlineFilterRow({
  sorts,
  onRemove,
  onToggleDir,
  colors,
}: {
  sorts: SortEntry[];
  onRemove: (key: SortKey) => void;
  onToggleDir: (key: SortKey) => void;
  colors: any;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (sorts.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [sorts.length]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={ifrStyles.row}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          ifrStyles.allPill,
          {
            backgroundColor: sorts.length === 0 ? `${colors.gold}20` : `${colors.gold}08`,
            borderColor: sorts.length === 0 ? `${colors.gold}60` : `${colors.gold}28`,
          },
        ]}
      >
        <Text style={[ifrStyles.allText, { color: sorts.length === 0 ? colors.gold : colors.textMuted }]}>
          All
        </Text>
      </View>

      {sorts.map((s, i) => {
        const meta = SORT_META[s.key];
        return (
          <View
            key={s.key}
            style={[
              ifrStyles.sortPill,
              {
                backgroundColor: `${colors.gold}16`,
                borderColor: `${colors.gold}50`,
              },
            ]}
          >
            <View style={[ifrStyles.badge, { backgroundColor: `${colors.gold}30` }]}>
              <Text style={[ifrStyles.badgeText, { color: colors.gold }]}>{i + 1}</Text>
            </View>
            <Ionicons
              name={meta.icon as any}
              size={moderateScale(10)}
              color={colors.gold}
              style={{ marginRight: scale(3) }}
            />
            <Text style={[ifrStyles.sortLabel, { color: colors.gold }]} numberOfLines={1}>
              {meta.label}
            </Text>
            <TouchableOpacity
              style={ifrStyles.dirBtn}
              onPress={() => {
                triggerHaptic();
                onToggleDir(s.key);
              }}
              hitSlop={6}
            >
              <Ionicons
                name={s.dir === "asc" ? "arrow-up" : "arrow-down"}
                size={moderateScale(9)}
                color={`${colors.gold}cc`}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={ifrStyles.removeBtn}
              onPress={() => {
                triggerHaptic();
                onRemove(s.key);
              }}
              hitSlop={6}
            >
              <Ionicons name="close" size={moderateScale(9)} color={`${colors.textMuted}aa`} />
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const ifrStyles = ScaledSheet.create({
  row: {
    paddingHorizontal: "14@s",
    paddingVertical: "4@vs",
    gap: "6@s" as any,
    alignItems: "center",
    flexDirection: "row",
  },
  allPill: {
    paddingHorizontal: "12@s",
    paddingVertical: "5@vs",
    borderRadius: "20@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  allText: { fontSize: "11@ms", fontWeight: "700" },
  sortPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: "4@vs",
    paddingLeft: "5@s",
    paddingRight: "7@s",
    borderRadius: "20@ms",
    borderWidth: 0.5,
  },
  badge: {
    width: "13@ms",
    height: "13@ms",
    borderRadius: "7@ms",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "3@s",
  },
  badgeText: { fontSize: "7@ms", fontWeight: "800" },
  sortLabel: { fontSize: "10@ms", fontWeight: "600", marginRight: "3@s" },
  dirBtn: { padding: "2@ms", marginRight: "2@s" },
  removeBtn: { padding: "2@ms" },
});

// ─── Sort Panel ──────────────────────────────────────────────────────────────
// onToggle is now a TRUE toggle: if the key is already active it removes it,
// if not active it adds it. Panel stays open after every tap so the user can
// build multi-sort combinations without reopening.

interface SortPanelProps {
  visible: boolean;
  sorts: SortEntry[];
  onDismiss: () => void;
  onToggle: (key: SortKey) => void; // toggles on/off — panel stays open
  colors: any;
  anchorRef: React.RefObject<View>;
  insetTop: number;
}

function SortPanel({ visible, sorts, onDismiss, onToggle, colors, anchorRef, insetTop }: SortPanelProps) {
  const translateX = useRef(new Animated.Value(SORT_PANEL_W)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [showLabels, setShowLabels] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const [panelHeight, setPanelHeight] = useState(0);
  const [anchorPosition, setAnchorPosition] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const measureAnchor = useCallback(() => {
    if (anchorRef.current) {
      const nodeHandle = findNodeHandle(anchorRef.current);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (x, y, width, height, pageX, pageY) => {
          setAnchorPosition({ x: pageX, y: pageY, width, height });
        });
      }
    }
  }, [anchorRef]);

  useEffect(() => {
    if (visible) {
      measureAnchor();
      setMounted(true);
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, tension: 90, friction: 14, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: SORT_PANEL_W, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, measureAnchor]);

  useEffect(() => {
    if (visible) measureAnchor();
  }, [visible, measureAnchor]);

  if (!mounted) return null;

  const activeKeys = new Set(sorts.map((s) => s.key));
  const rows: SortKey[][] = [];
  for (let i = 0; i < SORT_KEYS.length; i += 3) {
    rows.push(SORT_KEYS.slice(i, i + 3));
  }

  const buttonCenterX = anchorPosition.x + anchorPosition.width / 2;
  const panelRightEdge = SCREEN_W - 10;

  let topPosition = anchorPosition.y + anchorPosition.height + 8;
  const wouldGoOffScreen = topPosition + panelHeight + 20 > SCREEN_H - insetTop;
  if (wouldGoOffScreen && panelHeight > 0) {
    topPosition = anchorPosition.y - panelHeight - 8;
  }

  const arrowRightOffset = panelRightEdge - buttonCenterX;

  return (
    <>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { opacity, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 990 },
        ]}
        pointerEvents={visible ? "box-none" : "none"}
      >
        <TouchableWithoutFeedback onPress={onDismiss}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <Animated.View
        onLayout={(e: LayoutChangeEvent) => setPanelHeight(e.nativeEvent.layout.height)}
        style={[
          spStyles.panel,
          {
            top: Math.max(insetTop + 50, topPosition),
            right: 10,
            width: SORT_PANEL_W,
            transform: [{ translateX }],
            zIndex: 999,
          },
        ]}
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={70}
            tint="dark"
            style={[StyleSheet.absoluteFillObject, { borderRadius: moderateScale(14) }]}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: moderateScale(14),
                backgroundColor: `${colors.surface}f2`,
              },
            ]}
          />
        )}

        <View
          style={[
            spStyles.arrow,
            {
              top: -6,
              right: Math.max(10, Math.min(SORT_PANEL_W - 20, arrowRightOffset)),
              borderBottomColor: colors.surface,
              borderTopColor: colors.surface,
            },
          ]}
        />
        <View
          style={[
            spStyles.arrowGlow,
            {
              top: -5,
              right: Math.max(10, Math.min(SORT_PANEL_W - 20, arrowRightOffset)),
              borderBottomColor: `${colors.gold}40`,
              borderTopColor: `${colors.gold}40`,
            },
          ]}
        />

        <View style={[spStyles.leftLine, { backgroundColor: `${colors.gold}66` }]} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={spStyles.headerRow}>
            <TouchableOpacity
              style={[
                spStyles.eyeBtn,
                {
                  backgroundColor: showLabels ? `${colors.gold}18` : `${colors.gold}08`,
                  borderColor: showLabels ? `${colors.gold}55` : `${colors.gold}22`,
                },
              ]}
              onPress={() => {
                triggerHaptic();
                setShowLabels((v) => !v);
              }}
              hitSlop={8}
              activeOpacity={0.75}
            >
              <Ionicons
                name={showLabels ? "eye" : "eye-outline"}
                size={moderateScale(13)}
                color={showLabels ? colors.gold : colors.textMuted}
              />
            </TouchableOpacity>
          </View>

          <View style={spStyles.grid}>
            {rows.map((row, ri) => (
              <View key={ri} style={spStyles.gridRow}>
                {row.map((key) => {
                  const meta = SORT_META[key];
                  const active = activeKeys.has(key);
                  const entry = sorts.find((s) => s.key === key);
                  const pri = sorts.findIndex((s) => s.key === key) + 1;

                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        spStyles.iconCell,
                        { backgroundColor: active ? `${colors.gold}12` : "transparent" },
                      ]}
                      onPress={() => {
                        triggerHaptic();
                        // TRUE toggle: tap active → remove; tap inactive → add.
                        // Panel stays open so user can build multi-sort combinations.
                        onToggle(key);
                      }}
                      activeOpacity={0.72}
                    >
                      {active && (
                        <View style={[spStyles.priBadge, { backgroundColor: colors.gold }]}>
                          <Text style={spStyles.priBadgeText}>{pri}</Text>
                        </View>
                      )}
                      <Ionicons
                        name={meta.icon as any}
                        size={moderateScale(showLabels ? 14 : 18)}
                        color={active ? colors.gold : `${colors.gold}80`}
                      />
                      {showLabels && (
                        <Text
                          style={[
                            spStyles.cellLabel,
                            { color: active ? colors.gold : `${colors.gold}80` },
                          ]}
                          numberOfLines={1}
                        >
                          {meta.label}
                        </Text>
                      )}
                      {active && entry && (
                        <View style={spStyles.dirArrow}>
                          <Ionicons
                            name={entry.dir === "asc" ? "arrow-up" : "arrow-down"}
                            size={moderateScale(7)}
                            color={`${colors.gold}cc`}
                          />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </>
  );
}

const spStyles = ScaledSheet.create({
  panel: {
    position: "absolute",
    borderRadius: "14@ms",
    borderLeftWidth: 0.5,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "rgba(212,175,55,0.28)",
    overflow: "hidden",
    paddingHorizontal: "10@s",
    paddingTop: "12@vs",
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 20,
  },
  arrow: {
    position: "absolute",
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    zIndex: 1,
  },
  arrowGlow: {
    position: "absolute",
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    zIndex: 0,
  },
  leftLine: {
    position: "absolute",
    left: 0,
    top: "28@vs",
    bottom: "28@vs",
    width: "1.5@s",
    borderRadius: "1@ms",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: "10@vs",
    paddingRight: "2@s",
  },
  eyeBtn: {
    width: "26@ms",
    height: "26@ms",
    borderRadius: "8@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { gap: "4@vs" as any },
  gridRow: { flexDirection: "row", gap: "4@s" as any, justifyContent: "space-between" },
  iconCell: {
    flex: 1,
    paddingVertical: "8@vs",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    minHeight: "40@ms",
  },
  cellLabel: { fontSize: "8@ms", fontWeight: "600", textAlign: "center", marginTop: "2@vs" },
  priBadge: {
    position: "absolute",
    top: "0@vs",
    right: "0@s",
    width: "12@ms",
    height: "12@ms",
    borderRadius: "6@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  priBadgeText: { fontSize: "6@ms", fontWeight: "900", color: "#000" },
  dirArrow: { position: "absolute", bottom: "0@vs", right: "2@s" },
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (dest: "browse" | "favorites" | "downloads" | "recentlyPlayed" | "mostPlayed") => void;
  colors: any;
  insetTop: number;
}

function Sidebar({ visible, onClose, onSelect, colors, insetTop }: SidebarProps) {
  const translateX = useRef(new Animated.Value(220)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [showLabels, setShowLabels] = useState(false);
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, tension: 90, friction: 14, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: 220, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;

  const items: Array<{ icon: string; label: string; dest: any }> = [
    { icon: "library-outline", label: "Browse", dest: "browse" },
    { icon: "heart", label: "Favourites", dest: "favorites" },
    { icon: "cloud-download-outline", label: "Downloads", dest: "downloads" },
    { icon: "time-outline", label: "Recently Played", dest: "recentlyPlayed" },
    { icon: "trending-up-outline", label: "Most Played", dest: "mostPlayed" },
  ];

  return (
    <>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { opacity, backgroundColor: "rgba(0,0,0,0.48)", zIndex: 990 },
        ]}
        pointerEvents={visible ? "box-none" : "none"}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <Animated.View
        style={[
          sbPanelStyles.panel,
          {
            top: insetTop + verticalScale(52),
            zIndex: 999,
            transform: [{ translateX }],
            width: showLabels ? scale(170) : scale(54),
          },
        ]}
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={60}
            tint="dark"
            style={[StyleSheet.absoluteFillObject, { borderRadius: moderateScale(14) }]}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: moderateScale(14),
                backgroundColor: `${colors.surface}ec`,
              },
            ]}
          />
        )}

        <View style={[sbPanelStyles.topLine, { backgroundColor: `${colors.gold}66` }]} />

        <TouchableOpacity
          style={[
            sbPanelStyles.eyeBtn,
            {
              backgroundColor: showLabels ? `${colors.gold}18` : `${colors.gold}08`,
              borderColor: showLabels ? `${colors.gold}55` : `${colors.gold}22`,
              alignSelf: showLabels ? "flex-end" : "center",
            },
          ]}
          onPress={() => {
            triggerHaptic();
            setShowLabels((v) => !v);
          }}
          hitSlop={8}
          activeOpacity={0.75}
        >
          <Ionicons
            name={showLabels ? "eye" : "eye-outline"}
            size={moderateScale(12)}
            color={showLabels ? colors.gold : colors.textMuted}
          />
        </TouchableOpacity>

        <View style={sbPanelStyles.itemsWrap}>
          {items.map((it) => (
            <SidebarItem
              key={it.dest}
              icon={it.icon}
              label={it.label}
              showLabel={showLabels}
              colors={colors}
              onPress={() => {
                onSelect(it.dest);
                onClose();
              }}
            />
          ))}
        </View>
      </Animated.View>
    </>
  );
}

interface SidebarItemProps {
  icon: string;
  label: string;
  showLabel: boolean;
  onPress: () => void;
  colors: any;
}

function SidebarItem({ icon, label, showLabel, onPress, colors }: SidebarItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.82, duration: 90, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    triggerHaptic();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], width: "100%" }}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
        style={[
          sbItemStyles.item,
          { borderColor: "transparent", backgroundColor: `${colors.gold}08` },
          showLabel && sbItemStyles.itemWithLabel,
        ]}
      >
        <View style={[sbItemStyles.iconWrap, { backgroundColor: `${colors.gold}10` }]}>
          <Ionicons name={icon as any} size={moderateScale(15)} color={`${colors.gold}99`} />
        </View>
        {showLabel && (
          <Text style={[sbItemStyles.label, { color: colors.textMuted }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const sbItemStyles = ScaledSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderRadius: "9@ms",
    borderWidth: 0.5,
    paddingVertical: "8@vs",
    paddingHorizontal: "6@s",
    marginBottom: "4@vs",
  },
  itemWithLabel: {
    justifyContent: "flex-start",
    paddingHorizontal: "8@s",
  },
  iconWrap: {
    width: "28@ms",
    height: "28@ms",
    borderRadius: "7@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: "11@ms", fontWeight: "500", marginLeft: "7@s" },
});

const sbPanelStyles = ScaledSheet.create({
  panel: {
    position: "absolute",
    right: "10@s",
    borderRadius: "14@ms",
    borderWidth: 0.5,
    borderColor: "rgba(212,175,55,0.22)",
    overflow: "hidden",
    paddingHorizontal: "6@s",
    paddingTop: "10@vs",
    paddingBottom: "10@vs",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 20,
  },
  topLine: {
    height: "1.5@vs",
    borderRadius: "1@ms",
    marginBottom: "8@vs",
    width: "28@ms",
    alignSelf: "center",
  },
  eyeBtn: {
    width: "24@ms",
    height: "24@ms",
    borderRadius: "7@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "8@vs",
  },
  itemsWrap: { width: "100%" },
});

// ─── Swipe Gesture Wrapper ───────────────────────────────────────────────────

interface SwipeGestureWrapperProps {
  isLocalMode: boolean;
  onShowSidebar: () => void;
  onReturnToLocal: () => void;
  children: React.ReactNode;
}

function SwipeGestureWrapper({
  isLocalMode,
  onShowSidebar,
  onReturnToLocal,
  children,
}: SwipeGestureWrapperProps) {
  const gestureActive = useRef(false);
  const isLocalModeRef = useRef(isLocalMode);
  const onShowSidebarRef = useRef(onShowSidebar);
  const onReturnToLocalRef = useRef(onReturnToLocal);

  useEffect(() => { isLocalModeRef.current = isLocalMode; }, [isLocalMode]);
  useEffect(() => { onShowSidebarRef.current = onShowSidebar; }, [onShowSidebar]);
  useEffect(() => { onReturnToLocalRef.current = onReturnToLocal; }, [onReturnToLocal]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.pageX > SCREEN_W - EDGE_HIT_SLOP,
      onMoveShouldSetPanResponder: (evt, gs) => {
        if (Math.abs(gs.dy) > Math.abs(gs.dx)) return false;
        return gs.dx < -8 && evt.nativeEvent.pageX > SCREEN_W - EDGE_HIT_SLOP - scale(20);
      },
      onPanResponderGrant: () => { gestureActive.current = true; },
      onPanResponderRelease: (_evt, gs) => {
        if (!gestureActive.current) return;
        gestureActive.current = false;
        const leftSwipe = gs.dx < -SWIPE_THRESHOLD && Math.abs(gs.dy) < scale(60);
        if (leftSwipe) {
          if (isLocalModeRef.current) {
            onShowSidebarRef.current();
          } else {
            onReturnToLocalRef.current();
          }
        }
      },
      onPanResponderTerminate: () => { gestureActive.current = false; },
    })
  ).current;

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}

// ─── Pinch-to-zoom Image ─────────────────────────────────────────────────────

function PinchZoomImage({
  uri,
  size,
  radius = 8,
  colors,
}: {
  uri?: string;
  size: number;
  radius?: number;
  colors: any;
}) {
  const scale$ = useRef(new Animated.Value(1)).current;
  const lastScale = useRef(1);
  const initialDistance = useRef<number | null>(null);

  const getDistance = (touches: any[]) => {
    const [a, b] = touches;
    return Math.sqrt(Math.pow(a.pageX - b.pageX, 2) + Math.pow(a.pageY - b.pageY, 2));
  };

  const pinch = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2)
          initialDistance.current = getDistance(evt.nativeEvent.touches as any);
      },
      onPanResponderMove: (evt) => {
        if (evt.nativeEvent.touches.length === 2 && initialDistance.current) {
          const ratio = getDistance(evt.nativeEvent.touches as any) / initialDistance.current;
          scale$.setValue(Math.min(Math.max(lastScale.current * ratio, 0.85), 2.6));
        }
      },
      onPanResponderRelease: () => {
        lastScale.current = (scale$ as any).__getValue?.() ?? 1;
        if (lastScale.current < 1) {
          Animated.spring(scale$, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }).start(() => {
            lastScale.current = 1;
          });
        }
      },
    })
  ).current;

  // Normalize artwork URI if provided
  const normalizedUri = uri ? normalizeLocalUri(uri) : undefined;

  if (normalizedUri) {
    return (
      <Animated.View style={{ transform: [{ scale: scale$ }] }} {...pinch.panHandlers}>
        <Image source={{ uri: normalizedUri }} style={{ width: size, height: size, borderRadius: radius }} />
      </Animated.View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.surfaceHigh ?? colors.surface,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <Ionicons name="musical-notes" size={size * 0.38} color={colors.textMuted} />
    </View>
  );
}

// ─── QuickPill ───────────────────────────────────────────────────────────────

function QuickPill({
  icon,
  label,
  sub,
  onPress,
  badge,
  colors,
  index,
}: {
  icon: string;
  label: string;
  sub: string;
  onPress: () => void;
  badge?: number;
  colors: any;
  index: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, delay: index * 55, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 280, delay: index * 55, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity
        style={[
          qStyles.pill,
          {
            backgroundColor: colors.surfaceRaised ?? colors.surface,
            borderColor: `${colors.gold}28`,
          },
        ]}
        onPress={() => {
          triggerHaptic();
          onPress();
        }}
        activeOpacity={0.72}
      >
        <View style={[qStyles.iconWrap, { backgroundColor: `${colors.gold}14` }]}>
          <Ionicons name={icon as any} size={moderateScale(16)} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[qStyles.label, { color: colors.text }]} numberOfLines={1}>{label}</Text>
          <Text style={[qStyles.sub, { color: colors.textMuted }]} numberOfLines={1}>{sub}</Text>
        </View>
        {badge != null && badge > 0 && (
          <View style={[qStyles.badge, { backgroundColor: `${colors.gold}16`, borderColor: `${colors.gold}36` }]}>
            <Text style={[qStyles.badgeText, { color: colors.gold }]}>
              {badge > 999 ? "999+" : badge}
            </Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={moderateScale(11)} color={`${colors.textMuted}88`} style={{ marginLeft: scale(6) }} />
        <View style={[qStyles.edgeAccent, { backgroundColor: `${colors.gold}40` }]} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const qStyles = ScaledSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: "11@ms",
    borderWidth: 0.5,
    paddingVertical: "12@vs",
    paddingHorizontal: "14@s",
    marginBottom: "7@vs",
    overflow: "hidden",
  },
  iconWrap: {
    width: "34@ms",
    height: "34@ms",
    borderRadius: "9@ms",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12@s",
  },
  label: { fontSize: "13@ms", fontWeight: "600", letterSpacing: 0.1 },
  sub: { fontSize: "10@ms", marginTop: "2@vs" },
  badge: {
    borderRadius: "8@ms",
    borderWidth: 0.5,
    paddingHorizontal: "7@s",
    paddingVertical: "2@vs",
    minWidth: "24@ms",
    alignItems: "center",
    marginRight: "6@s",
  },
  badgeText: { fontSize: "10@ms", fontWeight: "700" },
  edgeAccent: {
    position: "absolute",
    right: 0,
    top: "8@vs",
    bottom: "8@vs",
    width: "2.5@s",
    borderRadius: "2@ms",
  },
});

// ─── Folder Card ─────────────────────────────────────────────────────────────

function FolderCard({
  id,
  name,
  onPress,
  onLongPress,
  colors,
  index,
  selectionMode,
  selected,
}: {
  id: string;
  name: string;
  onPress: () => void;
  onLongPress?: () => void;
  colors: any;
  index: number;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, delay: index * 48, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: 240, delay: index * 48, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }] }}>
      <TouchableOpacity
        style={[
          fcStyles.card,
          {
            backgroundColor: selected ? `${colors.gold}14` : colors.surfaceRaised ?? colors.surface,
            borderColor: selected ? `${colors.gold}55` : `${colors.gold}20`,
          },
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        activeOpacity={0.75}
      >
        {selectionMode ? (
          <View
            style={[
              fcStyles.selectionCircle,
              selected
                ? { backgroundColor: colors.gold, borderColor: colors.gold }
                : { borderColor: `${colors.textMuted}55` },
            ]}
          >
            {selected && <Ionicons name="checkmark" size={moderateScale(12)} color="#000" />}
          </View>
        ) : (
          <View style={[fcStyles.iconWrap, { backgroundColor: `${colors.gold}12` }]}>
            <Ionicons name="folder-outline" size={moderateScale(20)} color={colors.gold} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[fcStyles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
        </View>
        {!selectionMode && (
          <Ionicons name="chevron-forward" size={moderateScale(11)} color={`${colors.textMuted}66`} />
        )}
        <View style={[fcStyles.leftBar, { backgroundColor: `${colors.gold}55` }]} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const fcStyles = ScaledSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: "16@s",
    marginBottom: "4@vs",
    borderRadius: "11@ms",
    borderWidth: 0.5,
    paddingVertical: "12@vs",
    paddingHorizontal: "12@s",
    overflow: "hidden",
  },
  iconWrap: {
    width: "36@ms",
    height: "36@ms",
    borderRadius: "10@ms",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12@s",
  },
  name: { fontSize: "13@ms", fontWeight: "500", letterSpacing: 0.1 },
  leftBar: {
    position: "absolute",
    left: 0,
    top: "8@vs",
    bottom: "8@vs",
    width: "2.5@s",
    borderRadius: "2@ms",
  },
  selectionCircle: {
    width: "22@ms",
    height: "22@ms",
    borderRadius: "11@ms",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12@s",
  },
});

// ─── Track Row ───────────────────────────────────────────────────────────────

function TrackRow({
  item,
  isPlaying,
  onPress,
  colors,
}: {
  item: LocalTrack;
  isPlaying: boolean;
  onPress: () => void;
  colors: any;
}) {
  const SIZE = moderateScale(42);
  // Normalize artwork URI for display
  const artworkUri = item.cached_artwork_path || item.artwork_uri || undefined;
  
  return (
    <TouchableOpacity style={trStyles.row} onPress={onPress} activeOpacity={0.72}>
      <PinchZoomImage uri={artworkUri} size={SIZE} colors={colors} />
      <View style={trStyles.info}>
        <Text style={[trStyles.title, { color: isPlaying ? colors.gold : colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[trStyles.sub, { color: colors.textMuted }]} numberOfLines={1}>
          {item.artist === "Unknown Artist" ? "Upcoming Artist" : item.artist}
          {item.duration ? ` · ${formatDuration(item.duration)}` : ""}
        </Text>
      </View>
      {isPlaying && (
        <View style={[trStyles.playingBadge, { backgroundColor: `${colors.gold}18`, borderColor: `${colors.gold}44` }]}>
          <Ionicons name="volume-high" size={moderateScale(12)} color={colors.gold} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function formatDuration(ms: number) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

const trStyles = ScaledSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: "16@s",
    paddingVertical: "6@vs",
  },
  info: { flex: 1, marginLeft: "10@s", marginRight: "8@s" },
  title: { fontSize: "13@ms", fontWeight: "600" },
  sub: { fontSize: "10@ms", marginTop: "1@vs" },
  playingBadge: {
    width: "26@ms",
    height: "26@ms",
    borderRadius: "13@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─── Folder Detail Header ────────────────────────────────────────────────────

function FolderDetailHeader({
  folderName,
  trackCount,
  onBack,
  onSort,
  onSearchToggle,
  searchActive,
  activeSortCount,
  colors,
  sortButtonRef,
}: {
  folderName: string;
  trackCount: number;
  onBack: () => void;
  onSort: () => void;
  onSearchToggle: () => void;
  searchActive: boolean;
  activeSortCount: number;
  colors: any;
  sortButtonRef: React.RefObject<View>;
}) {
  return (
    <View style={[fdHStyles.wrap, { borderBottomColor: `${colors.gold}18` }]}>
      <TouchableOpacity onPress={onBack} hitSlop={12} style={fdHStyles.backBtn}>
        <Ionicons name="arrow-back" size={moderateScale(17)} color={colors.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[fdHStyles.title, { color: colors.text }]} numberOfLines={1}>{folderName}</Text>
        <Text style={[fdHStyles.sub, { color: colors.textMuted }]}>
          {trackCount} {trackCount === 1 ? "track" : "tracks"}
        </Text>
      </View>
      <View style={fdHStyles.actions}>
        <TouchableOpacity
          style={[
            fdHStyles.iconBtn,
            {
              backgroundColor: searchActive ? `${colors.gold}20` : `${colors.gold}0c`,
              borderColor: searchActive ? `${colors.gold}70` : `${colors.gold}38`,
            },
          ]}
          onPress={() => { triggerHaptic(); onSearchToggle(); }}
          hitSlop={10}
          activeOpacity={0.75}
        >
          <Ionicons
            name={searchActive ? "search" : "search-outline"}
            size={moderateScale(14)}
            color={searchActive ? colors.gold : `${colors.gold}b0`}
          />
        </TouchableOpacity>

        <TouchableOpacity
          ref={sortButtonRef}
          style={[
            fdHStyles.iconBtn,
            {
              backgroundColor: activeSortCount > 0 ? `${colors.gold}20` : `${colors.gold}0c`,
              borderColor: activeSortCount > 0 ? `${colors.gold}70` : `${colors.gold}38`,
            },
          ]}
          onPress={() => { triggerHaptic(); onSort(); }}
          hitSlop={10}
          activeOpacity={0.75}
        >
          <Ionicons
            name="options-outline"
            size={moderateScale(14)}
            color={activeSortCount > 0 ? colors.gold : `${colors.gold}b0`}
          />
          {activeSortCount > 0 && (
            <View style={[fdHStyles.badge, { backgroundColor: colors.gold }]}>
              <Text style={fdHStyles.badgeText}>{activeSortCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const fdHStyles = ScaledSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: "14@s",
    paddingVertical: "10@vs",
    borderBottomWidth: 0.5,
  },
  backBtn: {
    width: "32@ms",
    height: "32@ms",
    borderRadius: "9@ms",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "8@s",
  },
  title: { fontSize: "16@ms", fontWeight: "700", letterSpacing: 0.2 },
  sub: { fontSize: "10@ms", marginTop: "1@vs" },
  actions: { flexDirection: "row", alignItems: "center", gap: "6@s" as any },
  iconBtn: {
    width: "30@ms",
    height: "30@ms",
    borderRadius: "8@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    width: "13@ms",
    height: "13@ms",
    borderRadius: "7@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: "7@ms", fontWeight: "800", color: "#000" },
});

// ─── Search Bar ──────────────────────────────────────────────────────────────

function SearchBar({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (t: string) => void;
  colors: any;
}) {
  const inputRef = useRef<TextInput>(null);
  const [localValue, setLocalValue] = useState(value);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const handleChange = (text: string) => {
    setLocalValue(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { onChange(text); }, 300);
  };

  useEffect(() => { setLocalValue(value); }, [value]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  return (
    <View style={[srStyles.wrap, { borderBottomColor: `${colors.gold}18`, backgroundColor: colors.background }]}>
      <View style={[srStyles.inner, { backgroundColor: `${colors.gold}08`, borderColor: `${colors.gold}25` }]}>
        <Ionicons name="search-outline" size={moderateScale(13)} color={colors.textMuted} style={{ marginRight: scale(7) }} />
        <TextInput
          ref={inputRef}
          value={localValue}
          onChangeText={handleChange}
          placeholder="Search tracks…"
          placeholderTextColor={`${colors.textMuted}88`}
          style={[srStyles.input, { color: colors.text }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {localValue.length > 0 && (
          <TouchableOpacity onPress={() => handleChange("")} hitSlop={8}>
            <Ionicons name="close-circle" size={moderateScale(14)} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const srStyles = ScaledSheet.create({
  wrap: {
    paddingHorizontal: "14@s",
    paddingVertical: "7@vs",
    borderBottomWidth: 0.5,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: "10@ms",
    borderWidth: 0.5,
    paddingHorizontal: "10@s",
    paddingVertical: "7@vs",
  },
  input: { flex: 1, fontSize: "13@ms", padding: 0 },
});

// ─── Folder Detail Screen ────────────────────────────────────────────────────
//
// SORT FIX — three precise changes:
//
// 1. toggleSort(): replaces raw addSort as the onToggle handler.
//    If the key is already in sorts → removeSort(key).
//    If not → addSort(key).
//    This means tapping an active icon in the panel deactivates it,
//    and tapping an inactive icon activates it. Previously addSort()
//    silently ignored a key that was already present, making it look
//    like sorting was broken after the first tap.
//
// 2. displayedTracks memo: calls applySorts(tracks, sorts) directly
//    from the hook — no wrapper, no field remapping. applySorts
//    already maps every SortKey to the correct LocalTrack field:
//      "name"         → track.title ?? track.name
//      "artist"       → track.artist
//      "album"        → track.album
//      "filename"     → track.file_uri ?? track.filename
//      "folder"       → track.folder
//      "year"         → track.year          (numeric)
//      "duration"     → track.duration      (numeric)
//      "trackNumber"  → track.track_number  (numeric)
//      "rating"       → track.rating        (numeric)
//      "playCount"    → track.play_count    (numeric)
//      "dateAdded"    → track.date_added    (string/ISO → locale sort)
//      "dateModified" → track.date_modified (string/ISO → locale sort)
//    Sort is applied to the FULL track list first; search filters second
//    so sort order is always preserved within filtered results.
//
// 3. SortPanel onToggle prop is now wired to toggleSort, not addSort.

function FolderDetailScreen({
  folderId,
  folderName,
  onBack,
  colors,
  insetTop,
  initialTrackId,
}: {
  folderId: string;
  folderName: string;
  onBack: () => void;
  colors: any;
  insetTop: number;
  initialTrackId?: string;
}) {
  const engine = usePlayerEngine();
  const { playDownloadedSong } = useMusicPlayer();
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const sortButtonRef = useRef<View>(null);
  const listRef = useRef<FlatList>(null);
  const currentId = engine.currentTrack?.id;

  const {
    sorts,
    sortPanelVisible,
    setSortPanelVisible,
    addSort,
    removeSort,
    toggleSortDir,
    activeSortCount,
  } = useLocalSorting();

  // ── FIX 1: True toggle ────────────────────────────────────────────────────
  // addSort() from the hook silently ignores keys already in the list.
  // We need a real toggle: active → remove, inactive → add.
  // This is what the SortPanel onToggle prop now receives.
  // Date/time keys default to "desc" (latest first — most useful).
  // All other keys default to "asc" (A→Z, smallest first, etc.).
  // addSort() from the hook always inserts as "asc", so for date keys
  // we immediately flip to "desc" after adding.
  const DATE_SORT_KEYS: SortKey[] = ["dateModified", "dateAdded"];

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sorts.some((s) => s.key === key)) {
        removeSort(key);
      } else {
        addSort(key); // hook inserts as "asc"
        if (DATE_SORT_KEYS.includes(key)) {
          toggleSortDir(key); // flip to "desc" so latest appears first
        }
      }
    },
    [sorts, addSort, removeSort, toggleSortDir]
  );

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const folderTracks = await getTracksByAlbum(folderId);
      setTracks(folderTracks);
    } catch (error) {
      console.error("[FolderDetail] Failed to load tracks:", error);
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { loadTracks(); }, [loadTracks]);

  // ─── FIX: Proper handlePlay with URI normalization ─────────────────────────
  const handlePlay = useCallback((track: LocalTrack) => {
    const normalizedUri = normalizeLocalUri(track.file_uri);
    
    playDownloadedSong(
      {
        id: track.track_id,
        title: track.title,
        artist: track.artist === "Unknown Artist" ? "Upcoming Artist" : track.artist,
        thumbnail: track.cached_artwork_path || track.artwork_uri || "",
        url: normalizedUri,
        localTrackUri: normalizedUri,  // CRITICAL: player expects localTrackUri
        duration: track.duration,
        albumId: folderId,
      } as DownloadedSongMetadata,
      undefined
    );
  }, [playDownloadedSong, folderId]);

  const handleSearchToggle = () => {
    triggerHaptic();
    if (searchActive) {
      setSearchQuery("");
      setSearchActive(false);
      Keyboard.dismiss();
    } else {
      setSearchActive(true);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTracks();
    setRefreshing(false);
  }, [loadTracks]);

  // ── FIX 2: Correct sort → filter pipeline ────────────────────────────────
  // Step 1: Sort the FULL track list using applySorts() from the hook.
  //         applySorts is generic (T extends Record<string, any>) and maps
  //         each SortKey to the real LocalTrack field names. No wrapper needed.
  // Step 2: Filter the sorted result by search query.
  //         Filtering AFTER sorting preserves sort order within results.
  // Search only matches title and artist — not album id or full file_uri path.
  const displayedTracks = useMemo(() => {
    // Sort first — applyLocalSorts maps SortKeys to real LocalTrack column names
    const sorted = sorts.length > 0 ? applyLocalSorts(tracks, sorts) : [...tracks];

    // Filter second — only title + artist, search query trimmed and lowercased
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((track) => {
      const title = (track.title || "").toLowerCase();
      const artist = (track.artist || "").toLowerCase();
      return title.includes(q) || artist.includes(q);
    });
  }, [tracks, searchQuery, sorts]);

  // ISSUE 8: Scroll to initialTrackId when tracks load
  useEffect(() => {
    if (!initialTrackId || displayedTracks.length === 0) return;
    
    const index = displayedTracks.findIndex(track => track.track_id === initialTrackId);
    if (index !== -1) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      }, 300);
    }
  }, [initialTrackId, displayedTracks]);

  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  useEffect(() => {
    if (searchActive && listRef.current) {
      setTimeout(() => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); }, 100);
    }
  }, [searchActive]);

  useEffect(() => {
    if (searchQuery && listRef.current) {
      setTimeout(() => { listRef.current?.scrollToOffset({ offset: 0, animated: false }); }, 50);
    }
  }, [searchQuery]);

  // Spacer matching fixed header height — correct on Android + iOS
  const HeaderSpacer = useMemo(
    () => () => <View style={{ height: headerHeight }} />,
    [headerHeight]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed header sits above the list, absolutely positioned */}
      <View
        style={[fdScreenStyles.fixedHeader, { backgroundColor: colors.background }]}
        onLayout={onHeaderLayout}
      >
        <FolderDetailHeader
          folderName={folderName}
          trackCount={tracks.length}
          onBack={onBack}
          onSort={() => setSortPanelVisible(true)}
          onSearchToggle={handleSearchToggle}
          searchActive={searchActive}
          activeSortCount={activeSortCount}
          colors={colors}
          sortButtonRef={sortButtonRef}
        />

        {searchActive && (
          <SearchBar value={searchQuery} onChange={setSearchQuery} colors={colors} />
        )}

        <InlineFilterRow
          sorts={sorts}
          onRemove={removeSort}
          onToggleDir={toggleSortDir}
          colors={colors}
        />

        <View
          style={{
            height: 0.5,
            backgroundColor: `${colors.border ?? colors.gold}18`,
            marginHorizontal: scale(14),
          }}
        />
      </View>

      {loading ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { alignItems: "center", justifyContent: "center", top: headerHeight },
          ]}
        >
          <Ionicons name="musical-notes" size={28} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, marginTop: verticalScale(8) }}>
            Loading tracks...
          </Text>
        </View>
      ) : displayedTracks.length === 0 ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              alignItems: "center",
              justifyContent: "center",
              top: headerHeight,
              paddingHorizontal: scale(24),
            },
          ]}
        >
          <View style={[esStyles.iconRing, { borderColor: `${colors.gold}30` }]}>
            <Ionicons name="musical-notes-outline" size={moderateScale(28)} color={colors.textMuted} />
          </View>
          <Text style={[esStyles.title, { color: colors.text }]}>No tracks found</Text>
          <Text style={[esStyles.sub, { color: colors.textMuted }]}>
            {searchQuery ? "Try a different search" : "Pull down to refresh"}
          </Text>
        </View>
      ) : (
        // FlatList fills the full screen; HeaderSpacer pushes items below the fixed header.
        // Works correctly on both Android and iOS (no contentInset/contentOffset needed).
        <FlatList
          ref={listRef}
          data={displayedTracks}
          keyExtractor={(item) => item.track_id}
          renderItem={({ item }) => (
            <TrackRow
              item={item}
              isPlaying={currentId === item.track_id}
              onPress={() => handlePlay(item)}
              colors={colors}
            />
          )}
          ListHeaderComponent={HeaderSpacer}
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: 0.5,
                backgroundColor: `${colors.border}44`,
                marginLeft: scale(68),
              }}
            />
          )}
          contentContainerStyle={{ paddingBottom: verticalScale(24) }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={StyleSheet.absoluteFillObject}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
              colors={[colors.gold]}
              progressBackgroundColor={colors.surface}
              progressViewOffset={headerHeight}
            />
          }
        />
      )}

      {/* ── FIX 3: onToggle is now toggleSort, not addSort ─────────────────
          toggleSort(key) removes the key if active, adds it if not.
          Panel stays open after every tap (no auto-dismiss on toggle).
          Only the backdrop tap calls onDismiss. ────────────────────────── */}
      <SortPanel
        visible={sortPanelVisible}
        sorts={sorts}
        onDismiss={() => setSortPanelVisible(false)}
        onToggle={toggleSort}
        colors={colors}
        anchorRef={sortButtonRef}
        insetTop={insetTop}
      />
    </View>
  );
}

const fdScreenStyles = StyleSheet.create({
  fixedHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
});

// ─── Page Header ─────────────────────────────────────────────────────────────

function PageHeader({
  title,
  isLocalMode,
  onAdd,
  onSidebar,
  colors,
}: {
  title: string;
  isLocalMode: boolean;
  onAdd: () => void;
  onSidebar?: () => void;
  colors: any;
}) {
  return (
    <View style={phStyles.wrap}>
      <View style={{ flex: 1 }}>
        <Text style={[phStyles.eyebrow, { color: `${colors.gold}99` }]}>
          {isLocalMode ? "LOCAL" : "BROWSE"}
        </Text>
        <Text style={[phStyles.title, { color: colors.text, fontFamily: "Meriva" }]}>{title}</Text>
      </View>
      <View style={phStyles.actions}>
        {isLocalMode && (
          <TouchableOpacity
            style={[phStyles.iconBtn, { backgroundColor: `${colors.gold}14`, borderColor: `${colors.gold}40` }]}
            onPress={onAdd}
            hitSlop={10}
            activeOpacity={0.75}
          >
            <Ionicons name="add" size={moderateScale(16)} color={colors.gold} />
          </TouchableOpacity>
        )}
        {onSidebar && (
          <TouchableOpacity
            style={[phStyles.iconBtn, { backgroundColor: `${colors.gold}08`, borderColor: `${colors.gold}20` }]}
            onPress={onSidebar}
            hitSlop={10}
            activeOpacity={0.75}
          >
            <Ionicons name="menu-outline" size={moderateScale(16)} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const phStyles = ScaledSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: "18@s",
    paddingTop: "6@vs",
    paddingBottom: "8@vs",
  },
  eyebrow: { fontSize: "9@ms", fontWeight: "700", letterSpacing: 2.5, marginBottom: "2@vs" },
  title: { fontSize: "24@ms", letterSpacing: 0.3 },
  actions: { flexDirection: "row", alignItems: "center", gap: "7@s" as any, marginBottom: "2@vs" },
  iconBtn: {
    width: "30@ms",
    height: "30@ms",
    borderRadius: "9@ms",
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─── Gold Divider ────────────────────────────────────────────────────────────

function GoldDivider({ colors }: { colors: any }) {
  return (
    <View style={{ paddingHorizontal: scale(18), marginBottom: verticalScale(4) }}>
      <View style={{ height: 0.5, backgroundColor: `${colors.gold}44` }} />
    </View>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

const esStyles = ScaledSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: "60@vs",
    paddingHorizontal: "32@s",
  },
  iconRing: {
    width: "56@ms",
    height: "56@ms",
    borderRadius: "28@ms",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "14@vs",
  },
  title: { fontSize: "15@ms", fontWeight: "700", marginBottom: "6@vs" },
  sub: { fontSize: "12@ms", textAlign: "center", lineHeight: "18@ms" },
});

function LocalEmptyState({ colors }: { colors: any }) {
  return (
    <View style={esStyles.wrap}>
      <View style={[esStyles.iconRing, { borderColor: `${colors.gold}30` }]}>
        <Ionicons name="folder-open-outline" size={moderateScale(28)} color={colors.textMuted} />
      </View>
      <Text style={[esStyles.title, { color: colors.text }]}>No Local Music</Text>
      <Text style={[esStyles.sub, { color: colors.textMuted }]}>
        Add folders to see your local tracks here.
      </Text>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors: rawColors } = useTheme();
  const colors = useExtendedColors(rawColors);

  // Read navigation params for folder navigation from player
  const targetFolderId = params.folderId as string | undefined;
  const targetTrackId = params.trackId as string | undefined;

  const isDark = useMemo(() => {
    const bg = colors.background ?? "#000";
    if (typeof bg === "string") {
      const stripped = bg.replace(/\s/g, "").toLowerCase();
      if (stripped.startsWith("#")) {
        const hex = stripped.slice(1);
        const expanded = hex.length === 3
          ? hex.split("").map((c) => c + c).join("")
          : hex;
        const r = parseInt(expanded.slice(0, 2), 16);
        const g = parseInt(expanded.slice(2, 4), 16);
        const b = parseInt(expanded.slice(4, 6), 16);
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance < 128;
      }
    }
    return true;
  }, [colors.background]);

  const { defaultView, setDefaultView, watchedFolders, removeWatchedFolder, renameWatchedFolder } =
    useLocalMusicStore();
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<{ id: string; name: string } | null>(null);

  // Auto-navigate to folder if targetFolderId is provided
  useEffect(() => {
    if (targetFolderId && watchedFolders.length > 0 && !selectedFolder) {
      const folder = watchedFolders.find(f => f.id === targetFolderId);
      if (folder) {
        setSelectedFolder({ id: folder.id, name: folder.name });
      }
    }
  }, [targetFolderId, watchedFolders, selectedFolder]);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextFolder, setContextFolder] = useState<{ id: string; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const selectionBarAnim = useRef(new Animated.Value(0)).current;

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    title: string;
    message?: string;
    buttons: ThemedAlertButton[];
  }>({ title: "", buttons: [] });

  const showThemedAlert = useCallback(
    (title: string, message: string, buttons: ThemedAlertButton[]) => {
      setAlertConfig({ title, message, buttons });
      setAlertVisible(true);
    },
    []
  );

  const { favoriteTracks } = useFavorites();
  const downloadedTracks = useDownloadedTracks();

  const userInitiatedNavigation = useRef(false);

  useEffect(() => {
    if (watchedFolders.length > 0 && defaultView === "normal" && !userInitiatedNavigation.current) {
      setDefaultView("local");
    }
    if (userInitiatedNavigation.current) {
      const timer = setTimeout(() => { userInitiatedNavigation.current = false; }, 500);
      return () => clearTimeout(timer);
    }
  }, [watchedFolders.length, defaultView, setDefaultView]);

  const isLocalMode = defaultView === "local";

  useEffect(() => {
    Animated.spring(selectionBarAnim, {
      toValue: selectionMode ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
    }).start();
  }, [selectionMode]);

  useEffect(() => {
    if (!isLocalMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectionMode) { exitSelectionMode(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [isLocalMode, selectionMode]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback((folder: { id: string; name: string }) => {
    triggerHaptic();
    setSelectionMode(true);
    setSelectedIds(new Set([folder.id]));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    triggerHaptic();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const allSelected =
    watchedFolders.length > 0 && selectedIds.size === watchedFolders.length;

  const toggleSelectAll = useCallback(() => {
    triggerHaptic();
    if (allSelected) {
      setSelectedIds(new Set());
      setSelectionMode(false);
    } else {
      setSelectedIds(new Set(watchedFolders.map((f) => f.id)));
    }
  }, [allSelected, watchedFolders]);

  const handleRemove = useCallback(
    (ids: string[]) => {
      showThemedAlert(
        ids.length > 1 ? `Remove ${ids.length} folders` : "Remove folder",
        "These folders will be removed from your library. Files stay on your device.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              ids.forEach((id) => removeWatchedFolder(id));
              exitSelectionMode();
              setContextFolder(null);
            },
          },
        ]
      );
    },
    [removeWatchedFolder, exitSelectionMode, showThemedAlert]
  );

  const startEdit = useCallback(() => {
    if (!contextFolder) return;
    setEditName(contextFolder.name);
    setEditTarget(contextFolder);
    setContextFolder(null);
  }, [contextFolder]);

  const commitEdit = useCallback(async () => {
    if (!editTarget || !editName.trim() || editSaving) return;
    setEditSaving(true);
    try {
      renameWatchedFolder(editTarget.id, editName.trim());
    } catch (err) {
      showThemedAlert("Rename failed", "Could not rename the folder.", [
        { text: "OK", style: "default" },
      ]);
    } finally {
      setEditSaving(false);
      setEditTarget(null);
    }
  }, [editTarget, editName, editSaving, renameWatchedFolder, showThemedAlert]);

  const selectionBarTranslateX = selectionBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [100, 0],
  });

  const handleSidebarSelect = (dest: string) => {
    triggerHaptic();
    userInitiatedNavigation.current = true;
    switch (dest) {
      case "browse": setDefaultView("normal"); break;
      case "favorites":
        setDefaultView("normal");
        setTimeout(() => router.push("/(library)/favorites"), 50);
        break;
      case "downloads":
        setDefaultView("normal");
        setTimeout(() => router.push("/(library)/downloads"), 50);
        break;
      case "recentlyPlayed":
        setDefaultView("normal");
        setTimeout(() => router.push("/(modals)/recentlyPlayed"), 50);
        break;
      case "mostPlayed":
        setDefaultView("normal");
        setTimeout(() => router.push("/(modals)/mostPlayed"), 50);
        break;
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await mediaStoreManager.refreshAlbumsInBackground();
    await new Promise((r) => setTimeout(r, 500));
    setRefreshing(false);
  }, []);

  // Pass initialTrackId to FolderDetailScreen when navigating from player
  if (selectedFolder) {
    return (
      <View style={[ls.container, { backgroundColor: colors.background, paddingTop: top }]}>
        <FolderDetailScreen
          folderId={selectedFolder.id}
          folderName={selectedFolder.name}
          onBack={() => setSelectedFolder(null)}
          colors={colors}
          insetTop={top}
          initialTrackId={targetFolderId === selectedFolder.id ? targetTrackId : undefined}
        />
      </View>
    );
  }

  if (isLocalMode) {
    return (
      <>
        <SwipeGestureWrapper
          isLocalMode={true}
          onShowSidebar={() => { triggerHaptic(); setShowSidebar(true); }}
          onReturnToLocal={() => {}}
        >
          <View style={[ls.container, { backgroundColor: colors.background, paddingTop: top }]}>
            {selectionMode ? (
              <View style={[ls.selHeader, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={exitSelectionMode} hitSlop={12}>
                  <Ionicons name="close" size={moderateScale(20)} color={colors.text} />
                </TouchableOpacity>
                <Text style={[ls.selHeaderTitle, { color: colors.text }]}>
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select folders"}
                </Text>
                <TouchableOpacity
                  style={[
                    ls.selAllBox,
                    allSelected
                      ? { backgroundColor: colors.gold, borderColor: colors.gold }
                      : {
                          backgroundColor: "transparent",
                          borderColor: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.35)",
                        },
                  ]}
                  onPress={toggleSelectAll}
                  hitSlop={12}
                >
                  {allSelected && <Ionicons name="checkmark" size={moderateScale(12)} color="#000" />}
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <PageHeader
                  title="Local Library"
                  isLocalMode={true}
                  onAdd={() => setShowFolderBrowser(true)}
                  onSidebar={() => { triggerHaptic(); setShowSidebar(true); }}
                  colors={colors}
                />
                <GoldDivider colors={colors} />
              </>
            )}

            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.gold}
                  colors={[colors.gold]}
                  progressBackgroundColor={colors.surface}
                />
              }
              contentContainerStyle={{
                paddingTop: verticalScale(4),
                paddingBottom: bottom + 24,
                paddingRight: selectionMode ? scale(62) : 0,
              }}
            >
              {watchedFolders.length > 0 ? (
                watchedFolders.map((folder, i) => (
                  <FolderCard
                    key={folder.id}
                    id={folder.id}
                    name={folder.name}
                    index={i}
                    colors={colors}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(folder.id)}
                    onPress={() => {
                      if (selectionMode) { toggleSelect(folder.id); return; }
                      triggerHaptic();
                      setSelectedFolder({ id: folder.id, name: folder.name });
                    }}
                    onLongPress={() => {
                      if (selectionMode) return;
                      enterSelectionMode(folder);
                    }}
                  />
                ))
              ) : (
                <LocalEmptyState colors={colors} />
              )}
            </ScrollView>
          </View>
        </SwipeGestureWrapper>

        <Animated.View
          style={[
            ls.selBar,
            {
              backgroundColor: colors.surface,
              borderColor: `${colors.border}88`,
              top: top + verticalScale(64),
              transform: [{ translateX: selectionBarTranslateX }],
            },
          ]}
          pointerEvents={selectionMode ? "auto" : "none"}
        >
          <TouchableOpacity
            style={ls.selBarAction}
            onPress={() => handleRemove(Array.from(selectedIds))}
            disabled={selectedIds.size === 0}
            activeOpacity={0.7}
          >
            <View
              style={[
                ls.selBarIconWrap,
                {
                  backgroundColor: `${colors.textSub ?? colors.textMuted}12`,
                  opacity: selectedIds.size === 0 ? 0.3 : 1,
                },
              ]}
            >
              <Ionicons name="remove-circle-outline" size={moderateScale(15)} color={colors.text} />
            </View>
            <Text style={[ls.selBarLabel, { color: colors.textSub ?? colors.textMuted }]}>
              Remove
            </Text>
          </TouchableOpacity>
        </Animated.View>

        <Sidebar
          visible={showSidebar}
          onClose={() => setShowSidebar(false)}
          onSelect={handleSidebarSelect}
          colors={colors}
          insetTop={top}
        />

        <FolderBrowserOverlay
          visible={showFolderBrowser}
          onClose={() => setShowFolderBrowser(false)}
          onComplete={() => setDefaultView("local")}
        />

        {/* Context Menu Sheet */}
        <Modal
          visible={!!contextFolder}
          transparent
          animationType="fade"
          onRequestClose={() => setContextFolder(null)}
        >
          <TouchableOpacity
            style={ls.ctxOverlay}
            activeOpacity={1}
            onPress={() => setContextFolder(null)}
          >
            <View
              style={[
                ls.ctxSheet,
                {
                  backgroundColor: isDark ? colors.surface : "#ffffff",
                  borderTopColor: `${colors.gold}30`,
                  borderTopWidth: 0.5,
                },
              ]}
            >
              <View style={[ls.ctxTopAccent, { backgroundColor: colors.gold }]} />
              <View style={ls.ctxHeader}>
                <View
                  style={[
                    ls.ctxIconWrap,
                    { backgroundColor: `${colors.gold}15`, borderColor: `${colors.gold}30`, borderWidth: 0.5 },
                  ]}
                >
                  <Ionicons name="folder-outline" size={moderateScale(20)} color={colors.gold} />
                </View>
                <Text style={[ls.ctxName, { color: colors.text }]} numberOfLines={1}>
                  {contextFolder?.name}
                </Text>
              </View>
              <View style={[ls.ctxDivider, { backgroundColor: isDark ? `${colors.gold}18` : `${colors.gold}25` }]} />
              <TouchableOpacity
                style={[ls.ctxAction, { borderBottomColor: isDark ? `${colors.gold}10` : `${colors.gold}15`, borderBottomWidth: 0.5 }]}
                onPress={startEdit}
              >
                <View style={[ls.ctxActionIcon, { backgroundColor: `${colors.gold}12` }]}>
                  <Ionicons name="pencil-outline" size={moderateScale(16)} color={colors.gold} />
                </View>
                <Text style={[ls.ctxActionText, { color: colors.text }]}>Edit name</Text>
                <Ionicons name="chevron-forward" size={moderateScale(12)} color={`${colors.textMuted}66`} />
              </TouchableOpacity>
              <TouchableOpacity
                style={ls.ctxAction}
                onPress={() => contextFolder && handleRemove([contextFolder.id])}
              >
                <View style={[ls.ctxActionIcon, { backgroundColor: "rgba(220,60,60,0.10)" }]}>
                  <Ionicons name="remove-circle-outline" size={moderateScale(16)} color="#e04444" />
                </View>
                <Text style={[ls.ctxActionText, { color: "#e04444" }]}>Remove from library</Text>
                <Ionicons name="chevron-forward" size={moderateScale(12)} color="rgba(220,60,60,0.35)" />
              </TouchableOpacity>
              <View style={[ls.ctxDivider, { backgroundColor: isDark ? `${colors.gold}18` : `${colors.gold}25` }]} />
              <TouchableOpacity style={ls.ctxCancelAction} onPress={() => setContextFolder(null)}>
                <Text style={[ls.ctxCancelText, { color: isDark ? colors.textMuted : "#888" }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Rename Modal */}
        <Modal
          visible={!!editTarget}
          transparent
          animationType="fade"
          onRequestClose={() => !editSaving && setEditTarget(null)}
        >
          <View style={ls.ctxOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => !editSaving && setEditTarget(null)}
            />
            <View
              style={[
                ls.editSheet,
                {
                  backgroundColor: isDark ? colors.surface : "#ffffff",
                  borderColor: `${colors.gold}30`,
                  borderWidth: 0.5,
                },
              ]}
            >
              <View style={[ls.editTopAccent, { backgroundColor: colors.gold }]} />
              <View style={ls.editIconRow}>
                <View style={[ls.editIconRing, { borderColor: `${colors.gold}40`, backgroundColor: `${colors.gold}12` }]}>
                  <Ionicons name="pencil" size={moderateScale(20)} color={colors.gold} />
                </View>
              </View>
              <Text style={[ls.editTitle, { color: colors.text }]}>Rename Folder</Text>
              <Text style={[ls.editSubtitle, { color: isDark ? colors.textMuted : "#666" }]}>
                Give this folder a new display name in your library.
              </Text>
              <TextInput
                style={[
                  ls.editInput,
                  {
                    color: colors.text,
                    borderColor: `${colors.gold}40`,
                    backgroundColor: isDark ? colors.background : "#f8f8f8",
                  },
                ]}
                value={editName}
                onChangeText={setEditName}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={commitEdit}
                placeholderTextColor={colors.textMuted}
              />
              <View style={ls.editActions}>
                <TouchableOpacity
                  style={[
                    ls.editBtn,
                    {
                      borderColor: isDark ? `${colors.gold}25` : `${colors.gold}40`,
                      backgroundColor: isDark ? `${colors.gold}08` : `${colors.gold}0a`,
                    },
                  ]}
                  onPress={() => setEditTarget(null)}
                  disabled={editSaving}
                >
                  <Text style={[ls.editBtnText, { color: isDark ? colors.textMuted : "#666" }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    ls.editBtn,
                    ls.editBtnPrimary,
                    {
                      backgroundColor: colors.gold,
                      opacity: editSaving || !editName.trim() ? 0.45 : 1,
                    },
                  ]}
                  onPress={commitEdit}
                  disabled={editSaving || !editName.trim()}
                >
                  <Text style={ls.editBtnPrimaryText}>{editSaving ? "Saving…" : "Save"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <ThemedAlert
          visible={alertVisible}
          title={alertConfig.title}
          message={alertConfig.message}
          buttons={alertConfig.buttons}
          colors={colors}
          isDark={isDark}
          onDismiss={() => setAlertVisible(false)}
        />
      </>
    );
  }

  return (
    <>
      <SwipeGestureWrapper
        isLocalMode={false}
        onShowSidebar={() => {}}
        onReturnToLocal={() => {
          triggerHaptic();
          userInitiatedNavigation.current = true;
          setDefaultView("local");
        }}
      >
        <View style={[ls.container, { backgroundColor: colors.background, paddingTop: top }]}>
          <PageHeader
            title="Browse"
            isLocalMode={false}
            onAdd={() => {}}
            onSidebar={() => { triggerHaptic(); setShowSidebar(true); }}
            colors={colors}
          />
          <GoldDivider colors={colors} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.gold}
                colors={[colors.gold]}
                progressBackgroundColor={colors.surface}
              />
            }
            contentContainerStyle={{
              paddingHorizontal: scale(16),
              paddingTop: verticalScale(14),
              paddingBottom: bottom + 90,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <QuickPill index={0} icon="heart" label="Favourites" sub="Songs you've liked" badge={favoriteTracks.length} onPress={() => router.push("/(library)/favorites")} colors={colors} />
            <QuickPill index={1} icon="cloud-download-outline" label="Downloads" sub="Offline listening" badge={downloadedTracks.length} onPress={() => router.push("/(library)/downloads")} colors={colors} />
            <QuickPill index={2} icon="time-outline" label="Recently Played" sub="Jump back in" onPress={() => router.push("/(modals)/recentlyPlayed")} colors={colors} />
            <QuickPill index={3} icon="trending-up-outline" label="Most Played" sub="Your top tracks" onPress={() => router.push("/(modals)/mostPlayed")} colors={colors} />
            <QuickPill index={4} icon="phone-portrait-outline" label="Local Music" sub="Files on this device" onPress={() => setShowFolderBrowser(true)} colors={colors} />
          </ScrollView>
        </View>
      </SwipeGestureWrapper>

      <Sidebar
        visible={showSidebar}
        onClose={() => setShowSidebar(false)}
        onSelect={handleSidebarSelect}
        colors={colors}
        insetTop={top}
      />

      <FolderBrowserOverlay
        visible={showFolderBrowser}
        onClose={() => setShowFolderBrowser(false)}
        onComplete={() => setDefaultView("local")}
      />

      <ThemedAlert
        visible={alertVisible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        colors={colors}
        isDark={isDark}
        onDismiss={() => setAlertVisible(false)}
      />
    </>
  );
}

const ls = ScaledSheet.create({
  container: { flex: 1 },
  selHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: "16@s",
    paddingTop: "12@vs",
    paddingBottom: "12@vs",
    borderBottomWidth: 0.5,
  },
  selHeaderTitle: { fontSize: "15@ms", fontWeight: "600", flex: 1, textAlign: "center" },
  selAllBox: {
    width: "20@ms",
    height: "20@ms",
    borderRadius: "5@ms",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  selBar: {
    position: "absolute",
    right: "8@s",
    flexDirection: "column",
    alignItems: "center",
    paddingVertical: "8@vs",
    paddingHorizontal: "5@s",
    borderRadius: "16@ms",
    borderWidth: 0.5,
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 12,
    gap: "2@vs" as any,
  },
  selBarAction: {
    alignItems: "center",
    gap: "3@vs" as any,
    paddingVertical: "5@vs",
    paddingHorizontal: "3@s",
  },
  selBarIconWrap: {
    width: "34@ms",
    height: "34@ms",
    borderRadius: "17@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  selBarLabel: { fontSize: "8@ms", fontWeight: "600" },
  selBarDivider: { width: "26@ms", height: 0.5, borderRadius: 1, marginVertical: "2@vs" },
  ctxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    justifyContent: "flex-end",
  },
  ctxSheet: {
    borderTopLeftRadius: "20@ms",
    borderTopRightRadius: "20@ms",
    paddingBottom: "34@vs",
    overflow: "hidden",
  },
  ctxTopAccent: { height: "3@vs", width: "100%" },
  ctxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: "12@s" as any,
    paddingHorizontal: "20@s",
    paddingVertical: "16@vs",
  },
  ctxIconWrap: {
    width: "40@ms",
    height: "40@ms",
    borderRadius: "10@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  ctxName: { fontSize: "15@ms", fontWeight: "600", flex: 1 },
  ctxDivider: { height: 0.5 },
  ctxAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: "14@s" as any,
    paddingHorizontal: "20@s",
    paddingVertical: "16@vs",
  },
  ctxActionIcon: {
    width: "32@ms",
    height: "32@ms",
    borderRadius: "8@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  ctxActionText: { fontSize: "15@ms", fontWeight: "500", flex: 1 },
  ctxCancelAction: {
    alignItems: "center",
    paddingVertical: "18@vs",
    paddingHorizontal: "20@s",
  },
  ctxCancelText: { fontSize: "15@ms", fontWeight: "500" },
  editSheet: {
    marginHorizontal: "24@s",
    borderRadius: "20@ms",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  editTopAccent: { height: "3@vs", width: "100%" },
  editIconRow: { alignItems: "center", marginTop: "20@vs", marginBottom: "12@vs" },
  editIconRing: {
    width: "52@ms",
    height: "52@ms",
    borderRadius: "26@ms",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editTitle: { fontSize: "17@ms", fontWeight: "700", marginBottom: "6@vs", textAlign: "center", paddingHorizontal: "20@s" },
  editSubtitle: { fontSize: "13@ms", marginBottom: "20@vs", lineHeight: "18@ms" as any, textAlign: "center", paddingHorizontal: "20@s" },
  editInput: {
    fontSize: "15@ms",
    borderWidth: 1,
    borderRadius: "10@ms",
    paddingHorizontal: "14@s",
    paddingVertical: "10@vs",
    marginBottom: "20@vs",
    marginHorizontal: "20@s",
  },
  editActions: { flexDirection: "row", gap: "10@s" as any, paddingHorizontal: "20@s", paddingBottom: "20@vs" },
  editBtn: {
    flex: 1,
    paddingVertical: "12@vs",
    borderRadius: "12@ms",
    alignItems: "center",
    borderWidth: 0.5,
  },
  editBtnText: { fontSize: "15@ms", fontWeight: "500" },
  editBtnPrimary: { borderWidth: 0 },
  editBtnPrimaryText: { fontSize: "15@ms", fontWeight: "700", color: "#000" },
});