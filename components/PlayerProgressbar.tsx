/**
 * This file defines the `PlayerProgressBar` component, which displays the current
 * playback progress of a song using a seekable slider. It also shows the elapsed, remaining,
 * and total time of the track.
 */

import { fontSize } from "@/constants/tokens";
import { Colors } from "@/constants/Colors";
import { formatSecondsToMinutes } from "@/helpers/miscellaneous";
import { defaultStyles } from "@/styles";
import { Text, View, ViewProps } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import TrackPlayer, { useProgress } from "react-native-track-player";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { useRef, useCallback } from "react";

/**
 * `PlayerProgressBar` component.
 * Displays a seekable progress bar for the current track, along with time information.
 * @param {ViewProps} { style } Props for the container View.
 */
export const PlayerProgressBar = ({ style }: ViewProps) => {
  // useProgress reads from TrackPlayer — correct for audio mode and also
  // for muxed video mode because playerContent keeps TrackPlayer seeked to
  // the same position before handing control to the video player.
  // 250ms interval matches playerContent's own useProgress interval.
  const { duration, position } = useProgress(250);

  // All shared values live on the UI thread — zero JS bridge for slider motion.
  const isSliding    = useSharedValue(false);
  const progress     = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  // 80ms debounce: rapid drags batch into one seek instead of hammering TrackPlayer.
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      TrackPlayer.seekTo(fraction * duration);
    }, 80);
  }, [duration]);

  const trackElapsedTime   = formatSecondsToMinutes(position);
  const trackRemainingTime = formatSecondsToMinutes(duration - position);
  const trackDuration      = formatSecondsToMinutes(duration);

  if (!isSliding.value) {
    progress.value = duration > 0 ? position / duration : 0;
  }

  return (
    <View style={style}>
      <Slider
        progress={progress} // Current playback progress (0-1).
        minimumValue={min} // Minimum value of the slider (0).
        maximumValue={max} // Maximum value of the slider (1).
        containerStyle={{
          height: moderateScale(5),
          borderRadius: 16,
        }}
        // Custom bubble to display the time when sliding.
        renderBubble={() => (
          <View style={styles.bubbleContainer}>
            <Text style={styles.bubbleText}>
              {formatSecondsToMinutes(slidingValue.value * duration)}
            </Text>
          </View>
        )}
        // Custom thumb for the slider.
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
        // Time bubble updates on UI thread; seek is debounced to avoid buffer thrash.
        onValueChange={(value) => {
          slidingValue.value = value;
          runOnJS(commitSeek)(value);
        }}
        onSlidingComplete={(value) => {
          if (!isSliding.value) return;
          isSliding.value = false;
          if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
          TrackPlayer.seekTo(value * duration);
        }}
      />

      {/* Display elapsed, remaining, and total time */}
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{trackElapsedTime}</Text>

        <Text style={styles.timeText}>
          {"-"} {trackRemainingTime} {"/"} {trackDuration}
        </Text>
      </View>
    </View>
  );
};

// Styles for the PlayerProgressBar component.
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