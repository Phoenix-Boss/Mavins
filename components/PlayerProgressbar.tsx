/**
 * PlayerProgressBar
 *
 * NOTE — unit contract:
 *   mavin-eq's useProgress() returns { position, duration, buffered } in MILLISECONDS.
 *   mavin-eq's seekTo(seconds) expects SECONDS.
 *   formatSecondsToMinutes() expects SECONDS.
 *
 *   We divide position/duration by 1000 once here (positionSec / durationSec) and use
 *   those throughout. The slider ratio (position/duration) is unit-agnostic so we
 *   compute it from raw ms values — the units cancel out.
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import TrackPlayer, { useProgress } from "@/modules/mavin-eq";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback } from "react";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  // position and duration arrive in MILLISECONDS from mavin-eq.
  const { duration: durationMs, position: positionMs } = useProgress(250);

  // Convert to seconds for all time-display and seekTo calls.
  const positionSec = positionMs / 1000;
  const durationSec = durationMs / 1000;

  // All shared values live on the UI thread — zero JS bridge for slider motion.
  const isSliding    = useSharedValue(false);
  const progress     = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  // 80ms debounce: rapid drags batch into one seek instead of hammering the player.
  // seekTo() expects seconds — fraction * durationSec gives the correct value.
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

  // Slider ratio is unit-agnostic (ms/ms = sec/sec) — leave raw ms values here.
  if (!isSliding.value) {
    progress.value = durationMs > 0 ? positionMs / durationMs : 0;
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