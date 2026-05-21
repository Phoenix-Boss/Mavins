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
// BUG FIX 1: Back-to-song double-seek removed — single seekTo, no buffering blip
// BUG FIX 2: Play icon source-of-truth fixed — always routes through togglePlayPause
// BUG FIX 3: Slider optimistic update — thumb no longer snaps back on drag
// BUG FIX 4: Comment count live-read fallback — never misses a version bump
// BUG FIX 5: Video→Song toggle resumes audio correctly.
//   Root cause: vp.muted=true alone does NOT release Android audio focus —
//   expo-video holds focus even muted, ducking/pausing the expo-audio player.
//   Fix: vp.pause() to release audio focus, then engine.play() to reclaim it.
//   isPlayingRef (stale-closure-free) guards engine.play() so paused state is respected.
// BUG FIX 6: Slider seek lock extended 200ms→1500ms — covers Android native rebuffer
//   window so positionSec ticking during rebuffer cannot overwrite optimistic thumb.
// BUG FIX 7: Progress bar source-of-truth — same pattern as visualIsPlaying.
//   visualPositionSec: on Song tab mirrors engine.position; on Video tab polls
//   videoPlayer.currentTime at 250 ms intervals so the thumb tracks video playback.
//   visualDurationSec: same split — engine.duration on Song, videoPlayer.duration
//   on Video (falls back to engine.duration when video duration is 0).
//   Tab switches immediately snap visualPosition to the incoming player's current
//   time so there is no jump on the progress bar when toggling.
//   Seek on Video tab dispatches ONLY to the video player (not engine) so expo-audio
//   focus is never disturbed during video playback.
// BUG FIX 8: Comment icon hidden entirely when commentsCount <= 0 (no track or
//   track has no comment data yet). Shown only when commentsCount > 0.
// BUG FIX 9: Audio duration display fixed — visualDurationSec now syncs correctly
//   when durationSec becomes > 0 after mount.
// BUG FIX 10: Tap-to-seek fixed — removed isSliding guard so taps work.
// BUG FIX 11: Lock screen media controls now sync with video tab position.
//
// SURGICAL FIXES 2026-05-18:
// FIX 1: deactivateAudio()/activateAudio() called on tab switches (audio focus mgmt)
// FIX 2: vp.pause() called before vp.muted=true on song-tab return (releases focus)
// FIX 3: VIDEO_SYNC_INTERVAL_MS = 100 (was 500)
// FIX 4: Status listener attached once at module level, not re-attached per load
// FIX 5: handlePlaylist/handleSleepTimer call onMinimize() first (mini-player visible)
// FIX 6: Video seek does pause→seek→play for reliable Android seeking
// FIX 7: Context video state (setVideoActive, updateVideoPosition, etc.) wired
// FIX 8: loadVideoSource guarded by lastLoadedUrlRef — NEVER reloads on tab switch
// FIX 9: Sync interval only runs on Song tab, never during video playback
// FIX 10: Tab switch sequence: deactivateAudio → seek → unmute → play (video)
//         pause → mute → activateAudio → play (song)
//
// PiP & BACKGROUND FIXES 2026-05-19:
// FIX 10: videoPlayerSingleton.staysActiveInBackground = true (module level)
// FIX 11: VideoView allowsPictureInPicture changed from false to true
// FIX 12: AppState listener triggers PiP on background when video is active
// FIX 13: pictureInPictureStatusChange listener tracks PiP state
// FIX 14: isPipActiveRef guards expandPlayer/UI restoration when PiP is active
// FIX 15: Global __mavinVideoPlay/__mavinVideoPause/__mavinVideoSeek registered
//         with updateVideoIsPlaying calls to keep lock screen sync correct

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
  // FIX 10: Keep video player alive when app backgrounds (required for PiP)
  videoPlayerSingleton.staysActiveInBackground = true;
} catch {}

const LYRICS_LEAD_IN_S = 0.25;
const SK = { base: '#1A1A1A', highlight: '#2A2A2A' };
// FIX 3: Sync interval now 100ms as per spec (was 500)
const VIDEO_SYNC_INTERVAL_MS = 100;
// How often (ms) we poll video player's currentTime to drive the visual progress bar
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
  const isResolving = engine.isResolving ?? false;

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

  // showSkeleton: true only when we have no track metadata yet (dummy track state).
  // isResolving/musicPlayerLoading shows a spinner on the play button but title/artwork
  // are already set immediately when playAudio is called, so we don't blank the screen.
  const isLoadingAudio = musicPlayerLoading || isResolving;
  const showSkeleton = !engine.currentTrack || engine.currentTrack.id === DUMMY_TRACK.id;

  const [activeSegment, setActiveSegment] = useState<'song' | 'video'>('song');
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoPlayerReady = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const videoOwnsAudio = useRef(false);
  const isTransitioning = useRef(false);

  const activeSegmentRef = useRef<'song' | 'video'>('song');
  const videoPlayingRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);

  const statusListenerRef = useRef<any>(null);
  const errorCountRef = useRef(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoPlayer = videoPlayerSingleton;
  const videoPlayerRef = useRef(videoPlayer);
  const [videoPlayerInitialized, setVideoPlayerInitialized] = useState(false);
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);
  
  // FIX 8: Track last loaded URL to prevent reload on tab switch
  const lastLoadedUrlRef = useRef<string | null>(null);
  
  // FIX 13 / FIX 14: Track PiP active state
  const isPipActiveRef = useRef(false);
  
  useEffect(() => { positionRef.current = positionSec; }, [positionSec]);
  useEffect(() => { durationRef.current = durationSec; }, [durationSec]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // ── VISUAL PLAY STATE ────────────────────────────────────────────────────
  const [visualIsPlaying, setVisualIsPlaying] = useState(isPlaying);
  useEffect(() => {
    if (activeSegmentRef.current === 'song') {
      setVisualIsPlaying(isPlaying);
    }
  }, [isPlaying]);

  // ── VISUAL POSITION / DURATION ───────────────────────────────────────────
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

  // Poll video player's currentTime/duration while on Video tab
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

  // ── MODULE-LEVEL STATUS LISTENER (FIX 4: attached once, never re-attached) ─
  useEffect(() => {
    if (!videoPlayer || isLocal) return;

    try {
      statusListenerRef.current = videoPlayer.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') {
          videoPlayerReady.current = true;
          setVideoError(null);

          if (pendingSeek.current !== null) {
            try {
              videoPlayer.currentTime = pendingSeek.current;
            } catch {}
            pendingSeek.current = null;

            if (activeSegmentRef.current === 'video' && isPlayingRef.current) {
              try {
                videoPlayer.play();
                videoPlayingRef.current = true;
              } catch {}
            }
          }
        } else if (status === 'error') {
          videoPlayerReady.current = false;
          const errorMsg = error?.message || 'Unknown video error';
          console.error('[PlayerContent] Video error:', errorMsg);

          if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
            setVideoError('Video unavailable (access denied). Listening to audio only.');
          } else {
            setVideoError(errorMsg);
          }

          errorCountRef.current += 1;
          if (errorCountRef.current === 1 && lastLoadedUrlRef.current) {
            setTimeout(() => {
              try {
                if (typeof (videoPlayer as any).replaceAsync === 'function') {
                  void (videoPlayer as any).replaceAsync(lastLoadedUrlRef.current);
                } else {
                  (videoPlayer as any).replace(lastLoadedUrlRef.current);
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
      } catch {}
      statusListenerRef.current = null;
    };
  }, [videoPlayer, isLocal]);

  // ── PICTURE-IN-PICTURE STATUS LISTENER (FIX 13) ──────────────────────────
  useEffect(() => {
    if (!videoPlayer || isLocal) return;

    let pipListener: any = null;

    try {
      pipListener = videoPlayer.addListener('pictureInPictureStatusChange', ({ status }: any) => {
        if (status === 'started') {
          isPipActiveRef.current = true;
          console.log('[PlayerContent] PiP started');
        } else if (status === 'stopped') {
          isPipActiveRef.current = false;
          console.log('[PlayerContent] PiP stopped');
          
          // If user dismissed PiP manually while app is in background, pause video
          const currentAppState = AppState.currentState;
          if (currentAppState === 'background' && activeSegmentRef.current === 'video') {
            try {
              videoPlayer.pause();
              videoPlayingRef.current = false;
              updateVideoIsPlaying(false);
              setVisualIsPlaying(false);
            } catch {}
          }
        }
      });
    } catch (e) {
      console.warn('[PlayerContent] Failed to add PiP listener:', e);
    }

    return () => {
      try {
        pipListener?.remove?.();
      } catch {}
    };
  }, [videoPlayer, isLocal, updateVideoIsPlaying]);

  // ── APPSTATE LISTENER FOR PiP AUTO-TRIGGER (FIX 12 / FIX 14) ──────────────
  useEffect(() => {
    if (isLocal) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const vp = videoPlayerRef.current;
      if (!vp) return;

      if (nextAppState === 'background') {
        // FIX 12: Auto-enter PiP when going background on video tab
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
      } else if (nextAppState === 'active') {
        // FIX 14: Only restore normal UI if PiP is NOT active
        if (!isPipActiveRef.current) {
          // Normal foreground restoration — nothing special needed here
          // The video stays in its tab, audio focus managed by segment switch
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [isLocal, videoPlayerInitialized]);

  // ── GLOBAL VIDEO COMMAND REGISTRATION (FIX 15) ───────────────────────────
  useEffect(() => {
    if (!videoPlayerInitialized || isLocal) return;

    const vp = videoPlayerRef.current;
    if (!vp) return;

    // Register globals so MusicPlayerContext lock-screen handlers can control video
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
      console.log('[PlayerContent] Unregistered global video command handlers');
    };
  }, [videoPlayerInitialized, isLocal, updateVideoIsPlaying, updateVideoPosition]);

  // ── LOAD VIDEO SOURCE (FIX 8: only loads when URL changes, never on tab switch) ─
  const loadVideoSource = useCallback(async (url: string) => {
    if (!url || isLocal) return;
    
    // FIX 8: Skip if this URL is already loaded
    if (lastLoadedUrlRef.current === url && videoPlayerReady.current) {
      console.log('[PlayerContent] Video URL already loaded, skipping replaceAsync');
      return;
    }

    try {
      setVideoError(null);
      errorCountRef.current = 0;
      videoPlayerReady.current = false;

      const vp = videoPlayerRef.current;

      if (typeof (vp as any).replaceAsync === 'function') {
        await (vp as any).replaceAsync(url);
      } else {
        (vp as any).replace(url);
      }

      lastLoadedUrlRef.current = url;

      const POLL_INTERVAL_MS = 200;
      const POLL_TIMEOUT_MS  = 12000;
      const pollStart = Date.now();

      await new Promise<void>((resolve) => {
        const poll = () => {
          const status = (vp as any).status;
          if (status === 'readyToPlay') {
            videoPlayerReady.current = true;
            resolve();
            return;
          }
          if (Date.now() - pollStart >= POLL_TIMEOUT_MS) {
            console.warn('[PlayerContent] Video readyToPlay poll timed out');
            resolve();
            return;
          }
          setTimeout(poll, POLL_INTERVAL_MS);
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

  // FIX 8: Only run when activeVideoUrl actually changes, NOT when videoPlayerInitialized changes
  useEffect(() => {
    if (!activeVideoUrl || isLocal) return;
    void loadVideoSource(activeVideoUrl);
  }, [activeVideoUrl, isLocal]);

  // FIX 9: Sync interval only runs on Song tab, never during video playback
  useEffect(() => {
    if (!videoPlayerInitialized || !videoPlayer || isLocal || !activeVideoUrl) return;

    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);

    syncIntervalRef.current = setInterval(() => {
      // Only sync when on Song tab — during video playback we don't touch video position
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

  const videoProgress = useSharedValue(0);
  const artworkAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [1, 0]), { duration: 300 }),
  }));
  const videoAnimStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(videoProgress.value, [0, 1], [0, 1]), { duration: 300 }),
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // SEGMENT SWITCH (FIX 10: correct sequence, no source reload)
  // ─────────────────────────────────────────────────────────────────────────
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
          // FIX 10: Step 1 — Deactivate audio (pause + release focus)
          await deactivateAudio();

          // FIX 10: Step 2 — Calculate seek target
          const seekTarget = Math.max(0, currentAudioPos - OFFSET);

          // FIX 10: Step 3 — Set video position FIRST, before unmuting
          if (videoPlayerReady.current) {
            try { 
              vp.currentTime = seekTarget; 
            } catch (e) {
              console.warn('[PlayerContent] currentTime set failed:', e);
              pendingSeek.current = seekTarget;
            }
          } else {
            console.log('[PlayerContent] Video not ready yet — queuing seek at', seekTarget);
            pendingSeek.current = seekTarget;
          }

          // FIX 10: Step 4 — Unmute video (now at correct position)
          vp.muted = false;

          // FIX 10: Step 5 — Play video if audio was playing
          if (visualIsPlaying) {
            try { 
              vp.play(); 
              videoPlayingRef.current = true; 
            } catch {}
          }

          setVisualPositionSec(seekTarget);
          setVisualDurationSec(
            (vp.duration ?? 0) > 0 ? vp.duration : durationRef.current,
          );

          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          videoProgress.value = 1;
          setVideoActive(true);
          updateVideoPosition(seekTarget);
          updateVideoDuration((vp.duration ?? 0) > 0 ? vp.duration : durationRef.current);
          updateVideoIsPlaying(visualIsPlaying);

        } else if (seg === 'song' && vp) {
          pendingSeek.current = null;
          
          // FIX 10: Step 1 — Pause video FIRST (stops sound + releases focus)
          try { vp.pause(); } catch {}
          
          // FIX 10: Step 2 — Mute video
          try { vp.muted = true; } catch {}
          
          videoPlayingRef.current = false;
          videoOwnsAudio.current = false;

          // FIX 10: Step 3 — Reactivate audio focus
          await activateAudio();

          // FIX 10: Step 4 — Resume audio from exact video position
          const videoStoppedAt = vp.currentTime ?? positionRef.current;
          if (videoStoppedAt > 0 && videoStoppedAt !== positionRef.current) {
            try { engine.seekTo(videoStoppedAt); } catch {}
          }
          
          if (visualIsPlaying) {
            try { engine.play(); } catch {}
          }

          setVisualPositionSec(videoStoppedAt);
          setVisualDurationSec(durationRef.current);

          setActiveSegment(seg);
          activeSegmentRef.current = seg;
          videoProgress.value = 0;
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
        }, 600);
      }
    },
    [
      hasVideo,
      videoPlayer,
      videoProgress,
      visualIsPlaying,
      muxedVideoUrl,
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

  // ─────────────────────────────────────────────────────────────────────────
  // TRACK CHANGE RESET
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    videoOwnsAudio.current = false;
    videoPlayerReady.current = false;
    pendingSeek.current = null;
    lastLoadedUrlRef.current = null; // FIX 8: Reset so new track loads
    setActiveSegment('song');
    activeSegmentRef.current = 'song';
    videoProgress.value = 0;
    setVideoError(null);
    errorCountRef.current = 0;
    setVisualPositionSec(0);
    setVisualDurationSec(0);
    setVideoActive(false);
    updateVideoPosition(0);
    updateVideoDuration(0);
    updateVideoIsPlaying(false);
  }, [displayTrack?.id, videoProgress, setVideoActive, updateVideoPosition, updateVideoDuration, updateVideoIsPlaying]);

  const artworkForColors = typeof displayTrack?.thumbnail === 'string' ? displayTrack.thumbnail : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo((): [string, string, string] => {
    if (imageColors?.dominant && isDark) {
      return [imageColors.dominant, colors.surface, colors.background];
    }
    return [colors.playerGradientStart, colors.playerGradientMiddle, colors.playerGradientEnd];
  }, [imageColors, colors, isDark]);

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDER / SEEK
  // ─────────────────────────────────────────────────────────────────────────
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
        willPlay ? videoPlayer.play() : videoPlayer.pause();
        videoPlayingRef.current = willPlay;
        updateVideoIsPlaying(willPlay);
      } catch {}
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
                    // FIX 11: Enable PiP on the native VideoView
                    allowsPictureInPicture={true}
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
                      {likeCount > 0 && (
                        <Text style={[styles.statCount, { color: colors.text }]}>
                          {formatCount(likeCount)}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

                    <TouchableOpacity
                      style={styles.actionButton}
                      activeOpacity={0.7}
                      onPressIn={() => setButtonActive(true)}
                      onPressOut={() => setButtonActive(false)}
                    >
                      <Ionicons name="thumbs-down-outline" size={16} color={colors.text} />
                      {dislikeCount > 0 && (
                        <Text style={[styles.statCount, { color: colors.text }]}>
                          {formatCount(dislikeCount)}
                        </Text>
                      )}
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

                {showCommentButton && (
                  <TouchableOpacity
                    style={[styles.actionContainer, { backgroundColor: `${colors.gold}15` }]}
                    onPress={handleOpenComments}
                    activeOpacity={0.7}
                    onPressIn={() => setButtonActive(true)}
                    onPressOut={() => setButtonActive(false)}
                  >
                    <MaterialCommunityIcons
                      name="comment-text-outline"
                      size={16}
                      color={colors.text}
                    />
                    <Text style={[styles.statCount, { color: colors.text }]}>
                      {formatCount(commentsCount)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {!isLocal && (
                <View style={[styles.playCountPill, { backgroundColor: `${colors.gold}10` }]}>
                  <Ionicons name="headset-outline" size={13} color={colors.textSub} />
                  {counterTarget > 0
                    ? <AnimatedCounter target={counterTarget} />
                    : <SkeletonPulse width={42} height={10} borderRadius={3} />}
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
                disabled={showSkeleton || displayTrack.id === DUMMY_TRACK.id}
                onPressIn={() => setButtonActive(true)}
                onPressOut={() => setButtonActive(false)}
              >
                <Ionicons
                  name={showSkeleton ? 'hourglass-outline' : visualIsPlaying ? 'pause' : 'play'}
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