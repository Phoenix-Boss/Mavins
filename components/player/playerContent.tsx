// components/player/playerContent.tsx
//
// MIGRATION: All react-native-track-player removed.
// Audio engine is expo-audio (via usePlayerEngine from MusicPlayerContext).
// Video morph uses expo-video VideoView exactly as before.
//
// SINGLE SOURCE OF TRUTH:
//   engine.isPlaying   → play/pause icon, video sync
//   engine.position    → slider, time display, video drift correction
//   engine.duration    → slider max, time display
//   engine.seekTo()    → slider complete, video seek
//   engine.skipToNext/Previous() → skip buttons
//
// FIXES:
//   • Changed imports to @/libs/playerSetup (bridge consistency)
//   • Removed thumbnail → artwork mapping in displayTrack
//   • Added useTrackExtrasVersion() for reactive extras (race condition fix)
//   • displayTrack now passes thumbnail directly

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { Slider } from "react-native-awesome-slider";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";

import { MovingText } from "@/components/MovingText";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { triggerHaptic } from "@/helpers/haptics";

// FIXED: Import from bridge for consistency
import {
  useMusicPlayer,
  usePlayerEngine,
  getTrackExtras,
  useTrackExtrasVersion,
} from "@/libs/playerSetup";

// GestureContext lives in libs/playerSetup to avoid the circular import:
//   playerContent → _layout → playerContent
import { useGestureContext } from "@/libs/playerSetup";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Constants ────────────────────────────────────────────────────────────────

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

type RepeatMode = "off" | "queue" | "track";

// ─── Dummy track shown before first song plays ────────────────────────────────

const DUMMY_TRACK = {
  id:       "dummy-track-id",
  title:    "Mavin Player",
  artist:   "Select a song to start listening",
  thumbnail: undefined as string | undefined,
  url:      "",
  duration: 0,
  videoId:  undefined as string | undefined,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (s: number): string => {
  if (!s || isNaN(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const formatCount = (n: number): string => {
  if (n <= 0) return "";
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, "")}T`;
  if (n >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)         return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000)             return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
};

const parseArtists = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw.split(/[,&]|\bft\.?\b|\bfeat\.?\b/i).map(a => a.trim()).filter(Boolean);
};

const formatArtistName = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2");

// ─── SkeletonPulse ────────────────────────────────────────────────────────────

function SkeletonPulse({
  width, height, borderRadius = 6, style,
}: { width: number | string; height: number; borderRadius?: number; style?: object }) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, [anim]);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [SK.base, SK.highlight] });
  return <RNAnimated.View style={[{ width, height, borderRadius, backgroundColor: bg }, style]} />;
}

// ─── AnimatedCounter ──────────────────────────────────────────────────────────

function AnimatedCounter({ target }: { target: number }) {
  const [display, setDisplay] = useState(1);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  useEffect(() => {
    if (target <= 0) { setDisplay(1); return; }
    const start = Date.now();
    const DURATION = 3500;
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      setDisplay(Math.max(1, Math.floor(eased * target)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [target]);
  return <Text style={ctrStyles.text}>{formatCount(display)}</Text>;
}
const ctrStyles = StyleSheet.create({
  text: { color: "rgba(255,255,255,0.85)", fontSize: moderateScale(11), fontWeight: "600", letterSpacing: 0.2 },
});

// ─── ArtistLine ───────────────────────────────────────────────────────────────

function ArtistLine({
  rawArtist, uploaderUrl, onArtistPress,
}: {
  rawArtist: string | undefined;
  uploaderUrl: string | undefined;
  onArtistPress: (name: string) => void;
}) {
  const artists = useMemo(
    () => parseArtists(rawArtist).map(formatArtistName),
    [rawArtist]
  );
  if (!artists.length) return <Text style={styles.artist}>—</Text>;
  return (
    <Text style={styles.artist}>
      {artists.map((name, idx) => (
        <React.Fragment key={`${name}-${idx}`}>
          {idx > 0 && <Text style={styles.artistSeparator}>{", "}</Text>}
          <Text
            style={[styles.artistName, uploaderUrl ? styles.artistTappable : undefined]}
            onPress={uploaderUrl ? () => onArtistPress(name) : undefined}
            suppressHighlighting
          >
            {name}
          </Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlayerContentProps {
  onMinimize: () => void;
  onClose: () => void;
  isExpanded: boolean;
  playerReady: boolean;
  topInset?: number;
  onNavigateToEqualizer?: () => void;
  onNavigateToCast?: () => void;
  onNavigateToComments?: () => void;
  onNavigateToPlaylist?: () => void;
  onNavigateToSleepTimer?: () => void;
  onNavigateToQueue?: () => void;
  onNavigateToLyrics?: (params: {
    title: string; artist: string; duration: string; videoId: string; leadIn: string;
  }) => void;
  onNavigateToRelated?: (params: { songUrl: string; title: string; artist: string }) => void;
  onNavigateToMenu?: (params: { songData: string }) => void;
  onNavigateToArtist?: (params: { id: string; subtitle: string }) => void;
}

// ─── PlayerContentInner ───────────────────────────────────────────────────────

function PlayerContentInner({
  onMinimize,
  onClose,
  topInset: topInsetProp,
  onNavigateToEqualizer,
  onNavigateToCast,
  onNavigateToComments,
  onNavigateToPlaylist,
  onNavigateToSleepTimer,
  onNavigateToQueue,
  onNavigateToLyrics,
  onNavigateToRelated,
  onNavigateToMenu,
  onNavigateToArtist,
}: Omit<PlayerContentProps, "playerReady">) {
  const insets   = useSafeAreaInsets();
  const topInset = topInsetProp ?? insets.top;

  // ── Gesture coordination (keeps dismiss swipe from fighting slider) ───────
  const { setSliderActive, setButtonActive } = useGestureContext();

  // ── Engine — all playback state from expo-audio ───────────────────────────
  const engine = usePlayerEngine();
  const { isLoading: musicPlayerLoading, togglePlayPause } = useMusicPlayer();

  const isPlaying   = engine.isPlaying;
  const positionSec = engine.position;
  const durationSec = engine.duration;

  // ── FIXED: Reactive track extras version — re-reads when data arrives ─────
  const trackExtrasVersion = useTrackExtrasVersion();

  // ── Display track — thumbnail passed through directly (no mapping) ────────
  const displayTrack = useMemo(() => {
    if (engine.currentTrack) {
      return {
        id:        engine.currentTrack.id,
        title:     engine.currentTrack.title,
        artist:    engine.currentTrack.artist,
        thumbnail: engine.currentTrack.thumbnail,
        url:       engine.currentTrack.url,
        duration:  engine.currentTrack.duration,
        videoId:   engine.currentTrack.videoId,
      };
    }
    return DUMMY_TRACK as any;
  }, [engine.currentTrack]);

  // ── Track extras (videoUrl, like counts, etc.) — FIXED: reactive ─────────
  const [extras, setExtras] = useState<Record<string, any>>({});

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) { setExtras({}); return; }
    setExtras(getTrackExtras(id) ?? {});
  }, [displayTrack?.id, trackExtrasVersion]);

  const likeCount      = extras?.likeCount     ?? -1;
  const dislikeCount   = extras?.dislikeCount  ?? -1;
  const commentsCount  = extras?.commentsCount ?? -1;
  const viewCount      = extras?.viewCount     ?? -1;
  const uploaderUrl:   string | undefined = extras?.uploaderUrl;
  const videoId:       string | undefined = extras?.videoId;
  const muxedVideoUrl: string | undefined = extras?.muxedVideoUrl;
  const videoUrl:      string | undefined = extras?.videoUrl;
  const activeVideoUrl = muxedVideoUrl ?? videoUrl ?? undefined;
  const hasVideo       = !!activeVideoUrl && displayTrack.id !== DUMMY_TRACK.id;
  const canShowLyrics  = !!(videoId ?? displayTrack?.id) && displayTrack.id !== DUMMY_TRACK.id;

  // ── Local repeat / shuffle ─────────────────────────────────────────────────
  const [repeatMode,  setRepeatMode]  = useState<RepeatMode>("off");
  const [shuffleMode, setShuffleMode] = useState<"off" | "on">("off");

  const toggleRepeat = () => {
    triggerHaptic();
    setRepeatMode(prev => prev === "off" ? "queue" : prev === "queue" ? "track" : "off");
  };
  const toggleShuffle = () => {
    triggerHaptic();
    setShuffleMode(prev => prev === "off" ? "on" : "off");
  };

  // ── Favourite ──────────────────────────────────────────────────────────────
  const [isFavorite, setIsFavorite] = useState(false);
  const toggleFavoriteFunc = () => { triggerHaptic(); setIsFavorite(p => !p); };

  // ── View-count animated counter ────────────────────────────────────────────
  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [displayTrack?.id, viewCount]);

  // ─────────────────────────────────────────────────────────────────────────
  // VIDEO PLAYER (expo-video — visual only; audio comes from engine above)
  // ─────────────────────────────────────────────────────────────────────────
  const [activeSegment, setActiveSegment] = useState<"song" | "video">("song");
  const videoPlayerReady  = useRef(false);
  const pendingSeek       = useRef<number | null>(null);
  const videoOwnsAudio    = useRef(false);
  const isTransitioning   = useRef(false);
  const statusListenerRef = useRef<any>(null);

  const videoPlayer = useVideoPlayer(activeVideoUrl ?? null, (p) => {
    try {
      p.muted = !muxedVideoUrl;
      p.loop  = false;
      p.pause();
    } catch (e) { console.warn("[PlayerContent] Video player init error:", e); }
  });

  // Sync video play/pause with engine state
  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video") return;
    if (muxedVideoUrl && videoOwnsAudio.current) {
      try { isPlaying ? videoPlayer.play() : videoPlayer.pause(); } catch { }
    } else if (!muxedVideoUrl) {
      try { isPlaying ? videoPlayer.play() : videoPlayer.pause(); } catch { }
    }
  }, [isPlaying, activeSegment, videoPlayer, muxedVideoUrl]);

  // Video status listener
  useEffect(() => {
    if (!videoPlayer) return;
    try { statusListenerRef.current?.remove(); } catch { }
    statusListenerRef.current = null;

    try {
      statusListenerRef.current = videoPlayer.addListener("statusChange", ({ status, error }: any) => {
        if (status === "readyToPlay") {
          videoPlayerReady.current = true;
          if (pendingSeek.current !== null) {
            try { videoPlayer.currentTime = pendingSeek.current; } catch { }
            pendingSeek.current = null;
            if (isPlaying && activeSegment === "video") {
              if (muxedVideoUrl) { videoOwnsAudio.current = true; engine.pause(); }
              try { videoPlayer.play(); } catch { }
            }
          }
        } else if (status === "error") {
          videoPlayerReady.current = false;
          console.error("[PlayerContent] Video error:", error);
        }
      });
    } catch (e) { console.error("[PlayerContent] Failed to add video listener:", e); }

    return () => { try { statusListenerRef.current?.remove(); } catch { } statusListenerRef.current = null; };
  }, [videoPlayer, activeSegment, isPlaying, muxedVideoUrl, engine]);

  // Keep video position in sync with engine
  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video" || !videoPlayerReady.current) return;
    if (muxedVideoUrl && videoOwnsAudio.current) return;
    try {
      const drift = Math.abs(videoPlayer.currentTime - positionSec);
      if (drift > 1.0) videoPlayer.currentTime = positionSec;
    } catch { }
  }, [positionSec, activeSegment, videoPlayer, muxedVideoUrl]);

  // Reanimated crossfade
  const videoProgress    = useSharedValue(0);
  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [1, 0]), { duration: 300 }),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [0, 1]), { duration: 300 }),
  }));

  // Switch between Song / Video tabs
  const handleSegmentPress = useCallback(
    async (seg: "song" | "video") => {
      if (seg === "video" && (!hasVideo || displayTrack.id === DUMMY_TRACK.id)) return;
      if (isTransitioning.current) return;
      isTransitioning.current = true;
      triggerHaptic();
      setActiveSegment(seg);
      videoProgress.value = seg === "video" ? 1 : 0;

      try {
        if (seg === "video" && videoPlayer) {
          const currentPosition = positionSec;
          if (muxedVideoUrl) {
            videoOwnsAudio.current = true;
            engine.pause();
            if (videoPlayerReady.current) {
              try { videoPlayer.currentTime = currentPosition; videoPlayer.play(); } catch { }
            } else { pendingSeek.current = currentPosition; }
          } else {
            if (videoPlayerReady.current) {
              try {
                videoPlayer.currentTime = currentPosition;
                if (isPlaying) videoPlayer.play();
              } catch { }
            } else { pendingSeek.current = currentPosition; }
          }
        } else if (seg === "song" && videoPlayer) {
          try { videoPlayer.pause(); } catch { }
          if (muxedVideoUrl && videoOwnsAudio.current) {
            videoOwnsAudio.current = false;
            engine.seekTo(videoPlayer.currentTime);
            if (isPlaying) engine.play();
          }
        }
      } catch (err) {
        console.error("[PlayerContent] Segment switch error:", err);
      } finally {
        setTimeout(() => { isTransitioning.current = false; }, 400);
      }
    },
    [hasVideo, videoPlayer, videoProgress, positionSec, isPlaying, muxedVideoUrl, displayTrack.id, engine]
  );

  // Reset video player state on every track change
  useEffect(() => {
    if (videoPlayer) { try { videoPlayer.pause(); } catch { } }
    videoOwnsAudio.current    = false;
    videoPlayerReady.current  = false;
    pendingSeek.current       = null;
    setActiveSegment("song");
    videoProgress.value = 0;
  }, [displayTrack?.id, videoPlayer, videoProgress]);

  // ── Bottom tabs ───────────────────────────────────────────────────────────
  const [activeBottomTab, setActiveBottomTab] = useState<"upnext" | "lyrics" | "related">("upnext");
  useEffect(() => { setActiveBottomTab("upnext"); }, [displayTrack?.id]);

  // ── Dynamic gradient from artwork palette ─────────────────────────────────
  const artworkForColors = typeof displayTrack?.thumbnail === "string" ? displayTrack.thumbnail : null;
  const { imageColors }  = useImageColors(artworkForColors);
  const gradientColors   = useMemo((): [string, string, string] => {
    if (imageColors?.dominant) return [imageColors.dominant, "#0d0d0d", "#000000"];
    return ["#2d1a2e", "#1a1020", "#0a0a0f"];
  }, [imageColors]);

  // ── Slider ────────────────────────────────────────────────────────────────
  const isSliding      = useSharedValue(false);
  const sliderProgress = useSharedValue(0);
  const sliderMin      = useSharedValue(0);
  const sliderMax      = useSharedValue(1);
  const slidingValue   = useSharedValue(0);

  useEffect(() => {
    if (!isSliding.value && durationSec > 0) {
      sliderProgress.value = positionSec / durationSec;
    }
  }, [positionSec, durationSec, isSliding, sliderProgress]);

  const handleSeek = useCallback(
    (fraction: number) => {
      if (durationSec <= 0) return;
      const t = fraction * durationSec;
      engine.seekTo(t);
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        try {
          videoPlayer.currentTime = t;
          if (isPlaying && !videoOwnsAudio.current) videoPlayer.play();
        } catch { }
      }
    },
    [durationSec, engine, activeSegment, videoPlayer, isPlaying]
  );

  // ── Playback controls ─────────────────────────────────────────────────────

  const handleSkipBack = useCallback(async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") { try { videoPlayer.pause(); } catch { } }
    await engine.skipToPrevious();
  }, [engine, videoPlayer, activeSegment]);

  const handleSkipNext = useCallback(async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") { try { videoPlayer.pause(); } catch { } }
    await engine.skipToNext();
  }, [engine, videoPlayer, activeSegment]);

  const handlePlayPause = useCallback(async () => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;

    try {
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        if (muxedVideoUrl) {
          if (isPlaying) {
            try { videoPlayer.pause(); } catch { }
            engine.pause();
            videoOwnsAudio.current = false;
          } else {
            videoOwnsAudio.current = true;
            engine.pause();
            try { videoPlayer.play(); } catch { }
          }
        } else {
          if (isPlaying) {
            engine.pause();
            try { videoPlayer.pause(); } catch { }
          } else {
            engine.play();
            try { videoPlayer.play(); } catch { }
          }
        }
      } else {
        togglePlayPause();
      }
    } catch (err) {
      console.error("[PlayerContent] Play/pause error:", err);
      togglePlayPause();
    }
  }, [isPlaying, displayTrack, togglePlayPause, activeSegment, videoPlayer, muxedVideoUrl, engine]);

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleArtistPress = useCallback(
    (artistName: string) => {
      if (!uploaderUrl || !onNavigateToArtist) return;
      triggerHaptic();
      const channelId =
        uploaderUrl.split("/channel/")[1]?.split("?")[0] ??
        uploaderUrl.split("/c/")[1]?.split("?")[0] ??
        uploaderUrl.split("/user/")[1]?.split("?")[0] ??
        uploaderUrl;
      onNavigateToArtist({ id: encodeURIComponent(channelId), subtitle: artistName });
    },
    [uploaderUrl, onNavigateToArtist]
  );

  const handleEqualizer  = () => { triggerHaptic(); onNavigateToEqualizer?.(); };
  const handleCast       = () => { triggerHaptic(); onNavigateToCast?.(); };
  const handleComments   = () => { triggerHaptic(); onNavigateToComments?.(); };
  const handlePlaylist   = () => { triggerHaptic(); onNavigateToPlaylist?.(); };
  const handleSleepTimer = () => { triggerHaptic(); onNavigateToSleepTimer?.(); };
  const handleSeeAll     = () => { triggerHaptic(); onNavigateToQueue?.(); };

  const handleLyrics = () => {
    if (!canShowLyrics || !onNavigateToLyrics) return;
    triggerHaptic();
    onNavigateToLyrics({
      title:    String(displayTrack?.title    ?? ""),
      artist:   String(displayTrack?.artist   ?? ""),
      duration: String(displayTrack?.duration ?? 0),
      videoId:  String(videoId ?? displayTrack?.id ?? ""),
      leadIn:   String(LYRICS_LEAD_IN_S),
    });
  };

  const handleRelated = () => {
    const vid = videoId ?? displayTrack?.id;
    if (!vid || displayTrack.id === DUMMY_TRACK.id || !onNavigateToRelated) return;
    triggerHaptic();
    onNavigateToRelated({
      songUrl: `https://www.youtube.com/watch?v=${vid}`,
      title:   String(displayTrack?.title  ?? ""),
      artist:  String(displayTrack?.artist ?? ""),
    });
  };

  const handleMenuPress = useCallback(() => {
    if (!onNavigateToMenu) return;
    triggerHaptic();
    onNavigateToMenu({
      songData: JSON.stringify({
        id:          displayTrack?.id,
        title:       displayTrack?.title,
        artist:      displayTrack?.artist,
        thumbnail:   displayTrack?.thumbnail,
        url:         displayTrack?.url,
        duration:    displayTrack?.duration,
        uploaderUrl,
        videoId,
      }),
    });
  }, [onNavigateToMenu, displayTrack, uploaderUrl, videoId]);

  const handleCollapsePlayer = useCallback(() => { triggerHaptic(); onMinimize(); }, [onMinimize]);
  const handleClosePlayer    = useCallback(() => { triggerHaptic(); onClose();    }, [onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  const artworkSource =
    typeof displayTrack?.thumbnail === "string" && displayTrack.thumbnail
      ? { uri: displayTrack.thumbnail }
      : require("@/assets/images/mavins.png");

  return (
    <View style={{ flex: 1, backgroundColor: gradientColors[2] }}>
      <LinearGradient style={{ flex: 1 }} colors={gradientColors}>

        {/* TOP BAR */}
        <View style={[styles.topBar, { top: topInset + 8 }]}>
          <View style={styles.dragHandleWrapper} pointerEvents="none">
            <View style={styles.dragHandle} />
          </View>
          <View style={styles.topBarContent}>
            {/* Song / Video segment switch */}
            <View style={styles.segmentSwitch}>
              <TouchableOpacity
                onPress={() => handleSegmentPress("song")}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Text style={activeSegment === "song" ? styles.segmentActive : styles.segmentInactive}>
                  Song
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSegmentPress("video")}
                activeOpacity={hasVideo ? 0.7 : 1}
                disabled={!hasVideo}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Text style={[
                  activeSegment === "video" ? styles.segmentActive : styles.segmentInactive,
                  !hasVideo && { opacity: 0.3 },
                ]}>
                  Video
                </Text>
              </TouchableOpacity>
            </View>

            {/* Right icons */}
            <View style={styles.topBarRight}>
              <TouchableOpacity
                onPress={handleMenuPress}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons name="chevron-down" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCollapsePlayer}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* MAIN CONTENT */}
        <View style={[styles.contentContainer, { paddingTop: topInset + 80 }]}>

          {/* ARTWORK / VIDEO */}
          <View style={styles.artworkContainer}>
            <Animated.View style={[StyleSheet.absoluteFill, artworkAnimStyle]}>
              <Image
                source={artworkSource}
                style={styles.artworkImage}
                contentFit="cover"
                transition={300}
              />
            </Animated.View>
            {hasVideo && (
              <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                <VideoView
                  player={videoPlayer}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                />
              </Animated.View>
            )}
          </View>

          {/* TRACK INFO */}
          <View style={styles.infoContainer}>
            {displayTrack.title ? (
              <MovingText
                text={String(displayTrack.title)}
                animationThreshold={20}
                style={styles.title}
              />
            ) : (
              <View style={{ alignItems: "center", marginBottom: 4 }}>
                <SkeletonPulse width={180} height={20} borderRadius={6} />
              </View>
            )}
            {displayTrack.artist ? (
              <ArtistLine
                rawArtist={String(displayTrack.artist)}
                uploaderUrl={uploaderUrl}
                onArtistPress={handleArtistPress}
              />
            ) : (
              <View style={{ alignItems: "center", marginTop: 6 }}>
                <SkeletonPulse width={120} height={14} borderRadius={4} />
              </View>
            )}
          </View>

          {/* ACTION ROW */}
          <View style={styles.actionRow}>
            <View style={styles.leftActions}>
              <View style={styles.actionContainer}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={toggleFavoriteFunc}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <Ionicons
                    name={isFavorite ? "thumbs-up" : "thumbs-up-outline"}
                    size={16}
                    color={isFavorite ? "#D4AF37" : "#fff"}
                  />
                  {likeCount > 0 && <Text style={styles.statCount}>{formatCount(likeCount)}</Text>}
                </TouchableOpacity>
                <View style={styles.actionDivider} />
                <TouchableOpacity
                  style={styles.actionButton}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <Ionicons name="thumbs-down-outline" size={16} color="#fff" />
                  {dislikeCount > 0 && <Text style={styles.statCount}>{formatCount(dislikeCount)}</Text>}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.actionContainer}
                onPress={handleComments}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons name="comment-text-outline" size={16} color="#fff" />
                {commentsCount > 0 && <Text style={styles.statCount}>{formatCount(commentsCount)}</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.playCountPill}>
              <Ionicons name="headset-outline" size={13} color="rgba(255,255,255,0.65)" />
              {counterTarget > 0
                ? <AnimatedCounter target={counterTarget} />
                : <SkeletonPulse width={42} height={10} borderRadius={3} />
              }
            </View>

            <View style={styles.extraActions}>
              <TouchableOpacity style={styles.extraIcon} onPress={handlePlaylist} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
                <MaterialIcons name="playlist-add" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.extraIcon} onPress={handleSleepTimer} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
                <MaterialCommunityIcons name="weather-night" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* PROGRESS BAR */}
          <View
            style={styles.progressWrapper}
            onTouchStart={() => setSliderActive(true)}
            onTouchEnd={() => setSliderActive(false)}
            onTouchCancel={() => setSliderActive(false)}
          >
            <Slider
              progress={sliderProgress}
              minimumValue={sliderMin}
              maximumValue={sliderMax}
              containerStyle={{ height: moderateScale(5), borderRadius: 16 }}
              renderBubble={() => (
                <View style={styles.bubbleContainer}>
                  <Text style={styles.bubbleText}>
                    {formatTime(slidingValue.value * durationSec)}
                  </Text>
                </View>
              )}
              renderThumb={() => <View style={styles.sliderThumb} />}
              theme={{
                minimumTrackTintColor: "#FFFFFF",
                maximumTrackTintColor: "rgba(255,255,255,0.25)",
              }}
              onSlidingStart={() => { isSliding.value = true;  setSliderActive(true);  }}
              onValueChange={(v)  => { slidingValue.value = v; }}
              onSlidingComplete={(v) => {
                if (!isSliding.value) return;
                isSliding.value = false;
                setSliderActive(false);
                runOnJS(handleSeek)(v);
              }}
            />
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(positionSec)}</Text>
              <Text style={styles.timeText}>{formatTime(durationSec)}</Text>
            </View>
          </View>

          {/* PLAYBACK CONTROLS */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={toggleShuffle} style={styles.shuffleWrapper} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
              <Feather name="shuffle" size={20} color={shuffleMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"} />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSkipBack} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
              <Ionicons name="play-skip-back" size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePlayPause}
              style={styles.bigPlay}
              activeOpacity={0.85}
              disabled={musicPlayerLoading || displayTrack.id === DUMMY_TRACK.id}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons
                name={musicPlayerLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
                size={32}
                color="#000"
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSkipNext} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
              <Ionicons name="play-skip-forward" size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity onPress={toggleRepeat} style={styles.repeatWrapper} activeOpacity={0.7} onPressIn={() => setButtonActive(true)} onPressOut={() => setButtonActive(false)}>
              <MaterialCommunityIcons
                name={repeatMode === "track" ? "repeat-once" : "repeat"}
                size={22}
                color={repeatMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"}
              />
              {repeatMode === "track" && (
                <View style={styles.repeatOneBadge}>
                  <Text style={styles.repeatOneText}>1</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* BOTTOM TABS */}
          <View style={styles.bottomTabs}>
            <TouchableOpacity
              onPress={() => { setActiveBottomTab("upnext"); handleSeeAll(); }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Text style={activeBottomTab === "upnext" ? styles.bottomTabActive : styles.bottomTab}>
                UP NEXT
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={canShowLyrics ? () => { setActiveBottomTab("lyrics"); handleLyrics(); } : undefined}
              activeOpacity={canShowLyrics ? 0.7 : 1}
              disabled={!canShowLyrics}
              onPressIn={() => { if (canShowLyrics) setButtonActive(true); }}
              onPressOut={() => setButtonActive(false)}
            >
              <Text style={[
                activeBottomTab === "lyrics" ? styles.bottomTabActive : styles.bottomTab,
                !canShowLyrics && styles.bottomTabDisabled,
              ]}>
                LYRICS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setActiveBottomTab("related"); handleRelated(); }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Text style={activeBottomTab === "related" ? styles.bottomTabActive : styles.bottomTab}>
                RELATED
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </LinearGradient>
    </View>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export default function PlayerContent(props: PlayerContentProps) {
  return (
    <PlayerContentInner
      onMinimize={props.onMinimize}
      onClose={props.onClose}
      isExpanded={props.isExpanded}
      topInset={props.topInset}
      onNavigateToEqualizer={props.onNavigateToEqualizer}
      onNavigateToCast={props.onNavigateToCast}
      onNavigateToComments={props.onNavigateToComments}
      onNavigateToPlaylist={props.onNavigateToPlaylist}
      onNavigateToSleepTimer={props.onNavigateToSleepTimer}
      onNavigateToQueue={props.onNavigateToQueue}
      onNavigateToLyrics={props.onNavigateToLyrics}
      onNavigateToRelated={props.onNavigateToRelated}
      onNavigateToMenu={props.onNavigateToMenu}
      onNavigateToArtist={props.onNavigateToArtist}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: { position: "absolute", left: 0, right: 0, zIndex: 1000, alignItems: "center" },
  dragHandleWrapper: { width: "100%", alignItems: "center", paddingBottom: 8 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  topBarContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: screenPadding.horizontal,
  },
  segmentSwitch: { flexDirection: "row", gap: scale(20) },
  segmentActive:   { color: "#fff", fontWeight: "600" },
  segmentInactive: { color: "rgba(255,255,255,0.5)" },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: scale(15) },

  contentContainer: { flex: 1, paddingHorizontal: screenPadding.horizontal },
  artworkContainer: {
    alignItems: "center",
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_WIDTH * 0.85,
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
  },
  artworkImage: { width: SCREEN_WIDTH * 0.85, height: SCREEN_WIDTH * 0.85, borderRadius: 16 },

  infoContainer: { marginTop: verticalScale(24), alignItems: "center" },
  title:          { color: "#fff", fontSize: moderateScale(20), fontWeight: "700", textAlign: "center" },
  artist:         { color: "rgba(255,255,255,0.7)", fontSize: moderateScale(15), marginTop: 4, textAlign: "center", flexWrap: "wrap" },
  artistName:     { color: "rgba(255,255,255,0.7)", fontSize: moderateScale(15) },
  artistTappable: { color: "rgba(255,255,255,0.9)" },
  artistSeparator: { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(15) },

  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: verticalScale(18),
    paddingHorizontal: scale(4),
  },
  leftActions: { flexDirection: "row", alignItems: "center", gap: scale(8) },
  actionContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 24,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    alignItems: "center",
    gap: scale(2),
  },
  actionButton:  { flexDirection: "row", alignItems: "center", gap: scale(4) },
  statCount:     { color: "rgba(255,255,255,0.85)", fontSize: moderateScale(11), fontWeight: "600", letterSpacing: 0.2 },
  actionDivider: { width: 1, height: verticalScale(14), backgroundColor: "rgba(255,255,255,0.3)", marginHorizontal: scale(6) },

  playCountPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderRadius: 20,
    paddingHorizontal: scale(9),
    paddingVertical: verticalScale(5),
  },

  extraActions: { flexDirection: "row", alignItems: "center", gap: scale(14) },
  extraIcon:    { padding: scale(4) },

  progressWrapper: { marginTop: verticalScale(20) },
  sliderThumb: {
    width: moderateScale(15),
    height: moderateScale(15),
    borderRadius: moderateScale(15) / 2,
    backgroundColor: "#fff",
  },
  bubbleContainer: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" },
  bubbleText:      { color: "#fff", fontSize: moderateScale(11), fontWeight: "600" },
  timeRow:  { flexDirection: "row", justifyContent: "space-between", marginTop: verticalScale(6) },
  timeText: { color: "rgba(255,255,255,0.6)", fontSize: moderateScale(12) },

  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: verticalScale(26),
    paddingHorizontal: scale(8),
  },
  shuffleWrapper: { alignItems: "center", gap: verticalScale(4) },
  bigPlay: {
    width: scale(65),
    height: scale(65),
    borderRadius: 32.5,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  repeatWrapper: { alignItems: "center", position: "relative" },
  repeatOneBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    backgroundColor: "#8B7355",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#A0826D",
  },
  repeatOneText: { color: "#fff", fontSize: moderateScale(9), fontWeight: "700", lineHeight: moderateScale(12) },

  bottomTabs:        { flexDirection: "row", justifyContent: "space-around", marginTop: verticalScale(32), paddingBottom: verticalScale(5) },
  bottomTabActive:   { color: "#fff", fontSize: moderateScale(13), fontWeight: "600" },
  bottomTab:         { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(13) },
  bottomTabDisabled: { color: "rgba(255,255,255,0.25)", fontSize: moderateScale(13) },
});