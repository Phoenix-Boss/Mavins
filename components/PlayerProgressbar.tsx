/**
 * PlayerProgressBar
 *
 * MASTER-SLAVE ARCHITECTURE:
 *   - Reads position/duration by subscribing to the master player's timeUpdate
 *     and statusChange events directly — no expo-audio hook needed.
 *   - Falls back to engine.position / engine.duration when master isn't ready.
 *   - Seek writes to masterPlayer.currentTime (master) and engine.seekTo (context).
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

import { usePlayerEngine } from "@/libs/playerSetup";

export const PlayerProgressBar = ({ style }: ViewProps) => {
  const engine = usePlayerEngine();

  const [positionSec, setPositionSec] = useState(engine.position ?? 0);
  const [durationSec, setDurationSec] = useState(engine.duration ?? 0);

  // Subscribe to master player events for real-time position updates
  useEffect(() => {
    const masterPlayer = (global as any).__MavinMasterPlayer__;
    if (!masterPlayer) return;

    // Sync initial values
    try {
      const pos = masterPlayer.currentTime ?? 0;
      const dur = masterPlayer.duration ?? 0;
      setPositionSec(pos);
      if (dur > 0) setDurationSec(dur);
    } catch {}

    let timeUpdateListener: any = null;
    let statusListener: any = null;

    try {
      timeUpdateListener = masterPlayer.addListener('timeUpdate', ({ currentTime }: any) => {
        setPositionSec(currentTime ?? 0);
        const dur = masterPlayer.duration ?? 0;
        if (dur > 0) setDurationSec(dur);
      });

      statusListener = masterPlayer.addListener('statusChange', ({ status }: any) => {
        if (status === 'readyToPlay') {
          try {
            const dur = masterPlayer.duration ?? 0;
            if (dur > 0) setDurationSec(dur);
          } catch {}
        } else if (status === 'idle') {
          setPositionSec(0);
        }
      });
    } catch (e) {
      console.warn('[PlayerProgressBar] Failed to add master listeners:', e);
    }

    return () => {
      try {
        timeUpdateListener?.remove?.();
        statusListener?.remove?.();
      } catch {}
    };
  }, []);

  // Keep in sync with engine as fallback when master isn't active (e.g. local tracks
  // where context drives state, or before master loads)
  useEffect(() => {
    if (engine.position > 0 && positionSec === 0) {
      setPositionSec(engine.position);
    }
    if (engine.duration > 0 && durationSec === 0) {
      setDurationSec(engine.duration);
    }
  }, [engine.position, engine.duration]);

  const isSliding = useSharedValue(false);
  const progress = useSharedValue(0);
  const slidingValue = useSharedValue(0);
  const min = useSharedValue(0);
  const max = useSharedValue(1);

  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitSeek = useCallback((fraction: number) => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      const targetSec = fraction * durationSec;
      // Seek master player (source of truth)
      try {
        const masterPlayer = (global as any).__MavinMasterPlayer__;
        if (masterPlayer) masterPlayer.currentTime = targetSec;
      } catch {}
      // Also notify engine/context
      engine.seekTo(targetSec);
    }, 80);
  }, [durationSec, engine]);

  // Update slider progress when not dragging
  useEffect(() => {
    if (!isSliding.value && durationSec > 0) {
      progress.value = positionSec / durationSec;
    }
  }, [positionSec, durationSec, isSliding.value, progress]);

  const trackElapsedTime = formatSecondsToMinutes(positionSec);
  const trackRemainingTime = formatSecondsToMinutes(durationSec - positionSec);

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
          const targetSec = value * durationSec;
          try {
            const masterPlayer = (global as any).__MavinMasterPlayer__;
            if (masterPlayer) masterPlayer.currentTime = targetSec;
          } catch {}
          engine.seekTo(targetSec);
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