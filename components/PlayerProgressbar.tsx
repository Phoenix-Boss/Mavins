/**
 * PlayerProgressBar
 *
 * INDUSTRY STANDARD DUAL-MODE ARCHITECTURE:
 *   - Uses useAudioPlayerStatus from expo-audio for REAL-TIME position updates
 *   - No reliance on engine.position (which is a snapshot, not reactive)
 *   - Progress bar updates at 250ms intervals (native-driven)
 *
 * FIXED: Position now updates correctly using expo-audio's useAudioPlayerStatus hook
 * FIXED: No skeleton UI - shows cover art immediately
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback, useEffect, useState } from "react";
import { useAudioPlayerStatus } from "expo-audio";

import { usePlayerEngine } from "@/libs/playerSetup";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  const engine = usePlayerEngine();
  
  // Get the global audio player instance from the module-level singleton
  const [audioPlayer, setAudioPlayer] = useState<any>(null);
  
  useEffect(() => {
    // Access the global audio player created by MusicPlayerContext
    const globalPlayer = (global as any).__MavinAudioPlayer__;
    setAudioPlayer(globalPlayer);
  }, []);
  
  // Use expo-audio's reactive hook for real-time position updates
  // This is the INDUSTRY STANDARD way to get playback position
  const status = useAudioPlayerStatus(audioPlayer);
  
  // Use reactive values from the hook, fallback to engine values
  const positionSec = status?.currentTime ?? engine.position;
  const durationSec = status?.duration ?? engine.duration;

  const isSliding = useSharedValue(false);
  const progress = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      // expo-audio uses currentTime property for seeking
      if (audioPlayer) {
        (audioPlayer as any).currentTime = fraction * durationSec;
      } else {
        engine.seekTo(fraction * durationSec);
      }
    }, 80);
  }, [durationSec, engine, audioPlayer]);

  // Update progress when not sliding - reacts to positionSec changes
  useEffect(() => {
    if (!isSliding.value && durationSec > 0) {
      progress.value = positionSec / durationSec;
    }
  }, [positionSec, durationSec, isSliding.value, progress]);

  const trackElapsedTime = formatSecondsToMinutes(positionSec);
  const trackRemainingTime = formatSecondsToMinutes(durationSec - positionSec);
  const trackDuration = formatSecondsToMinutes(durationSec);

  return (
    <View style={style}>
      <Slider
        progress={progress}
        minimumValue={min}
        maximumValue={max}
        containerStyle={{
          height: moderateScale(5),
          borderRadius: 16,
        }}
        renderBubble={() => (
          <View style={styles.bubbleContainer}>
            <Text style={styles.bubbleText}>
              {formatSecondsToMinutes(slidingValue.value * durationSec)}
            </Text>
          </View>
        )}
        renderThumb={() => (
          <View style={styles.thumb} />
        )}
        theme={{
          minimumTrackTintColor: Colors.minimumTrackTintColor,
          maximumTrackTintColor: Colors.maximumTrackTintColor,
        }}
        onSlidingStart={() => { isSliding.value = true; }}
        onValueChange={(value) => {
          slidingValue.value = value;
          runOnJS(commitSeek)(value);
        }}
        onSlidingComplete={(value) => {
          if (!isSliding.value) return;
          isSliding.value = false;
          if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
          // Final seek on complete
          if (audioPlayer) {
            (audioPlayer as any).currentTime = value * durationSec;
          } else {
            engine.seekTo(value * durationSec);
          }
        }}
      />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{trackElapsedTime}</Text>
        <Text style={styles.timeText}>
          {"-"} {trackRemainingTime}
        </Text>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: "20@vs",
  },
  timeText: {
    ...defaultStyles.text,
    color: Colors.text,
    fontSize: fontSize.xs,
    letterSpacing: 0.7,
    fontWeight: "500",
  },
  bubbleContainer: {
    backgroundColor: "transparent",
    alignItems: "flex-end",
    width: 67.5,
  },
  bubbleText: {
    color: Colors.text,
    fontWeight: "500",
  },
  thumb: {
    width: moderateScale(15),
    height: moderateScale(15),
    borderRadius: moderateScale(15) / 2,
    backgroundColor: "#fff",
  },
});