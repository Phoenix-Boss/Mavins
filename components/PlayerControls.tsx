// components/player/PlayerControls.tsx
//
// INDUSTRY STANDARD DUAL-MODE ARCHITECTURE
// - Uses PlayerEngineContext for audio playback
// - Real-time state with responsive playback hook for accurate play/pause icon
// - Horizontal scrolling action row for unlimited icons
// - Share functionality, Download, Comments count display
// - Optimistic UI updates with sync verification

import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { downloadAndSaveSong } from "@/services/download";
import { useIsSongDownloaded, useIsSongDownloading } from "@/store/library";
import { useMusicPlayer, usePlayerEngine } from "@/libs/playerSetup";
import { MaterialCommunityIcons, MaterialIcons, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { ComponentProps, useCallback, useEffect, useRef, useState } from "react";
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
// Enhanced with responsive playback for instant UI feedback

export const PlayPauseButton = ({
  style,
  iconSize = moderateScale(65),
  isFloatingPlayer = false,
}: PlayerButtonProps) => {
  const { togglePlayPause, isPlaying: actualPlaying, position, duration, isBuffering: contextBuffering } = useMusicPlayer();
  const engine = usePlayerEngine();
  
  // Get master player instance for direct state queries
  const getActualState = useCallback(() => {
    const master = (global as any).__MavinAudioPlayer__;
    return {
      playing: master?.playing ?? actualPlaying,
      position: master?.currentTime ?? position,
      duration: master?.duration ?? duration,
      buffering: master?.isBuffering ?? contextBuffering,
    };
  }, [actualPlaying, position, duration, contextBuffering]);
  
  // Use the responsive playback hook
  const {
    uiPlaying,
    isSyncing,
    needsSync,
    setPlaying,
    forceSync,
    resetSync,
  } = useResponsivePlayback({
    actualPlaying: actualPlaying,
    actualPosition: position,
    actualDuration: duration,
    actualBuffering: contextBuffering,
    onPlay: () => {
      engine.play();
      togglePlayPause();
    },
    onPause: () => {
      engine.pause();
      togglePlayPause();
    },
    onSeek: (pos) => {
      engine.seekTo(pos);
    },
    syncDelayMs: 500,
    positionDriftThreshold: 0.3,
    syncIntervalMs: 2000,
    enablePositionDriftCorrection: true,
    onSyncNeeded: () => {
      console.log('[PlayPauseButton] Sync needed - correcting UI');
    },
    onSyncComplete: () => {
      console.log('[PlayPauseButton] Sync complete');
    },
    onDriftDetected: (drift) => {
      console.log(`[PlayPauseButton] Position drift detected: ${drift.toFixed(3)}s`);
    },
  });
  
  // Reset sync when track changes
  useEffect(() => {
    resetSync();
  }, [engine.currentTrack?.id, resetSync]);
  
  // Force sync when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        forceSync();
      }
    });
    return () => subscription.remove();
  }, [forceSync]);
  
  // Handle play/pause press
  const handlePress = useCallback(() => {
    triggerHaptic();
    const newPlayingState = !uiPlaying;
    setPlaying(newPlayingState);
  }, [uiPlaying, setPlaying]);
  
  // Determine if we should show loading state
  const showLoading = contextBuffering && !actualPlaying && duration === 0;
  
  // Determine icon name based on state
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

  const handlePress = useCallback(async () => {
    triggerHaptic();
    onBeforeSkip?.();
    try {
      await engine.skipToNext();
    } catch (error) {
      console.warn('[PlayerControls] Skip next error:', error);
    }
  }, [engine, onBeforeSkip]);

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

  const handlePress = useCallback(async () => {
    triggerHaptic();
    onBeforeSkip?.();
    try {
      await engine.skipToPrevious();
    } catch (error) {
      console.warn('[PlayerControls] Skip previous error:', error);
    }
  }, [engine, onBeforeSkip]);

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

  const handlePress = useCallback(async () => {
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
  }, [router, activeTrack]);

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

  const handleDownload = useCallback(async () => {
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
  }, [activeTrack, downloaded, downloading]);

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

  const handleShare = useCallback(async () => {
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
  }, [activeTrack]);

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
  
  return (
    <View style={style}>
      <TouchableOpacity onPress={onPress || triggerHaptic}>
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
  return (
    <View style={style}>
      <TouchableOpacity onPress={onPress || triggerHaptic}>
        <View style={styles.iconWithCount}>
          <Ionicons
            name={isLiked ? "thumbs-up" : "thumbs-up-outline"}
            size={iconSize}
            color={isLiked ? Colors.gold : Colors.text}
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
  return (
    <View style={style}>
      <TouchableOpacity onPress={onPress || triggerHaptic}>
        <View style={styles.iconWithCount}>
          <Ionicons
            name={isDisliked ? "thumbs-down" : "thumbs-down-outline"}
            size={iconSize}
            color={isDisliked ? Colors.gold : Colors.text}
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
      <Ionicons name="play-circle-outline" size={14} color={Colors.textSub} />
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

  const toggleRepeatMode = useCallback(() => {
    triggerHaptic();
    const currentIndex = repeatOrder.indexOf(repeatMode);
    const nextUi = repeatOrder[(currentIndex + 1) % repeatOrder.length];
    engine.setRepeatMode(uiToEngine(nextUi));
  }, [engine, repeatMode]);

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

// ─── ActionRow (Horizontal Scrollable) ───────────────────────────────────────
// This component wraps all action buttons in a horizontally scrollable view

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
  showDownload = true,
  showShare = true,
  showPlaylist = true,
  showComments = true,
  showLikeDislike = true,
  showViewCount = true,
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
  showDownload?: boolean;
  showShare?: boolean;
  showPlaylist?: boolean;
  showComments?: boolean;
  showLikeDislike?: boolean;
  showViewCount?: boolean;
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
      {/* Like button */}
      {showLikeDislike && !isLocal && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onLikePress} activeOpacity={0.7}>
            <View style={styles.iconWithCount}>
              <Ionicons
                name={isLiked ? "thumbs-up" : "thumbs-up-outline"}
                size={iconSize}
                color={isLiked ? Colors.gold : Colors.text}
              />
              {likeCount > 0 && (
                <Text style={styles.iconCountText}>{formatCount(likeCount)}</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Dislike button */}
      {showLikeDislike && !isLocal && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onDislikePress} activeOpacity={0.7}>
            <View style={styles.iconWithCount}>
              <Ionicons
                name={isDisliked ? "thumbs-down" : "thumbs-down-outline"}
                size={iconSize}
                color={isDisliked ? Colors.gold : Colors.text}
              />
              {dislikeCount > 0 && (
                <Text style={styles.iconCountText}>{formatCount(dislikeCount)}</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Comments button */}
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
      
      {/* View count badge */}
      {showViewCount && !isLocal && viewCount > 0 && (
        <View style={[styles.actionItem, styles.viewCountItem]}>
          <Ionicons name="play-circle-outline" size={smallIconSize} color={Colors.textSub} />
          <Text style={styles.viewCountText}>{formatCount(viewCount)} views</Text>
        </View>
      )}
      
      {/* Add to Playlist button */}
      {showPlaylist && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onPlaylistPress} activeOpacity={0.7}>
            <MaterialIcons name="playlist-add" size={iconSize} color={Colors.text} />
          </TouchableOpacity>
        </View>
      )}
      
      {/* Download button */}
      {showDownload && (
        <View style={styles.actionItem}>
          <DownloadSongButton iconSize={iconSize} />
        </View>
      )}
      
      {/* Share button */}
      {showShare && (
        <View style={styles.actionItem}>
          <TouchableOpacity onPress={onSharePress} activeOpacity={0.7}>
            <Ionicons name="share-outline" size={iconSize} color={Colors.text} />
          </TouchableOpacity>
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
    backgroundColor: Colors.gold,
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
    color: Colors.textSub,
    fontSize: moderateScale(11),
    fontWeight: "500",
  },
});