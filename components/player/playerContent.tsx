// components/player/playerContent.tsx
//
// ANDROID-ONLY: All iOS-specific code removed
// COMPLETE VIDEO TAB IMPLEMENTATION
//
// FIXED: Metadata (title, artist, artwork) shows immediately - no skeleton
// FIXED: Skeleton only for loading states (buffering, resolving, etc.)
// FIXED: Download and Share buttons in same pill container (consistent styling)
// FIXED: Share icon uses curved arrow (arrow-redo-outline)

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
  AppState,
  AppStateStatus,
  ActivityIndicator,
  ScrollView,
  Share,
  ToastAndroid,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { createVideoPlayer, VideoView } from 'expo-video';
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
import AsyncStorage from '@react-native-async-storage/async-storage';

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
} from '@/libs/playerSetup';

import { useGestureContext } from '@/libs/playerSetup';
import { downloadAndSaveSong } from '@/services/download';
import { useIsSongDownloaded, useIsSongDownloading } from '@/store/library';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Storage key for download cooldown
const DOWNLOAD_COOLDOWN_KEY = '@download_cooldown';
const COOLDOWN_HOURS = 24;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL VIDEO PLAYER SINGLETON
// ─────────────────────────────────────────────────────────────────────────────
const VIDEO_PLAYER_GLOBAL_KEY = '__MavinVideoPlayer__';

if (!(global as any)[VIDEO_PLAYER_GLOBAL_KEY]) {
  (global as any)[VIDEO_PLAYER_GLOBAL_KEY] = createVideoPlayer(null);
  console.log('[PlayerContent] Created persistent video player singleton');
}

const videoPlayerSingleton: ReturnType<typeof createVideoPlayer> =
  (global as any)[VIDEO_PLAYER_GLOBAL_KEY];

try {
  videoPlayerSingleton.muted = true;
  videoPlayerSingleton.loop = false;
  videoPlayerSingleton.staysActiveInBackground = true;
} catch (e) {
  console.warn('[PlayerContent] Failed to configure video player:', e);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LYRICS_LEAD_IN_S = 0.25;
const VIDEO_SYNC_INTERVAL_MS = 100;
const VIDEO_POSITION_POLL_MS = 250;
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
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
  return raw.split(/[,&]|\bft\.?\b|\bfeat\.?\b/i).map(a => a.trim()).filter(Boolean);
};

const formatArtistName = (name: string): string =>
  name.replace(/([a-z])([A-Z])/g, '$1 $2');

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonPulse({
  width, height, borderRadius = 6, style,
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

  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: ['#1A1A1A', '#2A2A2A'] });

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

// ─────────────────────────────────────────────────────────────────────────────
// Download Button Component with Progress and Cooldown
// FIXED: Percentage count displayed INSIDE the circular spinner
// ─────────────────────────────────────────────────────────────────────────────
interface DownloadButtonProps {
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackDuration?: number;
  trackUrl: string;
  trackThumbnail?: string;
  iconSize?: number;
  onDownloadComplete?: () => void;
}

const DownloadButtonWithProgress: React.FC<DownloadButtonProps> = ({
  trackId,
  trackTitle,
  trackArtist,
  trackDuration,
  trackUrl,
  trackThumbnail,
  iconSize = 24,
  onDownloadComplete,
}) => {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'completed' | 'cooldown'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const isDownloaded = useIsSongDownloaded(trackId);
  const isDownloadingGlobal = useIsSongDownloading(trackId);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkCooldown();
  }, []);

  useEffect(() => {
    if (isDownloadingGlobal && downloadState !== 'downloading') {
      setDownloadState('downloading');
      startProgressSimulation();
    } else if (!isDownloadingGlobal && downloadState === 'downloading') {
      if (isDownloaded) {
        setDownloadState('completed');
        setDownloadProgress(100);
        stopProgressSimulation();
        onDownloadComplete?.();
        setCooldown();
        setTimeout(() => {
          setDownloadState('cooldown');
          checkCooldown();
        }, 2000);
      } else {
        setDownloadState('idle');
        setDownloadProgress(0);
        stopProgressSimulation();
      }
    }
  }, [isDownloadingGlobal, isDownloaded]);

  const startProgressSimulation = () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setDownloadProgress(0);
    progressInterval.current = setInterval(() => {
      setDownloadProgress(prev => {
        if (prev >= 95) return prev;
        return Math.min(prev + Math.random() * 5, 95);
      });
    }, 500);
  };

  const stopProgressSimulation = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  };

  const checkCooldown = async () => {
    try {
      const cooldownData = await AsyncStorage.getItem(DOWNLOAD_COOLDOWN_KEY);
      if (cooldownData) {
        const { lastDownloadTime } = JSON.parse(cooldownData);
        const elapsed = Date.now() - lastDownloadTime;
        if (elapsed < COOLDOWN_MS) {
          const remaining = COOLDOWN_MS - elapsed;
          setCooldownRemaining(remaining);
          setDownloadState('cooldown');
          const timer = setInterval(() => {
            setCooldownRemaining(prev => {
              if (prev <= 1000) {
                clearInterval(timer);
                setDownloadState('idle');
                return 0;
              }
              return prev - 1000;
            });
          }, 1000);
          return () => clearInterval(timer);
        }
      }
      setDownloadState('idle');
    } catch (error) {
      console.warn('[DownloadButton] Failed to check cooldown:', error);
    }
  };

  const setCooldown = async () => {
    try {
      await AsyncStorage.setItem(DOWNLOAD_COOLDOWN_KEY, JSON.stringify({ lastDownloadTime: Date.now() }));
    } catch (error) {
      console.warn('[DownloadButton] Failed to set cooldown:', error);
    }
  };

  const formatCooldownTime = (ms: number): string => {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const handleDownload = async () => {
    if (downloadState !== 'idle') return;
    if (isDownloaded) {
      ToastAndroid.show('Song already downloaded', ToastAndroid.SHORT);
      return;
    }

    triggerHaptic();
    setDownloadState('downloading');
    startProgressSimulation();

    try {
      await downloadAndSaveSong({
        id: trackId,
        title: trackTitle,
        artist: trackArtist,
        duration: trackDuration,
        url: trackUrl,
        thumbnailUrl: trackThumbnail,
      });
    } catch (error) {
      console.error('[DownloadButton] Download failed:', error);
      setDownloadState('idle');
      setDownloadProgress(0);
      stopProgressSimulation();
      ToastAndroid.show('Download failed. Please try again.', ToastAndroid.SHORT);
    }
  };

  const renderIcon = () => {
    const circleSize = iconSize + 8;
    const strokeWidth = 3;
    const progressPercent = Math.min(downloadProgress / 100, 1);

    if (downloadState === 'downloading') {
      return (
        <View style={{ width: circleSize, height: circleSize, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute',
              width: circleSize,
              height: circleSize,
              borderRadius: circleSize / 2,
              borderWidth: strokeWidth,
              borderColor: 'rgba(255,255,255,0.3)',
              backgroundColor: 'transparent',
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: circleSize,
              height: circleSize,
              transform: [{ rotate: '-90deg' }],
            }}
          >
            <View
              style={{
                width: circleSize,
                height: circleSize,
                borderRadius: circleSize / 2,
                borderWidth: strokeWidth,
                borderColor: '#fff',
                borderStyle: 'solid',
                borderTopColor: '#fff',
                borderRightColor: 'transparent',
                borderBottomColor: 'transparent',
                borderLeftColor: 'transparent',
                transform: [{ rotate: `${progressPercent * 360}deg` }],
              }}
            />
          </View>
          <Text style={{ fontSize: circleSize * 0.3, color: '#fff', fontWeight: 'bold', textAlign: 'center' }}>
            {Math.round(downloadProgress)}%
          </Text>
        </View>
      );
    }

    if (downloadState === 'completed') {
      return <Ionicons name="checkmark-circle" size={circleSize} color="#4CAF50" />;
    }

    if (downloadState === 'cooldown') {
      return (
        <View style={{ alignItems: 'center' }}>
          <MaterialIcons name="file-download" size={iconSize} color="rgba(255,255,255,0.5)" />
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {formatCooldownTime(cooldownRemaining)}
          </Text>
        </View>
      );
    }

    if (isDownloaded) {
      return <MaterialIcons name="file-download-done" size={iconSize} color="#4CAF50" />;
    }

    return <MaterialIcons name="file-download" size={iconSize} color="#fff" />;
  };

  return (
    <TouchableOpacity onPress={handleDownload} disabled={downloadState !== 'idle'} activeOpacity={0.7}>
      {renderIcon()}
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
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

  // ── Modals ──────────────────────────────────────────────────────────────────
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);

  const [lyricsData, setLyricsData] = useState({ title: '', artist: '', videoId: '' });
  const [relatedData, setRelatedData] = useState({ songUrl: '', title: '', artist: '' });
  const [commentsData, setCommentsData] = useState({ songId: '', title: '' });

  const { setSliderActive, setButtonActive } = useGestureContext();

  // ── Context ─────────────────────────────────────────────────────────────────
  const engine = usePlayerEngine();
  const {
    isLoading: musicPlayerLoading,
    togglePlayPause,
    isLocalTrack,
    deactivateAudio,
    activateAudio,
    setVideoActive,
    updateVideoPosition,
    updateVideoDuration,
    updateVideoIsPlaying,
  } = useMusicPlayer();

  const isPlaying = engine.isPlaying;
  const positionSec = engine.position;
  const durationSec = engine.duration;
  const repeatMode = engine.repeatMode;
  const shuffleMode = engine.shuffleMode;
  const isResolving = (engine as any).isResolving ?? false;

  const trackExtrasVersion = useTrackExtrasVersion();

  // ── Display track ───────────────────────────────────────────────────────────
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

  const isLocal = useMemo(
    () => isLocalTrack(engine.currentTrack),
    [engine.currentTrack, isLocalTrack],
  );

  // ── Track extras ─────────────────────────────────────────────────────────────
  const [extras, setExtras] = useState<Record<string, any>>({});

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) {
      setExtras({});
      return;
    }
    setExtras(getTrackExtras(id) ?? {});
  }, [displayTrack?.id, trackExtrasVersion]);

  const liveExtras = (displayTrack?.id && displayTrack.id !== DUMMY_TRACK.id)
    ? (getTrackExtras(displayTrack.id) ?? extras)
    : extras;

  const likeCount = liveExtras?.likeCount ?? -1;
  const dislikeCount = liveExtras?.dislikeCount ?? -1;
  const commentsCount = liveExtras?.commentsCount ?? -1;
  const viewCount = liveExtras?.viewCount ?? -1;
  const uploaderUrl: string | undefined = liveExtras?.uploaderUrl;
  const videoId: string | undefined = liveExtras?.videoId ?? displayTrack?.videoId;
  const muxedVideoUrl: string | undefined = liveExtras?.muxedVideoUrl;
  const videoUrl: string | undefined = liveExtras?.videoUrl;

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

  useEffect(() => {
    console.log('[PlayerContent] Video availability:', {
      hasVideo,
      activeVideoUrl: activeVideoUrl?.substring(0, 60),
      muxedVideoUrl: muxedVideoUrl?.substring(0, 60),
      videoUrl: videoUrl?.substring(0, 60),
      isLocal,
      trackId: displayTrack?.id,
    });
  }, [hasVideo, activeVideoUrl, muxedVideoUrl, videoUrl, isLocal, displayTrack?.id]);

  const [isFavorite, setIsFavorite] = useState(false);
  const toggleFavoriteFunc = () => {
    triggerHaptic();
    setIsFavorite(p => !p);
  };

  const [counterTarget, setCounterTarget] = useState(0);
  useEffect(() => {
    setCounterTarget(0);
    const t = setTimeout(() => setCounterTarget(viewCount > 0 ? viewCount : 0), 150);
    return () => clearTimeout(t);
  }, [displayTrack?.id, viewCount]);

  // ── Skeleton only for loading states, NOT for metadata ──────────────────────
  const showSkeletonForStats = musicPlayerLoading || isResolving || (engine.isBuffering && !isPlaying && durationSec === 0);

  // ── VIDEO TAB STATE ─────────────────────────────────────────────────────────
  const [activeSegment, setActiveSegment] = useState<'song' | 'video'>('song');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoPlayerInitialized, setVideoPlayerInitialized] = useState(false);

  const videoPlayer = videoPlayerSingleton;
  const videoPlayerRef = useRef(videoPlayer);
  const videoPlayerReady = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const isTransitioning = useRef(false);
  const activeSegmentRef = useRef<'song' | 'video'>('song');
  const videoPlayingRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const errorCountRef = useRef(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const isPipActiveRef = useRef(false);
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);

  useEffect(() => { positionRef.current = positionSec; }, [positionSec]);
  useEffect(() => { durationRef.current = durationSec; }, [durationSec]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const [visualIsPlaying, setVisualIsPlaying] = useState(isPlaying);
  useEffect(() => {
    if (activeSegmentRef.current === 'song') {
      setVisualIsPlaying(isPlaying);
    }
  }, [isPlaying]);

  const [visualPositionSec, setVisualPositionSec] = useState(positionSec);
  const [visualDurationSec, setVisualDurationSec] = useState(durationSec);

  useEffect(() => {
    if (activeSegmentRef.current === 'song') {
      setVisualPositionSec(positionSec);
      if (durationSec > 0 && visualDurationSec !== durationSec) {
        setVisualDurationSec(durationSec);
      }
    }
  }, [positionSec, durationSec, visualDurationSec]);

  // ── Poll video player position while on Video tab ───────────────────────────
  useEffect(() => {
    if (videoPollIntervalRef.current) {
      clearInterval(videoPollIntervalRef.current);
      videoPollIntervalRef.current = null;
    }

    if (activeSegment !== 'video' || !videoPlayerInitialized || isLocal) return;

    videoPollIntervalRef.current = setInterval(() => {
      const vp = videoPlayerRef.current;
      if (!vp) return;
      try {
        const ct = vp.currentTime ?? 0;
        const dur = vp.duration ?? 0;
        if (!isSlidingRef.current) {
          setVisualPositionSec(ct);
        }
        setVisualDurationSec(dur > 0 ? dur : durationRef.current);
        updateVideoPosition(ct);
        updateVideoDuration(dur > 0 ? dur : durationRef.current);
      } catch {}
    }, VIDEO_POSITION_POLL_MS);

    return () => {
      if (videoPollIntervalRef.current) {
        clearInterval(videoPollIntervalRef.current);
        videoPollIntervalRef.current = null;
      }
    };
  }, [activeSegment, videoPlayerInitialized, isLocal, updateVideoPosition, updateVideoDuration]);

  // ── Video player status listener ───────────────────────────────────────────
  useEffect(() => {
    if (!videoPlayer || isLocal) return;

    let statusListener: any = null;

    try {
      statusListener = videoPlayer.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') {
          videoPlayerReady.current = true;
          setVideoError(null);
          errorCountRef.current = 0;

          if (pendingSeek.current !== null) {
            try {
              videoPlayer.currentTime = pendingSeek.current;
              if (activeSegmentRef.current === 'video') {
                setVisualPositionSec(pendingSeek.current);
              }
            } catch {}
            pendingSeek.current = null;

            if (activeSegmentRef.current === 'video' && isPlayingRef.current) {
              try {
                videoPlayer.play();
                videoPlayingRef.current = true;
              } catch {}
            }
          }
        } else if (status === 'error' && activeSegmentRef.current === 'video') {
          videoPlayerReady.current = false;
          const errorMsg = error?.message || 'Unknown video error';
          console.error('[PlayerContent] Video error:', errorMsg);

          if ((errorMsg.includes('403') || errorMsg.includes('forbidden')) && errorCountRef.current === 0) {
            errorCountRef.current = 1;
            setVideoError('Video unavailable. Retrying...');
            setTimeout(() => {
              if (lastLoadedUrlRef.current) {
                try {
                  videoPlayer.replaceAsync(lastLoadedUrlRef.current);
                } catch {}
              }
            }, 1000);
          } else {
            setVideoError(errorMsg.includes('403') ? 'Video unavailable (access denied)' : errorMsg);
          }
        }
      });
    } catch (e) {
      console.error('[PlayerContent] Failed to add video listener:', e);
    }

    return () => {
      try {
        statusListener?.remove?.();
      } catch {}
    };
  }, [videoPlayer, isLocal]);

  // ── AppState listener for auto-PiP ──────────────────────────────────────────
  useEffect(() => {
    if (isLocal || !hasVideo) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const vp = videoPlayerRef.current;
      if (!vp) return;

      if (nextAppState === 'background') {
        if (
          activeSegmentRef.current === 'video' &&
          videoPlayerReady.current &&
          videoPlayerInitialized &&
          !isPipActiveRef.current
        ) {
          try {
            vp.startPictureInPicture();
          } catch (e) {
            console.warn('[PlayerContent] Failed to start PiP:', e);
          }
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [isLocal, hasVideo, videoPlayerInitialized]);

  // ── Global video command registration ───────────────────────────────────────
  useEffect(() => {
    if (!videoPlayerInitialized || isLocal) return;

    const vp = videoPlayerRef.current;
    if (!vp) return;

    (global as any).__mavinVideoPlay = () => {
      try {
        vp.play();
        videoPlayingRef.current = true;
        updateVideoIsPlaying(true);
        setVisualIsPlaying(true);
      } catch (e) {
        console.warn('[PlayerContent] Global play failed:', e);
      }
    };

    (global as any).__mavinVideoPause = () => {
      try {
        vp.pause();
        videoPlayingRef.current = false;
        updateVideoIsPlaying(false);
        setVisualIsPlaying(false);
      } catch (e) {
        console.warn('[PlayerContent] Global pause failed:', e);
      }
    };

    (global as any).__mavinVideoSeek = (position: number) => {
      try {
        vp.currentTime = position;
        updateVideoPosition(position);
        setVisualPositionSec(position);
      } catch (e) {
        console.warn('[PlayerContent] Global seek failed:', e);
      }
    };

    console.log('[PlayerContent] Registered global video command handlers');

    return () => {
      delete (global as any).__mavinVideoPlay;
      delete (global as any).__mavinVideoPause;
      delete (global as any).__mavinVideoSeek;
    };
  }, [videoPlayerInitialized, isLocal, updateVideoIsPlaying, updateVideoPosition]);

  // ── Load video source ───────────────────────────────────────────────────────
  const loadVideoSource = useCallback(async (url: string) => {
    if (!url || isLocal) return;

    if (lastLoadedUrlRef.current === url && videoPlayerReady.current) {
      console.log('[PlayerContent] Video URL already loaded, skipping');
      return;
    }

    try {
      setVideoError(null);
      errorCountRef.current = 0;
      videoPlayerReady.current = false;

      const vp = videoPlayerRef.current;
      await vp.replaceAsync(url);
      lastLoadedUrlRef.current = url;

      const pollStart = Date.now();
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (vp.status === 'readyToPlay') {
            videoPlayerReady.current = true;
            resolve();
            return;
          }
          if (Date.now() - pollStart >= 8000) {
            console.warn('[PlayerContent] readyToPlay poll timed out');
            resolve();
            return;
          }
          setTimeout(poll, 200);
        };
        poll();
      });

      try { vp.muted = true; } catch {}
      console.log('[PlayerContent] Video source loaded:', url.substring(0, 80));
    } catch (e) {
      console.warn('[PlayerContent] Failed to load video source:', e);
      setVideoError('Video unavailable. Listening to audio only.');
    }
  }, [isLocal]);

  useEffect(() => {
    if (!activeVideoUrl || isLocal) return;
    void loadVideoSource(activeVideoUrl);
  }, [activeVideoUrl, isLocal]);

  // ── Sync interval ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || isLocal || !activeVideoUrl) return;

    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);

    syncIntervalRef.current = setInterval(() => {
      if (videoPlayer && !videoError && activeSegmentRef.current === 'song') {
        const drift = Math.abs(videoPlayer.currentTime - positionRef.current);
        if (drift > 0.5) {
          try {
            videoPlayer.currentTime = positionRef.current;
          } catch {}
        }
      }
    }, VIDEO_SYNC_INTERVAL_MS);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [videoPlayerInitialized, videoPlayer, isLocal, activeVideoUrl, videoError]);

  // ── Share handler ───────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;
    triggerHaptic();
    
    try {
      const shareUrl = videoId 
        ? `https://www.youtube.com/watch?v=${videoId}`
        : displayTrack.url;
      
      const message = `Check out "${displayTrack.title}" by ${displayTrack.artist || 'Unknown Artist'}`;
      
      await Share.share({
        title: displayTrack.title,
        message: Platform.OS === 'android' ? `${message}\n\n${shareUrl}` : message,
        url: Platform.OS === 'ios' ? shareUrl : undefined,
      });
    } catch (error) {
      console.warn('[PlayerContent] Share failed:', error);
      ToastAndroid.show("Failed to share song", ToastAndroid.SHORT);
    }
  }, [displayTrack, videoId]);

  // ── SEGMENT SWITCH ─────────────────────────────────────────────────────────
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

      if (seg === 'video' && !videoPlayerInitialized) {
        setVideoPlayerInitialized(true);
      }

      const vp = videoPlayerRef.current;
      const currentAudioPos = positionRef.current;
      const OFFSET = BACKWARD_SEEK_OFFSET;

      try {
        if (seg === 'video' && vp && !videoError && !isLocal) {
          await deactivateAudio();

          const seekTarget = Math.max(0, currentAudioPos - OFFSET);

          if (videoPlayerReady.current) {
            try {
              vp.currentTime = seekTarget;
            } catch {
              pendingSeek.current = seekTarget;
            }
          } else {
            pendingSeek.current = seekTarget;
          }

          vp.muted = false;

          if (visualIsPlaying) {
            try {
              await vp.play();
              videoPlayingRef.current = true;
            } catch (e) {
              console.warn('[PlayerContent] vp.play() failed:', e);
            }
          }

          setVisualPositionSec(seekTarget);
          setVisualDurationSec((vp.duration ?? 0) > 0 ? vp.duration : durationRef.current);

          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          setVideoActive(true);
          updateVideoPosition(seekTarget);
          updateVideoDuration((vp.duration ?? 0) > 0 ? vp.duration : durationRef.current);
          updateVideoIsPlaying(visualIsPlaying);
        } else if (seg === 'song' && vp) {
          pendingSeek.current = null;

          try { vp.pause(); } catch {}
          try { vp.muted = true; } catch {}
          
          videoPlayingRef.current = false;

          await activateAudio();

          const videoStoppedAt = vp.currentTime ?? positionRef.current;
          if (videoStoppedAt > 0 && videoStoppedAt !== positionRef.current) {
            try { engine.seekTo(videoStoppedAt); } catch {}
          }
          
          if (visualIsPlaying) {
            try { engine.play(); } catch (e) {
              console.warn('[PlayerContent] engine.play() failed:', e);
            }
          }

          setVisualPositionSec(videoStoppedAt);
          setVisualDurationSec(durationRef.current);

          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          setVideoActive(false);
          updateVideoPosition(videoStoppedAt);
          updateVideoDuration(durationRef.current);
          updateVideoIsPlaying(false);
        }
      } catch (err) {
        console.error('[PlayerContent] Segment switch error:', err);
      } finally {
        setTimeout(() => {
          isTransitioning.current = false;
        }, 500);
      }
    },
    [
      hasVideo,
      videoPlayer,
      visualIsPlaying,
      displayTrack.id,
      engine,
      videoError,
      isLocal,
      videoPlayerInitialized,
      setVisualPositionSec,
      setVisualDurationSec,
      deactivateAudio,
      activateAudio,
      setVideoActive,
      updateVideoPosition,
      updateVideoDuration,
      updateVideoIsPlaying,
    ],
  );

  // ── Track change reset ──────────────────────────────────────────────────────
  useEffect(() => {
    videoPlayerReady.current = false;
    pendingSeek.current = null;
    lastLoadedUrlRef.current = null;
    setActiveSegment('song');
    activeSegmentRef.current = 'song';
    setVideoError(null);
    errorCountRef.current = 0;
    setVisualPositionSec(0);
    setVisualDurationSec(0);
    setVideoActive(false);
    updateVideoPosition(0);
    updateVideoDuration(0);
    updateVideoIsPlaying(false);
  }, [displayTrack?.id, setVideoActive, updateVideoPosition, updateVideoDuration, updateVideoIsPlaying]);

  // ── Artwork colors ──────────────────────────────────────────────────────────
  const artworkForColors = typeof displayTrack?.thumbnail === 'string' ? displayTrack.thumbnail : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo((): [string, string, string] => {
    if (imageColors?.dominant && isDark) {
      return [imageColors.dominant, colors.surface, colors.background];
    }
    return [colors.playerGradientStart, colors.playerGradientMiddle, colors.playerGradientEnd];
  }, [imageColors, colors, isDark]);

  // ─────────────────────────────────────────────────────────────────────────────
  // SLIDER / SEEK
  // ─────────────────────────────────────────────────────────────────────────────
  const isSliding = useSharedValue(false);
  const isSlidingRef = useRef(false);
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderProgress = useSharedValue(0);
  const sliderMin = useSharedValue(0);
  const sliderMax = useSharedValue(1);
  const slidingValue = useSharedValue(0);

  useEffect(() => {
    if (!isSlidingRef.current && visualDurationSec > 0) {
      sliderProgress.value = visualPositionSec / visualDurationSec;
    } else if (!isSlidingRef.current && visualDurationSec === 0 && visualPositionSec === 0) {
      sliderProgress.value = 0;
    }
  }, [visualPositionSec, visualDurationSec, sliderProgress]);

  const handleSeek = useCallback(
    (fraction: number) => {
      const activeDuration =
        activeSegmentRef.current === 'video'
          ? ((videoPlayerRef.current?.duration ?? 0) > 0
              ? videoPlayerRef.current!.duration
              : durationRef.current)
          : durationRef.current;

      if (activeDuration <= 0) return;
      const t = fraction * activeDuration;

      if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = setTimeout(() => {
        isSlidingRef.current = false;
      }, 1500);

      if (activeSegmentRef.current === 'video') {
        const vp = videoPlayerRef.current;
        if (vp && videoPlayerReady.current && !videoError && !isLocal) {
          try {
            const wasPlaying = visualIsPlaying;
            vp.pause();
            vp.currentTime = t;
            if (wasPlaying) {
              vp.play();
            }
          } catch {}
        }
        setVisualPositionSec(t);
        updateVideoPosition(t);
      } else {
        engine.seekTo(t);
      }
    },
    [engine, videoError, isLocal, visualIsPlaying, updateVideoPosition],
  );

  const handleSkipBack = useCallback(async () => {
    triggerHaptic();
    await engine.skipToPrevious();
  }, [engine]);

  const handleSkipNext = useCallback(async () => {
    triggerHaptic();
    await engine.skipToNext();
  }, [engine]);

  const handlePlayPause = useCallback(async () => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;

    const willPlay = !visualIsPlaying;
    setVisualIsPlaying(willPlay);

    if (activeSegmentRef.current === 'video' && videoPlayer && videoPlayerReady.current && !videoError && !isLocal) {
      try {
        if (willPlay) {
          await videoPlayer.play();
        } else {
          await videoPlayer.pause();
        }
        videoPlayingRef.current = willPlay;
        updateVideoIsPlaying(willPlay);
      } catch (e) {
        console.warn('[PlayerContent] Video play/pause failed:', e);
      }
    } else {
      togglePlayPause();
    }
  }, [displayTrack, visualIsPlaying, togglePlayPause, videoPlayer, videoError, isLocal, updateVideoIsPlaying]);

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
    onMinimize();
    setTimeout(() => {
      onNavigateToPlaylist?.();
    }, 50);
  };

  const handleSleepTimer = () => {
    triggerHaptic();
    onMinimize();
    setTimeout(() => {
      onNavigateToSleepTimer?.();
    }, 50);
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

  const showCommentButton = !isLocal && commentsCount > 0 && displayTrack.id !== DUMMY_TRACK.id;

  const videoProgress = useSharedValue(0);
  useEffect(() => {
    videoProgress.value = withTiming(activeSegment === 'video' ? 1 : 0, { duration: 300 });
  }, [activeSegment, videoProgress]);

  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(videoProgress.value, [0, 1], [1, 0]),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(videoProgress.value, [0, 1], [0, 1]),
  }));

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER - Metadata always shows, skeleton only for loading stats
  // FIXED: Download and Share buttons in same pill container
  // ─────────────────────────────────────────────────────────────────────────────
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
            {/* Artwork / Video */}
            <View style={styles.artworkContainer}>
              <Animated.View style={[StyleSheet.absoluteFill, artworkAnimStyle]}>
                <Image
                  source={artworkSource}
                  style={styles.artworkImage}
                  contentFit="cover"
                  transition={300}
                />
              </Animated.View>

              {hasVideo && !isLocal && videoPlayerInitialized && (
                <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                  <VideoView
                    player={videoPlayer}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    nativeControls={false}
                    allowsPictureInPicture={true}
                    startsPictureInPictureAutomatically={false}
                    onPictureInPictureStart={() => {
                      isPipActiveRef.current = true;
                      console.log('[PlayerContent] VideoView PiP started');
                    }}
                    onPictureInPictureStop={() => {
                      isPipActiveRef.current = false;
                      console.log('[PlayerContent] VideoView PiP stopped');
                    }}
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

            {/* Track info - ALWAYS shows metadata, never skeleton */}
            <View style={styles.infoContainer}>
              <MovingText
                text={displayTrack.title}
                animationThreshold={20}
                style={[styles.title, { color: colors.text }]}
              />

              <ArtistLine
                rawArtist={displayTrack.artist}
                uploaderUrl={uploaderUrl}
                onArtistPress={handleArtistPress}
                colors={colors}
                isLocal={isLocal}
              />
            </View>

            {/* Action Row - Horizontal Scrollable */}
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actionRowContent}
              style={styles.actionScrollView}
            >
              {/* Like Button */}
              {!isLocal && (
                <View style={styles.actionItem}>
                  {showSkeletonForStats ? (
                    <SkeletonPulse width={60} height={24} borderRadius={20} />
                  ) : (
                    <TouchableOpacity onPress={toggleFavoriteFunc} activeOpacity={0.7}>
                      <View style={styles.iconWithCount}>
                        <Ionicons
                          name={isFavorite ? "thumbs-up" : "thumbs-up-outline"}
                          size={moderateScale(24)}
                          color={isFavorite ? colors.gold : colors.text}
                        />
                        {likeCount > 0 && (
                          <Text style={[styles.iconCountText, { color: colors.text }]}>
                            {formatCount(likeCount)}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Dislike Button */}
              {!isLocal && (
                <View style={styles.actionItem}>
                  {showSkeletonForStats ? (
                    <SkeletonPulse width={60} height={24} borderRadius={20} />
                  ) : (
                    <TouchableOpacity activeOpacity={0.7}>
                      <View style={styles.iconWithCount}>
                        <Ionicons
                          name="thumbs-down-outline"
                          size={moderateScale(24)}
                          color={colors.text}
                        />
                        {dislikeCount > 0 && (
                          <Text style={[styles.iconCountText, { color: colors.text }]}>
                            {formatCount(dislikeCount)}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Comments Button */}
              {showCommentButton && (
                <View style={styles.actionItem}>
                  {showSkeletonForStats ? (
                    <SkeletonPulse width={50} height={24} borderRadius={20} />
                  ) : (
                    <TouchableOpacity onPress={handleOpenComments} activeOpacity={0.7}>
                      <View style={styles.commentBadgeContainer}>
                        <MaterialCommunityIcons
                          name="comment-text-outline"
                          size={moderateScale(24)}
                          color={colors.text}
                        />
                        <View style={[styles.commentBadge, { backgroundColor: colors.gold }]}>
                          <Text style={styles.commentBadgeText}>{formatCount(commentsCount)}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* View Count Badge - Pill container with icon + text */}
              {!isLocal && viewCount > 0 && (
                <View style={[styles.pillContainer, styles.viewCountPill]}>
                  {showSkeletonForStats ? (
                    <SkeletonPulse width={70} height={20} borderRadius={20} />
                  ) : (
                    <>
                      <Ionicons name="play-circle-outline" size={moderateScale(18)} color={colors.textSub} />
                      <Text style={[styles.pillText, { color: colors.textSub }]}>
                        {formatCount(viewCount)} views
                      </Text>
                    </>
                  )}
                </View>
              )}

              {/* Add to Playlist Button */}
              <View style={styles.actionItem}>
                <TouchableOpacity onPress={handlePlaylist} activeOpacity={0.7}>
                  <MaterialIcons name="playlist-add" size={moderateScale(24)} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Sleep Timer Button */}
              <View style={styles.actionItem}>
                <TouchableOpacity onPress={handleSleepTimer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="weather-night" size={moderateScale(22)} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Download + Share Combined Pill Container */}
              {!isLocal && displayTrack.id !== DUMMY_TRACK.id && (
                <View style={[styles.pillContainer, styles.actionPill]}>
                  {/* Download Button */}
                  <DownloadButtonWithProgress
                    trackId={displayTrack.id}
                    trackTitle={displayTrack.title}
                    trackArtist={displayTrack.artist}
                    trackDuration={displayTrack.duration}
                    trackUrl={displayTrack.url}
                    trackThumbnail={displayTrack.thumbnail}
                    iconSize={20}
                  />

                  {/* Divider between download and share */}
                  <View style={[styles.pillDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />

                  {/* Share Button with curved arrow icon */}
                  <TouchableOpacity onPress={handleShare} activeOpacity={0.7}>
                    <Ionicons name="arrow-redo-outline" size={moderateScale(20)} color={colors.text} />
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            {/* Slider */}
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
                      {formatTime(slidingValue.value * visualDurationSec)}
                    </Text>
                  </View>
                )}
                renderThumb={() => (
                  <View style={[styles.sliderThumb, { backgroundColor: colors.gold }]} />
                )}
                theme={{
                  minimumTrackTintColor: colors.gold,
                  maximumTrackTintColor: colors.sliderTrack,
                }}
                onSlidingStart={() => {
                  isSliding.value = true;
                  isSlidingRef.current = true;
                  if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
                  setSliderActive(true);
                }}
                onValueChange={(v) => {
                  slidingValue.value = v;
                }}
                onSlidingComplete={(v) => {
                  sliderProgress.value = v;
                  isSliding.value = false;
                  setSliderActive(false);
                  runOnJS(handleSeek)(v);
                }}
              />

              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: colors.textSub }]}>
                  {formatTime(visualPositionSec)}
                </Text>
                <Text style={[styles.timeText, { color: colors.textSub }]}>
                  {formatTime(visualDurationSec)}
                </Text>
              </View>
            </View>

            {/* Transport controls */}
            <View style={styles.controls}>
              <TouchableOpacity
                onPress={handleToggleShuffle}
                style={styles.shuffleWrapper}
                activeOpacity={0.7}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Feather
                  name="shuffle"
                  size={20}
                  color={shuffleMode === 'off' ? colors.textMuted : colors.gold}
                />
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
                disabled={showSkeletonForStats || displayTrack.id === DUMMY_TRACK.id}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                {showSkeletonForStats ? (
                  <ActivityIndicator size="large" color={colors.textInverse} />
                ) : (
                  <Ionicons
                    name={visualIsPlaying ? 'pause' : 'play'}
                    size={32}
                    color={colors.textInverse}
                  />
                )}
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

            {/* Bottom tabs */}
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

      {/* Modals */}
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
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

  actionScrollView: {
    flexGrow: 0,
    marginVertical: verticalScale(8),
  },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    gap: scale(16),
  },
  actionItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pill container styles (replaces viewCountItem)
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    gap: scale(8),
  },
  viewCountPill: {
    gap: scale(6),
  },
  actionPill: {
    gap: scale(10),
  },
  pillDivider: {
    width: 1,
    height: verticalScale(16),
  },
  pillText: {
    fontSize: moderateScale(11),
    fontWeight: '500',
  },
  iconWithCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(4),
  },
  iconCountText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
  commentBadgeContainer: {
    position: 'relative',
  },
  commentBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    borderRadius: scale(10),
    minWidth: scale(18),
    height: scale(18),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(4),
  },
  commentBadgeText: {
    color: '#000',
    fontSize: moderateScale(9),
    fontWeight: '700',
  },

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

  bottomTabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: verticalScale(32),
    paddingBottom: verticalScale(5),
  },
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