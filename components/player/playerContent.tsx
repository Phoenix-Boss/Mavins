// components/player/playerContent.tsx
/**
 * PlayerContent — Full player screen UI.
 *
 * BUGS FIXED IN THIS VERSION:
 *
 *  BUG 1 (Critical) — Stats (likes/dislikes/views/comments) never rendered;
 *    video toggle always disabled.
 *    ROOT CAUSE: likeCount, dislikeCount, viewCount, commentsCount, videoUrl,
 *    muxedVideoUrl, uploaderUrl are JS-only TrackExtras fields. The native
 *    bridge strips them when it serialises the Track for the
 *    onPlaybackActiveTrackChanged event, so useActiveTrack() never had them.
 *    FIX: These are now read from getTrackExtras(activeTrack.id) — a
 *    JS-side Map that MusicPlayerContext populates immediately after
 *    resolveTrack() resolves. The native track event is only used for the
 *    standard fields (title, artist, artwork, duration, id).
 *
 *  BUG 2 (Critical) — Play button toggled but no audio played, progress bar
 *    frozen, no error shown.
 *    ROOT CAUSE: Stale/expired Supabase-cached YouTube stream URLs were
 *    loaded silently by ExoPlayer. MusicPlayerContext now auto-recovers on
 *    PlaybackError (invalidates cache + re-resolves). playerContent reflects
 *    the corrected state via the native event-driven isPlaying.
 *
 *  BUG 3 (Critical) — isPlaying in JS was optimistic (set before native
 *    confirms playback), so the button icon was wrong after silent failures.
 *    FIX: MusicPlayerContext no longer calls setIsPlaying optimistically.
 *    isPlaying here is now solely driven by native PlaybackStateChanged events.
 *    useIsPlayingBridge() below supplements the "ready→playing" gap as before.
 *
 *  BUG 4 (Major) — useActiveTrack() result not destructured.
 *    useActiveTrack() returns { track, index, isLoading }. Kept from previous
 *    fix; now also feeds getTrackExtras() via the track's id.
 *
 *  BUG 5 (Major) — useProgress() received a bare number, not an options object.
 *    Kept from previous fix.
 *
 *  BUG 6 (Minor) — artwork field mismatch: resolveArtwork() helper, kept.
 *
 *  BUG 7 (Minor) — handlePlayPause video/audio handoff: now reads extras from
 *    the JS-side store so hasVideo / muxedVideoUrl are correct.
 */

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
import {
  GestureDetector,
  Gesture,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { Slider } from "react-native-awesome-slider";
import TrackPlayer, {
  useActiveTrack,
  useProgress,
  RepeatMode,
  MavinEvent,
  addEventListener,
  State,
} from "@/modules/mavin-eq";
import { useRouter } from "expo-router";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";

import { MovingText } from "@/components/MovingText";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer, getTrackExtras } from "@/components/MusicPlayerContext";
import { useTrackPlayerRepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
import { useTrackPlayerFavorite } from "@/hooks/useTrackPlayerFavorite";
import { useTrackPlayerShuffle } from "@/hooks/useTrackPlayerShuffle";
import { usePlayerStore } from "@/store/player";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Constants ───────────────────────────────────────────────────────────────

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTime = (s: number): string => {
  if (!s || isNaN(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const formatCount = (n: number): string => {
  if (n <= 0) return "";
  if (n >= 1_000_000_000_000)
    return `${(n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, "")}T`;
  if (n >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000)
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
};

const resolveArtwork = (track: any): string | number | undefined => {
  if (!track) return undefined;
  if (typeof track.artwork === "string" && track.artwork) return track.artwork;
  if (typeof track.artworkUri === "string" && track.artworkUri) return track.artworkUri;
  if (typeof track.artwork === "number") return track.artwork;
  return undefined;
};

const getImageSource = (artwork: string | number | undefined) => {
  if (!artwork) return require("@/assets/images/mavins.png");
  if (typeof artwork === "number") return artwork;
  return { uri: artwork as string };
};

const parseArtists = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,&]|\bft\.?\b|\bfeat\.?\b/i)
    .map((a) => a.trim())
    .filter(Boolean);
};

const formatArtistName = (name: string): string =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2");

// ─── BUG 3 FIX — isPlaying bridge hook ───────────────────────────────────────
/**
 * Supplements MusicPlayerContext.isPlaying with a direct native event listener.
 * Bridges the "ready" → "playing" gap that the Kotlin layer leaves when
 * ExoPlayer reaches STATE_READY but hasn't emitted "playing" yet.
 */
function useIsPlayingBridge(contextIsPlaying: boolean): boolean {
  const [nativePlaying, setNativePlaying] = useState(contextIsPlaying);

  useEffect(() => {
    setNativePlaying(contextIsPlaying);
  }, [contextIsPlaying]);

  useEffect(() => {
    const sub = addEventListener(MavinEvent.PlaybackStateChanged, (data: any) => {
      const s = data?.state as string | undefined;
      if (s === State.Playing || s === "playing") {
        setNativePlaying(true);
      } else if (
        s === State.Paused  || s === "paused"  ||
        s === State.Stopped || s === "stopped" ||
        s === State.Idle    || s === "idle"    ||
        s === State.Ended   || s === "ended"   ||
        s === State.Error   || s === "error"
      ) {
        setNativePlaying(false);
      }
      // "ready" / "buffering" / "loading" — keep current value
    });
    return () => sub.remove();
  }, []);

  return contextIsPlaying || nativePlaying;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonPulse({
  width,
  height,
  borderRadius = 6,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
}) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, []);
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
      const current = Math.max(1, Math.floor(eased * target));
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return <Text style={ctrStyles.text}>{formatCount(display)}</Text>;
}

const ctrStyles = StyleSheet.create({
  text: {
    color: "rgba(255,255,255,0.85)",
    fontSize: moderateScale(11),
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});

// ─── ArtistLine ──────────────────────────────────────────────────────────────

interface ArtistLineProps {
  rawArtist: string | undefined;
  uploaderUrl: string | undefined;
  onArtistPress: (name: string) => void;
}

function ArtistLine({ rawArtist, uploaderUrl, onArtistPress }: ArtistLineProps) {
  const artists = useMemo(
    () => parseArtists(rawArtist).map(formatArtistName),
    [rawArtist]
  );

  if (!artists.length) {
    return <Text style={styles.artist}>—</Text>;
  }

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

// ─── PlayerIdleScreen ────────────────────────────────────────────────────────

function PlayerIdleScreen({ onMinimize }: { onMinimize: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const anim   = useRef(new RNAnimated.Value(0)).current;

  const handleDismiss = useCallback(() => {
    onMinimize();
    try {
      if (!router.canGoBack()) router.replace("/(tabs)");
    } catch {
      router.replace("/(tabs)");
    }
  }, [onMinimize, router]);

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const glowOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.38] });

  return (
    <LinearGradient style={{ flex: 1 }} colors={["#1a0f05", "#0b0b0b", "#050505"]}>
      <View style={[idleStyles.topBar, { top: insets.top + 8 }]}>
        <View style={idleStyles.dragHandleWrapper}>
          <View style={idleStyles.dragHandle} />
        </View>
        <TouchableOpacity onPress={handleDismiss} style={idleStyles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-down" size={28} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      <View style={[idleStyles.body, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 24 }]}>
        <View style={idleStyles.artworkWrapper}>
          <RNAnimated.View style={[idleStyles.glow, { opacity: glowOpacity }]} />
          <Image
            source={require("@/assets/images/mavins.png")}
            style={idleStyles.artworkImage}
            contentFit="contain"
          />
        </View>

        <View style={idleStyles.infoContainer}>
          <Text style={idleStyles.appTitle}>Mavin Player</Text>
          <Text style={idleStyles.subtitle}>No song playing yet</Text>
        </View>

        <View style={idleStyles.progressWrapper}>
          <SkeletonPulse width="100%" height={4} borderRadius={4} />
          <View style={idleStyles.timeRow}>
            <Text style={idleStyles.timeText}>0:00</Text>
            <Text style={idleStyles.timeText}>0:00</Text>
          </View>
        </View>

        <View style={idleStyles.controls}>
          <Feather name="shuffle" size={20} color="rgba(255,255,255,0.2)" />
          <Ionicons name="play-skip-back" size={32} color="rgba(255,255,255,0.2)" />
          <View style={idleStyles.bigPlay}>
            <Ionicons name="play" size={32} color="rgba(0,0,0,0.35)" />
          </View>
          <Ionicons name="play-skip-forward" size={32} color="rgba(255,255,255,0.2)" />
          <MaterialCommunityIcons name="repeat" size={22} color="rgba(255,255,255,0.2)" />
        </View>

        <View style={idleStyles.bottomTabs}>
          {["UP NEXT", "LYRICS", "RELATED"].map((label) => (
            <Text key={label} style={idleStyles.bottomTab}>{label}</Text>
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}

const idleStyles = StyleSheet.create({
  topBar: { position: "absolute", left: 0, right: 0, zIndex: 100, alignItems: "center" },
  dragHandleWrapper: { width: "100%", alignItems: "center", paddingBottom: 8 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  closeBtn: { position: "absolute", left: screenPadding.horizontal, top: 0 },
  body: { flex: 1, paddingHorizontal: screenPadding.horizontal, alignItems: "center" },
  artworkWrapper: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_WIDTH * 0.85,
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1c1208",
    justifyContent: "center",
    alignItems: "center",
  },
  glow: { ...StyleSheet.absoluteFillObject, backgroundColor: "#D4AF37", borderRadius: 16 },
  artworkImage: { width: SCREEN_WIDTH * 0.55, height: SCREEN_WIDTH * 0.55, opacity: 0.75 },
  infoContainer: { marginTop: verticalScale(24), alignItems: "center", width: "100%" },
  appTitle: { color: "#fff", fontSize: moderateScale(20), fontWeight: "700", textAlign: "center", letterSpacing: 0.4 },
  subtitle: { color: "rgba(255,255,255,0.4)", fontSize: moderateScale(14), marginTop: 6, textAlign: "center" },
  progressWrapper: { marginTop: verticalScale(20), width: "100%" },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: verticalScale(6) },
  timeText: { color: "rgba(255,255,255,0.3)", fontSize: moderateScale(12) },
  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: verticalScale(26),
    width: "100%",
    paddingHorizontal: scale(8),
  },
  bigPlay: {
    width: scale(65),
    height: scale(65),
    borderRadius: 32.5,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomTabs: { flexDirection: "row", justifyContent: "space-around", marginTop: verticalScale(32), width: "100%" },
  bottomTab: { color: "rgba(255,255,255,0.2)", fontSize: moderateScale(13) },
});

// ─── Props ───────────────────────────────────────────────────────────────────

interface PlayerContentProps {
  onMinimize: () => void;
  onClose: () => void;
  isExpanded: boolean;
  playerReady: boolean;
}

// ─── PlayerContentInner ──────────────────────────────────────────────────────

function PlayerContentInner({
  onMinimize,
  onClose,
  isExpanded,
}: Omit<PlayerContentProps, "playerReady">) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // BUG 4 FIX (kept): useActiveTrack() returns { track, index, isLoading }
  const { track: activeTrack, isLoading: trackIsLoading } = useActiveTrack();

  // BUG 5 FIX (kept): useProgress() takes an options object
  const progress = useProgress({ intervalMs: 250 });

  // Progress values are in milliseconds (native ExoPlayer contract).
  const positionSec = progress.position / 1000;
  const durationSec = progress.duration / 1000;

  const { togglePlayPause, isLoading, isPlaying: contextIsPlaying } = useMusicPlayer();

  // BUG 3 FIX: Bridge the "ready" → "playing" gap
  const isPlaying = useIsPlayingBridge(contextIsPlaying);

  type PS = ReturnType<typeof usePlayerStore.getState>;
  const storeCurrentTrack = usePlayerStore((s: PS) => s.currentTrack);

  // BUG 6 FIX (kept): normalise displayTrack so .artwork is always set
  const displayTrack = useMemo(() => {
    if (activeTrack) {
      const resolved = resolveArtwork(activeTrack);
      return { ...(activeTrack as any), artwork: resolved };
    }
    if (storeCurrentTrack) {
      return {
        id:        storeCurrentTrack.id,
        title:     storeCurrentTrack.title,
        artist:    storeCurrentTrack.artist,
        artwork:   storeCurrentTrack.thumbnail,
        artworkUri: storeCurrentTrack.thumbnail,
        url:       storeCurrentTrack.url,
        duration:  storeCurrentTrack.duration,
        videoId:   storeCurrentTrack.videoId,
      } as any;
    }
    return null;
  }, [activeTrack, storeCurrentTrack]);

  // ─── BUG 1 FIX ─────────────────────────────────────────────────────────────
  // JS-only extra fields (stats, video URLs, uploaderUrl) are NOT available
  // from useActiveTrack() because the native bridge strips them. They live in
  // the JS-side trackExtrasStore populated by MusicPlayerContext.
  // We read them here by the active track's ID and keep a local state copy
  // so the UI re-renders when comments arrive asynchronously.
  const [extras, setExtras] = useState(() =>
    getTrackExtras(displayTrack?.id) ?? {}
  );

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id) {
      setExtras({});
      return;
    }
    // Immediately read whatever is already stored
    setExtras(getTrackExtras(id) ?? {});

    // Poll once more after a short delay to catch asynchronous comment counts
    // that MusicPlayerContext may have written after we rendered
    const t = setTimeout(() => {
      setExtras(getTrackExtras(id) ?? {});
    }, 3000);
    return () => clearTimeout(t);
  }, [displayTrack?.id]);

  // Also subscribe to the native track-changed event so extras update
  // when the user skips to a queued track
  useEffect(() => {
    const sub = addEventListener(
      MavinEvent.PlaybackActiveTrackChanged,
      (data: any) => {
        const id = data?.track?.id;
        if (id) setExtras(getTrackExtras(id) ?? {});
      },
    );
    return () => sub.remove();
  }, []);

  // Derived stat values — all sourced from the JS-side extras store
  const likeCount     = typeof extras.likeCount     === "number" ? extras.likeCount     : -1;
  const dislikeCount  = typeof extras.dislikeCount  === "number" ? extras.dislikeCount  : -1;
  const commentsCount = typeof extras.commentsCount === "number" ? extras.commentsCount : -1;
  const viewCount     = typeof extras.viewCount     === "number" ? extras.viewCount     : -1;

  // Video / uploader data also from extras store
  const uploaderUrl: string | undefined  = extras.uploaderUrl as string | undefined;
  const videoId:     string | undefined  = extras.videoId     as string | undefined;
  const muxedVideoUrl: string | undefined = extras.muxedVideoUrl as string | undefined;
  const videoUrl:      string | undefined = extras.videoUrl      as string | undefined;
  const activeVideoUrl                    = muxedVideoUrl ?? videoUrl ?? undefined;
  const hasVideo                          = !!activeVideoUrl;

  const canShowLyrics = !!(videoId ?? displayTrack?.id);

  const { repeatMode, changeRepeatMode } = useTrackPlayerRepeatMode();
  const { isFavorite, toggleFavoriteFunc } = useTrackPlayerFavorite();
  const { shuffleMode, toggleShuffle, getDotCount } = useTrackPlayerShuffle();

  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [displayTrack?.id, viewCount]);

  // ── Video handling ──────────────────────────────────────────────────────────

  const [activeSegment, setActiveSegment] = useState<"song" | "video">("song");
  const videoPlayerReady  = useRef(false);
  const pendingSeek       = useRef<number | null>(null);
  const videoOwnsAudio    = useRef(false);

  const videoPlayer = useVideoPlayer(activeVideoUrl ?? null, (p) => {
    p.muted  = !muxedVideoUrl;
    p.loop   = false;
    p.pause();
  });

  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video") return;
    if (muxedVideoUrl && videoOwnsAudio.current) {
      if (isPlaying) videoPlayer.play();
      else videoPlayer.pause();
    } else if (!muxedVideoUrl) {
      if (isPlaying) videoPlayer.play();
      else videoPlayer.pause();
    }
  }, [isPlaying, activeSegment, videoPlayer, muxedVideoUrl]);

  useEffect(() => {
    if (!videoPlayer) return;
    const sub = videoPlayer.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") {
        videoPlayerReady.current = true;
        if (pendingSeek.current !== null) {
          videoPlayer.currentTime = pendingSeek.current;
          pendingSeek.current = null;
          if (activeSegment === "video" && isPlaying) {
            if (muxedVideoUrl) {
              videoOwnsAudio.current = true;
              TrackPlayer.pause().catch(() => {});
            }
            videoPlayer.play();
          }
        }
      }
    });
    return () => sub.remove();
  }, [videoPlayer, activeSegment, isPlaying, muxedVideoUrl]);

  const videoProgress    = useSharedValue(0);
  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [1, 0]), { duration: 300 }),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [0, 1]), { duration: 300 }),
  }));

  const handleSegmentPress = useCallback(
    (seg: "song" | "video") => {
      if (seg === "video" && !hasVideo) return;
      triggerHaptic();
      setActiveSegment(seg);
      videoProgress.value = seg === "video" ? 1 : 0;

      if (seg === "video" && videoPlayer) {
        if (muxedVideoUrl) {
          TrackPlayer.getProgress().then(({ position }) => {
            const seekSec = position / 1000;
            if (videoPlayerReady.current) {
              videoPlayer.currentTime = seekSec;
              if (isPlaying) {
                videoOwnsAudio.current = true;
                TrackPlayer.pause().catch(() => {});
                videoPlayer.play();
              }
            } else {
              pendingSeek.current = seekSec;
            }
          }).catch(() => {});
        } else {
          if (videoPlayerReady.current) {
            videoPlayer.currentTime = positionSec;
            if (isPlaying) videoPlayer.play();
          } else {
            pendingSeek.current = positionSec;
          }
        }
      } else if (seg === "song" && videoPlayer) {
        videoPlayer.pause();
        if (muxedVideoUrl && videoOwnsAudio.current) {
          videoOwnsAudio.current = false;
          TrackPlayer.play().catch(() => {});
        }
      }
    },
    [hasVideo, videoPlayer, videoProgress, positionSec, isPlaying, muxedVideoUrl]
  );

  // Reset video state when the active track changes
  useEffect(() => {
    if (videoPlayer) videoPlayer.pause();
    if (videoOwnsAudio.current) {
      videoOwnsAudio.current = false;
      TrackPlayer.play().catch(() => {});
    }
    setActiveSegment("song");
    videoProgress.value      = 0;
    videoPlayerReady.current = false;
    pendingSeek.current      = null;
  }, [displayTrack?.id, videoPlayer]);

  const [activeBottomTab, setActiveBottomTab] = useState<"upnext" | "lyrics" | "related">("upnext");
  useEffect(() => { setActiveBottomTab("upnext"); }, [displayTrack?.id]);

  const artworkForColors = typeof displayTrack?.artwork === "string" ? displayTrack.artwork : null;
  const { imageColors }  = useImageColors(artworkForColors);
  const gradientColors   = useMemo(() => {
    if (imageColors?.dominant) return [imageColors.dominant, "#000", "#000"];
    return ["#1a0f05", "#0b0b0b", "#050505"];
  }, [imageColors]);

  // ── Slider ─────────────────────────────────────────────────────────────────

  const isSliding      = useSharedValue(false);
  const sliderProgress = useSharedValue(0);
  const sliderMin      = useSharedValue(0);
  const sliderMax      = useSharedValue(1);
  const slidingValue   = useSharedValue(0);

  if (!isSliding.value) {
    sliderProgress.value = progress.duration > 0 ? progress.position / progress.duration : 0;
  }

  const handleSeek = useCallback(
    async (fraction: number) => {
      if (durationSec <= 0) return;
      const t = fraction * durationSec;
      await TrackPlayer.seekTo(t * 1000);
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        videoPlayer.currentTime = t;
        if (isPlaying) videoPlayer.play();
      }
    },
    [durationSec, activeSegment, videoPlayer, isPlaying]
  );

  // ── Swipe-down-to-dismiss gesture ──────────────────────────────────────────

  const translateY        = useSharedValue(0);
  const DISMISS_THRESHOLD = SCREEN_HEIGHT * 0.15;
  const DISMISS_VELOCITY  = 800;

  const dismiss = useCallback(() => {
    triggerHaptic();
    onMinimize();
    try {
      if (!router.canGoBack()) router.replace("/(tabs)");
    } catch {
      router.replace("/(tabs)");
    }
  }, [onMinimize, router]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > DISMISS_THRESHOLD ||
        (e.translationY > 40 && e.velocityY > DISMISS_VELOCITY);

      if (shouldDismiss) {
        translateY.value = withTiming(SCREEN_HEIGHT, { duration: 220 }, () => {
          runOnJS(dismiss)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ── Playback controls ───────────────────────────────────────────────────────

  const handleSkipBack = async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") videoPlayer.pause();
    try { await TrackPlayer.skipToPrevious(); } catch { }
  };

  const handleSkipNext = async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") videoPlayer.pause();
    try { await TrackPlayer.skipToNext(); } catch { }
  };

  const toggleRepeat = () => {
    triggerHaptic();
    if (repeatMode === RepeatMode.Off)        changeRepeatMode(RepeatMode.Queue);
    else if (repeatMode === RepeatMode.Queue) changeRepeatMode(RepeatMode.Track);
    else                                       changeRepeatMode(RepeatMode.Off);
  };

  // BUG 7 FIX: muxedVideoUrl now comes from the JS-side extras store,
  // so the video/audio handoff here is always correct.
  const handlePlayPause = useCallback(() => {
    triggerHaptic();
    if (!displayTrack) return;
    togglePlayPause();
    if (isPlaying && activeSegment === "video" && muxedVideoUrl && videoPlayer) {
      videoPlayer.pause();
    } else if (!isPlaying && activeSegment === "video" && muxedVideoUrl && videoPlayer) {
      videoOwnsAudio.current = true;
      TrackPlayer.pause().catch(() => {});
      videoPlayer.play();
    }
  }, [isPlaying, displayTrack, togglePlayPause, activeSegment, muxedVideoUrl, videoPlayer]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleArtistPress = useCallback(
    (artistName: string) => {
      if (!uploaderUrl) return;
      triggerHaptic();
      const channelId =
        uploaderUrl.split("/channel/")[1]?.split("?")[0] ??
        uploaderUrl.split("/c/")[1]?.split("?")[0] ??
        uploaderUrl.split("/user/")[1]?.split("?")[0] ??
        uploaderUrl;
      router.push({
        pathname: "/(tabs)/search/artist",
        params: { id: encodeURIComponent(channelId), subtitle: artistName },
      });
    },
    [uploaderUrl, router]
  );

  const handleEqualizer  = () => { triggerHaptic(); router.push("/(modals)/equalizer"); };
  const handleCast       = () => { triggerHaptic(); router.push("/(player)/cast-devices"); };
  const handleComments   = () => { triggerHaptic(); router.push("/(modals)/comments"); };
  const handlePlaylist   = () => { triggerHaptic(); router.push("/(modals)/add-to-playlist"); };
  const handleSleepTimer = () => { triggerHaptic(); router.push("/(player)/sleep-timer"); };
  const handleSeeAll     = () => { triggerHaptic(); router.push("/(modals)/queue"); };

  const handleLyrics = () => {
    if (!canShowLyrics) return;
    triggerHaptic();
    router.push({
      pathname: "/(modals)/lyrics",
      params: {
        title:    (displayTrack?.title    ?? "") as string,
        artist:   (displayTrack?.artist   ?? "") as string,
        duration: String(displayTrack?.duration ?? 0),
        videoId:  (videoId ?? displayTrack?.id  ?? "") as string,
        leadIn:   String(LYRICS_LEAD_IN_S),
      },
    });
  };

  const handleRelated = () => {
    const vid = videoId ?? displayTrack?.id;
    if (!vid) return;
    triggerHaptic();
    router.push({
      pathname: "/(modals)/related",
      params: {
        songUrl: `https://www.youtube.com/watch?v=${vid}`,
        title:   (displayTrack?.title  ?? "") as string,
        artist:  (displayTrack?.artist ?? "") as string,
      },
    });
  };

  const handleMenuPress = useCallback(() => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/menu",
      params: {
        type: "song",
        songData: JSON.stringify({
          id:          displayTrack?.id,
          title:       displayTrack?.title,
          artist:      displayTrack?.artist,
          thumbnail:   displayTrack?.artwork,
          url:         displayTrack?.url,
          duration:    displayTrack?.duration,
          uploaderUrl: uploaderUrl,
          videoId:     videoId,
        }),
      },
    });
  }, [router, displayTrack, uploaderUrl, videoId]);

  // ── No-track idle fallback ───────────────────────────────────────────────────
  if (!displayTrack) {
    return <PlayerIdleScreen onMinimize={onMinimize} />;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[{ flex: 1 }, animatedStyle]}>
        <LinearGradient style={{ flex: 1 }} colors={gradientColors}>

          {/* TOP BAR */}
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <View style={styles.dragHandleWrapper}>
              <View style={styles.dragHandle} />
            </View>
            <View style={styles.topBarContent}>
              <View style={styles.segmentSwitch}>
                <TouchableOpacity onPress={() => handleSegmentPress("song")} activeOpacity={0.7}>
                  <Text style={activeSegment === "song" ? styles.segmentActive : styles.segmentInactive}>
                    Song
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleSegmentPress("video")}
                  activeOpacity={hasVideo ? 0.7 : 1}
                >
                  <Text style={[
                    activeSegment === "video" ? styles.segmentActive : styles.segmentInactive,
                    !hasVideo && { opacity: 0.3 },
                  ]}>
                    Video
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.topBarRight}>
                <TouchableOpacity onPress={handleEqualizer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="equalizer" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCast} activeOpacity={0.7}>
                  <MaterialIcons name="cast" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleMenuPress} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* MAIN CONTENT */}
          <View style={[
            styles.contentContainer,
            { paddingTop: insets.top + 90, paddingBottom: insets.bottom + 8 },
          ]}>

            {/* ARTWORK / VIDEO */}
            <View style={styles.artworkContainer}>
              <Animated.View style={[StyleSheet.absoluteFill, artworkAnimStyle]}>
                <Image
                  source={getImageSource(displayTrack.artwork)}
                  style={styles.artworkImage}
                  contentFit="cover"
                  transition={300}
                />
              </Animated.View>
              {hasVideo && (
                <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                  <VideoView
                    player={videoPlayer}
                    style={styles.artworkImage}
                    contentFit="cover"
                    nativeControls={false}
                    allowsFullscreen={false}
                    allowsPictureInPicture={false}
                  />
                </Animated.View>
              )}
            </View>

            {/* SONG INFO */}
            <View style={styles.infoContainer}>
              {displayTrack.title ? (
                <MovingText
                  text={displayTrack.title}
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
                  rawArtist={displayTrack.artist}
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
                {/* Likes / Dislikes — BUG 1 FIX: sourced from JS extras store */}
                <View style={styles.actionContainer}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => { triggerHaptic(); toggleFavoriteFunc(); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isFavorite ? "thumbs-up" : "thumbs-up-outline"}
                      size={16}
                      color={isFavorite ? "#D4AF37" : "#fff"}
                    />
                    {likeCount > 0 && (
                      <Text style={styles.statCount}>{formatCount(likeCount)}</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.actionDivider} />
                  <TouchableOpacity style={styles.actionButton} activeOpacity={0.7}>
                    <Ionicons name="thumbs-down-outline" size={16} color="#fff" />
                    {dislikeCount > 0 && (
                      <Text style={styles.statCount}>{formatCount(dislikeCount)}</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Comments — BUG 1 FIX: sourced from JS extras store */}
                <TouchableOpacity
                  style={styles.actionContainer}
                  onPress={handleComments}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="comment-text-outline" size={16} color="#fff" />
                  {commentsCount > 0 && (
                    <Text style={styles.statCount}>{formatCount(commentsCount)}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Play / view count — BUG 1 FIX: sourced from JS extras store */}
              <View style={styles.playCountPill}>
                <Ionicons name="headset-outline" size={13} color="rgba(255,255,255,0.65)" />
                {counterTarget > 0 ? (
                  <AnimatedCounter target={counterTarget} />
                ) : (
                  <SkeletonPulse width={42} height={10} borderRadius={3} />
                )}
              </View>

              <View style={styles.extraActions}>
                <TouchableOpacity style={styles.extraIcon} onPress={handlePlaylist} activeOpacity={0.7}>
                  <MaterialIcons name="playlist-add" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.extraIcon} onPress={handleSleepTimer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="weather-night" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {/* PROGRESS BAR */}
            <View style={styles.progressWrapper}>
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
                onSlidingStart={() => { isSliding.value = true; }}
                onValueChange={(v) => {
                  slidingValue.value = v;
                  runOnJS(handleSeek)(v);
                }}
                onSlidingComplete={(v) => {
                  if (!isSliding.value) return;
                  isSliding.value = false;
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
              <TouchableOpacity
                onPress={toggleShuffle}
                style={styles.shuffleWrapper}
                activeOpacity={0.7}
              >
                <Feather
                  name="shuffle"
                  size={20}
                  color={shuffleMode === "off" ? "rgba(255,255,255,0.4)" : "#fff"}
                />
                {shuffleMode !== "off" && (
                  <View style={styles.dotContainer}>
                    {Array.from({ length: getDotCount() }).map((_, i) => (
                      <View key={i} style={styles.dot} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSkipBack} activeOpacity={0.7}>
                <Ionicons name="play-skip-back" size={32} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePlayPause}
                style={styles.bigPlay}
                activeOpacity={0.85}
                disabled={isLoading}
              >
                <Ionicons
                  name={isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
                  size={32}
                  color="#000"
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSkipNext} activeOpacity={0.7}>
                <Ionicons name="play-skip-forward" size={32} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity onPress={toggleRepeat} style={styles.repeatWrapper} activeOpacity={0.7}>
                <MaterialCommunityIcons
                  name={repeatMode === RepeatMode.Track ? "repeat-once" : "repeat"}
                  size={22}
                  color={repeatMode === RepeatMode.Off ? "rgba(255,255,255,0.4)" : "#fff"}
                />
                {repeatMode === RepeatMode.Track && (
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
              >
                <Text style={activeBottomTab === "upnext" ? styles.bottomTabActive : styles.bottomTab}>
                  UP NEXT
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={canShowLyrics ? () => { setActiveBottomTab("lyrics"); handleLyrics(); } : undefined}
                activeOpacity={canShowLyrics ? 0.7 : 1}
                disabled={!canShowLyrics}
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
              >
                <Text style={activeBottomTab === "related" ? styles.bottomTabActive : styles.bottomTab}>
                  RELATED
                </Text>
              </TouchableOpacity>
            </View>

          </View>
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── PlayerContent — public export ───────────────────────────────────────────

export default function PlayerContent({
  onMinimize,
  onClose,
  isExpanded,
  playerReady,
}: PlayerContentProps) {
  if (!playerReady) {
    return <PlayerIdleScreen onMinimize={onMinimize} />;
  }

  return (
    <PlayerContentInner
      onMinimize={onMinimize}
      onClose={onClose}
      isExpanded={isExpanded}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
  segmentActive: { color: "#fff", fontWeight: "600" },
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
  title: { color: "#fff", fontSize: moderateScale(20), fontWeight: "700", textAlign: "center" },

  artist: {
    color: "rgba(255,255,255,0.7)",
    fontSize: moderateScale(15),
    marginTop: 4,
    textAlign: "center",
    flexWrap: "wrap",
  },
  artistName: { color: "rgba(255,255,255,0.7)", fontSize: moderateScale(15) },
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
  actionButton: { flexDirection: "row", alignItems: "center", gap: scale(4) },
  statCount: { color: "rgba(255,255,255,0.85)", fontSize: moderateScale(11), fontWeight: "600", letterSpacing: 0.2 },
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
  extraIcon: { padding: scale(4) },

  progressWrapper: { marginTop: verticalScale(20) },
  sliderThumb: { width: moderateScale(15), height: moderateScale(15), borderRadius: moderateScale(15) / 2, backgroundColor: "#fff" },
  bubbleContainer: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" },
  bubbleText: { color: "#fff", fontSize: moderateScale(11), fontWeight: "600" },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: verticalScale(6) },
  timeText: { color: "rgba(255,255,255,0.6)", fontSize: moderateScale(12) },

  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: verticalScale(26),
    paddingHorizontal: scale(8),
  },
  shuffleWrapper: { alignItems: "center", gap: verticalScale(4) },
  dotContainer: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#fff", marginHorizontal: 1.5 },
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

  bottomTabs: { flexDirection: "row", justifyContent: "space-around", marginTop: verticalScale(32), paddingBottom: verticalScale(5) },
  bottomTabActive: { color: "#fff", fontSize: moderateScale(13), fontWeight: "600" },
  bottomTab: { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(13) },
  bottomTabDisabled: { color: "rgba(255,255,255,0.25)", fontSize: moderateScale(13) },
});