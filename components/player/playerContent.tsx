// components/player/PlayerContent.tsx
/**
 * PlayerContent — The actual player UI (extracted from PlayerScreen)
 * 
 * Uses playerStore.setIsPlaying() for INSTANT UI feedback (0ms delay)
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
import {
  useActiveTrack,
  useProgress,
  RepeatMode,
} from "react-native-track-player";
import TrackPlayer from "react-native-track-player";
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
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { useTrackPlayerRepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
import { useTrackPlayerFavorite } from "@/hooks/useTrackPlayerFavorite";
import { useTrackPlayerShuffle } from "@/hooks/useTrackPlayerShuffle";
import { usePlayerStore } from "@/store/player";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Constants ──────────────────────────────────────────────────────────────

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

// ─── Helpers ────────────────────────────────────────────────────────────────

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

const getImageSource = (artwork: string | number | undefined) => {
  if (!artwork) return require("@/assets/images/icon.png");
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

// ─── Skeleton Components ────────────────────────────────────────────────────

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

// ─── AnimatedCounter ─────────────────────────────────────────────────────────

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

// ─── ArtistLine ─────────────────────────────────────────────────────────────

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

// ─── Main PlayerContent Component ────────────────────────────────────────────

interface PlayerContentProps {
  onMinimize: () => void;
  onClose: () => void;
  isExpanded: boolean;
}

export default function PlayerContent({ onMinimize, onClose, isExpanded }: PlayerContentProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const activeTrack = useActiveTrack();
  const progress = useProgress(250);
  const { togglePlayPause, isLoading, isPlaying: contextIsPlaying } = useMusicPlayer();

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTANT UI: Use playerStore for immediate state updates
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Get store actions
  const setStoreIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  const storeIsPlaying = usePlayerStore((state) => state.isPlaying);
  
  // Track if we're in "dumb mode" (ignoring context updates)
  const dumbModeRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Sync store with context when not in dumb mode
  useEffect(() => {
    if (!dumbModeRef.current && storeIsPlaying !== contextIsPlaying) {
      setStoreIsPlaying(contextIsPlaying);
    }
  }, [contextIsPlaying, storeIsPlaying, setStoreIsPlaying]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);
  
  // Track change: reset dumb mode and sync
  useEffect(() => {
    dumbModeRef.current = false;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setStoreIsPlaying(contextIsPlaying);
  }, [activeTrack?.id, contextIsPlaying, setStoreIsPlaying]);

  // ═══════════════════════════════════════════════════════════════════════════

  const { repeatMode, changeRepeatMode } = useTrackPlayerRepeatMode();
  const { isFavorite, toggleFavoriteFunc } = useTrackPlayerFavorite();
  const { shuffleMode, toggleShuffle, getDotCount } = useTrackPlayerShuffle();

  const track = activeTrack as any;
  const likeCount = typeof track?.likeCount === "number" ? track.likeCount : -1;
  const dislikeCount = typeof track?.dislikeCount === "number" ? track.dislikeCount : -1;
  const commentsCount = typeof track?.commentsCount === "number" ? track.commentsCount : -1;
  const viewCount = typeof track?.viewCount === "number" ? track.viewCount : -1;

  const uploaderUrl: string | undefined = track?.uploaderUrl as string | undefined;
  const videoId: string | undefined = track?.videoId as string | undefined;

  // Counter animation
  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [activeTrack?.id, viewCount]);

  // Video handling
  const muxedVideoUrl: string | undefined = track?.muxedVideoUrl as string | undefined;
  const videoUrl: string | undefined      = track?.videoUrl as string | undefined;
  const activeVideoUrl                    = muxedVideoUrl ?? videoUrl ?? undefined;
  const hasVideo = !!activeVideoUrl;
  const [activeSegment, setActiveSegment] = useState<"song" | "video">("song");
  const videoPlayerReady = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const videoOwnsAudio = useRef(false);

  const videoPlayer = useVideoPlayer(activeVideoUrl ?? null, (p) => {
    p.muted = !muxedVideoUrl;
    p.loop = false;
    p.pause();
  });

  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video") return;
    if (muxedVideoUrl) {
      if (videoOwnsAudio.current) {
        if (contextIsPlaying) videoPlayer.play();
        else videoPlayer.pause();
      }
    } else {
      if (contextIsPlaying) videoPlayer.play();
      else videoPlayer.pause();
    }
  }, [contextIsPlaying, activeSegment, videoPlayer, muxedVideoUrl]);

  useEffect(() => {
    if (!videoPlayer) return;
    const sub = videoPlayer.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") {
        videoPlayerReady.current = true;
        if (pendingSeek.current !== null) {
          videoPlayer.currentTime = pendingSeek.current;
          pendingSeek.current = null;
          if (activeSegment === "video" && contextIsPlaying) {
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
  }, [videoPlayer, activeSegment, contextIsPlaying, muxedVideoUrl]);

  const videoProgress = useSharedValue(0);
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
            if (videoPlayerReady.current) {
              videoPlayer.currentTime = position;
              if (contextIsPlaying) {
                videoOwnsAudio.current = true;
                TrackPlayer.pause().catch(() => {});
                videoPlayer.play();
              }
            } else {
              pendingSeek.current = position;
            }
          }).catch(() => {});
        } else {
          const seekTo = progress.position;
          if (videoPlayerReady.current) {
            videoPlayer.currentTime = seekTo;
            if (contextIsPlaying) videoPlayer.play();
          } else {
            pendingSeek.current = seekTo;
          }
        }
      } else if (seg === "song" && videoPlayer) {
        videoPlayer.pause();
        if (muxedVideoUrl) {
          videoOwnsAudio.current = false;
          TrackPlayer.play().catch(() => {});
        }
      }
    },
    [hasVideo, videoPlayer, videoProgress, progress.position, contextIsPlaying, muxedVideoUrl]
  );

  useEffect(() => {
    if (videoPlayer) videoPlayer.pause();
    if (videoOwnsAudio.current) {
      videoOwnsAudio.current = false;
      TrackPlayer.play().catch(() => {});
    }
    setActiveSegment("song");
    videoProgress.value = 0;
    videoPlayerReady.current = false;
    pendingSeek.current = null;
    dumbModeRef.current = false;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, [activeTrack?.id, videoPlayer]);

  // Bottom tabs
  const [activeBottomTab, setActiveBottomTab] = useState<"upnext" | "lyrics" | "related">("upnext");
  useEffect(() => { setActiveBottomTab("upnext"); }, [activeTrack?.id]);

  // Gradient colors
  const artworkForColors = typeof activeTrack?.artwork === "string" ? activeTrack.artwork : null;
  const { imageColors } = useImageColors(artworkForColors);
  const gradientColors = useMemo(() => {
    if (imageColors?.dominant) return [imageColors.dominant, "#000", "#000"];
    return ["#1a0f05", "#0b0b0b", "#050505"];
  }, [imageColors]);

  // Progress bar
  const isSliding = useSharedValue(false);
  const sliderProgress = useSharedValue(0);
  const sliderMin = useSharedValue(0);
  const sliderMax = useSharedValue(1);
  const slidingValue = useSharedValue(0);

  if (!isSliding.value) {
    sliderProgress.value = progress.duration > 0 ? progress.position / progress.duration : 0;
  }

  const handleSeek = useCallback(
    async (fraction: number) => {
      if (progress.duration <= 0) return;
      const t = fraction * progress.duration;
      await TrackPlayer.seekTo(t);
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        videoPlayer.currentTime = t;
        if (contextIsPlaying) videoPlayer.play();
      }
    },
    [progress.duration, activeSegment, videoPlayer, contextIsPlaying]
  );

  // Dismiss gesture
  const translateY = useSharedValue(0);
  const DISMISS_THRESHOLD = SCREEN_HEIGHT * 0.25;

  const dismiss = useCallback(() => {
    triggerHaptic();
    onMinimize();
  }, [onMinimize]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => { if (e.translationY > 0) translateY.value = e.translationY; })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD) runOnJS(dismiss)();
      else translateY.value = withSpring(0, { damping: 20 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Controls
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
    if (repeatMode === RepeatMode.Off) changeRepeatMode(RepeatMode.Queue);
    else if (repeatMode === RepeatMode.Queue) changeRepeatMode(RepeatMode.Track);
    else changeRepeatMode(RepeatMode.Off);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTANT PLAY/PAUSE HANDLER - Uses playerStore for immediate update
  // ═══════════════════════════════════════════════════════════════════════════
  
  const handlePlayPause = useCallback(() => {
    triggerHaptic();
    
    // Enter dumb mode
    dumbModeRef.current = true;
    
    // INSTANT: Update store immediately (0ms delay)
    const nextState = !storeIsPlaying;
    setStoreIsPlaying(nextState);
    
    // Clear existing timeout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    // Handle video mode directly
    if (activeSegment === "video" && muxedVideoUrl && videoOwnsAudio.current && videoPlayer) {
      if (nextState) videoPlayer.play();
      else videoPlayer.pause();
    }
    
    // Fire actual command in background
    requestAnimationFrame(() => {
      togglePlayPause();
    });
    
    // Exit dumb mode after 300ms
    syncTimeoutRef.current = setTimeout(() => {
      dumbModeRef.current = false;
      setStoreIsPlaying(contextIsPlaying);
    }, 300);
  }, [storeIsPlaying, activeSegment, muxedVideoUrl, videoPlayer, togglePlayPause, contextIsPlaying, setStoreIsPlaying]);

  // ═══════════════════════════════════════════════════════════════════════════

  // Navigation
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

  const handleEqualizer = () => { triggerHaptic(); router.push("/(modals)/equalizer"); };
  const handleCast = () => { triggerHaptic(); router.push("/(player)/cast-devices"); };
  const handleComments = () => { triggerHaptic(); router.push("/(modals)/comments"); };
  const handlePlaylist = () => { triggerHaptic(); router.push("/(modals)/add-to-playlist"); };
  const handleSleepTimer = () => { triggerHaptic(); router.push("/(player)/sleep-timer"); };
  const handleSeeAll = () => { triggerHaptic(); router.push("/(modals)/queue"); };

  const handleLyrics = () => {
    triggerHaptic();
    router.push({
      pathname: "/(modals)/lyrics",
      params: {
        title: (activeTrack?.title ?? "") as string,
        artist: (activeTrack?.artist ?? "") as string,
        duration: String(activeTrack?.duration ?? 0),
        videoId: (videoId ?? activeTrack?.id ?? "") as string,
        leadIn: String(LYRICS_LEAD_IN_S),
      },
    });
  };

  const handleRelated = () => {
    const vid = videoId ?? activeTrack?.id;
    if (!vid) return;
    triggerHaptic();
    router.push({
      pathname: "/(modals)/related",
      params: {
        songUrl: `https://www.youtube.com/watch?v=${vid}`,
        title: (activeTrack?.title ?? "") as string,
        artist: (activeTrack?.artist ?? "") as string,
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
          id: activeTrack?.id,
          title: activeTrack?.title,
          artist: activeTrack?.artist,
          thumbnail: activeTrack?.artwork,
          url: track?.url,
          duration: activeTrack?.duration,
          uploaderUrl: uploaderUrl,
          albumId: track?.albumId,
          albumName: track?.albumName,
          videoId: videoId,
        }),
      },
    });
  }, [router, activeTrack, track, uploaderUrl, videoId]);

  if (!activeTrack) return null;

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
                  source={getImageSource(activeTrack?.artwork)}
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
              <MovingText
                text={activeTrack?.title ?? "—"}
                animationThreshold={20}
                style={styles.title}
              />
              <ArtistLine
                rawArtist={activeTrack?.artist}
                uploaderUrl={uploaderUrl}
                onArtistPress={handleArtistPress}
              />
            </View>

            {/* ACTION ROW */}
            <View style={styles.actionRow}>
              <View style={styles.leftActions}>
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
                      {formatTime(slidingValue.value * progress.duration)}
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
                <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
                <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
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

              {/* ═════════════════════════════════════════════════════════════════ */}
              {/* INSTANT PLAY BUTTON - Uses storeIsPlaying from playerStore */}
              {/* ═════════════════════════════════════════════════════════════════ */}
              <TouchableOpacity
                onPress={handlePlayPause}
                style={styles.bigPlay}
                activeOpacity={0.85}
                disabled={isLoading}
              >
                <Ionicons
                  name={isLoading ? "hourglass-outline" : storeIsPlaying ? "pause" : "play"}
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
                onPress={() => { setActiveBottomTab("lyrics"); handleLyrics(); }}
                activeOpacity={0.7}
              >
                <Text style={activeBottomTab === "lyrics" ? styles.bottomTabActive : styles.bottomTab}>
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
  artistName: {
    color: "rgba(255,255,255,0.7)",
    fontSize: moderateScale(15),
  },
  artistTappable: {
    color: "rgba(255,255,255,0.9)",
  },
  artistSeparator: {
    color: "rgba(255,255,255,0.5)",
    fontSize: moderateScale(15),
  },

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
});