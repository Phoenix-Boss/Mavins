// components/player/PlayerControls.tsx
//
// FIXED: All react-native-track-player removed.
// Now uses PlayerEngineContext (via usePlayerEngine / useMusicPlayer) exclusively.
//
// Uses playerStore.setIsPlaying() for INSTANT UI feedback

import { Colors } from "@/constants/Colors";
import { unknownTrackImageUri } from "@/constants/images";
import { triggerHaptic } from "@/helpers/haptics";
import { downloadAndSaveSong } from "@/services/download";
import { useIsSongDownloaded, useIsSongDownloading } from "@/store/library";
import { useMusicPlayer, usePlayerEngine } from "@/libs/playerSetup";
import { usePlayerStore } from "@/store/player";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
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
} from "react-native";
import { moderateScale } from "react-native-size-matters/extend";
import { match } from "ts-pattern";

// ─── Types ────────────────────────────────────────────────────────────────────

type RepeatMode = "off" | "queue" | "track";

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

// ─── Local repeat state ───────────────────────────────────────────────────────

// Simple module-level state for repeat mode since it's not part of the engine context
let _repeatMode: RepeatMode = "off";
const _repeatListeners = new Set<() => void>();

function getRepeatMode(): RepeatMode {
  return _repeatMode;
}

function setRepeatMode(mode: RepeatMode) {
  _repeatMode = mode;
  _repeatListeners.forEach(fn => fn());
}

function useRepeatMode(): [RepeatMode, (mode: RepeatMode) => void] {
  const [mode, setMode] = useState<RepeatMode>(_repeatMode);
  useEffect(() => {
    const listener = () => setMode(_repeatMode);
    _repeatListeners.add(listener);
    return () => { _repeatListeners.delete(listener); };
  }, []);
  return [mode, setRepeatMode];
}

const repeatOrder: RepeatMode[] = ["off", "queue", "track"];

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

export const PlayPauseButton = ({
  style,
  iconSize = moderateScale(65),
  isFloatingPlayer = false,
}: PlayerButtonProps) => {
  const { togglePlayPause, isPlaying: contextIsPlaying } = useMusicPlayer();
  
  // INSTANT UI: Use playerStore for immediate state updates
  const storeIsPlaying = usePlayerStore((state) => state.isPlaying);
  const setStoreIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  
  const dumbModeRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Sync store with context when not in dumb mode
  useEffect(() => {
    if (!dumbModeRef.current && storeIsPlaying !== contextIsPlaying) {
      setStoreIsPlaying(contextIsPlaying);
    }
  }, [contextIsPlaying, storeIsPlaying, setStoreIsPlaying]);
  
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const handlePress = useCallback(() => {
    triggerHaptic();
    
    dumbModeRef.current = true;
    
    const nextState = !storeIsPlaying;
    setStoreIsPlaying(nextState);
    
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    requestAnimationFrame(() => {
      togglePlayPause();
    });
    
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
                    thumbnail: activeTrack.thumbnail || unknownTrackImageUri,
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

export const RepeatToggle = ({ ...iconProps }: RepeatIconProps) => {
  const [repeatMode, changeRepeatMode] = useRepeatMode();

  const toggleRepeatMode = () => {
    triggerHaptic();
    const currentIndex = repeatOrder.indexOf(repeatMode);
    const nextIndex = (currentIndex + 1) % repeatOrder.length;
    changeRepeatMode(repeatOrder[nextIndex]);
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { width: "100%" },
  row: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
});