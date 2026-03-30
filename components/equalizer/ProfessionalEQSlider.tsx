// ============================================================================
// COMPONENTS/EQUALIZER/ProfessionalEQSlider.tsx
// ============================================================================
// PURE UI COMPONENT - No native module calls
// All native interactions are handled by the parent EQ page
// ============================================================================

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  withDecay,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import * as Haptics from 'expo-haptics';

interface ProfessionalEQSliderProps {
  bandIndex: number;
  frequencyLabel: string;
  value: number;                    // dB value from parent (-15 to +15)
  enabled?: boolean;
  quantizeStep?: number;
  onValueChange: (bandIndex: number, value: number) => void;  // Pure callback
}

const SLIDER_HEIGHT = verticalScale(240);
const TRACK_WIDTH = scale(6);
const THUMB_W = scale(24);
const THUMB_H = verticalScale(56);
const MAX_DB = 15;
const MIN_DB = -15;
const DB_RANGE = MAX_DB - MIN_DB;

function quantize(db: number, step: number): number {
  'worklet';
  if (step <= 0) return db;
  return Math.round(db / step) * step;
}

function perceptualScale(progress: number): number {
  'worklet';
  const normalized = (progress - 0.5) * 2;
  const shaped = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1.6);
  return shaped * 0.5 + 0.5;
}

function inversePerceptualScale(shapedProgress: number): number {
  'worklet';
  const normalized = (shapedProgress - 0.5) * 2;
  const linear = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1 / 1.6);
  return linear * 0.5 + 0.5;
}

function dbToProgress(db: number): number {
  'worklet';
  const linear = (db + MAX_DB) / DB_RANGE;
  return perceptualScale(linear);
}

function progressToDb(progress: number): number {
  'worklet';
  const linear = inversePerceptualScale(progress);
  return (linear * DB_RANGE) - MAX_DB;
}

function applyEdgeResistance(progress: number): number {
  'worklet';
  const edgeStart = 0.08;
  if (progress < edgeStart) {
    const t = progress / edgeStart;
    return progress * (1 - t * 0.6);
  }
  if (progress > 1 - edgeStart) {
    const t = (1 - progress) / edgeStart;
    return progress + (1 - progress) * (1 - t * 0.6);
  }
  return progress;
}

function applyMagneticCenter(progress: number, db: number): number {
  'worklet';
  const center = 0.5;
  const distance = Math.abs(progress - center);
  const magneticZone = 0.045;
  if (Math.abs(db) < 0.05) return center;
  if (distance < magneticZone) {
    const strength = 1 - (distance / magneticZone);
    return progress + (center - progress) * (strength * 0.35);
  }
  return progress;
}

function getFrequencyWeight(bandIndex: number): number {
  'worklet';
  if (bandIndex < 8) return 0.75;
  if (bandIndex < 16) return 0.85;
  if (bandIndex < 24) return 1.0;
  return 1.1;
}

function getIntentGain(speed: number): number {
  'worklet';
  if (speed < 0.006) return 0.35;
  if (speed < 0.015) return 0.7;
  if (speed < 0.035) return 1.0;
  if (speed < 0.07) return 1.4;
  return 1.9;
}

function getDynamicExponent(intentGain: number): number {
  'worklet';
  if (intentGain < 0.6) return 1.1;
  if (intentGain < 1.1) return 1.3;
  return 1.6;
}

function applySensitivityCurve(delta: number, intentGain: number, frequencyWeight: number): number {
  'worklet';
  const sign = delta > 0 ? 1 : -1;
  const absDelta = Math.abs(delta);
  const dynamicExponent = getDynamicExponent(intentGain);
  let shaped = sign * Math.pow(absDelta, dynamicExponent) * 0.0075 * intentGain;
  shaped *= frequencyWeight;
  if (Math.abs(shaped) < 0.0005) return 0;
  return shaped;
}

function getGradientColor(progress: number): string {
  'worklet';
  if (progress > 0.5) {
    const t = (progress - 0.5) * 2;
    if (t < 0.33) return '#4ade80';
    if (t < 0.66) return '#a3e635';
    return '#facc15';
  } else if (progress < 0.5) {
    const t = (0.5 - progress) * 2;
    if (t < 0.5) return '#fbbf24';
    if (t < 0.75) return '#f97316';
    return '#ef4444';
  }
  return '#666';
}

export const ProfessionalEQSlider: React.FC<ProfessionalEQSliderProps> = ({
  bandIndex,
  frequencyLabel,
  value,
  enabled = true,
  quantizeStep = 0,
  onValueChange,
}) => {
  const [layout, setLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const layoutRef = useRef(layout);
  
  const progress = useSharedValue(dbToProgress(value));
  const isDragging = useSharedValue(false);
  const thumbScale = useSharedValue(1);
  const velocity = useSharedValue(0);
  const smoothedDelta = useSharedValue(0);
  const lastTimestamp = useSharedValue(0);
  const isDecaying = useSharedValue(false);
  const grabOffset = useSharedValue(0);
  const lastHapticDb = useSharedValue(0);
  const lastProgressValue = useSharedValue(progress.value);
  const frameTick = useSharedValue(0);
  const frequencyWeight = getFrequencyWeight(bandIndex);

  useEffect(() => {
    if (!isDragging.value && !isDecaying.value) {
      progress.value = withSpring(dbToProgress(value), { damping: 22, stiffness: 280 });
    }
  }, [value]);

  useAnimatedReaction(
    () => progress.value,
    (current, previous) => {
      if (isDecaying.value && !isDragging.value && previous !== undefined) {
        const delta = current - previous;
        const instantVelocity = delta * 60;
        velocity.value = velocity.value * 0.92 + instantVelocity * 0.08;
      }
      lastProgressValue.value = current;
    }
  );

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const triggerHaptic = useCallback((vel: number) => {
    const absVel = Math.abs(vel);
    if (absVel > 0.08) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (absVel > 0.03) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const startInertia = useCallback(() => {
    'worklet';
    if (isDragging.value) return;
    
    const minVelocity = 0.008;
    if (Math.abs(velocity.value) < minVelocity) {
      if (Math.abs(progress.value - 0.5) < 0.04) {
        progress.value = withSpring(0.5, { damping: 22, stiffness: 280 });
        let targetDb = progressToDb(0.5);
        targetDb = quantize(targetDb, quantizeStep);
        runOnJS(onValueChange)(bandIndex, targetDb);
        runOnJS(triggerHaptic)(0.1);
      }
      return;
    }
    
    const handoffBoost = 1.12;
    const boostedVelocity = velocity.value * handoffBoost;
    isDecaying.value = true;
    
    progress.value = withDecay({
      velocity: boostedVelocity * 800,
      deceleration: 0.993,
      clamp: [0, 1],
    });
    
    const checkDecayComplete = () => {
      'worklet';
      if (!isDragging.value && isDecaying.value) {
        if (Math.abs(velocity.value) < 0.003) {
          isDecaying.value = false;
          velocity.value = 0;
          if (Math.abs(progress.value - 0.5) < 0.035) {
            progress.value = withSpring(0.5, { damping: 22, stiffness: 280 });
            let targetDb = progressToDb(0.5);
            targetDb = quantize(targetDb, quantizeStep);
            runOnJS(onValueChange)(bandIndex, targetDb);
            runOnJS(triggerHaptic)(0.1);
          }
          return;
        }
      }
      if (!isDragging.value && isDecaying.value) {
        requestAnimationFrame(() => checkDecayComplete());
      }
    };
    
    requestAnimationFrame(() => checkDecayComplete());
  }, []);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(1)
    .maxPointers(1)
    .onBegin((e) => {
      'worklet';
      isDragging.value = true;
      isDecaying.value = false;
      thumbScale.value = withSpring(1.05, { damping: 15, stiffness: 400 });
      lastTimestamp.value = e.timestamp;
      velocity.value = 0;
      smoothedDelta.value = 0;
      frameTick.value = 0;
      
      const touchY = e.absoluteY - layoutRef.current.y;
      let rawProgress = Math.max(0, Math.min(1, 1 - (touchY / layoutRef.current.height)));
      grabOffset.value = rawProgress - progress.value;
      
      runOnJS(triggerHaptic)(0.01);
    })
    .onUpdate((e) => {
      'worklet';
      const touchY = e.absoluteY - layoutRef.current.y;
      let rawProgress = Math.max(0, Math.min(1, 1 - (touchY / layoutRef.current.height)));
      rawProgress = Math.max(0, Math.min(1, rawProgress - grabOffset.value));
      
      const deltaTime = Math.max(0.008, (e.timestamp - lastTimestamp.value) / 1000);
      let delta = rawProgress - progress.value;
      
      const alpha = 0.35;
      smoothedDelta.value = smoothedDelta.value + alpha * (delta - smoothedDelta.value);
      
      const instantVelocity = Math.abs(smoothedDelta.value) / deltaTime;
      const intentGain = getIntentGain(instantVelocity);
      const shapedDelta = applySensitivityCurve(smoothedDelta.value, intentGain, frequencyWeight);
      
      const rawVelocity = shapedDelta / deltaTime;
      velocity.value = velocity.value * 0.6 + rawVelocity * 0.4;
      
      let newProgress = progress.value + shapedDelta * 1.2;
      newProgress = Math.max(0, Math.min(1, newProgress));
      newProgress = applyEdgeResistance(newProgress);
      newProgress = applyMagneticCenter(newProgress, progressToDb(newProgress));
      let newDb = progressToDb(newProgress);
      newDb = quantize(newDb, quantizeStep);
      newProgress = dbToProgress(newDb);
      
      progress.value = newProgress;
      
      // Frame-locked callback (max ~60fps)
      frameTick.value = (frameTick.value + 1) % 2;
      if (frameTick.value === 0) {
        runOnJS(onValueChange)(bandIndex, newDb);
      }
      
      const wasPositive = lastHapticDb.value > 0.3;
      const isNowNegative = newDb < -0.3;
      const wasNegative = lastHapticDb.value < -0.3;
      const isNowPositive = newDb > 0.3;
      if ((wasPositive && isNowNegative) || (wasNegative && isNowPositive)) {
        runOnJS(triggerHaptic)(velocity.value);
      }
      lastHapticDb.value = newDb;
      lastTimestamp.value = e.timestamp;
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      thumbScale.value = withSpring(1, { damping: 20, stiffness: 300 });
      startInertia();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      'worklet';
      isDecaying.value = false;
      progress.value = withSpring(0.5, { damping: 22, stiffness: 300 });
      velocity.value = 0;
      let targetDb = quantize(0, quantizeStep);
      runOnJS(onValueChange)(bandIndex, targetDb);
      runOnJS(triggerHaptic)(0.05);
    });

  const composed = Gesture.Exclusive(doubleTap, pan);

  const thumbStyle = useAnimatedStyle(() => {
    const travel = SLIDER_HEIGHT - THUMB_H;
    const y = (1 - progress.value) * travel;
    return { transform: [{ translateY: y }, { scale: thumbScale.value }] };
  });

  const fillStyle = useAnimatedStyle(() => {
    const centerY = SLIDER_HEIGHT / 2;
    const thumbY = (1 - progress.value) * (SLIDER_HEIGHT - THUMB_H) + THUMB_H / 2;
    const isPositive = progress.value > 0.5;
    return {
      top: isPositive ? thumbY : centerY,
      height: Math.abs(centerY - thumbY),
      backgroundColor: getGradientColor(progress.value),
      opacity: enabled ? interpolate(Math.abs(progress.value - 0.5), [0, 0.5], [0.5, 1], Extrapolation.CLAMP) : 0.12,
    };
  });

  const currentProgress = progress.value;
  let displayDb = currentProgress === 0.5 ? 0 : progressToDb(currentProgress);
  displayDb = quantize(displayDb, quantizeStep);
  const displayValue = displayDb === 0 ? '0.0' : (displayDb > 0 ? `+${displayDb.toFixed(1)}` : displayDb.toFixed(1));

  const onLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setLayout({ x, y, width, height });
  };

  return (
    <View style={styles.container}>
      <GestureDetector gesture={composed}>
        <View style={styles.sliderArea} onLayout={onLayout}>
          <View style={styles.trackBg}>
            <View style={styles.zeroLine} />
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumbContainer, thumbStyle]}>
            <View style={[styles.thumb, !enabled && styles.thumbDisabled]}>
              <View style={styles.thumbLine} />
            </View>
          </Animated.View>
          <View style={styles.ticks}>
            {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
              <View key={i} style={[styles.tick, { top: `${(1 - tick) * 100}%` }, tick === 0.5 && styles.tickCenter]} />
            ))}
          </View>
        </View>
      </GestureDetector>
      <View style={styles.labelsContainer}>
        <Text style={[styles.freqLabel, !enabled && styles.labelDisabled]}>{frequencyLabel}</Text>
        <Text style={[styles.dbLabel, !enabled && styles.labelDisabled, displayDb > 0 && styles.dbPositive, displayDb < 0 && styles.dbNegative]}>{displayValue}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', width: scale(36) },
  sliderArea: { height: SLIDER_HEIGHT, width: scale(28), alignItems: 'center', justifyContent: 'center' },
  trackBg: { width: TRACK_WIDTH, height: '100%', backgroundColor: '#0f0f0f', borderRadius: TRACK_WIDTH / 2, borderWidth: 1, borderColor: '#1a1a1a', overflow: 'hidden' },
  zeroLine: { position: 'absolute', left: -2, right: -2, top: '50%', height: 1.5, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: -0.75 },
  fill: { position: 'absolute', left: 0, right: 0, borderRadius: TRACK_WIDTH / 2 },
  thumbContainer: { position: 'absolute', left: (scale(28) - THUMB_W) / 2, top: 0, width: THUMB_W, height: THUMB_H, zIndex: 10 },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: THUMB_W / 2, backgroundColor: '#1f1f1f', borderWidth: 1.5, borderColor: '#3a3a3a', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.6, shadowRadius: 5, elevation: 10 },
  thumbDisabled: { backgroundColor: '#151515', borderColor: '#222' },
  thumbLine: { width: THUMB_W * 0.55, height: 2.5, backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 1.5 },
  ticks: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none' },
  tick: { position: 'absolute', left: '15%', right: '15%', height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  tickCenter: { backgroundColor: 'rgba(255,255,255,0.2)', height: 1.5 },
  labelsContainer: { marginTop: verticalScale(8), alignItems: 'center' },
  freqLabel: { color: '#888', fontSize: moderateScale(9), fontWeight: '700', letterSpacing: 0.5 },
  dbLabel: { color: '#555', fontSize: moderateScale(8), fontWeight: '600', fontFamily: 'monospace', marginTop: verticalScale(2) },
  labelDisabled: { color: '#333' },
  dbPositive: { color: '#4ade80' },
  dbNegative: { color: '#f97316' },
});