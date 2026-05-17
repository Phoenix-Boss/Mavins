// components/player/playerContent.tsx
//
// ANDROID-ONLY: All iOS-specific code removed
// FIXED: Modal navigation - opens modals as overlays not route pushes
// FIXED: Theme integration - all colors now use theme values
// FIXED: Gradients use gold/warm tones (no purple)
// FIXED: All UI elements visible in light mode
// FIXED: Local track UI - conditional rendering for local vs streamed content
//   - Hide view counts, comments, related for local tracks
//   - Show favorite heart instead of like/dislike counts
//   - Disable video toggle for local tracks
//   - Gray out related tab for local tracks
//
// ISSUE 5 FIX: Removed X close button from top bar
// ISSUE 6 FIX: Video tab completely hidden for local tracks (not just disabled)
// ISSUE 7 FIX: Seamless video toggle with backward seek offset (200ms)
// ISSUE 7 FIX: Both players run simultaneously, one muted — NEVER pause either
// ISSUE 7 FIX: Lazy video player init — only created when user taps Video tab
// ISSUE 7 FIX: Sync interval keeps video player aligned with audio
// ISSUE 8 FIX: Artist tap on local track navigates to folder (onNavigateToLocalFolder prop)

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
  Modal as RNModal,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { Slider } from 'react-native-awesome-slider';
import {
  moderateScale,
  scale,
  verticalScale,
} from 'react-native-size-matters/extend';

import { MovingText } from '@/components/MovingText';
import { screenPadding } from '@/constants/tokens';
import { useImageColors } from '@/hooks/useImageColors';
import { triggerHaptic } from '@/helpers/haptics';
import { useTheme } from '@/contexts/ThemeContext';
import LyricsModal from '@/app/(modals)/lyrics';
import QueueModal from '@/app/(modals)/queue';
import RelatedModal from '@/app/(modals)/related';
import CommentsModal from '@/app/(modals)/comments';

import {
  useMusicPlayer,
  usePlayerEngine,
  getTrackExtras,
  useTrackExtrasVersion,
  type RepeatMode,
  type ShuffleMode,
} from '@/libs/playerSetup';

import { useGestureContext } from '@/libs/playerSetup';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: '#1A1A1A', highlight: '#2A2A2A' };
const VIDEO_SYNC_INTERVAL_MS = 500;
const BACKWARD_SEEK_OFFSET = 0.2;

const DUMMY_TRACK = {
  id: 'dummy-track-id',
  title: 'Mavin Player',
  artist: 'Select a song to start listening',
  thumbnail: undefined as string | undefined,
  url: '',
  duration: 0,
  videoId: undefined as string | undefined,
};

const formatTime = (s: number): string => {
  if (!s || isNaN(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const formatCount = (n: number): string => {
  if (n <= 0) return '';
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
};

const parseArtists = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw.split(/[,&]|\bft\.?\b|\bfeat\.?\b/i).map((a) => a.trim()).filter(Boolean);
};

const formatArtistName = (name: string): string => name.replace(/([a-z])([A-Z])/g, '$1 $2');

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
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [SK.base, SK.highlight] });

  return <RNAnimated.View style={[{ width, height, borderRadius, backgroundColor: bg }, style]} />;
}

function AnimatedCounter({ target }: { target: number }) {
  const [display, setDisplay] = useState(1);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    if (target <= 0) {
      setDisplay(1);
      return;
    }

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
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return <Text style={ctrStyles.text}>{formatCount(display)}</Text>;
}

const ctrStyles = StyleSheet.create({
  text: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: moderateScale(11),
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

function ArtistLine({
  rawArtist,
  uploaderUrl,
  onArtistPress,
  colors,
  isLocal = false,
}: {
  rawArtist: string | undefined;
  uploaderUrl: string | undefined;
  onArtistPress: (name: string, channelId: string) => void;
  colors: any;
  isLocal?: boolean;
}) {
  const artists = useMemo(() => parseArtists(rawArtist).map(formatArtistName), [rawArtist]);

  if (!artists.length) return <Text style={[styles.artist, { color: colors.textSub }]}>—</Text>;

  return (
    <Text style={[styles.artist, { color: colors.textSub }]}>
      {artists.map((name, idx) => {
        let channelId = '';
        if (uploaderUrl && !isLocal) {
          channelId =
            uploaderUrl.split('/channel/')[1]?.split('?')[0] ??
            uploaderUrl.split('/c/')[1]?.split('?')[0] ??
            uploaderUrl.split('/user/')[1]?.split('?')[0] ??
            uploaderUrl;
        }

        return (
          <React.Fragment key={`${name}-${idx}`}>
            {idx > 0 && <Text style={[styles.artistSeparator, { color: colors.textSub }]}>, </Text>}
            <Text
              style={[
                styles.artistName,
                !isLocal && uploaderUrl ? styles.artistTappable : undefined,
                { color: colors.gold },
              ]}
              onPress={!isLocal && uploaderUrl ? () => onArtistPress(name, encodeURIComponent(channelId)) : undefined}
              suppressHighlighting
            >
              {name}
            </Text>
          </React.Fragment>
        );
      })}
    </Text>
  );
}

interface PlayerContentProps {
  onMinimize: () => void;
  onClose: () => void;
  isExpanded: boolean;
  playerReady: boolean;
  topInset?: number;
  onNavigateToEqualizer?: () => void;
  onNavigateToCast?: () => void;
  onNavigateToPlaylist?: () => void;
  onNavigateToSleepTimer?: () => void;
  onNavigateToArtist?: (params: { id: string; subtitle: string }) => void;
  onNavigateToMenu?: (params: { songData: string }) => void;
  onNavigateToLocalFolder?: (folderId: string, trackId: string) => void;
}

function PlayerContentInner({
  onMinimize,
  onClose,
  topInset: topInsetProp,
  onNavigateToEqualizer,
  onNavigateToCast,
  onNavigateToPlaylist,
  onNavigateToSleepTimer,
  onNavigateToArtist,
  onNavigateToMenu,
  onNavigateToLocalFolder,
}: Omit<PlayerContentProps, 'playerReady'>) {
  const insets = useSafeAreaInsets();
  const topInset = topInsetProp ?? insets.top;
  const { colors, isDark } = useTheme();

  const [showQueueModal, setShowQueueModal] = useState(false);
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);

  const [lyricsData, setLyricsData] = useState({ title: '', artist: '', videoId: '' });
  const [relatedData, setRelatedData] = useState({ songUrl: '', title: '', artist: '' });
  const [commentsData, setCommentsData] = useState({ songId: '', title: '' });

  const { setSliderActive, setButtonActive } = useGestureContext();

  const engine = usePlayerEngine();
  const { isLoading: musicPlayerLoading, togglePlayPause, isLocalTrack } = useMusicPlayer();

  const isPlaying = engine.isPlaying;
  const positionSec = engine.position;
  const durationSec = engine.duration;
  const repeatMode = engine.repeatMode;
  const shuffleMode = engine.shuffleMode;
  const isResolving = engine.isResolving;

  const trackExtrasVersion = useTrackExtrasVersion();

  const displayTrack = useMemo(() => {
    if (engine.currentTrack) {
      return {
        id: engine.currentTrack.id,
        title: engine.currentTrack.title,
        artist: engine.currentTrack.artist,
        thumbnail: engine.currentTrack.thumbnail,
        url: engine.currentTrack.url,
        duration: engine.currentTrack.duration,
        videoId: engine.currentTrack.videoId,
        localAlbumId: (engine.currentTrack as any).localAlbumId,
        localTrackId: (engine.currentTrack as any).localTrackId,
      };
    }
    return DUMMY_TRACK as any;
  }, [engine.currentTrack]);

  const isLocal = useMemo(() => isLocalTrack(engine.currentTrack), [engine.currentTrack, isLocalTrack]);

  const [extras, setExtras] = useState<Record<string, any>>({});

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) {
      setExtras({});
      return;
    }
    setExtras(getTrackExtras(id) ?? {});
  }, [displayTrack?.id, trackExtrasVersion]);

  const likeCount = extras?.likeCount ?? -1;
  const dislikeCount = extras?.dislikeCount ?? -1;
  const commentsCount = extras?.commentsCount ?? -1;
  const viewCount = extras?.viewCount ?? -1;
  const uploaderUrl: string | undefined = extras?.uploaderUrl;
  const videoId: string | undefined = extras?.videoId;
  const muxedVideoUrl: string | undefined = extras?.muxedVideoUrl;
  const videoUrl: string | undefined = extras?.videoUrl;

  const activeVideoUrl = useMemo(() => {
    const url = muxedVideoUrl ?? videoUrl ?? undefined;
    if (!url) return null;
    try {
      new URL(url);
      return url;
    } catch {
      console.warn('[PlayerContent] Invalid video URL:', url);
      return null;
    }
  }, [muxedVideoUrl, videoUrl]);

  const hasVideo = !isLocal && !!activeVideoUrl && displayTrack.id !== DUMMY_TRACK.id;
  const canShowLyrics = !isLocal && !!(videoId ?? displayTrack?.id) && displayTrack.id !== DUMMY_TRACK.id;

  const [isFavorite, setIsFavorite] = useState(false);
  const toggleFavoriteFunc = () => {
    triggerHaptic();
    setIsFavorite((p) => !p);
  };

  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [displayTrack?.id, viewCount]);

  const showSkeleton = musicPlayerLoading || isResolving || (engine.isBuffering && !isPlaying && durationSec === 0);

  const [activeSegment, setActiveSegment] = useState<'song' | 'video'>('song');
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoPlayerReady = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const videoOwnsAudio = useRef(false);
  const isTransitioning = useRef(false);
  const statusListenerRef = useRef<any>(null);
  const errorCountRef = useRef(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // ISSUE 7 FIX: Lazy video player initialization
  // Only create the video player when user first taps Video tab.
  // This prevents audio focus conflicts on Android during audio-only playback.
  // ─────────────────────────────────────────────────────────────────────────────

  const [videoPlayerInitialized, setVideoPlayerInitialized] = useState(false);

  const videoPlayer = useVideoPlayer(
    videoPlayerInitialized && activeVideoUrl ? activeVideoUrl : null,
    (p) => {
      if (!videoPlayerInitialized) return;
      try {
        p.muted = true;
        p.loop = false;
        p.pause();
        setVideoError(null);
        errorCountRef.current = 0;
      } catch (e) {
        console.warn('[PlayerContent] Video player init error:', e);
        setVideoError('Failed to initialize video player');
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // VIDEO SOURCE LOADING — only after player is initialized
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || !activeVideoUrl || isLocal) return;

    let cancelled = false;

    const loadVideo = async () => {
      try {
        if (typeof (videoPlayer as any).replaceAsync === 'function') {
          await (videoPlayer as any).replaceAsync(activeVideoUrl);
        } else {
          (videoPlayer as any).replace(activeVideoUrl);
        }

        if (cancelled) return;

        videoPlayer.muted = true;
        try {
          videoPlayer.pause();
        } catch {
          // ignore
        }
      } catch (e) {
        console.warn('[PlayerContent] Failed to replace video source:', e);
        setVideoError('Video unavailable. Listening to audio only.');
      }
    };

    void loadVideo();

    return () => {
      cancelled = true;
    };
  }, [videoPlayerInitialized, displayTrack?.id, activeVideoUrl, isLocal, videoPlayer]);

  // ─────────────────────────────────────────────────────────────────────────────
  // SYNC INTERVAL: Keep video aligned with audio position
  // Only runs when video player exists and we're on Song tab
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || isLocal || !activeVideoUrl) return;

    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);

    syncIntervalRef.current = setInterval(() => {
      if (videoPlayer && !videoError && activeSegment !== 'video') {
        const drift = Math.abs(videoPlayer.currentTime - positionSec);
        if (drift > 0.5) {
          try {
            videoPlayer.currentTime = positionSec;
          } catch {
            // ignore
          }
        }
      }
    }, VIDEO_SYNC_INTERVAL_MS);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [videoPlayerInitialized, videoPlayer, isLocal, activeVideoUrl, positionSec, activeSegment, videoError]);

  // ─────────────────────────────────────────────────────────────────────────────
  // PLAY/PAUSE SYNC: Video follows audio play state when on Song tab
  // NEVER pause the audio engine — both players stay alive
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || activeSegment !== 'video' || videoError || isLocal) return;

    if (muxedVideoUrl && videoOwnsAudio.current) {
      try {
        isPlaying ? videoPlayer.play() : videoPlayer.pause();
      } catch {
        // ignore
      }
    } else if (!muxedVideoUrl) {
      try {
        isPlaying ? videoPlayer.play() : videoPlayer.pause();
      } catch {
        // ignore
      }
    }
  }, [isPlaying, activeSegment, videoPlayer, muxedVideoUrl, videoError, isLocal, videoPlayerInitialized]);

  // ─────────────────────────────────────────────────────────────────────────────
  // VIDEO STATUS LISTENER
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || isLocal) return;

    try {
      statusListenerRef.current?.remove?.();
    } catch {
      // ignore
    }

    statusListenerRef.current = null;

    try {
      statusListenerRef.current = videoPlayer.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') {
          videoPlayerReady.current = true;
          setVideoError(null);

          if (pendingSeek.current !== null) {
            try {
              videoPlayer.currentTime = pendingSeek.current;
            } catch {
              // ignore
            }
            pendingSeek.current = null;

            if (isPlaying && activeSegment === 'video') {
              if (muxedVideoUrl) {
                videoOwnsAudio.current = true;
                // Mute audio engine instead of pausing
                engine.setVolume?.(0) ?? engine.pause();
              }
              try {
                videoPlayer.play();
              } catch {
                // ignore
              }
            }
          }
        } else if (status === 'error') {
          videoPlayerReady.current = false;
          const errorMsg = error?.message || 'Unknown video error';
          console.error('[PlayerContent] Video error:', errorMsg);

          if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
            setVideoError('Video unavailable (access denied). Listening to audio only.');
            if (activeSegment === 'video') {
              setTimeout(() => {
                handleSegmentPress('song');
              }, 100);
            }
          } else {
            setVideoError(errorMsg);
          }

          errorCountRef.current += 1;
          if (errorCountRef.current === 1 && activeVideoUrl) {
            setTimeout(() => {
              try {
                if (typeof (videoPlayer as any).replaceAsync === 'function') {
                  void (videoPlayer as any).replaceAsync(activeVideoUrl);
                } else {
                  (videoPlayer as any).replace(activeVideoUrl);
                }
              } catch (e) {
                console.warn('[PlayerContent] Failed to retry video:', e);
              }
            }, 1000);
          }
        }
      });
    } catch (e) {
      console.error('[PlayerContent] Failed to add video listener:', e);
    }

    return () => {
      try {
        statusListenerRef.current?.remove?.();
      } catch {
        // ignore
      }
      statusListenerRef.current = null;
    };
  }, [videoPlayerInitialized, videoPlayer, activeSegment, isPlaying, muxedVideoUrl, engine, activeVideoUrl, isLocal]);

  const videoProgress = useSharedValue(0);
  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [1, 0]), { duration: 300 }),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [0, 1]), { duration: 300 }),
  }));

  // ─────────────────────────────────────────────────────────────────────────────
  // ISSUE 7 FIX: Seamless segment switch — NEVER pause either player
  // Both players run simultaneously. We only swap which one is audible.
  // ─────────────────────────────────────────────────────────────────────────────

  const handleSegmentPress = useCallback(
    async (seg: 'song' | 'video') => {
      if (seg === 'video' && (!hasVideo || displayTrack.id === DUMMY_TRACK.id || videoError || isLocal)) {
        if (videoError) {
          console.log('[PlayerContent] Video unavailable due to error:', videoError);
        }
        return;
      }

      if (isTransitioning.current) return;
      isTransitioning.current = true;
      triggerHaptic();

      // Lazy init video player on first video tab tap
      if (seg === 'video' && !videoPlayerInitialized) {
        setVideoPlayerInitialized(true);
        // Give one frame for player to init before switching
        await new Promise(r => requestAnimationFrame(r));
      }

      const OFFSET = BACKWARD_SEEK_OFFSET;
      const currentAudioPos = positionSec;

      try {
        if (seg === 'video' && videoPlayer && !videoError && !isLocal) {
          const seekTarget = Math.max(0, currentAudioPos - OFFSET);
          videoPlayer.currentTime = seekTarget;
          videoPlayer.muted = false;

          requestAnimationFrame(() => {
            if (videoPlayer && Math.abs(videoPlayer.currentTime - currentAudioPos) > 0.05) {
              videoPlayer.currentTime = currentAudioPos;
            }
          });

          if (muxedVideoUrl) {
            // Muxed video has audio — mute the audio engine, DON'T pause
            videoOwnsAudio.current = true;
            try {
              (engine as any).setVolume?.(0) ?? engine.pause();
            } catch {}
          }

          try {
            videoPlayer.play();
          } catch {
            // ignore
          }

          setActiveSegment(seg);
          videoProgress.value = 1;
        } else if (seg === 'song' && videoPlayer) {
          // Switch audio back on, DON'T pause video — just mute it
          videoOwnsAudio.current = false;
          try {
            (engine as any).setVolume?.(1) ?? engine.play();
          } catch {}

          // Seek audio to match video position for seamlessness
          const currentVideoPos = videoPlayer.currentTime ?? currentAudioPos;
          const seekTarget = Math.max(0, currentVideoPos - OFFSET);
          engine.seekTo(seekTarget);

          setTimeout(() => {
            engine.seekTo(currentVideoPos);
          }, 50);

          videoPlayer.muted = true;

          setActiveSegment(seg);
          videoProgress.value = 0;
        }
      } catch (err) {
        console.error('[PlayerContent] Segment switch error:', err);
      } finally {
        setTimeout(() => {
          isTransitioning.current = false;
        }, 400);
      }
    },
    [hasVideo, videoPlayer, videoProgress, positionSec, isPlaying, muxedVideoUrl, displayTrack.id, engine, videoError, isLocal, videoPlayerInitialized],
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // TRACK CHANGE: Reset to song tab, but DON'T destroy video player
  // Keep it alive for seamless switching back
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    videoOwnsAudio.current = false;
    videoPlayerReady.current = false;
    pendingSeek.current = null;
    setActiveSegment('song');
    videoProgress.value = 0;
    setVideoError(null);
    errorCountRef.current = 0;
    // NOTE: We do NOT setVideoPlayerInitialized(false) here.
    // The video player stays alive for seamless toggling.
  }, [displayTrack?.id, videoProgress]);

  const artworkForColors = typeof displayTrack?.thumbnail === 'string' ? displayTrack.thumbnail : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo((): [string, string, string] => {
    if (imageColors?.dominant && isDark) {
      return [imageColors.dominant, colors.surface, colors.background];
    }
    return [colors.playerGradientStart, colors.playerGradientMiddle, colors.playerGradientEnd];
  }, [imageColors, colors, isDark]);

  const isSliding = useSharedValue(false);
  const sliderProgress = useSharedValue(0);
  const sliderMin = useSharedValue(0);
  const sliderMax = useSharedValue(1);
  const slidingValue = useSharedValue(0);

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

      if (activeSegment === 'video' && videoPlayer && videoPlayerReady.current && !videoError && !isLocal) {
        try {
          videoPlayer.currentTime = t;
          if (isPlaying && !videoOwnsAudio.current) videoPlayer.play();
        } catch {
          // ignore
        }
      }
    },
    [durationSec, engine, activeSegment, videoPlayer, isPlaying, videoError, isLocal],
  );

  const handleSkipBack = useCallback(async () => {
    triggerHaptic();
    await engine.skipToPrevious();
    // Video stays muted and synced via interval — no need to pause
  }, [engine]);

  const handleSkipNext = useCallback(async () => {
    triggerHaptic();
    await engine.skipToNext();
    // Video stays muted and synced via interval — no need to pause
  }, [engine]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ISSUE 7 FIX: Play/Pause — both players stay alive
  // Audio engine controls playback. Video follows via effects.
  // ─────────────────────────────────────────────────────────────────────────────

  const handlePlayPause = useCallback(async () => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;

    try {
      if (activeSegment === 'video' && videoPlayer && videoPlayerReady.current && !videoError && !isLocal) {
        if (muxedVideoUrl && videoOwnsAudio.current) {
          // Video owns audio — toggle video play state
          if (isPlaying) {
            try { videoPlayer.pause(); } catch {}
            engine.pause();
          } else {
            try { videoPlayer.play(); } catch {}
          }
        } else {
          // Audio engine owns playback — toggle it, video follows via effect
          togglePlayPause();
        }
      } else {
        // Song tab — normal audio toggle
        togglePlayPause();
      }
    } catch (err) {
      console.error('[PlayerContent] Play/pause error:', err);
      togglePlayPause();
    }
  }, [isPlaying, displayTrack, togglePlayPause, activeSegment, videoPlayer, muxedVideoUrl, engine, videoError, isLocal]);

  const handleOpenQueue = () => {
    triggerHaptic();
    setShowQueueModal(true);
  };

  const handleOpenLyrics = () => {
    if (!canShowLyrics) return;
    triggerHaptic();
    setLyricsData({
      title: displayTrack?.title ?? '',
      artist: displayTrack?.artist ?? '',
      videoId: videoId ?? displayTrack?.id ?? '',
    });
    setShowLyricsModal(true);
  };

  const handleOpenRelated = () => {
    if (isLocal) return;
    const vid = videoId ?? displayTrack?.id;
    if (!vid || displayTrack.id === DUMMY_TRACK.id) return;
    triggerHaptic();
    setRelatedData({
      songUrl: `https://www.youtube.com/watch?v=${vid}`,
      title: displayTrack?.title ?? '',
      artist: displayTrack?.artist ?? '',
    });
    setShowRelatedModal(true);
  };

  const handleOpenComments = () => {
    if (isLocal) return;
    const vid = videoId ?? displayTrack?.id;
    if (!vid || displayTrack.id === DUMMY_TRACK.id) return;
    triggerHaptic();
    setCommentsData({
      songId: vid,
      title: displayTrack?.title ?? '',
    });
    setShowCommentsModal(true);
  };

  const handleArtistPress = useCallback(
    (artistName: string, channelId: string) => {
      triggerHaptic();

      if (isLocal && displayTrack?.localAlbumId && onNavigateToLocalFolder) {
        onMinimize();
        setTimeout(() => {
          onNavigateToLocalFolder(displayTrack.localAlbumId, displayTrack.localTrackId);
        }, 150);
        return;
      }

      if (!isLocal && uploaderUrl && onNavigateToArtist) {
        onMinimize();
        setTimeout(() => {
          onNavigateToArtist({ id: channelId, subtitle: artistName });
        }, 150);
      }
    },
    [uploaderUrl, onNavigateToArtist, onNavigateToLocalFolder, onMinimize, isLocal, displayTrack],
  );

  const handleToggleRepeat = () => {
    triggerHaptic();
    if (repeatMode === 'off') engine.setRepeatMode('all');
    else if (repeatMode === 'all') engine.setRepeatMode('one');
    else engine.setRepeatMode('off');
  };

  const handleToggleShuffle = () => {
    triggerHaptic();
    engine.setShuffleMode(shuffleMode === 'off' ? 'on' : 'off');
  };

  const handleEqualizer = () => {
    triggerHaptic();
    onNavigateToEqualizer?.();
  };

  const handleCast = () => {
    triggerHaptic();
    onNavigateToCast?.();
  };

  const handlePlaylist = () => {
    triggerHaptic();
    onNavigateToPlaylist?.();
  };

  const handleSleepTimer = () => {
    triggerHaptic();
    onNavigateToSleepTimer?.();
  };

  const handleMenuPress = useCallback(() => {
    if (!onNavigateToMenu) return;
    triggerHaptic();
    onNavigateToMenu({
      songData: JSON.stringify({
        id: displayTrack?.id,
        title: displayTrack?.title,
        artist: displayTrack?.artist,
        thumbnail: displayTrack?.thumbnail,
        url: displayTrack?.url,
        duration: displayTrack?.duration,
        uploaderUrl: isLocal ? undefined : uploaderUrl,
        videoId: isLocal ? undefined : videoId,
        isLocal,
      }),
    });
  }, [onNavigateToMenu, displayTrack, uploaderUrl, videoId, isLocal]);

  const handleCollapsePlayer = useCallback(() => {
    triggerHaptic();
    onMinimize();
  }, [onMinimize]);

  const artworkSource =
    typeof displayTrack?.thumbnail === 'string' && displayTrack.thumbnail
      ? { uri: displayTrack.thumbnail }
      : require('@/assets/images/mavins.png');

  const getRepeatIcon = () => {
    if (repeatMode === 'off') return 'repeat-off';
    if (repeatMode === 'all') return 'repeat';
    return 'repeat-once';
  };

  const getRepeatColor = () => {
    if (repeatMode === 'off') return colors.textMuted;
    return colors.gold;
  };

  return (
    <>
      <View style={{ flex: 1, backgroundColor: gradientColors[2] }}>
        <LinearGradient style={{ flex: 1 }} colors={gradientColors}>
          <View style={[styles.topBar, { top: topInset + 8 }]}>
            <View style={styles.dragHandleWrapper} pointerEvents="none">
              <View style={[styles.dragHandle, { backgroundColor: colors.textMuted }]} />
            </View>

            <View style={styles.topBarContent}>
              <View style={styles.segmentSwitch}>
                <TouchableOpacity
                  onPress={() => handleSegmentPress('song')}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <Text style={activeSegment === 'song' ? styles.segmentActive : [styles.segmentInactive, { color: colors.textSub }]}>
                    Song
                  </Text>
                </TouchableOpacity>

                {!isLocal && (
                  <TouchableOpacity
                    onPress={() => handleSegmentPress('video')}
                    activeOpacity={hasVideo && !videoError ? 0.7 : 1}
                    disabled={!hasVideo}
                    onPressIn={() => setButtonActive(true)}
                    onPressOut={() => setButtonActive(false)}
                  >
                    <Text
                      style={[
                        activeSegment === 'video' ? styles.segmentActive : [styles.segmentInactive, { color: colors.textSub }],
                        !hasVideo && { opacity: 0.3 },
                        videoError && { opacity: 0.5, textDecorationLine: 'line-through' },
                      ]}
                    >
                      Video {videoError ? '(unavailable)' : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.topBarRight}>
                <TouchableOpacity
                  onPress={handleMenuPress}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <Ionicons name="chevron-down" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={[styles.contentContainer, { paddingTop: topInset + 80 }]}>
            <View style={styles.artworkContainer}>
              <Animated.View style={[StyleSheet.absoluteFill, artworkAnimStyle]}>
                {showSkeleton ? (
                  <View style={[styles.artworkImage, { backgroundColor: colors.surfaceLight }]} />
                ) : (
                  <Image
                    source={artworkSource}
                    style={styles.artworkImage}
                    contentFit="cover"
                    transition={300}
                  />
                )}
              </Animated.View>

              {hasVideo && !isLocal && videoPlayerInitialized && (
                <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                  <VideoView
                    player={videoPlayer}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    nativeControls={false}
                    allowsPictureInPicture={false}
                  />
                  {videoError && activeSegment === 'video' && (
                    <View style={[styles.videoErrorOverlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
                      <MaterialCommunityIcons name="video-off" size={32} color={colors.text} />
                      <Text style={[styles.videoErrorText, { color: colors.text }]}>{videoError}</Text>
                      <Text style={[styles.videoErrorSubtext, { color: colors.textSub }]}>Playing audio only</Text>
                    </View>
                  )}
                </Animated.View>
              )}
            </View>

            <View style={styles.infoContainer}>
              {showSkeleton ? (
                <SkeletonPulse width={200} height={24} borderRadius={6} />
              ) : displayTrack.title ? (
                <MovingText
                  text={String(displayTrack.title)}
                  animationThreshold={20}
                  style={[styles.title, { color: colors.text }]}
                />
              ) : (
                <View style={{ alignItems: 'center', marginBottom: 4 }}>
                  <SkeletonPulse width={180} height={20} borderRadius={6} />
                </View>
              )}

              {showSkeleton ? (
                <SkeletonPulse width={140} height={16} borderRadius={4} style={{ marginTop: 6 }} />
              ) : displayTrack.artist ? (
                <ArtistLine
                  rawArtist={String(displayTrack.artist)}
                  uploaderUrl={uploaderUrl}
                  onArtistPress={handleArtistPress}
                  colors={colors}
                  isLocal={isLocal}
                />
              ) : (
                <View style={{ alignItems: 'center', marginTop: 6 }}>
                  <SkeletonPulse width={120} height={14} borderRadius={4} />
                </View>
              )}
            </View>

            <View style={styles.actionRow}>
              <View style={styles.leftActions}>
                {!isLocal ? (
                  <View style={[styles.actionContainer, { backgroundColor: `${colors.gold}15` }]}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={toggleFavoriteFunc}
                      activeOpacity={0.7}
                      onPressIn={() => setButtonActive(true)}
                      onPressOut={() => setButtonActive(false)}
                    >
                      <Ionicons
                        name={isFavorite ? 'thumbs-up' : 'thumbs-up-outline'}
                        size={16}
                        color={isFavorite ? colors.gold : colors.text}
                      />
                      {likeCount > 0 && <Text style={[styles.statCount, { color: colors.text }]}>{formatCount(likeCount)}</Text>}
                    </TouchableOpacity>

                    <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

                    <TouchableOpacity
                      style={styles.actionButton}
                      activeOpacity={0.7}
                      onPressIn={() => setButtonActive(true)}
                      onPressOut={() => setButtonActive(false)}
                    >
                      <Ionicons name="thumbs-down-outline" size={16} color={colors.text} />
                      {dislikeCount > 0 && <Text style={[styles.statCount, { color: colors.text }]}>{formatCount(dislikeCount)}</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionContainer, { backgroundColor: `${colors.gold}15` }]}
                    onPress={toggleFavoriteFunc}
                    activeOpacity={0.7}
                    onPressIn={() => setButtonActive(true)}
                    onPressOut={() => setButtonActive(false)}
                  >
                    <Ionicons
                      name={isFavorite ? 'heart' : 'heart-outline'}
                      size={16}
                      color={isFavorite ? colors.gold : colors.text}
                    />
                    <Text style={[styles.statCount, { color: colors.textMuted, fontSize: moderateScale(10) }]}>
                      Favorite
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.actionContainer,
                    { backgroundColor: `${colors.gold}15` },
                    isLocal && { opacity: 0.5 },
                  ]}
                  onPress={handleOpenComments}
                  activeOpacity={isLocal ? 1 : 0.7}
                  disabled={isLocal}
                  onPressIn={() => {
                    if (!isLocal) setButtonActive(true);
                  }}
                  onPressOut={() => setButtonActive(false)}
                >
                  <MaterialCommunityIcons
                    name="comment-text-outline"
                    size={16}
                    color={isLocal ? colors.textMuted : colors.text}
                  />
                  {!isLocal && commentsCount > 0 && (
                    <Text style={[styles.statCount, { color: colors.text }]}>{formatCount(commentsCount)}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {!isLocal && (
                <View style={[styles.playCountPill, { backgroundColor: `${colors.gold}10` }]}>
                  <Ionicons name="headset-outline" size={13} color={colors.textSub} />
                  {counterTarget > 0 ? <AnimatedCounter target={counterTarget} /> : <SkeletonPulse width={42} height={10} borderRadius={3} />}
                </View>
              )}

              <View style={styles.extraActions}>
                <TouchableOpacity
                  style={styles.extraIcon}
                  onPress={handlePlaylist}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
                  <MaterialIcons name="playlist-add" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.extraIcon}
                  onPress={handleSleepTimer}
                  activeOpacity={0.7}
                  onPressIn={() => setButtonActive(true)}
                  onPressOut={() => setButtonActive(false)}
                >
               
                  <MaterialCommunityIcons name="weather-night" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

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
                  <View style={[styles.bubbleContainer, { backgroundColor: `${colors.background}CC` }]}>
                    <Text style={[styles.bubbleText, { color: colors.text }]}>
                      {formatTime(slidingValue.value * durationSec)}
                    </Text>
                  </View>
                )}
                renderThumb={() => <View style={[styles.sliderThumb, { backgroundColor: colors.gold }]} />}
                theme={{
                  minimumTrackTintColor: colors.gold,
                  maximumTrackTintColor: colors.sliderTrack,
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
                <Text style={[styles.timeText, { color: colors.textSub }]}>{formatTime(positionSec)}</Text>
                <Text style={[styles.timeText, { color: colors.textSub }]}>{formatTime(durationSec)}</Text>
              </View>
            </View>

            <View style={styles.controls}>
              <TouchableOpacity
                onPress={handleToggleShuffle}
                style={styles.shuffleWrapper}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Feather name="shuffle" size={20} color={shuffleMode === 'off' ? colors.textMuted : colors.gold} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSkipBack}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons name="play-skip-back" size={32} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePlayPause}
                style={[styles.bigPlay, { backgroundColor: colors.gold }]}
                activeOpacity={0.85}
                disabled={showSkeleton || displayTrack.id === DUMMY_TRACK.id}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons
                  name={showSkeleton ? 'hourglass-outline' : isPlaying ? 'pause' : 'play'}
                  size={32}
                  color={colors.textInverse}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSkipNext}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons name="play-skip-forward" size={32} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleToggleRepeat}
                style={styles.repeatWrapper}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <MaterialCommunityIcons
                  name={getRepeatIcon()}
                  size={22}
                  color={getRepeatColor()}
                />
                {repeatMode === 'one' && (
                  <View style={[styles.repeatOneBadge, { backgroundColor: colors.gold }]}>
                    <Text style={styles.repeatOneText}>1</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.bottomTabs}>
              <TouchableOpacity
                onPress={handleOpenQueue}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Text style={[styles.bottomTabActive, { color: colors.gold }]}>UP NEXT</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleOpenLyrics}
                activeOpacity={canShowLyrics && !isLocal ? 0.7 : 1}
                disabled={!canShowLyrics || isLocal}
                onPressIn={() => {
                  if (canShowLyrics && !isLocal) setButtonActive(true);
                }}
                onPressOut={() => setButtonActive(false)}
              >
                <Text
                  style={[
                    styles.bottomTab,
                    { color: colors.textSub },
                    (!canShowLyrics || isLocal) && { opacity: 0.25 },
                  ]}
                >
                  LYRICS
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleOpenRelated}
                activeOpacity={isLocal ? 1 : 0.7}
                disabled={isLocal}
                onPressIn={() => {
                  if (!isLocal) setButtonActive(true);
                }}
                onPressOut={() => setButtonActive(false)}
              >
                <Text
                  style={[
                    styles.bottomTab,
                    { color: colors.textSub },
                    isLocal && { opacity: 0.25, textDecorationLine: 'none' },
                  ]}
                >
                  RELATED
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </View>

      <RNModal
        visible={showQueueModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowQueueModal(false)}
      >
        <QueueModal onClose={() => setShowQueueModal(false)} />
      </RNModal>

      <RNModal
        visible={showLyricsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLyricsModal(false)}
      >
        <LyricsModal
          title={lyricsData.title}
          artist={lyricsData.artist}
          videoId={lyricsData.videoId}
          leadIn={String(LYRICS_LEAD_IN_S)}
          onClose={() => setShowLyricsModal(false)}
        />
      </RNModal>

      {!isLocal && (
        <RNModal
          visible={showRelatedModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowRelatedModal(false)}
        >
          <RelatedModal
            songUrl={relatedData.songUrl}
            title={relatedData.title}
            artist={relatedData.artist}
            onClose={() => setShowRelatedModal(false)}
          />
        </RNModal>
      )}

      {!isLocal && (
        <RNModal
          visible={showCommentsModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowCommentsModal(false)}
        >
          <CommentsModal
            songId={commentsData.songId}
            title={commentsData.title}
            onClose={() => setShowCommentsModal(false)}
          />
        </RNModal>
      )}
    </>
  );
}

export default function PlayerContent(props: PlayerContentProps) {
  return (
    <PlayerContentInner
      onMinimize={props.onMinimize}
      onClose={props.onClose}
      isExpanded={props.isExpanded}
      topInset={props.topInset}
      onNavigateToEqualizer={props.onNavigateToEqualizer}
      onNavigateToCast={props.onNavigateToCast}
      onNavigateToPlaylist={props.onNavigateToPlaylist}
      onNavigateToSleepTimer={props.onNavigateToSleepTimer}
      onNavigateToArtist={props.onNavigateToArtist}
      onNavigateToMenu={props.onNavigateToMenu}
      onNavigateToLocalFolder={props.onNavigateToLocalFolder}
    />
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 0, right: 0, zIndex: 1000, alignItems: 'center' },
  dragHandleWrapper: { width: '100%', alignItems: 'center', paddingBottom: 8 },
  dragHandle: { width: 36, height: 4, borderRadius: 2 },
  topBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: screenPadding.horizontal,
  },
  segmentSwitch: { flexDirection: 'row', gap: scale(20) },
  segmentActive: { color: '#fff', fontWeight: '600' },
  segmentInactive: { fontWeight: '500' },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: scale(15) },

  contentContainer: { flex: 1, paddingHorizontal: screenPadding.horizontal },
  artworkContainer: {
    alignItems: 'center',
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_WIDTH * 0.85,
    alignSelf: 'center',
    borderRadius: 16,
    overflow: 'hidden',
  },
  artworkImage: { width: SCREEN_WIDTH * 0.85, height: SCREEN_WIDTH * 0.85, borderRadius: 16 },

  infoContainer: { marginTop: verticalScale(24), alignItems: 'center' },
  title: { fontSize: moderateScale(20), fontWeight: '700', textAlign: 'center' },
  artist: { fontSize: moderateScale(15), marginTop: 4, textAlign: 'center', flexWrap: 'wrap' },
  artistName: { fontSize: moderateScale(15) },
  artistTappable: { textDecorationLine: 'underline' },
  artistSeparator: { fontSize: moderateScale(15) },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: verticalScale(18),
    paddingHorizontal: scale(4),
  },
  leftActions: { flexDirection: 'row', alignItems: 'center', gap: scale(8) },
  actionContainer: {
    flexDirection: 'row',
    borderRadius: 24,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    alignItems: 'center',
    gap: scale(2),
  },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: scale(4) },
  statCount: { fontSize: moderateScale(11), fontWeight: '600', letterSpacing: 0.2 },
  actionDivider: { width: 1, height: verticalScale(14), marginHorizontal: scale(6) },

  playCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: scale(9),
    paddingVertical: verticalScale(5),
  },

  extraActions: { flexDirection: 'row', alignItems: 'center', gap: scale(14) },
  extraIcon: { padding: scale(4) },

  progressWrapper: { marginTop: verticalScale(20) },
  sliderThumb: {
    width: moderateScale(15),
    height: moderateScale(15),
    borderRadius: moderateScale(15) / 2,
  },
  bubbleContainer: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  bubbleText: { fontSize: moderateScale(11), fontWeight: '600' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: verticalScale(6) },
  timeText: { fontSize: moderateScale(12) },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: verticalScale(26),
    paddingHorizontal: scale(8),
  },
  shuffleWrapper: { alignItems: 'center', gap: verticalScale(4) },
  bigPlay: {
    width: scale(65),
    height: scale(65),
    borderRadius: 32.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  repeatWrapper: { alignItems: 'center', position: 'relative' },
  repeatOneBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#A0826D',
  },
  repeatOneText: { color: '#fff', fontSize: moderateScale(9), fontWeight: '700', lineHeight: moderateScale(12) },

  bottomTabs: { flexDirection: 'row', justifyContent: 'space-around', marginTop: verticalScale(32), paddingBottom: verticalScale(5) },
  bottomTabActive: { fontSize: moderateScale(13), fontWeight: '600' },
  bottomTab: { fontSize: moderateScale(13), fontWeight: '500' },

  videoErrorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  videoErrorText: {
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginTop: verticalScale(8),
    textAlign: 'center',
    paddingHorizontal: scale(16),
  },
  videoErrorSubtext: {
    fontSize: moderateScale(12),
    marginTop: verticalScale(4),
    textAlign: 'center',
  },
});