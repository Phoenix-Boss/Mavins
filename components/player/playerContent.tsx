// components/player/playerContent.tsx
//
// ANDROID-ONLY: All iOS-specific code removed
// ARCHITECTURE v13.0 - SINGLE NEWPLAYER INSTANCE WITH NATIVE VIDEO SURFACE
//
// SINGLE PLAYER ARCHITECTURE: One NewPlayer (ExoPlayer) instance handles ALL playback.
//   - Audio plays through NewPlayer with YouTube headers via OkHttpDataSource.Factory
//   - Video renders through native MavinPlayerVideoView component (exported from MavinPlayer)
//   - Tab switching simply shows/hides the video surface - no second player, no offset seeking
//   - The same NewPlayer instance continues playing seamlessly when video surface attaches/detaches
//
// LOCAL TRACKS: expo-video master player (kept for local file playback only)
//   - For downloaded songs and content URIs
//   - NewPlayer handles all remote YouTube tracks
//
// STATE: All playback state comes from MusicPlayerContext (which bridges NewPlayer events)
//   - isPlaying, position, duration, bufferedPosition from context
//   - No local state for video loading, seeking, or sync
//
// VIDEO SURFACE: MavinPlayerVideoView (native ExoPlayer PlayerView)
//   - Imported from the native module's default export
//   - Visible only on video tab
//   - Automatically attaches to the existing NewPlayer instance when rendered
//   - Detaches when hidden - player continues audio-only
//   - No separate loading, no offset, no sync logic, no manifest re-fetch

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
  ActivityIndicator,
  ScrollView,
  Share,
  ToastAndroid,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { createVideoPlayer } from 'expo-video';
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
  getCachedTrackExtrasSync,
  useTrackExtrasVersion,
  setMasterPlayer,
  setPreferredStreamType,
  formatTime,
  formatCount,
  parseArtists,
  formatArtistName,
  isLocalTrack as checkIsLocalTrack,
} from '@/libs/playerSetup';

import { useGestureContext } from '@/libs/gestureContext';
import { downloadAndSaveSong } from '@/services/download';
import { useIsSongDownloaded, useIsSongDownloading } from '@/store/library';

// FIX: Import MavinPlayer and MavinPlayerVideoView correctly from the native module
// The native module exports MavinPlayer as default and MavinPlayerVideoView as a named export
import MavinPlayer, { MavinPlayerVideoView } from '@/modules/mavin-player';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Storage key for download cooldown
const DOWNLOAD_COOLDOWN_KEY = '@download_cooldown';
const COOLDOWN_HOURS = 24;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

// Manifest load timeout kept for local-track master player path
const MANIFEST_LOAD_TIMEOUT_MS = 15000;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL MASTER AUDIO PLAYER SINGLETON (expo-video, hidden)
// ONLY for LOCAL tracks (downloaded songs, content URIs)
// For remote tracks, NewPlayer handles everything.
// ─────────────────────────────────────────────────────────────────────────────
const MASTER_PLAYER_GLOBAL_KEY = '__MavinAudioMasterPlayer__';

if (!(global as any)[MASTER_PLAYER_GLOBAL_KEY]) {
  (global as any)[MASTER_PLAYER_GLOBAL_KEY] = createVideoPlayer(null);
  console.log('[PlayerContent] Created MASTER audio player singleton');
}

const masterPlayer: ReturnType<typeof createVideoPlayer> =
  (global as any)[MASTER_PLAYER_GLOBAL_KEY];

try {
  masterPlayer.muted = false;
  masterPlayer.loop = false;
  masterPlayer.staysActiveInBackground = true;
  masterPlayer.volume = 1.0;
  masterPlayer.timeUpdateEventInterval = 0.25;
  masterPlayer.audioMixingMode = 'doNotMix';
  console.log('[PlayerContent] MASTER player configured - unmuted, volume=1.0');
} catch (e) {
  console.warn('[PlayerContent] Failed to configure MASTER player:', e);
}

setMasterPlayer(masterPlayer);
(global as any).__MavinMasterPlayer__ = masterPlayer;
(global as any).__MavinAudioPlayer__ = masterPlayer;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LYRICS_LEAD_IN_S = 0.25;

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

  if (!artists.length) return <Text style={[styles.artist, { color: colors.textMuted }]}>—</Text>;

  return (
    <Text style={[styles.artist, { color: colors.textMuted }]}>
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
            {idx > 0 && <Text style={[styles.artistSeparator, { color: colors.textMuted }]}>, </Text>}
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

  const [showQueueModal, setShowQueueModal] = useState(false);
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);

  const [lyricsData, setLyricsData] = useState({ title: '', artist: '', videoId: '' });
  const [relatedData, setRelatedData] = useState({ songUrl: '', title: '', artist: '' });
  const [commentsData, setCommentsData] = useState({ songId: '', title: '' });

  const { setSliderActive, setButtonActive } = useGestureContext();

  const engine = usePlayerEngine();
  const {
    isLoading: musicPlayerLoading,
    togglePlayPause,
    isLocalTrack,
    bufferedPosition,
    isPlaying: contextIsPlaying,
    position: contextPosition,
    duration: contextDuration,
    hasVideoStream,
  } = useMusicPlayer();

  // Use context state (comes from NewPlayer for remote tracks, masterPlayer for local)
  const isPlaying = contextIsPlaying;
  const positionSec = contextPosition;
  const durationSec = contextDuration;
  const repeatMode = engine.repeatMode;
  const shuffleMode = engine.shuffleMode;
  const isResolving = (engine as any).isResolving ?? false;

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

  const isLocal = useMemo(
    () => checkIsLocalTrack(engine.currentTrack),
    [engine.currentTrack],
  );

  const [extras, setExtras] = useState<Record<string, any>>(() => {
    try {
      const id = engine.currentTrack?.id;
      if (!id || id === DUMMY_TRACK.id) return {};
      return (typeof getCachedTrackExtrasSync === 'function' ? getCachedTrackExtrasSync(id) : null)
        ?? (typeof getTrackExtras === 'function' ? getTrackExtras(id) : null)
        ?? {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const id = displayTrack?.id;
    if (!id || id === DUMMY_TRACK.id) {
      setExtras({});
      return;
    }
    const synced = (typeof getCachedTrackExtrasSync === 'function' ? getCachedTrackExtrasSync(id) : null)
      ?? (typeof getTrackExtras === 'function' ? getTrackExtras(id) : null)
      ?? {};
    setExtras(synced);
  }, [displayTrack?.id, trackExtrasVersion]);

  const liveExtras = (displayTrack?.id && displayTrack.id !== DUMMY_TRACK.id)
    ? (
        (typeof getTrackExtras === 'function' ? getTrackExtras(displayTrack.id) : null)
        ?? (typeof getCachedTrackExtrasSync === 'function' ? getCachedTrackExtrasSync(displayTrack.id) : null)
        ?? extras
      )
    : extras;

  const likeCount = liveExtras?.likeCount ?? -1;
  const dislikeCount = liveExtras?.dislikeCount ?? -1;
  const commentsCount = liveExtras?.commentsCount ?? -1;
  const viewCount = liveExtras?.viewCount ?? -1;
  const uploaderUrl: string | undefined = liveExtras?.uploaderUrl;
  const videoId: string | undefined = liveExtras?.videoId ?? displayTrack?.videoId;

  // Video availability from NewPlayer's stream info (engine.hasVideoStream)
  const hasVideo = !isLocal && hasVideoStream && displayTrack.id !== DUMMY_TRACK.id;
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

  const [activeSegment, setActiveSegment] = useState<'song' | 'video'>('song');
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);

  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

  const handleSetSpeed = useCallback((rate: number) => {
    try {
      if (!isLocal) {
        MavinPlayer.setPlaybackSpeed(rate);
      } else {
        masterPlayer.playbackRate = rate;
      }
      setPlaybackRateState(rate);
    } catch (e) {
      console.warn('[PlayerContent] setPlaybackRate failed:', e);
    }
    setShowSpeedPicker(false);
  }, [isLocal]);

  const trackEndHandledRef = useRef(false);
  const previousMasterStatusRef = useRef<string | null>(null);

  const waitForPlayerReady = useCallback((
    player: any,
    timeoutMs: number
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (player.status === 'readyToPlay') {
        resolve();
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout>;
      let listener: any = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (listener) {
          try { listener.remove?.(); } catch {}
        }
      };

      listener = player.addListener('statusChange', ({ status }: { status: string }) => {
        if (status === 'readyToPlay') {
          cleanup();
          resolve();
        }
      });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Player ready timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }, []);

  // Listen to master player ONLY for local tracks (expo-video)
  useEffect(() => {
    if (!masterPlayer) return;

    let statusListener: any = null;
    let playingListener: any = null;
    let sourceChangeListener: any = null;
    let rateChangeListener: any = null;
    let timeUpdateListener: any = null;

    try {
      statusListener = masterPlayer.addListener('statusChange', ({ status, error }: any) => {
        const previousStatus = previousMasterStatusRef.current;
        previousMasterStatusRef.current = status;

        if (status === 'readyToPlay') {
          const duration = masterPlayer.duration ?? 0;
          if (duration > 0) {
            const timestamps: number[] = [];
            const interval = 10;
            for (let ts = 0; ts < duration; ts += interval) {
              timestamps.push(ts);
            }
            if (timestamps.length > 0) {
              masterPlayer.generateThumbnailsAsync(timestamps).catch((e: any) => {
                console.warn('[PlayerContent] Thumbnail generation failed:', e?.message);
              });
            }
          }
        } else if (status === 'error') {
          console.error('[PlayerContent] Master player error:', error?.message);
        }

        // Local track end detection
        if (status === 'idle' && previousStatus === 'readyToPlay' && !trackEndHandledRef.current && isLocal) {
          console.log('[PlayerContent] Local master reached end, skipping to next');
          trackEndHandledRef.current = true;
          engine.skipToNext();
        }
      });

      sourceChangeListener = masterPlayer.addListener('sourceChange', () => {
        trackEndHandledRef.current = false;
      });

      // Only for local tracks — remote track state comes from MusicPlayerContext
      if (isLocal) {
        playingListener = masterPlayer.addListener('playingChange', ({ isPlaying: mPlaying }: any) => {
          // Local track playing state is already in context
        });

        rateChangeListener = masterPlayer.addListener('rateChange', ({ playbackRate: newRate }: any) => {
          setPlaybackRateState(newRate);
        });

        timeUpdateListener = masterPlayer.addListener('timeUpdate', ({ currentTime }: any) => {
          // Local track position comes from context via masterState
        });
      }

    } catch (e) {
      console.error('[PlayerContent] Failed to add master listeners:', e);
    }

    return () => {
      try {
        statusListener?.remove?.();
        playingListener?.remove?.();
        sourceChangeListener?.remove?.();
        rateChangeListener?.remove?.();
        timeUpdateListener?.remove?.();
      } catch {}
    };
  }, [engine, isLocal]);

  const handlePlayPause = useCallback(() => {
    triggerHaptic();
    if (!displayTrack || displayTrack.id === DUMMY_TRACK.id) return;
    togglePlayPause();
  }, [displayTrack, togglePlayPause]);

  const handleSegmentPress = useCallback(
    async (seg: 'song' | 'video') => {
      if (seg === 'video' && (!hasVideo || displayTrack.id === DUMMY_TRACK.id || isLocal)) {
        return;
      }

      triggerHaptic();
      console.log(`[PlayerContent] Switching to "${seg}" tab`);

      if (seg === 'video') {
        console.log('[PlayerContent] → VIDEO tab - showing native video surface');
        setActiveSegment('video');
        // The MavinPlayerVideoView component will automatically attach to
        // the already-playing NewPlayer instance when rendered.
      } else {
        console.log('[PlayerContent] → SONG tab - hiding video surface');
        setActiveSegment('song');
      }
    },
    [hasVideo, displayTrack.id, isLocal],
  );

  const handleSeek = useCallback((position: number) => {
    if (durationSec <= 0) return;
    const clampedPosition = Math.max(0, Math.min(position, durationSec));
    engine.seekTo(clampedPosition);
  }, [durationSec, engine]);

  const handleSkipNext = useCallback(async () => {
    triggerHaptic();
    setPreferredStreamType(activeSegment === 'video' ? 'video' : 'audio');
    await engine.skipToNext();
    trackEndHandledRef.current = false;
  }, [activeSegment, engine]);

  const handleSkipPrevious = useCallback(async () => {
    triggerHaptic();
    setPreferredStreamType(activeSegment === 'video' ? 'video' : 'audio');
    await engine.skipToPrevious();
    trackEndHandledRef.current = false;
  }, [activeSegment, engine]);

  useEffect(() => {
    setActiveSegment('song');
    trackEndHandledRef.current = false;
    previousMasterStatusRef.current = null;
  }, [displayTrack?.id]);

  const artworkForColors = typeof displayTrack?.thumbnail === 'string' ? displayTrack.thumbnail : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo((): [string, string, string] => {
    if (imageColors?.dominant && isDark) {
      return [imageColors.dominant, colors.surface, colors.background];
    }
    return [colors.playerGradientStart, colors.playerGradientMiddle, colors.playerGradientEnd];
  }, [imageColors, colors, isDark]);

  const isSliding = useSharedValue(false);
  const isSlidingRef = useRef(false);
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderProgress = useSharedValue(0);
  const sliderMin = useSharedValue(0);
  const sliderMax = useSharedValue(1);
  const slidingValue = useSharedValue(0);

  // Use context position for slider
  const visualPositionSec = positionSec;
  const visualDurationSec = durationSec;
  const visualIsPlaying = isPlaying;

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
    if (repeatMode === 'one') return 'repeat-once';
    return 'repeat';
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

  // Show native video surface when:
  // - Not a local track
  // - Has video streams available
  // - Video tab is active
  const showVideoSurface = hasVideo && !isLocal && activeSegment === 'video';

  const bufferFillPercent = visualDurationSec > 0 ? Math.min(bufferedPosition / visualDurationSec, 1) : 0;

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
                  <Text style={activeSegment === 'song' ? styles.segmentActive : [styles.segmentInactive, { color: colors.textMuted }]}>
                    Song
                  </Text>
                </TouchableOpacity>

                {!isLocal && hasVideo && (
                  <TouchableOpacity
                    onPress={() => handleSegmentPress('video')}
                    activeOpacity={0.7}
                    onPressIn={() => setButtonActive(true)}
                    onPressOut={() => setButtonActive(false)}
                  >
                    <Text
                      style={[
                        activeSegment === 'video' ? styles.segmentActive : [styles.segmentInactive, { color: colors.textMuted }],
                      ]}
                    >
                      Video
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
                <Image
                  source={artworkSource}
                  style={styles.artworkImage}
                  contentFit="cover"
                  transition={300}
                />
              </Animated.View>

              {showVideoSurface && (
                <Animated.View style={[StyleSheet.absoluteFill, videoAnimStyle]}>
                  <MavinPlayerVideoView
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    allowsPictureInPicture={true}
                    onFirstFrameRender={() => {
                      console.log('[PlayerContent] First video frame rendered');
                    }}
                    onPictureInPictureStart={() => {
                      console.log('[PlayerContent] PiP started');
                    }}
                    onPictureInPictureStop={() => {
                      console.log('[PlayerContent] PiP stopped');
                    }}
                  />
                </Animated.View>
              )}
            </View>

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
                      <Ionicons name="play-circle-outline" size={moderateScale(18)} color={colors.textMuted} />
                      <Text style={[styles.pillText, { color: colors.textMuted }]}>
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

              <View style={[styles.pillContainer, styles.actionPill]}>
                <TouchableOpacity onPress={handleSleepTimer} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="weather-night" size={moderateScale(20)} color={colors.text} />
                </TouchableOpacity>
                <View style={[styles.pillDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
                <TouchableOpacity
                  onPress={() => { triggerHaptic(); setShowSpeedPicker(true); }}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: scale(4) }}
                >
                  <MaterialCommunityIcons name="speedometer" size={moderateScale(16)} color={colors.textMuted} />
                  <Text style={[styles.pillText, { color: colors.textMuted }]}>
                    {playbackRate === 1.0 ? '1×' : `${playbackRate}×`}
                  </Text>
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

            <View
              style={styles.progressWrapper}
              onTouchStart={() => setSliderActive(true)}
              onTouchEnd={() => setSliderActive(false)}
              onTouchCancel={() => setSliderActive(false)}
            >
              <View style={styles.bufferBarBackground}>
                <View 
                  style={[
                    styles.bufferBarFill, 
                    { 
                      width: `${bufferFillPercent * 100}%`,
                      backgroundColor: colors.sliderTrack 
                    }
                  ]} 
                />
              </View>
              
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
                  maximumTrackTintColor: 'transparent',
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
                <Text style={[styles.timeText, { color: colors.textMuted }]}>
                  {formatTime(visualPositionSec)}
                </Text>
                <Text style={[styles.timeText, { color: colors.textMuted }]}>
                  {formatTime(visualDurationSec)}
                </Text>
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
                    { color: colors.textMuted },
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
                    { color: colors.textMuted },
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

      <RNModal
        visible={showSpeedPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSpeedPicker(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowSpeedPicker(false)}
        >
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 32, paddingHorizontal: scale(20) }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.textMuted, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ color: colors.text, fontSize: moderateScale(15), fontWeight: '600', marginBottom: 16 }}>Playback Speed</Text>
            {SPEED_OPTIONS.map((rate) => (
              <TouchableOpacity
                key={rate}
                onPress={() => handleSetSpeed(rate)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: verticalScale(12) }}
              >
                <Text style={{ color: playbackRate === rate ? colors.gold : colors.text, fontSize: moderateScale(16), fontWeight: playbackRate === rate ? '700' : '400' }}>
                  {rate === 1.0 ? 'Normal (1×)' : `${rate}×`}
                </Text>
                {playbackRate === rate && <Ionicons name="checkmark" size={20} color={colors.gold} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </RNModal>
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

  progressWrapper: { marginTop: verticalScale(20), position: 'relative' },
  bufferBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: moderateScale(5),
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  bufferBarFill: {
    height: '100%',
    borderRadius: 16,
  },
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
});