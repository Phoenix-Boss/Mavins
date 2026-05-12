/**
 * PlayerProgressBar
 *
 * NOTE — unit contract:
 *   expo-audio's useAudioPlayerStatus() returns position and duration in SECONDS.
 *   formatSecondsToMinutes() expects SECONDS.
 *
 * FIXED: All RNTP removed. Now uses PlayerEngineContext.
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback } from "react";

// FIXED: Use PlayerEngineContext instead of RNTP
import { usePlayerEngine } from "@/libs/playerSetup";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  const engine = usePlayerEngine();
  const durationSec = engine.duration;
  const positionSec = engine.position;

  // All shared values live on the UI thread — zero JS bridge for slider motion.
  const isSliding    = useSharedValue(false);
  const progress     = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  // 80ms debounce: rapid drags batch into one seek instead of hammering the player.
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      engine.seekTo(fraction * durationSec);
    }, 80);
  }, [durationSec, engine]);

  // Time labels — all in seconds.
  const trackElapsedTime   = formatSecondsToMinutes(positionSec);
  const trackRemainingTime = formatSecondsToMinutes(durationSec - positionSec);
  const trackDuration      = formatSecondsToMinutes(durationSec);

  // Slider ratio calculation
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
          engine.seekTo(value * durationSec);
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