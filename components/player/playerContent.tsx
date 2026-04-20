// components/player/playerContent.tsx
/**
 * PlayerContent — Full player screen UI for Eternal Overlay Architecture.
 *
 * GESTURE FIXES (Issue 7):
 *  - Uses GestureContext from _layout.tsx for coordination with parent gesture
 *  - ALL interactive elements report active state to block dismiss swipe
 *  - Slider, buttons, tabs, artwork, segment switch properly steal gesture from pan dismiss
 *  - Each TouchableOpacity has onPressIn/onPressOut calling setButtonActive(true/false)
 *  - Slider has onTouchStart/onTouchEnd/onTouchCancel calling setSliderActive(true/false)
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
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// RNTP imports
import TrackPlayer, {
  useActiveTrack,
  useProgress,
  RepeatMode,
  Event,
} from "react-native-track-player";

import { MovingText } from "@/components/MovingText";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer, getTrackExtras } from "@/components/MusicPlayerContext";
import { useTrackPlayerRepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
import { useTrackPlayerFavorite } from "@/hooks/useTrackPlayerFavorite";
import { useTrackPlayerShuffle } from "@/hooks/useTrackPlayerShuffle";
import { usePlayerStore } from "@/store/player";

// Import GestureContext from layout
import { useGestureContext } from "@/app/_layout";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Constants ───────────────────────────────────────────────────────────────

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: "#1A1A1A", highlight: "#2A2A2A" };

// ─── Dummy Track Data ─────────────────────────────────────────────────────────

const DUMMY_TRACK = {
  id: "dummy-track-id",
  title: "Mavin Player",
  artist: "Select a song to start listening",
  artwork: undefined as string | undefined,
  artworkUri: undefined as string | undefined,
  url: "",
  duration: 0,
  videoId: undefined as string | undefined,
};

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

  // FIX: Proper interpolate configuration with explicit inputRange/outputRange
  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [SK.base, SK.highlight],
  });

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface PlayerContentProps {
  /** Collapse to mini player (swipe down gesture) */
  onMinimize: () => void;
  /** Hide player completely (close button) */
  onClose: () => void;
  /** Current overlay state */
  isExpanded: boolean;
  /** Player ready state from setup */
  playerReady: boolean;
  /** Safe-area top inset passed from overlay */
  topInset?: number;
  /** 
   * Navigation handlers for modals — these still use router 
   * but are passed from parent to keep PlayerContent router-free
   */
  onNavigateToEqualizer?: () => void;
  onNavigateToCast?: () => void;
  onNavigateToComments?: () => void;
  onNavigateToPlaylist?: () => void;
  onNavigateToSleepTimer?: () => void;
  onNavigateToQueue?: () => void;
  onNavigateToLyrics?: (params: {
    title: string;
    artist: string;
    duration: string;
    videoId: string;
    leadIn: string;
  }) => void;
  onNavigateToRelated?: (params: {
    songUrl: string;
    title: string;
    artist: string;
  }) => void;
  onNavigateToMenu?: (params: {
    songData: string;
  }) => void;
  onNavigateToArtist?: (params: {
    id: string;
    subtitle: string;
  }) => void;
}

// ─── PlayerContentInner ──────────────────────────────────────────────────────

function PlayerContentInner({
  onMinimize,
  onClose,
  isExpanded,
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
  const insets = useSafeAreaInsets();
  const topInset = topInsetProp ?? insets.top;

  // ─── GESTURE CONTEXT — Coordinate with parent overlay (Issue 7) ────────────
  const { setSliderActive, setButtonActive } = useGestureContext();

  // ─── RNTP hooks ───────────────────────────────────────────────────────────
  const activeTrack = useActiveTrack();

  // isPlaying comes from MusicPlayerContext — it is OPTIMISTIC (flips instantly
  // on tap before the async TrackPlayer call returns), exactly like Spotify.
  // isLoading is true while the stream is resolving — shown as a spinner on
  // the progress bar. Neither value comes from usePlaybackState() directly,
  // which would lag by 50-150ms behind the user's tap.
  const {
    isPlaying: isPlayingRNTP,
    isLoading: musicPlayerLoading,
    togglePlayPause,
  } = useMusicPlayer();

  // Buffering is still derived from native state for the buffer indicator only
  // (not the play/pause icon — that's optimistic above)
  const isBufferingRNTP = false; // playerContent shows isLoading spinner instead

  // Progress values are in seconds
  const progress = useProgress(250);
  const positionSec = progress.position;
  const durationSec = progress.duration;

  type PS = ReturnType<typeof usePlayerStore.getState>;
  const storeCurrentTrack = usePlayerStore((s: PS) => s.currentTrack);

  // Always use a valid display track - fallback to dummy data
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
    return DUMMY_TRACK as any;
  }, [activeTrack, storeCurrentTrack]);

  // Safe initialization of extras with empty object fallback
  const [extras, setExtras] = useState<Record<string, any>>({});

  // Refresh extras when active track changes
  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) {
      setExtras({});
      return;
    }
    const trackExtras = getTrackExtras(id);
    setExtras(trackExtras ?? {});
    const t = setTimeout(() => {
      const refreshedExtras = getTrackExtras(id);
      setExtras(refreshedExtras ?? {});
    }, 3000);
    return () => clearTimeout(t);
  }, [displayTrack?.id]);

  // RNTP event listener
  useEffect(() => {
    const handleTrackChange = async (data: any) => {
      const id = data?.track?.id;
      if (id) {
        const trackExtras = getTrackExtras(id);
        setExtras(trackExtras ?? {});
      }
    };
    
    const subscription = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handleTrackChange);
    return () => {
      if (subscription && 'remove' in subscription) {
        subscription.remove();
      }
    };
  }, []);

  // Safe property access with default values
  const likeCount     = extras?.likeCount ?? -1;
  const dislikeCount  = extras?.dislikeCount ?? -1;
  const commentsCount = extras?.commentsCount ?? -1;
  const viewCount     = extras?.viewCount ?? -1;

  const uploaderUrl: string | undefined  = extras?.uploaderUrl;
  const videoId:     string | undefined  = extras?.videoId;
  const muxedVideoUrl: string | undefined = extras?.muxedVideoUrl;
  const videoUrl:      string | undefined = extras?.videoUrl;
  const activeVideoUrl                    = muxedVideoUrl ?? videoUrl ?? undefined;
  const hasVideo                          = !!activeVideoUrl && displayTrack.id !== DUMMY_TRACK.id;

  const canShowLyrics = !!(videoId ?? displayTrack?.id) && displayTrack.id !== DUMMY_TRACK.id;

  const { repeatMode, changeRepeatMode } = useTrackPlayerRepeatMode();
  const { isFavorite, toggleFavoriteFunc } = useTrackPlayerFavorite();
  const { shuffleMode, toggleShuffle, getDotCount } = useTrackPlayerShuffle();

  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [displayTrack?.id, viewCount]);

  // ─── Video handling ──────────────────────────────────────────────────────────

  const [activeSegment, setActiveSegment] = useState<"song" | "video">("song");
  const videoPlayerReady  = useRef(false);
  const pendingSeek       = useRef<number | null>(null);
  const videoOwnsAudio    = useRef(false);
  const isTransitioning   = useRef(false);
  const statusListenerRef = useRef<any>(null);

  // Create video player with proper cleanup
  const videoPlayer = useVideoPlayer(activeVideoUrl ?? null, (p) => {
    try {
      p.muted  = !muxedVideoUrl;
      p.loop   = false;
      p.pause();
    } catch (e) {
      console.warn("[PlayerContent] Video player init error:", e);
    }
  });

  // Video/RNTP sync
  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video") return;
    
    if (muxedVideoUrl && videoOwnsAudio.current) {
      if (isPlayingRNTP) {
        try {
          videoPlayer.play();
        } catch (e) {
          console.warn("[PlayerContent] Video play error:", e);
        }
      } else {
        try {
          videoPlayer.pause();
        } catch (e) {
          console.warn("[PlayerContent] Video pause error:", e);
        }
      }
    } else if (!muxedVideoUrl) {
      if (isPlayingRNTP) {
        try {
          videoPlayer.play();
        } catch (e) {
          console.warn("[PlayerContent] Video play error:", e);
        }
      } else {
        try {
          videoPlayer.pause();
        } catch (e) {
          console.warn("[PlayerContent] Video pause error:", e);
        }
      }
    }
  }, [isPlayingRNTP, activeSegment, videoPlayer, muxedVideoUrl]);

  // Handle video player ready state
  useEffect(() => {
    if (!videoPlayer) return;
    
    if (statusListenerRef.current) {
      try {
        statusListenerRef.current.remove();
      } catch (e) {
        // Ignore cleanup errors
      }
      statusListenerRef.current = null;
    }
    
    try {
      statusListenerRef.current = videoPlayer.addListener("statusChange", ({ status, error }: { status: string; error?: any }) => {
        if (status === "readyToPlay") {
          videoPlayerReady.current = true;
          
          if (pendingSeek.current !== null) {
            try {
              videoPlayer.currentTime = pendingSeek.current;
            } catch (e) {
              console.warn("[PlayerContent] Seek error:", e);
            }
            pendingSeek.current = null;
            
            if (isPlayingRNTP && activeSegment === "video") {
              if (muxedVideoUrl) {
                videoOwnsAudio.current = true;
                TrackPlayer.pause().catch(() => {});
              }
              try {
                videoPlayer.play();
              } catch (e) {
                console.warn("[PlayerContent] Auto-play error:", e);
              }
            }
          }
        } else if (status === "error") {
          videoPlayerReady.current = false;
          console.error("[PlayerContent] Video player error:", error);
        }
      });
    } catch (e) {
      console.error("[PlayerContent] Failed to add video listener:", e);
    }
    
    return () => {
      if (statusListenerRef.current) {
        try {
          statusListenerRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
        statusListenerRef.current = null;
      }
    };
  }, [videoPlayer, activeSegment, isPlayingRNTP, muxedVideoUrl]);

  // Sync video position with RNTP progress
  useEffect(() => {
    if (!videoPlayer || activeSegment !== "video" || !videoPlayerReady.current) return;
    
    if (muxedVideoUrl && videoOwnsAudio.current) return;
    
    try {
      const drift = Math.abs(videoPlayer.currentTime - positionSec);
      if (drift > 1.0) {
        videoPlayer.currentTime = positionSec;
      }
    } catch (e) {
      console.warn("[PlayerContent] Position sync error:", e);
    }
  }, [positionSec, activeSegment, videoPlayer, muxedVideoUrl]);

  const videoProgress    = useSharedValue(0);
  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [1, 0]), { duration: 300 }),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [0, 1]), { duration: 300 }),
  }));

  // Segment switching with gesture blocking (Issue 7)
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
          const currentPosition = await TrackPlayer.getProgress().then(p => p.position).catch(() => positionSec);
          
          if (muxedVideoUrl) {
            videoOwnsAudio.current = true;
            await TrackPlayer.pause();
            
            if (videoPlayerReady.current) {
              try {
                videoPlayer.currentTime = currentPosition;
                videoPlayer.play();
              } catch (e) {
                console.warn("[PlayerContent] Video segment switch error:", e);
              }
            } else {
              pendingSeek.current = currentPosition;
            }
          } else {
            if (videoPlayerReady.current) {
              try {
                videoPlayer.currentTime = currentPosition;
                if (isPlayingRNTP) {
                  videoPlayer.play();
                }
              } catch (e) {
                console.warn("[PlayerContent] Video segment switch error:", e);
              }
            } else {
              pendingSeek.current = currentPosition;
            }
          }
        } else if (seg === "song" && videoPlayer) {
          try {
            videoPlayer.pause();
          } catch (e) {
            console.warn("[PlayerContent] Video pause error:", e);
          }
          
          if (muxedVideoUrl && videoOwnsAudio.current) {
            videoOwnsAudio.current = false;
            try {
              await TrackPlayer.seekTo(videoPlayer.currentTime);
              if (isPlayingRNTP) {
                await TrackPlayer.play();
              }
            } catch (e) {
              console.warn("[PlayerContent] Audio handoff error:", e);
            }
          }
        }
      } catch (err) {
        console.error("[PlayerContent] Segment switch error:", err);
      } finally {
        setTimeout(() => {
          isTransitioning.current = false;
        }, 400);
      }
    },
    [hasVideo, videoPlayer, videoProgress, positionSec, isPlayingRNTP, muxedVideoUrl, displayTrack.id]
  );

  // Reset video state when track changes
  useEffect(() => {
    if (videoPlayer) {
      try {
        videoPlayer.pause();
      } catch (e) {
        console.warn("[PlayerContent] Video cleanup error:", e);
      }
    }
    videoOwnsAudio.current = false;
    setActiveSegment("song");
    videoProgress.value = 0;
    videoPlayerReady.current = false;
    pendingSeek.current = null;
  }, [displayTrack?.id, videoPlayer, videoProgress]);

  const [activeBottomTab, setActiveBottomTab] = useState<"upnext" | "lyrics" | "related">("upnext");
  useEffect(() => { setActiveBottomTab("upnext"); }, [displayTrack?.id]);

  const artworkForColors = typeof displayTrack?.artwork === "string" ? displayTrack.artwork : null;
  const { imageColors }  = useImageColors(artworkForColors);

  // BRANDED IDLE GRADIENT — visually distinct from pure black so the player
  // is never invisible on first open. Mavin brand dark burgundy palette.
  // When artwork resolves, dominant colour transitions in via useMemo dep change
  // (LinearGradient re-renders with new colours — expo-linear-gradient animates
  //  this automatically when the `colors` prop changes on iOS/Android).
  const gradientColors = useMemo((): [string, string, string] => {
    if (imageColors?.dominant) {
      return [imageColors.dominant, "#0d0d0d", "#000000"];
    }
    // Visible branded fallback — dark burgundy/charcoal, never pure black
    return ["#2d1a2e", "#1a1020", "#0a0a0f"];
  }, [imageColors]);

  // ─── Slider with gesture coordination (Issue 7) ────────────────────────────
  // isSliding guards the worklet-side check — sliderProgress only updates
  // from RNTP progress when the user is NOT actively sliding.
  const isSliding      = useSharedValue(false);
  const sliderProgress = useSharedValue(0);
  const sliderMin      = useSharedValue(0);
  const sliderMax      = useSharedValue(1);
  const slidingValue   = useSharedValue(0);

  useEffect(() => {
    if (!isSliding.value && durationSec > 0) {
      sliderProgress.value = positionSec / durationSec;
    }
  }, [positionSec, durationSec, isSliding.value, sliderProgress]);

  const handleSeek = useCallback(
    async (fraction: number) => {
      if (durationSec <= 0) return;
      const t = fraction * durationSec;
      await TrackPlayer.seekTo(t);
      
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        try {
          videoPlayer.currentTime = t;
          if (isPlayingRNTP && !videoOwnsAudio.current) {
            videoPlayer.play();
          }
        } catch (e) {
          console.warn("[PlayerContent] Video seek sync error:", e);
        }
      }
    },
    [durationSec, activeSegment, videoPlayer, isPlayingRNTP]
  );

  // ─── Playback controls ───────────────────────────────────────────────────────

  const handleSkipBack = async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") {
      try {
        videoPlayer.pause();
      } catch (e) {
        console.warn("[PlayerContent] Video pause error:", e);
      }
    }
    try { await TrackPlayer.skipToPrevious(); } catch { }
  };

  const handleSkipNext = async () => {
    triggerHaptic();
    if (videoPlayer && activeSegment === "video") {
      try {
        videoPlayer.pause();
      } catch (e) {
        console.warn("[PlayerContent] Video pause error:", e);
      }
    }
    try { await TrackPlayer.skipToNext(); } catch { }
  };

  const toggleRepeat = () => {
    triggerHaptic();
    if (repeatMode === RepeatMode.Off)        changeRepeatMode(RepeatMode.Queue);
    else if (repeatMode === RepeatMode.Queue) changeRepeatMode(RepeatMode.Track);
    else                                       changeRepeatMode(RepeatMode.Off);
  };

  const handlePlayPause = useCallback(async () => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;
    
    try {
      if (activeSegment === "video" && videoPlayer && videoPlayerReady.current) {
        if (muxedVideoUrl) {
          if (isPlayingRNTP) {
            try {
              videoPlayer.pause();
            } catch (e) {
              console.warn("[PlayerContent] Video pause error:", e);
            }
            await TrackPlayer.pause();
            videoOwnsAudio.current = false;
          } else {
            videoOwnsAudio.current = true;
            await TrackPlayer.pause();
            try {
              videoPlayer.play();
            } catch (e) {
              console.warn("[PlayerContent] Video play error:", e);
            }
          }
        } else {
          if (isPlayingRNTP) {
            await TrackPlayer.pause();
            try {
              videoPlayer.pause();
            } catch (e) {
              console.warn("[PlayerContent] Video pause error:", e);
            }
          } else {
            await TrackPlayer.play();
            try {
              videoPlayer.play();
            } catch (e) {
              console.warn("[PlayerContent] Video play error:", e);
            }
          }
        }
      } else {
        await togglePlayPause();
      }
    } catch (err) {
      console.error("[PlayerContent] Play/pause error:", err);
      await togglePlayPause();
    }
  }, [isPlayingRNTP, displayTrack, togglePlayPause, activeSegment, videoPlayer, muxedVideoUrl]);

  // ─── Navigation handlers (via props, not direct router) ─────────────────────

  const handleArtistPress = useCallback(
    (artistName: string) => {
      if (!uploaderUrl || !onNavigateToArtist) return;
      triggerHaptic();
      const channelId =
        uploaderUrl.split("/channel/")[1]?.split("?")[0] ??
        uploaderUrl.split("/c/")[1]?.split("?")[0] ??
        uploaderUrl.split("/user/")[1]?.split("?")[0] ??
        uploaderUrl;
      onNavigateToArtist({
        id: encodeURIComponent(channelId),
        subtitle: artistName,
      });
    },
    [uploaderUrl, onNavigateToArtist]
  );

  const handleEqualizer  = () => { 
    triggerHaptic(); 
    onNavigateToEqualizer?.();
  };
  
  const handleCast       = () => { 
    triggerHaptic(); 
    onNavigateToCast?.();
  };
  
  const handleComments   = () => { 
    triggerHaptic(); 
    onNavigateToComments?.();
  };
  
  const handlePlaylist   = () => { 
    triggerHaptic(); 
    onNavigateToPlaylist?.();
  };
  
  const handleSleepTimer = () => { 
    triggerHaptic(); 
    onNavigateToSleepTimer?.();
  };
  
  const handleSeeAll     = () => { 
    triggerHaptic(); 
    onNavigateToQueue?.();
  };

  const handleLyrics = () => {
    if (!canShowLyrics || !onNavigateToLyrics) return;
    triggerHaptic();
    onNavigateToLyrics({
      title:    (displayTrack?.title    ?? "") as string,
      artist:   (displayTrack?.artist   ?? "") as string,
      duration: String(displayTrack?.duration ?? 0),
      videoId:  (videoId ?? displayTrack?.id  ?? "") as string,
      leadIn:   String(LYRICS_LEAD_IN_S),
    });
  };

  const handleRelated = () => {
    const vid = videoId ?? displayTrack?.id;
    if (!vid || displayTrack.id === DUMMY_TRACK.id || !onNavigateToRelated) return;
    triggerHaptic();
    onNavigateToRelated({
      songUrl: `https://www.youtube.com/watch?v=${vid}`,
      title:   (displayTrack?.title  ?? "") as string,
      artist:  (displayTrack?.artist ?? "") as string,
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
        thumbnail:   displayTrack?.artwork,
        url:         displayTrack?.url,
        duration:    displayTrack?.duration,
        uploaderUrl: uploaderUrl,
        videoId:     videoId,
      }),
    });
  }, [onNavigateToMenu, displayTrack, uploaderUrl, videoId]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    // backgroundColor matches gradient bottom so there is NEVER a transparent
    // or black gap between the root View and the LinearGradient on first paint.
    <View style={{ flex: 1, backgroundColor: gradientColors[2] }}>
      <LinearGradient style={{ flex: 1 }} colors={gradientColors}>

        {/* TOP BAR - Drag handle is primary swipe zone */}
        <View style={[styles.topBar, { top: topInset + 8 }]}>
          <View style={styles.dragHandleWrapper} pointerEvents="none">
            <View style={styles.dragHandle} />
          </View>
          <View style={styles.topBarContent}>
            <View style={styles.segmentSwitch}>
              {/* Issue 7 Fix: Segment buttons with gesture blocking */}
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
            <View style={styles.topBarRight}>
              {/* Issue 7 Fix: Top bar buttons with gesture blocking */}
              <TouchableOpacity 
                onPress={handleEqualizer} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons name="equalizer" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleCast} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialIcons name="cast" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleMenuPress} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* MAIN CONTENT */}
        <View style={[
          styles.contentContainer,
          { paddingTop: topInset + 90, paddingBottom: insets.bottom + 8 },
        ]}>

          {/* ARTWORK / VIDEO - Swipeable area for dismiss */}
          {/* Issue 7 Fix: Artwork container with gesture blocking on touch */}
          <TouchableOpacity 
            style={styles.artworkContainer}
            activeOpacity={1}
            onPressIn={() => setButtonActive(true)}
            onPressOut={() => setButtonActive(false)}
          >
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
          </TouchableOpacity>

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
              {/* Issue 7 Fix: Like/Dislike buttons with gesture blocking */}
              <View style={styles.actionContainer}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => { triggerHaptic(); toggleFavoriteFunc(); }}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
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
                <TouchableOpacity 
                  style={styles.actionButton} 
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <Ionicons name="thumbs-down-outline" size={16} color="#fff" />
                  {dislikeCount > 0 && (
                    <Text style={styles.statCount}>{formatCount(dislikeCount)}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Issue 7 Fix: Comments button with gesture blocking */}
              <TouchableOpacity
                style={styles.actionContainer}
                onPress={handleComments}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
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
              {/* Issue 7 Fix: Extra action buttons with gesture blocking */}
              <TouchableOpacity 
                style={styles.extraIcon} 
                onPress={handlePlaylist} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialIcons name="playlist-add" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.extraIcon} 
                onPress={handleSleepTimer} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons name="weather-night" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* PROGRESS BAR - Slider blocks dismiss gesture (Issue 7) */}
          {/* Issue 7 Fix: Slider container with comprehensive touch handlers */}
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
              onSlidingStart={() => { 
                isSliding.value = true; 
                setSliderActive(true);
              }}
              onValueChange={(v) => {
                slidingValue.value = v;
              }}
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
            {/* Issue 7 Fix: Shuffle button with gesture blocking */}
            <TouchableOpacity
              onPress={toggleShuffle}
              style={styles.shuffleWrapper}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
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

            {/* Issue 7 Fix: Skip back button with gesture blocking */}
            <TouchableOpacity 
              onPress={handleSkipBack} 
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons name="play-skip-back" size={32} color="#fff" />
            </TouchableOpacity>

            {/* Issue 7 Fix: Play/Pause button with gesture blocking */}
            <TouchableOpacity
              onPress={handlePlayPause}
              style={styles.bigPlay}
              activeOpacity={0.85}
              disabled={musicPlayerLoading || displayTrack.id === DUMMY_TRACK.id}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons
                name={musicPlayerLoading ? "hourglass-outline" : isPlayingRNTP ? "pause" : "play"}
                size={32}
                color="#000"
              />
            </TouchableOpacity>

            {/* Issue 7 Fix: Skip next button with gesture blocking */}
            <TouchableOpacity 
              onPress={handleSkipNext} 
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons name="play-skip-forward" size={32} color="#fff" />
            </TouchableOpacity>

            {/* Issue 7 Fix: Repeat button with gesture blocking */}
            <TouchableOpacity 
              onPress={toggleRepeat} 
              style={styles.repeatWrapper} 
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
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
            {/* Issue 7 Fix: Bottom tab buttons with gesture blocking */}
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

// ─── PlayerContent — public export ───────────────────────────────────────────

export default function PlayerContent({
  onMinimize,
  onClose,
  isExpanded,
  playerReady,
  topInset,
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
}: PlayerContentProps) {
  return (
    <PlayerContentInner
      onMinimize={onMinimize}
      onClose={onClose}
      isExpanded={isExpanded}
      topInset={topInset}
      onNavigateToEqualizer={onNavigateToEqualizer}
      onNavigateToCast={onNavigateToCast}
      onNavigateToComments={onNavigateToComments}
      onNavigateToPlaylist={onNavigateToPlaylist}
      onNavigateToSleepTimer={onNavigateToSleepTimer}
      onNavigateToQueue={onNavigateToQueue}
      onNavigateToLyrics={onNavigateToLyrics}
      onNavigateToRelated={onNavigateToRelated}
      onNavigateToMenu={onNavigateToMenu}
      onNavigateToArtist={onNavigateToArtist}
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