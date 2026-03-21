// components/player/PlayerControls.tsx
/**
 * PlayerControls.tsx
 * 
 * Uses playerStore.setIsPlaying() for INSTANT UI feedback
 */

import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { useTrackPlayerRepeatMode } from "@/hooks/useTrackPlayerRepeatMode";
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
import TrackPlayer, {
  RepeatMode,
  useActiveTrack,
} from "react-native-track-player";
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
  const { togglePlayPause, isPlaying: contextIsPlaying } = useMusicPlayer();
  
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
  }, [storeIsPlaying, contextIsPlaying, togglePlayPause, setStoreIsPlaying]);

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
}: PlayerButtonProps) => (
  <TouchableOpacity
    onPress={() => {
      triggerHaptic();
      onBeforeSkip?.();
      TrackPlayer.skipToNext();
    }}
  >
    {isFloatingPlayer ? (
      <MaterialIcons name="skip-next" size={iconSize} color="#fff" />
    ) : (
      <MaterialCommunityIcons name="skip-next-outline" size={iconSize} color="#fff" />
    )}
  </TouchableOpacity>
);

// ─── SkipToPreviousButton ────────────────────────────────────────────────────

export const SkipToPreviousButton = ({
  iconSize = moderateScale(40),
  isFloatingPlayer = false,
  onBeforeSkip,
}: PlayerButtonProps) => (
  <TouchableOpacity
    onPress={() => {
      triggerHaptic();
      onBeforeSkip?.();
      TrackPlayer.skipToPrevious();
    }}
  >
    {isFloatingPlayer ? (
      <MaterialIcons name="skip-previous" size={iconSize} color="#fff" />
    ) : (
      <MaterialCommunityIcons name="skip-previous-outline" size={iconSize} color="#fff" />
    )}
  </TouchableOpacity>
);

// ─── AddToPlaylistButton ─────────────────────────────────────────────────────

export const AddToPlaylistButton = ({ iconSize = moderateScale(30) }) => {
  const router = useRouter();
  const activeTrack = useActiveTrack();

  return (
    <View>
      <TouchableOpacity
        onPress={async () => {
          triggerHaptic();
          await router.push({
            pathname: "/(modals)/addToPlaylist",
            params: activeTrack
              ? {
                  track: JSON.stringify({
                    id: activeTrack.id,
                    title: activeTrack.title || "",
                    artist: activeTrack.artist || "",
                    thumbnail: activeTrack.artwork || unknownTrackImageUri,
                  }),
                }
              : undefined,
          });
        }}
      >
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
  const activeTrack = useActiveTrack();
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
      thumbnailUrl: activeTrack.artwork,
    });
  }, [activeTrack, downloaded, downloading]);

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
  const { repeatMode, changeRepeatMode } = useTrackPlayerRepeatMode();

  const toggleRepeatMode = () => {
    triggerHaptic();
    if (repeatMode == null) return;
    const currentIndex = repeatOrder.indexOf(repeatMode);
    const nextIndex = (currentIndex + 1) % repeatOrder.length;
    changeRepeatMode(repeatOrder[nextIndex]);
  };

  const icon = match(repeatMode)
    .returnType<RepeatIconName>()
    .with(RepeatMode.Off, () => "repeat-off")
    .with(RepeatMode.Track, () => "repeat-once")
    .with(RepeatMode.Queue, () => "repeat")
    .otherwise(() => "repeat-off");

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