// components/player/PlayerControls.tsx
/**
 * PlayerControls.tsx - expo-av version
 * 
 * Uses playerStore.setIsPlaying() for INSTANT UI feedback
 * All RNTP calls replaced with MusicPlayerContext methods
 */

import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useTrackPlayerRepeatMode, RepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
import { downloadAndSaveSong } from "@/services/download";
import { useIsSongDownloaded, useIsSongDownloading } from "@/store/library";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { usePlayerStore } from "@/store/player";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { ComponentProps, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
  RegisteredStyle,
  ToastAndroid,
  ActivityIndicator,
} from "react-native";
import { moderateScale } from "react-native-size-matters/extend";

import { match } from "ts-pattern";

export type PlayerControlsProps = {
  style?: ViewStyle;
  onBeforeSkip?: () => void;
};

export type PlayerButtonProps = {
  style?:
    | ViewStyle
    | RegisteredStyle<ViewStyle>
    | (ViewStyle | RegisteredStyle<ViewStyle>)[];
  iconSize?: number;
  isFloatingPlayer?: boolean;
  onBeforeSkip?: () => void;
};

// ─── PlayerControls ──────────────────────────────────────────────────────────

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
// Uses playerStore for INSTANT UI feedback

export const PlayPauseButton = ({
  style,
  iconSize = moderateScale(65),
  isFloatingPlayer = false,
}: PlayerButtonProps) => {
  const { togglePlayPause, isPlaying: contextIsPlaying, isLoading, currentTrack } = useMusicPlayer();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // INSTANT UI: Use playerStore for immediate state updates
  // ═══════════════════════════════════════════════════════════════════════════
  
  const storeIsPlaying = usePlayerStore((state) => state.isPlaying);
  const setStoreIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  
  // Track if we're in "dumb mode"
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

  // ═══════════════════════════════════════════════════════════════════════════

  const handlePress = useCallback(() => {
    triggerHaptic();
    
    // Don't allow play/pause if no track is loaded
    if (!currentTrack && !storeIsPlaying) {
      return;
    }
    
    // Enter dumb mode
    dumbModeRef.current = true;
    
    // INSTANT: Update store immediately
    const nextState = !storeIsPlaying;
    setStoreIsPlaying(nextState);
    
    // Clear existing timeout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
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
  }, [storeIsPlaying, contextIsPlaying, togglePlayPause, setStoreIsPlaying, currentTrack]);

  // Show loading indicator while track is loading
  if (isLoading) {
    return (
      <View style={[
        isFloatingPlayer
          ? { height: iconSize }
          : {
              height: iconSize,
              width: iconSize,
              borderRadius: iconSize / 2,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
            },
        style,
      ]}>
        <ActivityIndicator size="small" color="#000" />
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[
        isFloatingPlayer
          ? { height: iconSize }
          : {
              height: iconSize,
              width: iconSize,
              borderRadius: storeIsPlaying ? iconSize * 0.35 : iconSize / 2,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
            },
        style,
      ]}
      onPress={handlePress}
    >
      <MaterialIcons
        name={storeIsPlaying ? "pause" : "play-arrow"}
        size={isFloatingPlayer ? iconSize : iconSize * 0.65}
        color={isFloatingPlayer ? "#fff" : "#000"}
      />
    </TouchableOpacity>
  );
};

// ─── SkipToNextButton ────────────────────────────────────────────────────────

export const SkipToNextButton = ({
  iconSize = moderateScale(40),
  isFloatingPlayer = false,
  onBeforeSkip,
}: PlayerButtonProps) => {
  const { skipToNext, queue, currentQueueIndex } = useMusicPlayer();
  
  const handlePress = useCallback(() => {
    triggerHaptic();
    onBeforeSkip?.();
    skipToNext();
  }, [skipToNext, onBeforeSkip]);
  
  // Check if there's a next track
  const hasNextTrack = queue.length > 0 && currentQueueIndex < queue.length - 1;
  
  return (
    <TouchableOpacity 
      onPress={handlePress}
      activeOpacity={hasNextTrack ? 0.7 : 1}
      disabled={!hasNextTrack}
    >
      {isFloatingPlayer ? (
        <MaterialIcons 
          name="skip-next" 
          size={iconSize} 
          color={hasNextTrack ? "#fff" : "rgba(255,255,255,0.3)"} 
        />
      ) : (
        <MaterialCommunityIcons 
          name="skip-next-outline" 
          size={iconSize} 
          color={hasNextTrack ? "#fff" : "rgba(255,255,255,0.3)"} 
        />
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
  const { skipToPrevious, position, queue, currentQueueIndex } = useMusicPlayer();
  
  const handlePress = useCallback(() => {
    triggerHaptic();
    onBeforeSkip?.();
    skipToPrevious();
  }, [skipToPrevious, onBeforeSkip]);
  
  // Check if there's a previous track (or we can seek to start)
  const hasPreviousTrack = queue.length > 0 && (currentQueueIndex > 0 || position > 3);
  
  return (
    <TouchableOpacity 
      onPress={handlePress}
      activeOpacity={hasPreviousTrack ? 0.7 : 1}
      disabled={!hasPreviousTrack}
    >
      {isFloatingPlayer ? (
        <MaterialIcons 
          name="skip-previous" 
          size={iconSize} 
          color={hasPreviousTrack ? "#fff" : "rgba(255,255,255,0.3)"} 
        />
      ) : (
        <MaterialCommunityIcons 
          name="skip-previous-outline" 
          size={iconSize} 
          color={hasPreviousTrack ? "#fff" : "rgba(255,255,255,0.3)"} 
        />
      )}
    </TouchableOpacity>
  );
};

// ─── AddToPlaylistButton ─────────────────────────────────────────────────────

export const AddToPlaylistButton = ({ iconSize = moderateScale(30) }) => {
  const router = useRouter();
  const { currentTrack } = useMusicPlayer();

  const handlePress = useCallback(async () => {
    triggerHaptic();
    await router.push({
      pathname: "/(modals)/addToPlaylist",
      params: currentTrack
        ? {
            track: JSON.stringify({
              id: currentTrack.id,
              title: currentTrack.title || "",
              artist: currentTrack.artist || "",
              thumbnail: currentTrack.artwork || unknownTrackImageUri,
            }),
          }
        : undefined,
    });
  }, [router, currentTrack]);

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
  const { currentTrack } = useMusicPlayer();
  const downloaded = useIsSongDownloaded(currentTrack?.id || "");
  const downloading = useIsSongDownloading(currentTrack?.id || "");

  const handleDownload = useCallback(async () => {
    if (!currentTrack || downloaded) return;
    if (downloading) {
      ToastAndroid.show("Song is already downloading", ToastAndroid.SHORT);
      return;
    }
    triggerHaptic();
    await downloadAndSaveSong({
      id: currentTrack.id,
      title: currentTrack.title || "Unknown Title",
      artist: currentTrack.artist || "Unknown Artist",
      duration: currentTrack.duration,
      url: currentTrack.url || "",
      thumbnailUrl: currentTrack.artwork,
    });
  }, [currentTrack, downloaded, downloading]);

  if (!currentTrack) return null;

  return (
    <View style={style}>
      <TouchableOpacity onPress={handleDownload}>
        {downloading ? (
          <ActivityIndicator size={iconSize} color="#000" />
        ) : (
          <MaterialIcons
            name={downloaded ? "file-download-done" : "file-download"}
            size={iconSize}
            color="#000"
          />
        )}
      </TouchableOpacity>
    </View>
  );
};

// ─── RepeatToggle ────────────────────────────────────────────────────────────

export type RepeatIconProps = Omit<ComponentProps<typeof MaterialCommunityIcons>, "name">;
type RepeatIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const repeatOrder = [RepeatMode.Off, RepeatMode.Track, RepeatMode.Queue] as const;

export const RepeatToggle = ({ ...iconProps }: RepeatIconProps) => {
  const { repeatMode, cycleRepeatMode, isLoading } = useTrackPlayerRepeatMode();

  const toggleRepeatMode = useCallback(() => {
    triggerHaptic();
    if (repeatMode == null) return;
    cycleRepeatMode();
  }, [repeatMode, cycleRepeatMode]);

  const icon = match(repeatMode)
    .returnType<RepeatIconName>()
    .with(RepeatMode.Off, () => "repeat-off")
    .with(RepeatMode.Track, () => "repeat-once")
    .with(RepeatMode.Queue, () => "repeat")
    .otherwise(() => "repeat-off");

  if (isLoading) {
    return (
      <View style={{ width: moderateScale(32), alignItems: "center" }}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
      </View>
    );
  }

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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { width: "100%" },
  row: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
});