// components/player/PlayerProgressbar.tsx
/**
 * PlayerProgressBar - expo-av version
 * 
 * Uses MusicPlayerContext for position/duration instead of RNTP's useProgress.
 * All times are in SECONDS.
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";

import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback, useEffect } from "react";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  // Get position and duration from MusicPlayerContext (in seconds)
  const { position: positionSec, duration: durationSec, seekTo } = useMusicPlayer();

  // All shared values live on the UI thread — zero JS bridge for slider motion.
  const isSliding    = useSharedValue(false);
  const progress     = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);
  
  // Track if component is mounted for safe updates
  const isMounted = useRef(true);

  // Update progress from context when not sliding
  useEffect(() => {
    if (!isSliding.value && durationSec > 0 && isMounted.current) {
      progress.value = positionSec / durationSec;
    }
  }, [positionSec, durationSec, isSliding.value, progress]);

  // Cleanup
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Debounced seek handler
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      const newPosition = fraction * durationSec;
      seekTo(newPosition);
    }, 80);
  }, [durationSec, seekTo]);

  // Time labels — all in seconds.
  const trackElapsedTime   = formatSecondsToMinutes(positionSec);
  const trackRemainingTime = formatSecondsToMinutes(Math.max(0, durationSec - positionSec));
  const trackDuration      = formatSecondsToMinutes(durationSec);

  // Slider ratio calculation
  if (!isSliding.value && durationSec > 0) {
    progress.value = positionSec / durationSec;
  }

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
          <View
            style={{
              width: moderateScale(15),
              height: moderateScale(15),
              borderRadius: moderateScale(15) / 2,
              backgroundColor: "#fff",
            }}
          />
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
          // Seek expects seconds
          seekTo(value * durationSec);
        }}
      />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{trackElapsedTime}</Text>
        <Text style={styles.timeText}>
          {"-"} {trackRemainingTime} {"/"} {trackDuration}
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
});