/**
 * (modals)/menu.tsx — Compact Gold × Black Futuristic Bottom Sheet
 * Layout: single horizontal chip scroll + 2-column action grid
 * UPDATED: Theme-aware with light/dark mode support
 */

import React, { useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Animated as RNAnimated,
  TouchableWithoutFeedback,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from "@expo/vector-icons";
import { Image } from "expo-image";
import { triggerHaptic } from "@/helpers/haptics";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useTheme } from "@/contexts/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Chip ────────────────────────────────────────────────────────────────────

interface ChipProps {
  title: string;
  thumbnail?: string;
  iconName?: string;
  count?: number;
  onPress?: () => void;
}

function Chip({ title, thumbnail, iconName, count, onPress }: ChipProps) {
  const { colors, isDark } = useTheme();
  
  const showCount = typeof count === "number" && count > 0;
  const countLabel = count
    ? count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}m`
      : count >= 1000    ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`
      : String(count)
    : "";

  return (
    <TouchableOpacity style={[chipSt.wrap]} onPress={() => { triggerHaptic(); onPress?.(); }} activeOpacity={0.7}>
      <View style={[chipSt.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={chipSt.img} contentFit="cover" />
        ) : (
          <View style={[chipSt.placeholder, { backgroundColor: colors.surfaceHigh }]}>
            <Ionicons name={(iconName as any) || "musical-notes"} size={moderateScale(15)} color={colors.gold} />
          </View>
        )}
        <View style={[chipSt.accent, { backgroundColor: colors.gold }]} />
      </View>
      <Text style={[chipSt.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      {showCount && <Text style={[chipSt.count, { color: colors.gold }]} numberOfLines={1}>{countLabel}</Text>}
    </TouchableOpacity>
  );
}

const chipSt = StyleSheet.create({
  wrap: { width: scale(68) },
  box: {
    width: scale(68), height: scale(52), borderRadius: 6,
    overflow: "hidden", borderWidth: StyleSheet.hairlineWidth,
  },
  img: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  accent: { position: "absolute", bottom: 0, left: 0, right: 0, height: 2, opacity: 0.55 },
  title: { fontSize: moderateScale(9), fontWeight: "600", marginTop: verticalScale(4), letterSpacing: 0.2 },
  count: { fontSize: moderateScale(8), fontWeight: "700", marginTop: 1, letterSpacing: 0.3 },
});

// ─── GridItem ────────────────────────────────────────────────────────────────

const GRID_GAP   = scale(8);
const GRID_H_PAD = scale(12);
const CELL_WIDTH = (SCREEN_WIDTH - GRID_H_PAD * 2 - GRID_GAP) / 2;

interface GridItemProps {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  gold?: boolean;
}

function GridItem({ icon, label, onPress, destructive, disabled, gold }: GridItemProps) {
  const { colors } = useTheme();
  
  return (
    <TouchableOpacity
      style={[gridSt.cell, disabled && { opacity: 0.3 }]}
      onPress={() => { if (disabled) return; triggerHaptic(); onPress?.(); }}
      activeOpacity={0.6}
      disabled={disabled}
    >
      <View style={[
        gridSt.iconWrap,
        { backgroundColor: colors.surfaceHigh },
        destructive && { backgroundColor: `${colors.error}15` },
        gold && { backgroundColor: `${colors.gold}15` }
      ]}>
        {icon}
      </View>
      <Text style={[
        gridSt.label,
        { color: colors.text },
        destructive && { color: colors.error },
        gold && { color: colors.gold }
      ]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const gridSt = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 9,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(11),
    gap: scale(9),
  },
  iconWrap: {
    width: scale(32), height: scale(32), borderRadius: 8,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  label: {
    fontSize: moderateScale(11.5), fontWeight: "500",
    letterSpacing: 0.1, flex: 1, lineHeight: moderateScale(15),
  },
});

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ gold }: { gold?: boolean }) {
  const { colors } = useTheme();
  
  return (
    <View style={{
      height: StyleSheet.hairlineWidth,
      backgroundColor: gold ? colors.borderGold : colors.border,
      marginHorizontal: scale(12),
      marginVertical: verticalScale(4),
    }} />
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function MenuModal() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { colors } = useTheme();
  const params  = useLocalSearchParams<{ type: string; songData?: string; playlistName?: string }>();
  const { type, songData: songDataRaw, playlistName } = params;

  const songData = useMemo(() => {
    if (!songDataRaw) return null;
    try {
      return JSON.parse(songDataRaw) as {
        id: string; title: string; artist: string; thumbnail?: string;
        url?: string; duration?: number; uploaderUrl?: string;
        albumId?: string; albumName?: string; videoId?: string;
      };
    } catch { return null; }
  }, [songDataRaw]);

  const slideAnim    = useRef(new RNAnimated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new RNAnimated.Value(0)).current;
  const [visible, setVisible] = React.useState(true);

  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 200, useNativeDriver: true }),
      RNAnimated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleClose = useCallback(() => {
    triggerHaptic();
    RNAnimated.parallel([
      RNAnimated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 240, useNativeDriver: true }),
      RNAnimated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { setVisible(false); router.back(); });
  }, [router, slideAnim, backdropAnim]);

  const act = useCallback(
    (cb?: () => void) => () => { handleClose(); setTimeout(() => cb?.(), 280); },
    [handleClose]
  );

  const hasArtist  = !!songData?.uploaderUrl || !!songData?.artist;
  const hasAlbum   = !!songData?.albumId;
  const hasVideoId = !!songData?.id;
  const title      = type === "playlist" ? playlistName ?? "Playlist" : songData?.title ?? "Options";
  const subtitle   = type === "playlist" ? "Playlist" : songData?.artist ?? "";

  const chips = [
    { title: "Watch Later", iconName: "time-outline",           count: undefined as number | undefined },
    { title: "Liked Songs",  iconName: "thumbs-up",              count: undefined as number | undefined },
    { title: "My Mix",       iconName: "musical-notes",          count: undefined as number | undefined },
    { title: "Downloads",    iconName: "cloud-download-outline", count: undefined as number | undefined },
    { title: "Similar",      iconName: "albums-outline",         count: undefined as number | undefined },
    { title: "Discography",  iconName: "person",                 count: undefined as number | undefined },
    { title: "Radio",        iconName: "radio",                  count: undefined as number | undefined },
  ];

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <RNAnimated.View style={[st.backdrop, { opacity: backdropAnim, backgroundColor: `rgba(0,0,0,0.78)` }]} />
      </TouchableWithoutFeedback>

      <RNAnimated.View style={[
        st.sheet,
        { paddingBottom: insets.bottom + verticalScale(10), transform: [{ translateY: slideAnim }], backgroundColor: colors.background, borderColor: colors.border }
      ]}>
        <View style={st.handleRow}>
          <View style={[st.handle, { backgroundColor: colors.gold }]} />
        </View>

        <View style={st.header}>
          {songData?.thumbnail ? (
            <View style={st.artworkWrap}>
              <Image source={{ uri: songData.thumbnail }} style={st.artwork} contentFit="cover" />
              <View style={[st.artworkBorder, { borderColor: colors.gold }]} />
            </View>
          ) : (
            <View style={[st.artwork, st.artworkPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name={type === "playlist" ? "list" : "musical-notes"} size={moderateScale(18)} color={colors.gold} />
            </View>
          )}
          <View style={st.headerText}>
            <Text style={[st.headerTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
            <Text style={[st.headerSub, { color: colors.textSub }]} numberOfLines={1}>{subtitle}</Text>
          </View>
          <View style={st.headerActions}>
            <TouchableOpacity style={[st.headerBtn, { backgroundColor: colors.surfaceHigh }]} onPress={() => triggerHaptic()} activeOpacity={0.7}>
              <Ionicons name="thumbs-up-outline" size={moderateScale(17)} color={colors.textSub} />
            </TouchableOpacity>
            <TouchableOpacity style={[st.headerBtn, { backgroundColor: colors.surfaceHigh }]} onPress={() => triggerHaptic()} activeOpacity={0.7}>
              <Ionicons name="thumbs-down-outline" size={moderateScale(17)} color={colors.textSub} />
            </TouchableOpacity>
          </View>
        </View>

        <Divider gold />

        <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} bounces={false}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.chipRow}
            style={st.chipScroll}
          >
            {chips.map((c, i) => (
              <Chip key={i} title={c.title} iconName={c.iconName} count={c.count} />
            ))}
          </ScrollView>

          <Divider />

          <View style={st.grid}>
            <View style={st.gridRow}>
              <GridItem
                icon={<MaterialIcons name="playlist-add" size={moderateScale(18)} color={colors.gold} />}
                label="Save to playlist" gold
                onPress={act(() => router.push({ pathname: "/(modals)/addToPlaylist", params: { songId: songData?.id, songTitle: songData?.title } }))}
              />
              <GridItem
                icon={<MaterialCommunityIcons name="bookmark-outline" size={moderateScale(18)} color={colors.text} />}
                label="Save to library"
                onPress={act(() => {})}
              />
            </View>

            <View style={st.gridRow}>
              <GridItem
                icon={<Feather name="share-2" size={moderateScale(17)} color={colors.text} />}
                label="Share"
                onPress={act(() => {})}
              />
              <GridItem
                icon={<MaterialCommunityIcons name="playlist-plus" size={moderateScale(18)} color={colors.text} />}
                label="Add to queue"
                onPress={act(() => {})}
              />
            </View>

            <View style={st.gridRow}>
              <GridItem
                icon={<MaterialCommunityIcons name="radio" size={moderateScale(18)} color={colors.text} />}
                label="Start radio"
                onPress={act(() => {})}
                disabled={!hasVideoId}
              />
              <GridItem
                icon={<Ionicons name="person-outline" size={moderateScale(18)} color={colors.text} />}
                label="Go to artist"
                onPress={act(() => { if (hasArtist) router.push({ pathname: "/search/artist", params: { id: songData?.uploaderUrl || songData?.artist } }); })}
                disabled={!hasArtist}
              />
            </View>

            <View style={st.gridRow}>
              <GridItem
                icon={<MaterialCommunityIcons name="album" size={moderateScale(18)} color={colors.text} />}
                label="Go to album"
                onPress={act(() => { if (songData?.albumId) router.push({ pathname: "/search/album", params: { id: songData.albumId } }); })}
                disabled={!hasAlbum}
              />
              <GridItem
                icon={<Ionicons name="musical-notes-outline" size={moderateScale(18)} color={colors.text} />}
                label="View lyrics"
                onPress={act(() => router.push({ pathname: "/(modals)/lyrics", params: { songId: songData?.id, title: songData?.title, artist: songData?.artist } }))}
              />
            </View>

            <View style={st.gridRow}>
              <GridItem
                icon={<Feather name="download" size={moderateScale(17)} color={colors.text} />}
                label="Download"
                onPress={act(() => {})}
              />
              <GridItem
                icon={<MaterialCommunityIcons name="weather-night" size={moderateScale(18)} color={colors.text} />}
                label="Sleep timer"
                onPress={act(() => {})}
              />
            </View>

            <View style={st.gridRow}>
              <GridItem
                icon={<MaterialCommunityIcons name="flag-outline" size={moderateScale(18)} color={colors.error} />}
                label="Report"
                onPress={act(() => {})}
                destructive
              />
              <View style={{ width: CELL_WIDTH }} />
            </View>
          </View>
        </ScrollView>
      </RNAnimated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: SCREEN_HEIGHT * 0.88,
  },
  handleRow: { alignItems: "center", paddingTop: verticalScale(8), paddingBottom: verticalScale(2) },
  handle: { width: 28, height: 3, borderRadius: 1.5, opacity: 0.5 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: scale(14), paddingVertical: verticalScale(10) },
  artworkWrap: { position: "relative" },
  artwork: { width: scale(42), height: scale(42), borderRadius: 5 },
  artworkBorder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 5, borderWidth: 1, opacity: 0.4 },
  artworkPlaceholder: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1, marginLeft: scale(10), marginRight: scale(6) },
  headerTitle: { fontSize: moderateScale(13), fontWeight: "700", letterSpacing: 0.1 },
  headerSub: { fontSize: moderateScale(11), marginTop: 2, letterSpacing: 0.2 },
  headerActions: { flexDirection: "row", gap: scale(4) },
  headerBtn: { width: scale(30), height: scale(30), alignItems: "center", justifyContent: "center", borderRadius: 15 },
  chipScroll: { marginTop: verticalScale(10), marginBottom: verticalScale(8) },
  chipRow: { paddingHorizontal: scale(12), gap: scale(8) },
  scroll: { flex: 1 },
  grid: {
    paddingHorizontal: GRID_H_PAD,
    paddingTop: verticalScale(8),
    paddingBottom: verticalScale(14),
    gap: GRID_GAP,
  },
  gridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
  },
});
