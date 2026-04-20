/**
 * PlayerProgressBar
 *
 * NOTE — unit contract:
 *   RNTP's useProgress() returns { position, duration, buffered } in SECONDS (not milliseconds).
 *   RNTP's seekTo(seconds) expects SECONDS.
 *   formatSecondsToMinutes() expects SECONDS.
 *
 *   RNTP v4+ returns values in seconds directly, so no conversion needed from ms.
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";

// RNTP imports - replacing mavin-eq
import TrackPlayer, { useProgress } from "react-native-track-player";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback } from "react";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  // RNTP useProgress returns SECONDS directly in v4+ (not milliseconds)
  const { duration: durationSec, position: positionSec } = useProgress(250);

  // All shared values live on the UI thread — zero JS bridge for slider motion.
  const isSliding    = useSharedValue(false);
  const progress     = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  // 80ms debounce: rapid drags batch into one seek instead of hammering the player.
  // seekTo() expects seconds.
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      TrackPlayer.seekTo(fraction * durationSec);
    }, 80);
  }, [durationSec]);

  // Time labels — all in seconds.
  const trackElapsedTime   = formatSecondsToMinutes(positionSec);
  const trackRemainingTime = formatSecondsToMinutes(durationSec - positionSec);
  const trackDuration      = formatSecondsToMinutes(durationSec);

  // Slider ratio calculation - using seconds directly since RNTP returns seconds
  if (!isSliding.value) {
    progress.value = durationSec > 0 ? positionSec / durationSec : 0;
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
              {/* slidingValue is a 0-1 fraction; multiply by durationSec for seconds */}
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
          // seekTo expects seconds.
          TrackPlayer.seekTo(value * durationSec);
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