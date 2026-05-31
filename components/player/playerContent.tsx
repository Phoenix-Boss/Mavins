// components/player/playerContent.tsx
//
// ANDROID-ONLY: All iOS-specific code removed
// MASTER-SLAVE ARCHITECTURE - Master always plays audio, Slave only provides muted video
//
// ARCHITECTURE:
//   MASTER PLAYER (Hidden): expo-video instance that ALWAYS plays audio
//   - Never paused (unless user explicitly pauses)
//   - Never muted
//   - Source of truth for all playback
//   - Active regardless of which tab is visible
//
//   SLAVE PLAYER (Visible): Second expo-video instance for video rendering ONLY
//   - ALWAYS MUTED - provides only video frames
//   - Visible only on video tab
//   - Seeks to master position on tab switch
//   - Play/pause follows master's state
//   - Never outputs audio
//
//   VIDEO OFFSET STRATEGY: When switching to video tab, slave seeks to master position + 5 seconds
//   - Video stays ahead of audio to prevent sync issues
//   - Progress bar always shows master position (audio)
//   - Only master player triggers track finish
//   - If offset drops below 2 seconds, auto re-sync

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
import { Colors } from '@/constants/Colors';

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
  getCachedTrackExtrasSync,
  useTrackExtrasVersion,
  setMasterPlayer,
  setPreferredStreamType,
} from '@/libs/playerSetup';

import { useGestureContext } from '@/libs/gestureContext';
import { downloadAndSaveSong } from '@/services/download';
import { useIsSongDownloaded, useIsSongDownloading } from '@/store/library';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Storage key for download cooldown
const DOWNLOAD_COOLDOWN_KEY = '@download_cooldown';
const COOLDOWN_HOURS = 24;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

// Video offset constants (5 seconds ahead of audio)
const VIDEO_OFFSET_SECONDS = 5;
const MIN_OFFSET_THRESHOLD = 2; // Re-sync if offset drops below 2 seconds
const OFFSET_SYNC_INTERVAL_MS = 2000; // Check offset every 2 seconds

// Retry constants for 403 errors
const MAX_RETRY_COUNT = 2;
const RETRY_DELAY_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL MASTER AUDIO PLAYER SINGLETON (expo-video, hidden)
// ALWAYS plays audio - NEVER muted - source of truth for ALL playback
// ─────────────────────────────────────────────────────────────────────────────
const MASTER_PLAYER_GLOBAL_KEY = '__MavinAudioMasterPlayer__';

if (!(global as any)[MASTER_PLAYER_GLOBAL_KEY]) {
  (global as any)[MASTER_PLAYER_GLOBAL_KEY] = createVideoPlayer(null);
  console.log('[PlayerContent] Created MASTER audio player singleton');
}

const masterPlayer: ReturnType<typeof createVideoPlayer> =
  (global as any)[MASTER_PLAYER_GLOBAL_KEY];

try {
  masterPlayer.muted = false;  // MASTER NEVER MUTED - always provides audio
  masterPlayer.loop = false;
  masterPlayer.staysActiveInBackground = true;
  masterPlayer.volume = 1.0;
  console.log('[PlayerContent] MASTER player configured - unmuted, volume=1.0');
} catch (e) {
  console.warn('[PlayerContent] Failed to configure MASTER player:', e);
}

// Register master player with context at module level
setMasterPlayer(masterPlayer);
(global as any).__MavinMasterPlayer__ = masterPlayer;
(global as any).__MavinAudioPlayer__ = masterPlayer;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL SLAVE VIDEO PLAYER SINGLETON (expo-video, visible)
// ALWAYS MUTED - provides ONLY video frames, NO audio output
// ─────────────────────────────────────────────────────────────────────────────
const SLAVE_PLAYER_GLOBAL_KEY = '__MavinVideoSlavePlayer__';

if (!(global as any)[SLAVE_PLAYER_GLOBAL_KEY]) {
  (global as any)[SLAVE_PLAYER_GLOBAL_KEY] = createVideoPlayer(null);
  console.log('[PlayerContent] Created SLAVE video player singleton');
}

const slavePlayer: ReturnType<typeof createVideoPlayer> =
  (global as any)[SLAVE_PLAYER_GLOBAL_KEY];

try {
  slavePlayer.muted = true;   // SLAVE ALWAYS MUTED - only for video frames
  slavePlayer.loop = false;
  slavePlayer.staysActiveInBackground = false;
  slavePlayer.volume = 0.0;   // Zero volume ensures no audio
  console.log('[PlayerContent] SLAVE player configured - muted, volume=0.0');
} catch (e) {
  console.warn('[PlayerContent] Failed to configure SLAVE player:', e);
}

(global as any).__MavinSlavePlayer__ = slavePlayer;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL GLOBAL COMMANDS (registered once)
// ─────────────────────────────────────────────────────────────────────────────
if (!(global as any).__mavinCommandsRegistered) {
  (global as any).__mavinMasterPlay = () => {
    try { masterPlayer.play(); } catch (e) { console.warn('[Global] Master play failed:', e); }
  };
  (global as any).__mavinMasterPause = () => {
    try { masterPlayer.pause(); } catch (e) { console.warn('[Global] Master pause failed:', e); }
  };
  (global as any).__mavinMasterSeek = (position: number) => {
    try { masterPlayer.currentTime = position; } catch (e) { console.warn('[Global] Master seek failed:', e); }
  };
  (global as any).__mavinMasterGetState = () => {
    try {
      return {
        isPlaying: masterPlayer.playing ?? false,
        position: masterPlayer.currentTime ?? 0,
        duration: masterPlayer.duration ?? 0,
      };
    } catch (e) {
      return { isPlaying: false, position: 0, duration: 0 };
    }
  };
  (global as any).__mavinCommandsRegistered = true;
  console.log('[PlayerContent] Global commands registered');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LYRICS_LEAD_IN_S = 0.25;
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
// Download Button Component
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
              borderWidth: 3,
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
                borderWidth: 3,
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
  const [extras, setExtras] = useState<Record<string, any>>(() => {
    const id = engine.currentTrack?.id;
    if (!id || id === DUMMY_TRACK.id) return {};
    return getCachedTrackExtrasSync(id) ?? getTrackExtras(id) ?? {};
  });

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) {
      setExtras({});
      return;
    }
    const synced = getCachedTrackExtrasSync(id) ?? getTrackExtras(id) ?? {};
    setExtras(synced);
  }, [displayTrack?.id, trackExtrasVersion]);

  const liveExtras = (displayTrack?.id && displayTrack.id !== DUMMY_TRACK.id)
    ? (getTrackExtras(displayTrack.id) ?? getCachedTrackExtrasSync(displayTrack.id) ?? extras)
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

  const showSkeletonForStats = musicPlayerLoading || isResolving || (engine.isBuffering && !isPlaying && durationSec === 0);

  // ── TAB STATE WITH VIDEO OFFSET ─────────────────────────────────────────────
  const [activeSegment, setActiveSegment] = useState<'song' | 'video'>('song');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [masterReady, setMasterReady] = useState(false);
  const [slaveReady, setSlaveReady] = useState(false);
  const [videoOffset, setVideoOffset] = useState(0); // Current offset applied to video
  const [showOffsetIndicator, setShowOffsetIndicator] = useState(false);
  
  const isTransitioning = useRef(false);
  const activeSegmentRef = useRef<'song' | 'video'>('song');
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);
  const offsetSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Track play states
  const masterPlayingRef = useRef(false);
  const slavePlayingRef = useRef(false);
  const videoEndedRef = useRef(false);

  useEffect(() => { positionRef.current = positionSec; }, [positionSec]);
  useEffect(() => { durationRef.current = durationSec; }, [durationSec]);

  const [visualIsPlaying, setVisualIsPlaying] = useState(isPlaying);
  const [visualPositionSec, setVisualPositionSec] = useState(positionSec);
  const [visualDurationSec, setVisualDurationSec] = useState(durationSec);

  useEffect(() => {
    setVisualIsPlaying(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    setVisualPositionSec(positionSec);
    if (durationSec > 0 && visualDurationSec !== durationSec) {
      setVisualDurationSec(durationSec);
    }
  }, [positionSec, durationSec]);

  // Helper function to calculate video seek position with offset
  const calculateVideoSeekPosition = useCallback((audioPosition: number, videoDur: number): number => {
    if (!videoDur || videoDur <= 0) return 0;
    // Add 5 seconds offset, but don't exceed video duration minus 0.5 seconds
    let seekPos = audioPosition + VIDEO_OFFSET_SECONDS;
    if (seekPos >= videoDur - 0.5) {
      seekPos = Math.max(0, videoDur - 0.5);
    }
    return seekPos;
  }, []);

  // Function to sync slave to master with offset
  const syncSlaveWithOffset = useCallback(async (audioPosition: number, forceSync: boolean = false) => {
    if (!slaveReady || activeSegmentRef.current !== 'video') return;
    
    try {
      const videoDuration = slavePlayer.duration ?? 0;
      if (videoDuration <= 0) return;
      
      const currentVideoPosition = slavePlayer.currentTime ?? 0;
      const targetVideoPosition = calculateVideoSeekPosition(audioPosition, videoDuration);
      const currentOffset = currentVideoPosition - audioPosition;
      
      // Check if offset has dropped below threshold (video falling behind)
      if (!forceSync && currentOffset < MIN_OFFSET_THRESHOLD && currentOffset > -1) {
        console.log(`[PlayerContent] Offset low: ${currentOffset.toFixed(2)}s, re-syncing video`);
        slavePlayer.currentTime = targetVideoPosition;
        setVideoOffset(VIDEO_OFFSET_SECONDS);
        setShowOffsetIndicator(true);
        setTimeout(() => setShowOffsetIndicator(false), 2000);
      } else if (forceSync) {
        slavePlayer.currentTime = targetVideoPosition;
        setVideoOffset(VIDEO_OFFSET_SECONDS);
      }
      
      // Ensure slave play state matches master
      if (masterPlayingRef.current !== slavePlayingRef.current) {
        if (masterPlayingRef.current) {
          await slavePlayer.play();
          slavePlayingRef.current = true;
        } else {
          await slavePlayer.pause();
          slavePlayingRef.current = false;
        }
      }
    } catch (err) {
      console.warn('[PlayerContent] Sync slave error:', err);
    }
  }, [slaveReady, calculateVideoSeekPosition]);

  // Offset sync interval - runs every 2 seconds when video tab is active
  useEffect(() => {
    if (activeSegment === 'video' && slaveReady && masterReady) {
      if (offsetSyncIntervalRef.current) clearInterval(offsetSyncIntervalRef.current);
      
      offsetSyncIntervalRef.current = setInterval(() => {
        const currentAudioPos = masterPlayer.currentTime ?? positionRef.current;
        syncSlaveWithOffset(currentAudioPos, false);
      }, OFFSET_SYNC_INTERVAL_MS);
      
      return () => {
        if (offsetSyncIntervalRef.current) {
          clearInterval(offsetSyncIntervalRef.current);
          offsetSyncIntervalRef.current = null;
        }
      };
    } else {
      if (offsetSyncIntervalRef.current) {
        clearInterval(offsetSyncIntervalRef.current);
        offsetSyncIntervalRef.current = null;
      }
    }
  }, [activeSegment, slaveReady, masterReady, syncSlaveWithOffset]);

  // retryMasterLoad and retrySlaveLoad intentionally removed.
  // MusicPlayerContext owns all master retries. PlayerContent never touches master.replaceAsync.

  // ── MASTER PLAYER STATUS LISTENER ───────────────────────────────────────────
  useEffect(() => {
    if (!masterPlayer) return;

    let statusListener: any = null;
    let playingListener: any = null;

    try {
      statusListener = masterPlayer.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') {
          setMasterReady(true);
          setVideoError(null);
          videoEndedRef.current = false;
        } else if (status === 'error') {
          const errMsg = error?.message || '';
          // 403 errors on the master are handled by MusicPlayerContext (moduleLevelLoadAndPlay).
          // PlayerContent must NOT retry the master independently — doing so causes a double-load
          // conflict that produces the start→stop→start loop. Suppress 403 errors silently.
          if (errMsg.includes('403')) {
            console.log('[PlayerContent] Master 403 suppressed — context handles retry');
            return;
          }
          console.error('[PlayerContent] MASTER player error:', errMsg);
          setVideoError(errMsg || 'Playback error');
        }
      });
      
      playingListener = masterPlayer.addListener('playingChange', ({ isPlaying: mPlaying }: any) => {
        masterPlayingRef.current = mPlaying;
        setVisualIsPlaying(mPlaying);
        
        // Sync slave's play state to match master
        if (slaveReady && slavePlayingRef.current !== mPlaying) {
          if (mPlaying) {
            slavePlayer.play();
            slavePlayingRef.current = true;
          } else {
            slavePlayer.pause();
            slavePlayingRef.current = false;
          }
        }
        
        // Industry-standard end detection:
        // ONLY trigger skip when ALL three conditions are true:
        //   1. Playback just stopped (mPlaying === false)
        //   2. We are genuinely near the end (currentTime >= duration - 0.5)
        //   3. duration is known and > 0 (rules out false fires during load/buffering)
        //   4. Track has played for at least 5 seconds (rules out load-time pauses)
        //   5. We haven't already handled this finish
        const masterDuration = masterPlayer.duration ?? 0;
        const masterPosition = masterPlayer.currentTime ?? 0;
        const isGenuineEnd =
          !mPlaying &&
          !videoEndedRef.current &&
          masterDuration > 0 &&
          masterPosition > 5 &&
          masterPosition >= masterDuration - 0.5;

        if (isGenuineEnd) {
          console.log('[PlayerContent] Master reached end, skipping to next');
          videoEndedRef.current = true;
          engine.skipToNext();
        }
      });
    } catch (e) {
      console.error('[PlayerContent] Failed to add MASTER listeners:', e);
    }

    return () => {
      try {
        statusListener?.remove?.();
        playingListener?.remove?.();
      } catch {}
    };
    // NOTE: engine and slaveReady are stable refs; activeVideoUrl/masterRetryCount/retryMasterLoad
    // intentionally removed — master 403 retries are owned by MusicPlayerContext, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, slaveReady]);

  // ── SLAVE PLAYER STATUS LISTENER ────────────────────────────────────────────
  useEffect(() => {
    if (!slavePlayer) return;

    let statusListener: any = null;
    let playingListener: any = null;

    try {
      statusListener = slavePlayer.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') {
          setSlaveReady(true);
          try { slavePlayer.muted = true; slavePlayer.volume = 0; } catch {}
        } else if (status === 'error') {
          const errMsg = error?.message || '';
          // Only surface video errors when the user is actually on the video tab
          if (activeSegmentRef.current === 'video') {
            console.warn('[PlayerContent] SLAVE player error (video tab active):', errMsg);
            setVideoError(errMsg || 'Video unavailable');
          } else {
            // Slave errors on audio tab are silent — video tab will re-load on switch
            console.log('[PlayerContent] Slave error suppressed (not on video tab):', errMsg);
          }
          setSlaveReady(false);
        }
      });
      
      playingListener = slavePlayer.addListener('playingChange', ({ isPlaying: sPlaying }: any) => {
        slavePlayingRef.current = sPlaying;
        updateVideoIsPlaying(sPlaying);
      });
    } catch (e) {
      console.error('[PlayerContent] Failed to add SLAVE listeners:', e);
    }

    return () => {
      try {
        statusListener?.remove?.();
        playingListener?.remove?.();
      } catch {}
    };
    // slavePlayer is a module-level singleton; activeVideoUrl/slaveRetryCount/retrySlaveLoad
    // intentionally removed — slave retry logic lives in loadSlaveStream, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateVideoIsPlaying]);

  // ── LOAD SLAVE STREAM WHEN TRACK CHANGES ────────────────────────────────────
  // IMPORTANT: MusicPlayerContext (moduleLevelLoadAndPlay) OWNS the MASTER player.
  // It resolves the URL, calls master.replaceAsync(), and master.play() itself.
  // PlayerContent must NEVER call master.replaceAsync() — doing so interrupts the
  // already-playing audio and causes the start→stop→start→stop loop.
  //
  // PlayerContent is ONLY responsible for loading the SLAVE (muted, video-only)
  // player so the video tab is ready when the user switches to it.
  const loadSlaveStream = useCallback(async () => {
    if (!activeVideoUrl || isLocal) return;

    console.log('[PlayerContent] Pre-loading slave (video-only) stream');

    try {
      setSlaveReady(false);
      slavePlayer.replace({ uri: activeVideoUrl });
      slavePlayer.muted = true;
      slavePlayer.volume = 0;

      const pollStart = Date.now();
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (slavePlayer.status === 'readyToPlay') {
            setSlaveReady(true);
            resolve();
            return;
          }
          if (Date.now() - pollStart >= 8000) {
            resolve();
            return;
          }
          setTimeout(poll, 200);
        };
        poll();
      });
      console.log('[PlayerContent] Slave stream pre-loaded');
    } catch (e: any) {
      // Non-fatal: slave failure only means video tab unavailable; audio continues
      console.warn('[PlayerContent] Slave pre-load failed (non-fatal):', e?.message);
    }
  }, [activeVideoUrl, isLocal]);

  useEffect(() => {
    loadSlaveStream();
  }, [loadSlaveStream]);

  // ── HANDLE PLAY/PAUSE - Controls MASTER only, slave follows ──────────────────
  const handlePlayPause = useCallback(async () => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;

    const willPlay = !visualIsPlaying;
    setVisualIsPlaying(willPlay);

    if (willPlay) {
      await masterPlayer.play();
      masterPlayingRef.current = true;
    } else {
      await masterPlayer.pause();
      masterPlayingRef.current = false;
    }
    
    if (willPlay) {
      engine.play();
    } else {
      engine.pause();
    }
  }, [displayTrack, visualIsPlaying, engine]);

  // ── SEGMENT SWITCH WITH VIDEO OFFSET ────────────────────────────────────────
  const handleSegmentPress = useCallback(
    async (seg: 'song' | 'video') => {
      if (seg === 'video' && (!hasVideo || displayTrack.id === DUMMY_TRACK.id || videoError || isLocal)) {
        if (videoError) {
          console.log('[PlayerContent] Video unavailable:', videoError);
        }
        return;
      }

      if (isTransitioning.current) return;
      isTransitioning.current = true;
      triggerHaptic();

      console.log(`[PlayerContent] Switching to "${seg}" tab`);

      try {
        if (seg === 'video') {
          // ── SWITCHING TO VIDEO TAB ─────────────────────────────────────────────
          console.log('[PlayerContent] → VIDEO tab');
          
          const currentAudioPosition = masterPlayer.currentTime ?? positionRef.current;
          const videoDuration = slavePlayer.duration ?? 0;
          
          console.log(`[PlayerContent] Audio position: ${currentAudioPosition.toFixed(2)}s`);
          
          // Calculate video position with 5-second offset
          let videoSeekPosition = currentAudioPosition + VIDEO_OFFSET_SECONDS;
          if (videoSeekPosition >= videoDuration - 0.5) {
            videoSeekPosition = Math.max(0, videoDuration - 0.5);
            console.log(`[PlayerContent] Video near end, clamping to ${videoSeekPosition.toFixed(2)}s`);
          }
          
          console.log(`[PlayerContent] Video will seek to +${VIDEO_OFFSET_SECONDS}s: ${videoSeekPosition.toFixed(2)}s`);
          
          // Ensure slave is ready (load on demand if pre-load didn't finish)
          if (!slaveReady && activeVideoUrl) {
            console.log('[PlayerContent] Loading slave stream on video tab switch...');
            try {
              slavePlayer.replace({ uri: activeVideoUrl });
              slavePlayer.muted = true;
              slavePlayer.volume = 0;
              setSlaveReady(true);
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e) {
              console.warn('[PlayerContent] Slave load on switch failed:', e);
            }
          }
          
          // Seek slave to offset position
          if (slaveReady) {
            slavePlayer.currentTime = videoSeekPosition;
            setVideoOffset(VIDEO_OFFSET_SECONDS);
            
            // Show offset indicator briefly
            setShowOffsetIndicator(true);
            setTimeout(() => setShowOffsetIndicator(false), 2000);
            
            // Start slave playing if master is playing
            if (masterPlayingRef.current) {
              await slavePlayer.play();
              slavePlayingRef.current = true;
            } else {
              await slavePlayer.pause();
              slavePlayingRef.current = false;
            }
          }
          
          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          setVideoActive(true);
          setVideoError(null);
          
          console.log(`[PlayerContent] Video tab active, position: ${videoSeekPosition.toFixed(2)}s (audio at ${currentAudioPosition.toFixed(2)}s)`);
          
        } else {
          // ── SWITCHING TO SONG TAB ─────────────────────────────────────────────
          console.log('[PlayerContent] → SONG tab');
          
          // Hide slave player (pause to save resources)
          if (slaveReady) {
            await slavePlayer.pause();
            slavePlayingRef.current = false;
          }
          
          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          setVideoActive(false);
          setVideoOffset(0);
          
          console.log('[PlayerContent] Song tab active, master continues playing');
        }
      } catch (err) {
        console.error('[PlayerContent] Segment switch error:', err);
      } finally {
        setTimeout(() => {
          isTransitioning.current = false;
        }, 500);
      }
    },
    [hasVideo, displayTrack.id, videoError, isLocal, activeVideoUrl, slaveReady, slavePlayer, masterPlayer, masterPlayingRef],
  );

  // ── SEEK HANDLER - maintains offset when on video tab ────────────────────────
  const handleSeek = useCallback(async (position: number) => {
    if (durationSec <= 0) return;
    
    const clampedPosition = Math.max(0, Math.min(position, durationSec));
    console.log(`[PlayerContent] Seeking to ${clampedPosition.toFixed(2)}s`);
    
    // Seek master player
    masterPlayer.currentTime = clampedPosition;
    
    // If on video tab, seek slave with offset
    if (activeSegment === 'video' && slaveReady) {
      const videoDuration = slavePlayer.duration ?? 0;
      let videoSeekPosition = clampedPosition + VIDEO_OFFSET_SECONDS;
      if (videoSeekPosition >= videoDuration - 0.5) {
        videoSeekPosition = Math.max(0, videoDuration - 0.5);
      }
      slavePlayer.currentTime = videoSeekPosition;
      console.log(`[PlayerContent] Slave seeked to ${videoSeekPosition.toFixed(2)}s (+${VIDEO_OFFSET_SECONDS}s offset)`);
      
      // Show offset indicator briefly
      setShowOffsetIndicator(true);
      setTimeout(() => setShowOffsetIndicator(false), 1500);
    }
    
    engine.seekTo(clampedPosition);
  }, [durationSec, activeSegment, slaveReady, engine]);

  // ── HANDLE SKIP NEXT - respects current tab ─────────────────────────────────
  const handleSkipNext = useCallback(async () => {
    triggerHaptic();
    
    // Update preferred stream type based on active tab
    setPreferredStreamType(activeSegment === 'video' ? 'video' : 'audio');
    
    await engine.skipToNext();
    
    // After skip, if on video tab, re-apply offset once new track loads
    if (activeSegment === 'video' && slaveReady) {
      setTimeout(async () => {
        const newAudioPos = masterPlayer.currentTime ?? 0;
        const videoDuration = slavePlayer.duration ?? 0;
        let videoSeekPos = newAudioPos + VIDEO_OFFSET_SECONDS;
        if (videoSeekPos >= videoDuration - 0.5) {
          videoSeekPos = Math.max(0, videoDuration - 0.5);
        }
        slavePlayer.currentTime = videoSeekPos;
        if (masterPlayingRef.current) {
          await slavePlayer.play();
        }
        console.log(`[PlayerContent] Post-skip sync: video at ${videoSeekPos.toFixed(2)}s`);
      }, 300);
    }
  }, [activeSegment, slaveReady, engine]);

  // ── HANDLE SKIP PREVIOUS - respects current tab ─────────────────────────────
  const handleSkipPrevious = useCallback(async () => {
    triggerHaptic();
    
    setPreferredStreamType(activeSegment === 'video' ? 'video' : 'audio');
    
    await engine.skipToPrevious();
    
    if (activeSegment === 'video' && slaveReady) {
      setTimeout(async () => {
        const newAudioPos = masterPlayer.currentTime ?? 0;
        const videoDuration = slavePlayer.duration ?? 0;
        let videoSeekPos = newAudioPos + VIDEO_OFFSET_SECONDS;
        if (videoSeekPos >= videoDuration - 0.5) {
          videoSeekPos = Math.max(0, videoDuration - 0.5);
        }
        slavePlayer.currentTime = videoSeekPos;
        if (masterPlayingRef.current) {
          await slavePlayer.play();
        }
      }, 300);
    }
  }, [activeSegment, slaveReady, engine]);

  // ── TRACK CHANGE RESET ──────────────────────────────────────────────────────
  useEffect(() => {
    setMasterReady(false);
    setSlaveReady(false);
    // NOTE: masterPlayingRef and slavePlayingRef are NOT reset here.
    // The context calls master.play() immediately after loading — resetting these refs
    // to false here causes the slave sync logic to pause the slave right after play starts.
    // Let the playingChange listener update them naturally.
    setActiveSegment('song');
    activeSegmentRef.current = 'song';
    setVideoError(null);
    setVideoOffset(0);
    setShowOffsetIndicator(false);
    setVisualPositionSec(0);
    setVisualDurationSec(0);
    setVideoActive(false);
    updateVideoPosition(0);
    updateVideoDuration(0);
    updateVideoIsPlaying(false);
    // NOTE: setVisualIsPlaying is NOT reset to false here.
    // Resetting it causes a visible "stop" flash in the UI even though audio keeps playing.
    // The playingChange listener and isPlaying prop keep it in sync correctly.
    videoEndedRef.current = false;
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

  const handleSliderSeek = useCallback(
    (fraction: number) => {
      if (durationSec <= 0) return;
      const seekPosition = fraction * durationSec;
      
      if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = setTimeout(() => {
        isSlidingRef.current = false;
      }, 1500);
      
      handleSeek(seekPosition);
      setVisualPositionSec(seekPosition);
    },
    [durationSec, handleSeek],
  );

  const handleSkipBack = useCallback(async () => {
    triggerHaptic();
    await handleSkipPrevious();
  }, [handleSkipPrevious]);

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

  const artworkSource =
    typeof displayTrack?.thumbnail === 'string' && displayTrack.thumbnail
      ? { uri: displayTrack.thumbnail }
      : require('@/assets/images/mavins.png');

  const getRepeatIcon = () => {
    // 'repeat-off' is NOT a valid MaterialCommunityIcons name — use 'repeat' for all states.
    // The color (muted vs gold) distinguishes off vs on. The "1" badge handles repeat-one visually.
    if (repeatMode === 'one') return 'repeat-once';
    return 'repeat'; // covers both 'off' (muted color) and 'all' (gold color)
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

  const showSlavePlayer = hasVideo && !isLocal && activeSegment === 'video' && slaveReady;

  // Update visual position from master (polling for smooth UI)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    
    if (masterReady) {
      interval = setInterval(() => {
        try {
          const pos = masterPlayer.currentTime ?? 0;
          const dur = masterPlayer.duration ?? 0;
          setVisualPositionSec(pos);
          if (dur > 0) setVisualDurationSec(dur);
          updateVideoPosition(pos);
          updateVideoDuration(dur);
          setVisualIsPlaying(masterPlayingRef.current);
        } catch {}
      }, 250);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [masterReady, updateVideoPosition, updateVideoDuration]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
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

              {showSlavePlayer && (
                <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                  <VideoView
                    player={slavePlayer}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    nativeControls={false}
                    allowsPictureInPicture={true}
                    startsPictureInPictureAutomatically={false}
                    onPictureInPictureStart={() => {
                      console.log('[PlayerContent] PiP started');
                    }}
                    onPictureInPictureStop={() => {
                      console.log('[PlayerContent] PiP stopped');
                      if (masterPlayingRef.current && slaveReady) {
                        const currentAudioPos = masterPlayer.currentTime ?? 0;
                        const videoDuration = slavePlayer.duration ?? 0;
                        let videoSeekPos = currentAudioPos + VIDEO_OFFSET_SECONDS;
                        if (videoSeekPos >= videoDuration - 0.5) {
                          videoSeekPos = Math.max(0, videoDuration - 0.5);
                        }
                        slavePlayer.currentTime = videoSeekPos;
                        slavePlayer.play();
                      }
                    }}
                  />
                  {/* Offset Indicator */}
                  {showOffsetIndicator && activeSegment === 'video' && (
                    <View style={[styles.offsetIndicator, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                      <Text style={styles.offsetIndicatorText}>+{VIDEO_OFFSET_SECONDS}s ahead</Text>
                    </View>
                  )}
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

            {/* Track info */}
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

            {/* Action Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actionRowContent}
              style={styles.actionScrollView}
            >
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

              <View style={styles.actionItem}>
                <TouchableOpacity onPress={handlePlaylist} activeOpacity={0.7}>
                  <MaterialIcons name="playlist-add" size={moderateScale(24)} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity onPress={handleSleepTimer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="weather-night" size={moderateScale(22)} color={colors.text} />
                </TouchableOpacity>
              </View>

              {!isLocal && displayTrack.id !== DUMMY_TRACK.id && (
                <View style={[styles.pillContainer, styles.actionPill]}>
                  <DownloadButtonWithProgress
                    trackId={displayTrack.id}
                    trackTitle={displayTrack.title}
                    trackArtist={displayTrack.artist}
                    trackDuration={displayTrack.duration}
                    trackUrl={displayTrack.url}
                    trackThumbnail={displayTrack.thumbnail}
                    iconSize={20}
                  />
                  <View style={[styles.pillDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
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
                  runOnJS(handleSliderSeek)(v);
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
// At the top of playerContent.tsx, ensure Colors is imported


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

  actionScrollView: { flexGrow: 0, marginVertical: verticalScale(8) },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    gap: scale(16),
  },
  actionItem: { alignItems: 'center', justifyContent: 'center' },
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    gap: scale(8),
  },
  viewCountPill: { gap: scale(6) },
  actionPill: { gap: scale(10) },
  pillDivider: { width: 1, height: verticalScale(16) },
  pillText: { fontSize: moderateScale(11), fontWeight: '500' },
  iconWithCount: { flexDirection: 'row', alignItems: 'center', gap: scale(4) },
  iconCountText: { fontSize: moderateScale(11), fontWeight: '600' },
  commentBadgeContainer: { position: 'relative' },
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
  commentBadgeText: { color: '#000', fontSize: moderateScale(9), fontWeight: '700' },

  progressWrapper: { marginTop: verticalScale(20) },
  sliderThumb: { width: moderateScale(15), height: moderateScale(15), borderRadius: moderateScale(15) / 2 },
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
  bigPlay: { width: scale(65), height: scale(65), borderRadius: 32.5, justifyContent: 'center', alignItems: 'center' },
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
  videoErrorText: { fontSize: moderateScale(14), fontWeight: '600', marginTop: verticalScale(8), textAlign: 'center', paddingHorizontal: scale(16) },
  videoErrorSubtext: { fontSize: moderateScale(12), marginTop: verticalScale(4), textAlign: 'center' },
  
  offsetIndicator: {
    position: 'absolute',
    top: verticalScale(16),
    right: scale(16),
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  offsetIndicatorText: {
    color: Colors.gold,
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
});