// components/player/PlayerControls.tsx
//
// INDUSTRY STANDARD DUAL-MODE ARCHITECTURE
// - Uses PlayerEngineContext for audio playback
// - Real-time state with responsive playback hook for accurate play/pause icon
// - Horizontal scrolling action row for unlimited icons
// - Share functionality, Download, Comments count display
// - Optimistic UI updates with sync verification
// - Fixed: AppState import added
// - Fixed: Removed double engine calls in PlayPauseButton
// - Fixed: triggerHaptic wrapped in arrow functions for TouchableOpacity
// - Added: SleepTimerButton component with pill styling
// - Added: PlaybackSpeedButton component with pill styling
// - Added: Sleep timer and speed props to ActionRow

import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { downloadAndSaveSong } from "@/services/download";
import { useIsSongDownloaded, useIsSongDownloading } from "@/store/library";
import { useMusicPlayer, usePlayerEngine } from "@/libs/playerSetup";
import { MaterialCommunityIcons, MaterialIcons, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { ComponentProps, useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
  RegisteredStyle,
  ToastAndroid,
  ActivityIndicator,
  ScrollView,
  Share,
  Platform,
  Text,
  Modal,
  AppState,
} from "react-native";
import { moderateScale, scale, verticalScale } from "react-native-size-matters/extend";
import { match } from "ts-pattern";

import useResponsivePlayback from "@/hooks/useResponsivePlayback";

type RepeatMode = "off" | "queue" | "track";

export type PlayerControlsProps = {
  style?: ViewStyle;
  onBeforeSkip?: () => void;
};

export type PlayerButtonProps = {
  style?: ViewStyle | RegisteredStyle<ViewStyle> | (ViewStyle | RegisteredStyle<ViewStyle>)[];
  iconSize?: number;
  isFloatingPlayer?: boolean;
  onBeforeSkip?: () => void;
};

const repeatOrder: RepeatMode[] = ["off", "queue", "track"];

// Format count for display (K, M, B)
const formatCount = (n: number): string => {
  if (n <= 0) return "";
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, "")}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toString();
};

// Format remaining time for sleep timer
const formatSleepTimerRemaining = (endsAt: number | null): string | null => {
  if (!endsAt) return null;
  const remainingMs = endsAt - Date.now();
  if (remainingMs <= 0) return null;
  const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
  if (remainingMinutes <= 0) return null;
  return `${remainingMinutes}m`;
};

export const PlayerControls = ({ style, onBeforeSkip }: PlayerControlsProps) => (
  <View style={[styles.container, style]}>
    <View style={styles.row}>
      <AddToPlaylistButton />
      <SkipToPreviousButton onBeforeSkip={onBeforeSkip} />
      <PlayPauseButton />
      <SkipToNextButton onBeforeSkip={onBeforeSkip} />
      <RepeatToggle />
    </View>
  </View>
);

export const ReducedPlayerControls = ({ style, onBeforeSkip }: PlayerControlsProps) => (
  <View style={[styles.container, style]}>
    <View style={styles.row}>
      <SkipToPreviousButton onBeforeSkip={onBeforeSkip} />
      <PlayPauseButton />
      <SkipToNextButton onBeforeSkip={onBeforeSkip} />
    </View>
  </View>
);

// ─── PlayPauseButton ─────────────────────────────────────────────────────────

export const PlayPauseButton = ({
  style,
  iconSize = moderateScale(65),
  isFloatingPlayer = false,
}: PlayerButtonProps) => {
  const { togglePlayPause, isPlaying: actualPlaying, position, duration, isBuffering: contextBuffering } = useMusicPlayer();
  const engine = usePlayerEngine();
  
  const {
    uiPlaying,
    setPlaying,
    forceSync,
    resetSync,
  } = useResponsivePlayback({
    actualPlaying: actualPlaying,
    actualPosition: position,
    actualDuration: duration,
    actualBuffering: contextBuffering,
    onPlay: () => {
      togglePlayPause();
    },
    onPause: () => {
      togglePlayPause();
    },
    onSeek: (pos) => {
      engine.seekTo(pos);
    },
    syncDelayMs: 500,
    positionDriftThreshold: 0.3,
    syncIntervalMs: 2000,
    enablePositionDriftCorrection: true,
    onSyncNeeded: () => {},
    onSyncComplete: () => {},
    onDriftDetected: () => {},
  });
  
  useEffect(() => {
    resetSync();
  }, [engine.currentTrack?.id, resetSync]);
  
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        forceSync();
      }
    });
    return () => subscription.remove();
  }, [forceSync]);
  
  const handlePress = () => {
    triggerHaptic();
    const newPlayingState = !uiPlaying;
    setPlaying(newPlayingState);
  };
  
  const showLoading = contextBuffering && !actualPlaying && duration === 0;
  
  const getIconName = () => {
    if (showLoading) return 'hourglass-empty';
    return uiPlaying ? 'pause' : 'play-arrow';
  };
  
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[
        !isFloatingPlayer && {
          height: iconSize,
          width: iconSize,
          borderRadius: uiPlaying ? iconSize * 0.35 : iconSize / 2,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
        },
        isFloatingPlayer && { height: iconSize },
        style,
      ]}
      onPress={handlePress}
      disabled={showLoading}
    >
      {showLoading ? (
        <ActivityIndicator size={iconSize * 0.5} color={isFloatingPlayer ? "#fff" : "#000"} />
      ) : (
        <MaterialIcons
          name={getIconName() as any}
          size={isFloatingPlayer ? iconSize : iconSize * 0.65}
          color={isFloatingPlayer ? "#fff" : "#000"}
        />
      )}
    </TouchableOpacity>
  );
};

// ─── SkipToNextButton ────────────────────────────────────────────────────────

export const SkipToNextButton = ({
  iconSize = moderateScale(40),
  isFloatingPlayer = false,
  onBeforeSkip,
}: PlayerButtonProps) => {
  const engine = usePlayerEngine();

  const handlePress = async () => {
    triggerHaptic();
    onBeforeSkip?.();
    try {
      await engine.skipToNext();
    } catch (error) {
      console.warn('[PlayerControls] Skip next error:', error);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      {isFloatingPlayer ? (
        <MaterialIcons name="skip-next" size={iconSize} color="#fff" />
      ) : (
        <MaterialCommunityIcons name="skip-next-outline" size={iconSize} color="#fff" />
      )}
    </TouchableOpacity>
  );
};

// ─── SkipToPreviousButton ────────────────────────────────────────────────────

export const SkipToPreviousButton = ({
  iconSize = moderateScale(40),
  isFloatingPlayer = false,
  onBeforeSkip,
}: PlayerButtonProps) => {
  const engine = usePlayerEngine();

  const handlePress = async () => {
    triggerHaptic();
    onBeforeSkip?.();
    try {
      await engine.skipToPrevious();
    } catch (error) {
      console.warn('[PlayerControls] Skip previous error:', error);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      {isFloatingPlayer ? (
        <MaterialIcons name="skip-previous" size={iconSize} color="#fff" />
      ) : (
        <MaterialCommunityIcons name="skip-previous-outline" size={iconSize} color="#fff" />
      )}
    </TouchableOpacity>
  );
};

// ─── AddToPlaylistButton ─────────────────────────────────────────────────────

export const AddToPlaylistButton = ({ iconSize = moderateScale(30) }) => {
  const router = useRouter();
  const engine = usePlayerEngine();
  const activeTrack = engine.currentTrack;

  const handlePress = async () => {
    triggerHaptic();
    await router.push({
      pathname: "/(modals)/addToPlaylist",
      params: activeTrack
        ? {
            track: JSON.stringify({
              id: activeTrack.id,
              title: activeTrack.title || "",
              artist: activeTrack.artist || "",
              thumbnail: activeTrack.thumbnail || unknownTrackImageUri,
            }),
          }
        : undefined,
    });
  };

  return (
    <View>
      <TouchableOpacity onPress={handlePress}>
        <MaterialIcons name="playlist-add" size={iconSize} color={Colors.text} />
      </TouchableOpacity>
    </View>
  );
};

// ─── DownloadSongButton ──────────────────────────────────────────────────────

export const DownloadSongButton = ({
  style,
  iconSize = moderateScale(25),
}: PlayerButtonProps) => {
  const engine = usePlayerEngine();
  const activeTrack = engine.currentTrack;
  const downloaded = useIsSongDownloaded(activeTrack?.id || "");
  const downloading = useIsSongDownloading(activeTrack?.id || "");

  const handleDownload = async () => {
    if (!activeTrack || downloaded) return;
    if (downloading) {
      ToastAndroid.show("Song is already downloading", ToastAndroid.SHORT);
      return;
    }
    triggerHaptic();
    await downloadAndSaveSong({
      id: activeTrack.id,
      title: activeTrack.title || "Unknown Title",
      artist: activeTrack.artist || "Unknown Artist",
      duration: activeTrack.duration,
      url: activeTrack.url,
      thumbnailUrl: activeTrack.thumbnail,
    });
  };

  if (!activeTrack) return null;

  return (
    <View style={style}>
      <TouchableOpacity onPress={handleDownload}>
        {downloading ? (
          <ActivityIndicator size={iconSize} color={Colors.text} />
        ) : (
          <MaterialIcons
            name={downloaded ? "file-download-done" : "file-download"}
            size={iconSize}
            color={Colors.text}
          />
        )}
      </TouchableOpacity>
    </View>
  );
};

// ─── ShareSongButton ─────────────────────────────────────────────────────────

export const ShareSongButton = ({
  style,
  iconSize = moderateScale(25),
}: PlayerButtonProps) => {
  const engine = usePlayerEngine();
  const activeTrack = engine.currentTrack;

  const handleShare = async () => {
    if (!activeTrack) return;
    triggerHaptic();
    
    try {
      const shareUrl = activeTrack.videoId 
        ? `https://www.youtube.com/watch?v=${activeTrack.videoId}`
        : activeTrack.url;
      
      const message = `Check out "${activeTrack.title}" by ${activeTrack.artist || 'Unknown Artist'}`;
      
      await Share.share({
        title: activeTrack.title,
        message: Platform.OS === 'android' ? `${message}\n\n${shareUrl}` : message,
        url: Platform.OS === 'ios' ? shareUrl : undefined,
      });
    } catch (error) {
      console.warn('[PlayerControls] Share failed:', error);
      ToastAndroid.show("Failed to share song", ToastAndroid.SHORT);
    }
  };

  if (!activeTrack) return null;

  return (
    <View style={style}>
      <TouchableOpacity onPress={handleShare}>
        <Ionicons name="share-outline" size={iconSize} color={Colors.text} />
      </TouchableOpacity>
    </View>
  );
};

// ─── CommentsButton ──────────────────────────────────────────────────────────

export const CommentsButton = ({
  style,
  iconSize = moderateScale(25),
  commentsCount = 0,
  onPress,
}: PlayerButtonProps & { commentsCount?: number; onPress?: () => void }) => {
  if (commentsCount <= 0) return null;
  
  const handlePress = () => {
    triggerHaptic();
    onPress?.();
  };
  
  return (
    <View style={style}>
      <TouchableOpacity onPress={handlePress}>
        <View style={styles.commentBadgeContainer}>
          <MaterialCommunityIcons 
            name="comment-text-outline" 
            size={iconSize} 
            color={Colors.text} 
          />
          <View style={styles.commentBadge}>
            <Text style={styles.commentBadgeText}>{formatCount(commentsCount)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
};

// ─── LikeButton ──────────────────────────────────────────────────────────────

export const LikeButton = ({
  style,
  iconSize = moderateScale(25),
  likeCount = 0,
  isLiked = false,
  onPress,
}: PlayerButtonProps & { likeCount?: number; isLiked?: boolean; onPress?: () => void }) => {
  const handlePress = () => {
    triggerHaptic();
    onPress?.();
  };
  
  return (
    <View style={style}>
      <TouchableOpacity onPress={handlePress}>
        <View style={styles.iconWithCount}>
          <Ionicons
            name={isLiked ? "thumbs-up" : "thumbs-up-outline"}
            size={iconSize}
            color={isLiked ? Colors.metallicBrown.primary : Colors.text}
          />
          {likeCount > 0 && (
            <Text style={styles.iconCountText}>{formatCount(likeCount)}</Text>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

// ─── DislikeButton ───────────────────────────────────────────────────────────

export const DislikeButton = ({
  style,
  iconSize = moderateScale(25),
  dislikeCount = 0,
  isDisliked = false,
  onPress,
}: PlayerButtonProps & { dislikeCount?: number; isDisliked?: boolean; onPress?: () => void }) => {
  const handlePress = () => {
    triggerHaptic();
    onPress?.();
  };
  
  return (
    <View style={style}>
      <TouchableOpacity onPress={handlePress}>
        <View style={styles.iconWithCount}>
          <Ionicons
            name={isDisliked ? "thumbs-down" : "thumbs-down-outline"}
            size={iconSize}
            color={isDisliked ? Colors.metallicBrown.primary : Colors.text}
          />
          {dislikeCount > 0 && (
            <Text style={styles.iconCountText}>{formatCount(dislikeCount)}</Text>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

// ─── ViewCountBadge ──────────────────────────────────────────────────────────

export const ViewCountBadge = ({
  style,
  viewCount = 0,
}: {
  style?: ViewStyle;
  viewCount?: number;
}) => {
  if (viewCount <= 0) return null;
  
  return (
    <View style={[styles.viewCountBadge, style]}>
      <Ionicons name="play-circle-outline" size={14} color={Colors.textMuted} />
      <Text style={styles.viewCountText}>{formatCount(viewCount)} views</Text>
    </View>
  );
};

// ─── RepeatToggle ────────────────────────────────────────────────────────────

export type RepeatIconProps = Omit<ComponentProps<typeof MaterialCommunityIcons>, "name">;
type RepeatIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export const RepeatToggle = ({ ...iconProps }: RepeatIconProps) => {
  const engine = usePlayerEngine();
  
  const engineToUi = (m: string): RepeatMode =>
    m === 'all' ? 'queue' : m === 'one' ? 'track' : 'off';
  const uiToEngine = (m: RepeatMode) =>
    m === 'queue' ? 'all' : m === 'track' ? 'one' : 'off';

  const repeatMode = engineToUi(engine.repeatMode);

  const toggleRepeatMode = () => {
    triggerHaptic();
    const currentIndex = repeatOrder.indexOf(repeatMode);
    const nextUi = repeatOrder[(currentIndex + 1) % repeatOrder.length];
    engine.setRepeatMode(uiToEngine(nextUi));
  };

  const icon = match(repeatMode)
    .returnType<RepeatIconName>()
    .with("off", () => "repeat-off" as const)
    .with("track", () => "repeat-once" as const)
    .with("queue", () => "repeat" as const)
    .otherwise(() => "repeat-off" as const);

  return (
    <MaterialCommunityIcons
      name={icon}
      onPress={toggleRepeatMode}
      color={Colors.text}
      size={moderateScale(32)}
      {...iconProps}
    />
  );
};

// ─── SleepTimerButton ────────────────────────────────────────────────────────

export const SleepTimerButton = ({
  iconSize = moderateScale(20),
  onTimerSet,
  onTimerCleared,
}: {
  iconSize?: number;
  onTimerSet?: (minutes: number) => void;
  onTimerCleared?: () => void;
}) => {
  const { setSleepTimer, clearSleepTimer, sleepTimerEndsAt } = useMusicPlayer();
  const [modalVisible, setModalVisible] = useState(false);
  const [remainingText, setRemainingText] = useState<string | null>(null);
  
  useEffect(() => {
    const updateRemaining = () => {
      const remaining = formatSleepTimerRemaining(sleepTimerEndsAt);
      setRemainingText(remaining);
    };
    
    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndsAt]);
  
  const isActive = remainingText !== null;
  
  const handlePress = () => {
    triggerHaptic();
    setModalVisible(true);
  };
  
  const handleSetTimer = (minutes: number) => {
    setSleepTimer(minutes);
    onTimerSet?.(minutes);
    setModalVisible(false);
    triggerHaptic();
  };
  
  const handleEndOfTrack = () => {
    setModalVisible(false);
    triggerHaptic();
  };
  
  const handleClearTimer = () => {
    clearSleepTimer();
    onTimerCleared?.();
    setModalVisible(false);
    triggerHaptic();
  };
  
  return (
    <>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <View style={[styles.sleepPill, isActive && styles.sleepPillActive]}>
          <MaterialCommunityIcons 
            name="weather-night" 
            size={iconSize} 
            color={isActive ? Colors.metallicBrown.primary : Colors.text} 
          />
          <Text style={[styles.sleepPillText, isActive && styles.sleepPillTextActive]}>
            {remainingText ? remainingText : "Sleep"}
          </Text>
        </View>
      </TouchableOpacity>
      
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sleep Timer</Text>
            <Text style={styles.modalSubtitle}>Stop playback after</Text>
            
            <View style={styles.timerOptions}>
              {[15, 30, 45, 60].map((minutes) => (
                <TouchableOpacity
                  key={minutes}
                  style={styles.timerOption}
                  onPress={() => handleSetTimer(minutes)}
                >
                  <Text style={styles.timerOptionText}>{minutes} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            
            {isActive && (
              <TouchableOpacity
                style={styles.cancelOption}
                onPress={handleClearTimer}
              >
                <Text style={styles.cancelOptionText}>Cancel timer</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// ─── PlaybackSpeedButton ─────────────────────────────────────────────────────

export const PlaybackSpeedButton = ({
  iconSize = moderateScale(20),
  onSpeedChange,
}: {
  iconSize?: number;
  onSpeedChange?: (rate: number) => void;
}) => {
  const { setPlaybackRate, playbackRate } = useMusicPlayer();
  const [modalVisible, setModalVisible] = useState(false);
  
  const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const isActive = playbackRate !== 1.0;
  
  const formatSpeedLabel = (rate: number): string => {
    if (rate === 1.0) return "1x";
    return `${rate}x`;
  };
  
  const handlePress = () => {
    triggerHaptic();
    setModalVisible(true);
  };
  
  const handleSetSpeed = (rate: number) => {
    setPlaybackRate(rate);
    onSpeedChange?.(rate);
    setModalVisible(false);
    triggerHaptic();
  };
  
  return (
    <>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <View style={[styles.speedPill, isActive && styles.speedPillActive]}>
          <MaterialCommunityIcons 
            name="speedometer" 
            size={iconSize} 
            color={isActive ? Colors.metallicBrown.primary : Colors.text} 
          />
          <Text style={[styles.speedPillText, isActive && styles.speedPillTextActive]}>
            {formatSpeedLabel(playbackRate)}
          </Text>
        </View>
      </TouchableOpacity>
      
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Playback Speed</Text>
            <Text style={styles.modalSubtitle}>Pitch is preserved at all speeds</Text>
            
            <View style={styles.speedOptions}>
              {speedOptions.map((rate) => (
                <TouchableOpacity
                  key={rate}
                  style={[
                    styles.speedOption,
                    playbackRate === rate && styles.speedOptionActive,
                  ]}
                  onPress={() => handleSetSpeed(rate)}
                >
                  <Text
                    style={[
                      styles.speedOptionText,
                      playbackRate === rate && styles.speedOptionTextActive,
                    ]}
                  >
                    {formatSpeedLabel(rate)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// ─── ActionRow (Horizontal Scrollable) ───────────────────────────────────────

export const ActionRow = ({
  likeCount = 0,
  dislikeCount = 0,
  commentsCount = 0,
  viewCount = 0,
  isLiked = false,
  isDisliked = false,
  isLocal = false,
  onLikePress,
  onDislikePress,
  onCommentsPress,
  onDownloadPress,
  onSharePress,
  onPlaylistPress,
  onSleepTimerPress,
  onSpeedPress,
  showDownload = true,
  showShare = true,
  showPlaylist = true,
  showComments = true,
  showLikeDislike = true,
  showViewCount = true,
  showSleepTimer = true,
  showSpeed = true,
}: {
  likeCount?: number;
  dislikeCount?: number;
  commentsCount?: number;
  viewCount?: number;
  isLiked?: boolean;
  isDisliked?: boolean;
  isLocal?: boolean;
  onLikePress?: () => void;
  onDislikePress?: () => void;
  onCommentsPress?: () => void;
  onDownloadPress?: () => void;
  onSharePress?: () => void;
  onPlaylistPress?: () => void;
  onSleepTimerPress?: () => void;
  onSpeedPress?: () => void;
  showDownload?: boolean;
  showShare?: boolean;
  showPlaylist?: boolean;
  showComments?: boolean;
  showLikeDislike?: boolean;
  showViewCount?: boolean;
  showSleepTimer?: boolean;
  showSpeed?: boolean;
}) => {
  const iconSize = moderateScale(24);
  const smallIconSize = moderateScale(20);
  
  return (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.actionRowContent}
      style={styles.actionScrollView}
    >
      {showLikeDislike && !isLocal && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onLikePress} activeOpacity={0.7}>
            <View style={styles.iconWithCount}>
              <Ionicons
                name={isLiked ? "thumbs-up" : "thumbs-up-outline"}
                size={iconSize}
                color={isLiked ? Colors.metallicBrown.primary : Colors.text}
              />
              {likeCount > 0 && (
                <Text style={styles.iconCountText}>{formatCount(likeCount)}</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      )}
      
      {showLikeDislike && !isLocal && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onDislikePress} activeOpacity={0.7}>
            <View style={styles.iconWithCount}>
              <Ionicons
                name={isDisliked ? "thumbs-down" : "thumbs-down-outline"}
                size={iconSize}
                color={isDisliked ? Colors.metallicBrown.primary : Colors.text}
              />
              {dislikeCount > 0 && (
                <Text style={styles.iconCountText}>{formatCount(dislikeCount)}</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      )}
      
      {showComments && !isLocal && commentsCount > 0 && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onCommentsPress} activeOpacity={0.7}>
            <View style={styles.commentBadgeContainer}>
              <MaterialCommunityIcons 
                name="comment-text-outline" 
                size={iconSize} 
                color={Colors.text} 
              />
              <View style={styles.commentBadge}>
                <Text style={styles.commentBadgeText}>{formatCount(commentsCount)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}
      
      {showViewCount && !isLocal && viewCount > 0 && (
        <View style={[styles.actionItem, styles.viewCountItem]}>
          <Ionicons name="play-circle-outline" size={smallIconSize} color={Colors.textMuted} />
          <Text style={styles.viewCountText}>{formatCount(viewCount)} views</Text>
        </View>
      )}
      
      {showPlaylist && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onPlaylistPress} activeOpacity={0.7}>
            <MaterialIcons name="playlist-add" size={iconSize} color={Colors.text} />
          </TouchableOpacity>
        </View>
      )}
      
      {showDownload && (
        <View style={styles.actionItem}>
          <DownloadSongButton iconSize={iconSize} />
        </View>
      )}
      
      {showShare && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onSharePress} activeOpacity={0.7}>
            <Ionicons name="share-outline" size={iconSize} color={Colors.text} />
          </TouchableOpacity>
        </View>
      )}
      
      {showSleepTimer && !isLocal && (
        <View style={styles.actionItem}>
          <SleepTimerButton iconSize={smallIconSize} onTimerSet={onSleepTimerPress} />
        </View>
      )}
      
      {showSpeed && !isLocal && (
        <View style={styles.actionItem}>
          <PlaybackSpeedButton iconSize={smallIconSize} onSpeedChange={onSpeedPress} />
        </View>
      )}
    </ScrollView>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { width: "100%" },
  row: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  actionScrollView: {
    flexGrow: 0,
    marginVertical: verticalScale(8),
  },
  actionRowContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(12),
    gap: scale(20),
  },
  actionItem: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewCountItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(5),
    borderRadius: scale(20),
  },
  iconWithCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
  },
  iconCountText: {
    color: Colors.text,
    fontSize: moderateScale(11),
    fontWeight: "600",
  },
  commentBadgeContainer: {
    position: "relative",
  },
  commentBadge: {
    position: "absolute",
    top: -6,
    right: -10,
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: scale(10),
    minWidth: scale(18),
    height: scale(18),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: scale(4),
  },
  commentBadgeText: {
    color: "#000",
    fontSize: moderateScale(9),
    fontWeight: "700",
  },
  viewCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(5),
    borderRadius: scale(20),
  },
  viewCountText: {
    color: Colors.textMuted,
    fontSize: moderateScale(11),
    fontWeight: "500",
  },
  sleepPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    gap: scale(6),
  },
  sleepPillActive: {
    backgroundColor: "rgba(255,215,0,0.15)",
    borderWidth: 1,
    borderColor: Colors.metallicBrown.primary,
  },
  sleepPillText: {
    color: Colors.text,
    fontSize: moderateScale(11),
    fontWeight: "500",
  },
  sleepPillTextActive: {
    color: Colors.metallicBrown.primary,
    fontWeight: "600",
  },
  speedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: scale(20),
    gap: scale(6),
  },
  speedPillActive: {
    backgroundColor: "rgba(255,215,0,0.15)",
    borderWidth: 1,
    borderColor: Colors.metallicBrown.primary,
  },
  speedPillText: {
    color: Colors.text,
    fontSize: moderateScale(11),
    fontWeight: "500",
  },
  speedPillTextActive: {
    color: Colors.metallicBrown.primary,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#1a1a1a",
    borderRadius: scale(16),
    padding: scale(20),
    width: scale(280),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: {
    color: Colors.text,
    fontSize: moderateScale(18),
    fontWeight: "700",
    textAlign: "center",
    marginBottom: verticalScale(4),
  },
  modalSubtitle: {
    color: Colors.textMuted,
    fontSize: moderateScale(12),
    textAlign: "center",
    marginBottom: verticalScale(16),
  },
  timerOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: scale(12),
    marginBottom: verticalScale(16),
  },
  timerOption: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    borderRadius: scale(25),
    minWidth: scale(80),
    alignItems: "center",
  },
  timerOptionText: {
    color: Colors.text,
    fontSize: moderateScale(14),
    fontWeight: "500",
  },
  cancelOption: {
    backgroundColor: "rgba(255,100,100,0.15)",
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    borderRadius: scale(25),
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,100,100,0.3)",
  },
  cancelOptionText: {
    color: "#ff6666",
    fontSize: moderateScale(14),
    fontWeight: "600",
  },
  speedOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: scale(10),
  },
  speedOption: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    borderRadius: scale(25),
    minWidth: scale(70),
    alignItems: "center",
  },
  speedOptionActive: {
    backgroundColor: "rgba(255,215,0,0.2)",
    borderWidth: 1,
    borderColor: Colors.metallicBrown.primary,
  },
  speedOptionText: {
    color: Colors.text,
    fontSize: moderateScale(14),
    fontWeight: "500",
  },
  speedOptionTextActive: {
    color: Colors.metallicBrown.primary,
    fontWeight: "700",
  },
});