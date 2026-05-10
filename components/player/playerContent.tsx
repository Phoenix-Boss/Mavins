// components/player/playerContent.tsx
/**
 * PlayerContent — Full player screen UI for Eternal Overlay Architecture.
 * 
 * expo-av version - All RNTP calls removed.
 * Uses MusicPlayerContext for playback control and state.
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

import { MovingText } from "@/components/MovingText";
import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer, getTrackExtras } from "@/components/MusicPlayerContext";
import { useTrackPlayerRepeatMode, RepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
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
  topInsetProp,
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

  // ─── GESTURE CONTEXT — Coordinate with parent overlay ─────────────────────
  const { setSliderActive, setButtonActive } = useGestureContext();

  // ─── MusicPlayerContext (expo-av) ─────────────────────────────────────────
  const {
    isPlaying,
    isLoading: musicPlayerLoading,
    position: positionSec,
    duration: durationSec,
    currentTrack,
    togglePlayPause,
    seekTo,
    skipToNext,
    skipToPrevious,
  } = useMusicPlayer();

  // Store current track for UI
  const storeCurrentTrack = usePlayerStore((s: any) => s.currentTrack);

  // Always use a valid display track - fallback to dummy data
  const displayTrack = useMemo(() => {
    if (currentTrack) {
      const resolved = resolveArtwork(currentTrack);
      return { ...(currentTrack as any), artwork: resolved };
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
  }, [currentTrack, storeCurrentTrack]);

  const [extras, setExtras] = useState<Record<string, any>>({});

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

  const { repeatMode, cycleRepeatMode } = useTrackPlayerRepeatMode();
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

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <LinearGradient 
        colors={["#2d1a2e", "#1a1020", "#0a0a0f"]} 
        style={{ flex: 1 }}
      >

        {/* TOP BAR - Drag handle is primary swipe zone */}
        <View style={[styles.topBar, { top: topInset + 8 }]}>
          <View style={styles.dragHandleWrapper} pointerEvents="none">
            <View style={styles.dragHandle} />
          </View>
          <View style={styles.topBarContent}>
            <View style={styles.segmentSwitch}>
              <TouchableOpacity 
                onPress={() => setActiveSegment("song")} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Text style={activeSegment === "song" ? styles.segmentActive : styles.segmentInactive}>
                  Song
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveSegment("video")}
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
              <TouchableOpacity 
                onPress={onNavigateToEqualizer} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons name="equalizer" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={onNavigateToCast} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialIcons name="cast" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => onNavigateToMenu?.({ songData: JSON.stringify(displayTrack) })}
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

          {/* ARTWORK / VIDEO */}
          <TouchableOpacity 
            style={styles.artworkContainer}
            activeOpacity={1}
            onPressIn={() => setButtonActive(true)}
            onPressOut={() => setButtonActive(false)}
          >
            <Image
              source={getImageSource(displayTrack.artwork)}
              style={styles.artworkImage}
              contentFit="cover"
              transition={300}
            />
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
                onArtistPress={(name) => onNavigateToArtist?.({ id: name, subtitle: name })}
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
                  {likeCount > 0 && (
                    <Text style={styles.statCount}>{formatCount(likeCount)}</Text>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.actionContainer}
                onPress={onNavigateToComments}
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
              <TouchableOpacity 
                style={styles.extraIcon} 
                onPress={onNavigateToPlaylist} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialIcons name="playlist-add" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.extraIcon} 
                onPress={onNavigateToSleepTimer} 
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
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
              progress={useSharedValue(durationSec > 0 ? positionSec / durationSec : 0)}
              minimumValue={useSharedValue(0)}
              maximumValue={useSharedValue(1)}
              containerStyle={{ height: moderateScale(5), borderRadius: 16 }}
              renderBubble={() => (
                <View style={styles.bubbleContainer}>
                  <Text style={styles.bubbleText}>{formatTime(positionSec)}</Text>
                </View>
              )}
              renderThumb={() => <View style={styles.sliderThumb} />}
              theme={{
                minimumTrackTintColor: "#FFFFFF",
                maximumTrackTintColor: "rgba(255,255,255,0.25)",
              }}
              onSlidingStart={() => { setSliderActive(true); }}
              onSlidingComplete={(v) => {
                setSliderActive(false);
                runOnJS(seekTo)(v * durationSec);
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

            <TouchableOpacity 
              onPress={() => { skipToPrevious(); }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons name="play-skip-back" size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={togglePlayPause}
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

            <TouchableOpacity 
              onPress={() => { skipToNext(); }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Ionicons name="play-skip-forward" size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={cycleRepeatMode}
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
            <TouchableOpacity
              onPress={() => { onNavigateToQueue?.(); }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Text style={styles.bottomTab}>UP NEXT</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (canShowLyrics && onNavigateToLyrics) {
                  onNavigateToLyrics({
                    title:    displayTrack?.title ?? "",
                    artist:   displayTrack?.artist ?? "",
                    duration: String(displayTrack?.duration ?? 0),
                    videoId:  videoId ?? displayTrack?.id ?? "",
                    leadIn:   String(LYRICS_LEAD_IN_S),
                  });
                }
              }}
              activeOpacity={canShowLyrics ? 0.7 : 1}
              disabled={!canShowLyrics}
            >
              <Text style={[styles.bottomTab, !canShowLyrics && styles.bottomTabDisabled]}>
                LYRICS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const vid = videoId ?? displayTrack?.id;
                if (vid && onNavigateToRelated) {
                  onNavigateToRelated({
                    songUrl: `https://www.youtube.com/watch?v=${vid}`,
                    title:   displayTrack?.title ?? "",
                    artist:  displayTrack?.artist ?? "",
                  });
                }
              }}
              activeOpacity={0.7}
              onPressIn={() => setButtonActive(true)}
              onPressOut={() => setButtonActive(false)}
            >
              <Text style={styles.bottomTab}>RELATED</Text>
            </TouchableOpacity>
          </View>

        </View>
      </LinearGradient>
    </View>
  );
}

// ─── PlayerContent — public export ───────────────────────────────────────────

export default function PlayerContent(props: PlayerContentProps) {
  return <PlayerContentInner {...props} />;
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
  bottomTab: { color: "rgba(255,255,255,0.5)", fontSize: moderateScale(13) },
  bottomTabActive: { color: "#fff", fontSize: moderateScale(13), fontWeight: "600" },
  bottomTabDisabled: { color: "rgba(255,255,255,0.25)" },
});