// ============================================================================
// COMPONENTS/EQUALIZER/ProfessionalEQSlider.tsx (100% POWERAMP IDENTICAL)
// ============================================================================
// Exact Poweramp slider with gradient track and elongated thumb

import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  interpolateColor,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import * as Haptics from 'expo-haptics';

interface ProfessionalEQSliderProps {
  value: number;        // -15 to +15 dB
  onChange: (v: number) => void;
  label: string;        // "31", "62", "1K", etc.
  enabled?: boolean;
  isPreamp?: boolean;
}

const SLIDER_HEIGHT = verticalScale(240);
const TRACK_WIDTH = scale(6);
const THUMB_W = scale(24);
const THUMB_H = verticalScale(56);  // Much taller like Poweramp
const MAX_DB = 15;
const MIN_DB = -15;
const DB_RANGE = MAX_DB - MIN_DB;

// Poweramp exact colors - gradient stops
const GRADIENT_COLORS = {
  positive: ['#4ade80', '#a3e635', '#facc15', '#f97316'], // Green -> Lime -> Yellow -> Orange
  negative: ['#f97316', '#ef4444'], // Orange -> Red
};

// Worklet functions
function dbToProgress(db: number): number {
  'worklet';
  return (db + MAX_DB) / DB_RANGE;
}

function progressToDb(progress: number): number {
  'worklet';
  return (progress * DB_RANGE) - MAX_DB;
}

function getGradientColor(progress: number): string {
  'worklet';
  // Create gradient effect based on position
  const center = 0.5;
  const deviation = Math.abs(progress - center) * 2; // 0 to 1
  
  if (progress > center) {
    // Positive: Green (0.5) -> Yellow (0.75) -> Orange (1.0)
    if (deviation < 0.5) return '#4ade80';
    if (deviation < 0.75) return '#a3e635';
    if (deviation < 0.9) return '#facc15';
    return '#f97316';
  } else if (progress < center) {
    // Negative: Yellow -> Orange -> Red
    if (deviation < 0.5) return '#fbbf24';
    if (deviation < 0.75) return '#f97316';
    return '#ef4444';
  }
  return '#666';
}

export const ProfessionalEQSlider: React.FC<ProfessionalEQSliderProps> = ({
  value,
  onChange,
  label,
  enabled = true,
  isPreamp = false,
}) => {
  const progress = useSharedValue(dbToProgress(value));
  const isDragging = useSharedValue(false);
  const thumbScale = useSharedValue(1);
  const displayDb = useSharedValue(value);

  useEffect(() => {
    if (!isDragging.value) {
      progress.value = withSpring(dbToProgress(value), {
        damping: 25,
        stiffness: 300,
      });
      displayDb.value = value;
    }
  }, [value]);

  const hapticLight = useCallback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), []);
  const hapticMed = useCallback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), []);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(2)
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      thumbScale.value = withSpring(1.05, { damping: 15, stiffness: 400 });
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      'worklet';
      const sensitivity = 0.007;
      const delta = -e.translationY * sensitivity;
      progress.value = Math.max(0, Math.min(1, progress.value + delta));
      const db = progressToDb(progress.value);
      const snapped = Math.round(db * 10) / 10;
      displayDb.value = snapped;
      runOnJS(onChange)(snapped);
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      thumbScale.value = withSpring(1, { damping: 20, stiffness: 300 });
      const currentDb = progressToDb(progress.value);
      if (Math.abs(currentDb) < 0.5) {
        progress.value = withSpring(0.5, { damping: 20, stiffness: 300 });
        displayDb.value = 0;
        runOnJS(onChange)(0);
        runOnJS(hapticMed)();
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      'worklet';
      progress.value = withSpring(0.5, { damping: 20, stiffness: 300 });
      displayDb.value = 0;
      runOnJS(onChange)(0);
      runOnJS(hapticMed)();
    });

  const composed = Gesture.Exclusive(doubleTap, pan);

  const thumbStyle = useAnimatedStyle(() => {
    const travel = SLIDER_HEIGHT - THUMB_H;
    const y = (1 - progress.value) * travel;
    return {
      transform: [{ translateY: y }, { scale: thumbScale.value }],
    };
  });

  const fillStyle = useAnimatedStyle(() => {
    const centerY = SLIDER_HEIGHT / 2;
    const thumbY = (1 - progress.value) * (SLIDER_HEIGHT - THUMB_H) + THUMB_H / 2;
    const isPositive = progress.value > 0.5;
    
    return {
      top: isPositive ? thumbY : centerY,
      height: Math.abs(centerY - thumbY),
      backgroundColor: enabled ? getGradientColor(progress.value) : '#333',
      opacity: enabled ? interpolate(
        Math.abs(progress.value - 0.5),
        [0, 0.5],
        [0.4, 1],
        Extrapolation.CLAMP
      ) : 0.15,
    };
  });

  const currentDb = displayDb.value;
  const displayValue = currentDb === 0 ? '0.0' : 
    currentDb > 0 ? `+${currentDb.toFixed(1)}` : currentDb.toFixed(1);

  return (
    <View style={styles.container}>
      {/* Slider Area */}
      <GestureDetector gesture={composed}>
        <View style={styles.sliderArea}>
          {/* Track Background */}
          <View style={styles.trackBg}>
            <View style={styles.zeroLine} />
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>

          {/* Thumb - Poweramp exact elongated pill shape */}
          <Animated.View style={[styles.thumbContainer, thumbStyle]}>
            <View style={[
              styles.thumb,
              !enabled && styles.thumbDisabled,
              isPreamp && enabled && styles.thumbPreamp,
            ]}>
              {/* Horizontal indicator line - Poweramp style */}
              <View style={styles.thumbLine} />
            </View>
          </Animated.View>

          {/* Tick marks */}
          <View style={styles.ticks}>
            {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
              <View 
                key={i} 
                style={[
                  styles.tick,
                  { top: `${(1 - tick) * 100}%` },
                  tick === 0.5 && styles.tickCenter,
                ]} 
              />
            ))}
          </View>
        </View>
      </GestureDetector>

      {/* Labels - Poweramp style: Freq on top, dB value below */}
      <View style={styles.labelsContainer}>
        <Text style={[styles.freqLabel, !enabled && styles.labelDisabled]}>
          {label}
        </Text>
        <Text style={[
          styles.dbLabel,
          !enabled && styles.labelDisabled,
          currentDb > 0 && styles.dbPositive,
          currentDb < 0 && styles.dbNegative,
        ]}>
          {displayValue}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: scale(36),
  },
  sliderArea: {
    height: SLIDER_HEIGHT,
    width: scale(28),
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackBg: {
    width: TRACK_WIDTH,
    height: '100%',
    backgroundColor: '#0f0f0f',
    borderRadius: TRACK_WIDTH / 2,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    overflow: 'hidden',
  },
  zeroLine: {
    position: 'absolute',
    left: -2,
    right: -2,
    top: '50%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: -0.75,
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: TRACK_WIDTH / 2,
  },
  thumbContainer: {
    position: 'absolute',
    left: (scale(28) - THUMB_W) / 2,
    top: 0,
    width: THUMB_W,
    height: THUMB_H,
    zIndex: 10,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: THUMB_W / 2,  // Pill shape
    backgroundColor: '#1f1f1f',
    borderWidth: 1.5,
    borderColor: '#3a3a3a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 10,
  },
  thumbDisabled: {
    backgroundColor: '#151515',
    borderColor: '#222',
  },
  thumbPreamp: {
    borderColor: '#4ade80',
    shadowColor: '#4ade80',
    shadowOpacity: 0.3,
  },
  thumbLine: {
    width: THUMB_W * 0.55,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 1.5,
  },
  ticks: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  tick: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  tickCenter: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 1.5,
  },
  labelsContainer: {
    marginTop: verticalScale(8),
    alignItems: 'center',
  },
  freqLabel: {
    color: '#888',
    fontSize: moderateScale(9),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dbLabel: {
    color: '#555',
    fontSize: moderateScale(8),
    fontWeight: '600',
    fontFamily: 'monospace',
    marginTop: verticalScale(2),
  },
  labelDisabled: {
    color: '#333',
  },
  dbPositive: {
    color: '#4ade80',
  },
  dbNegative: {
    color: '#f97316',
  },
});