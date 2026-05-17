// ============================================================================
// COMPONENTS/EQUALIZER/RotaryKnob.tsx
// ============================================================================
// PURE UI COMPONENT - No native module calls
// ============================================================================

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  withDecay,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters/extend';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

interface RotaryKnobProps {
  knobId: string;
  value: number;
  label: string;
  size?: number;
  enabled?: boolean;
  color?: string;
  onValueChange: (knobId: string, value: number) => void;
}

const DEFAULT_SIZE = scale(90);
const STROKE_WIDTH = scale(6);
const ROTATION_RANGE = 270;
const START_ANGLE = -135;
const END_ANGLE = 135;

const COLORS = { bg: '#151515', track: '#252525', gold: '#c8a464', goldLight: '#e8d9c0', text: '#fff', muted: '#444' };

function unwrapAngle(prevAngle: number, newAngle: number): number {
  'worklet';
  let delta = newAngle - prevAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return prevAngle + delta;
}

function valueToRotation(value: number): number {
  'worklet';
  return START_ANGLE + (value / 100) * ROTATION_RANGE;
}

function rotationToValue(rotation: number): number {
  'worklet';
  const clamped = Math.max(START_ANGLE, Math.min(END_ANGLE, rotation));
  return ((clamped - START_ANGLE) / ROTATION_RANGE) * 100;
}

function applyEdgeResistance(value: number): number {
  'worklet';
  const edgeStart = 8;
  if (value < edgeStart) {
    const t = value / edgeStart;
    return value * (1 - t * 0.5);
  }
  if (value > 100 - edgeStart) {
    const t = (100 - value) / edgeStart;
    return value + (100 - value) * (1 - t * 0.5);
  }
  return value;
}

function applyMagneticCenter(value: number): number {
  'worklet';
  const center = 50;
  const distance = Math.abs(value - center);
  const magneticZone = 5;
  if (distance < magneticZone) {
    const strength = 1 - (distance / magneticZone);
    return value + (center - value) * (strength * 0.3);
  }
  return value;
}

function getIntentGain(speed: number): number {
  'worklet';
  if (speed < 0.3) return 0.4;
  if (speed < 0.8) return 0.7;
  if (speed < 1.8) return 1.0;
  if (speed < 3.5) return 1.5;
  return 2.2;
}

function getDynamicExponent(intentGain: number): number {
  'worklet';
  if (intentGain < 0.6) return 1.05;
  if (intentGain < 1.1) return 1.25;
  return 1.55;
}

function applySensitivityCurve(delta: number, intentGain: number): number {
  'worklet';
  const sign = delta > 0 ? 1 : -1;
  const absDelta = Math.abs(delta);
  const dynamicExponent = getDynamicExponent(intentGain);
  return sign * Math.pow(absDelta, dynamicExponent) * 0.55 * intentGain;
}

function getAngleFromTouch(touchX: number, touchY: number, centerX: number, centerY: number): number {
  'worklet';
  const dx = touchX - centerX;
  const dy = touchY - centerY;
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle < -90) angle += 360;
  if (angle > 270) angle -= 360;
  return angle;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  knobId,
  value,
  label,
  size = DEFAULT_SIZE,
  enabled = true,
  color = COLORS.gold,
  onValueChange,
}) => {
  const [layout, setLayout] = useState({ x: 0, y: 0, width: size, height: size });
  const layoutRef = useRef(layout);
  
  const rotation = useSharedValue(valueToRotation(value));
  const isDragging = useSharedValue(false);
  const scaleAnim = useSharedValue(1);
  const velocity = useSharedValue(0);
  const smoothedDelta = useSharedValue(0);
  const lastAngle = useSharedValue(valueToRotation(value));
  const lastTimestamp = useSharedValue(0);
  const isDecaying = useSharedValue(false);
  const lastHapticValue = useSharedValue(50);
  const lastRotationValue = useSharedValue(rotation.value);
  const frameTick = useSharedValue(0);

  useEffect(() => {
    if (!isDragging.value && !isDecaying.value) {
      rotation.value = withSpring(valueToRotation(value), { damping: 22, stiffness: 280 });
    }
  }, [value]);

  useAnimatedReaction(
    () => rotation.value,
    (current, previous) => {
      if (isDecaying.value && !isDragging.value && previous !== undefined) {
        const delta = current - previous;
        const instantVelocity = delta * 60;
        velocity.value = velocity.value * 0.92 + instantVelocity * 0.08;
      }
      lastRotationValue.value = current;
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
    
    const minVelocity = 0.5;
    if (Math.abs(velocity.value) < minVelocity) {
      const currentVal = rotationToValue(rotation.value);
      if (Math.abs(currentVal - 50) < 4) {
        rotation.value = withSpring(valueToRotation(50), { damping: 20, stiffness: 260 });
        runOnJS(onValueChange)(knobId, 50);
        runOnJS(triggerHaptic)(0.1);
      }
      return;
    }
    
    const handoffBoost = 1.15;
    const boostedVelocity = velocity.value * handoffBoost;
    isDecaying.value = true;
    
    rotation.value = withDecay({
      velocity: boostedVelocity * 180,
      deceleration: 0.992,
      clamp: [START_ANGLE, END_ANGLE],
    });
    
    const checkDecayComplete = () => {
      'worklet';
      if (!isDragging.value && isDecaying.value) {
        if (Math.abs(velocity.value) < 0.3) {
          isDecaying.value = false;
          velocity.value = 0;
          const finalValue = rotationToValue(rotation.value);
          if (Math.abs(finalValue - 50) < 4) {
            rotation.value = withSpring(valueToRotation(50), { damping: 20, stiffness: 260 });
            runOnJS(onValueChange)(knobId, 50);
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
      scaleAnim.value = withSpring(0.96, { stiffness: 400, damping: 25 });
      lastTimestamp.value = e.timestamp;
      velocity.value = 0;
      smoothedDelta.value = 0;
      frameTick.value = 0;
      
      const centerX = layoutRef.current.x + layoutRef.current.width / 2;
      const centerY = layoutRef.current.y + layoutRef.current.height / 2;
      const currentAngle = getAngleFromTouch(e.absoluteX, e.absoluteY, centerX, centerY);
      lastAngle.value = currentAngle;
      
      runOnJS(triggerHaptic)(0.01);
    })
    .onUpdate((e) => {
      'worklet';
      const centerX = layoutRef.current.x + layoutRef.current.width / 2;
      const centerY = layoutRef.current.y + layoutRef.current.height / 2;
      
      let rawAngle = getAngleFromTouch(e.absoluteX, e.absoluteY, centerX, centerY);
      const unwrappedAngle = unwrapAngle(lastAngle.value, rawAngle);
      let deltaAngle = unwrappedAngle - lastAngle.value;
      
      const deltaTime = Math.max(0.008, (e.timestamp - lastTimestamp.value) / 1000);
      
      const alpha = 0.35;
      smoothedDelta.value = smoothedDelta.value + alpha * (deltaAngle - smoothedDelta.value);
      
      const instantSpeed = Math.abs(smoothedDelta.value) / deltaTime;
      const intentGain = getIntentGain(instantSpeed);
      const shapedDelta = applySensitivityCurve(smoothedDelta.value, intentGain);
      
      const rawVelocity = shapedDelta / deltaTime;
      velocity.value = velocity.value * 0.6 + rawVelocity * 0.4;
      
      let newRotation = rotation.value + shapedDelta * 0.9;
      newRotation = Math.max(START_ANGLE, Math.min(END_ANGLE, newRotation));
      rotation.value = newRotation;
      
      let newValue = rotationToValue(newRotation);
      newValue = applyEdgeResistance(newValue);
      newValue = applyMagneticCenter(newValue);
      
      if (newValue !== rotationToValue(newRotation)) {
        rotation.value = valueToRotation(newValue);
      }
      
      frameTick.value = (frameTick.value + 1) % 2;
      if (frameTick.value === 0) {
        runOnJS(onValueChange)(knobId, Math.round(newValue));
      }
      
      const wasAboveCenter = lastHapticValue.value > 52;
      const isNowBelowCenter = newValue < 48;
      const wasBelowCenter = lastHapticValue.value < 48;
      const isNowAboveCenter = newValue > 52;
      if ((wasAboveCenter && isNowBelowCenter) || (wasBelowCenter && isNowAboveCenter)) {
        runOnJS(triggerHaptic)(velocity.value);
      }
      lastHapticValue.value = newValue;
      
      lastAngle.value = unwrappedAngle;
      lastTimestamp.value = e.timestamp;
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      scaleAnim.value = withSpring(1, { stiffness: 300, damping: 20 });
      startInertia();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      'worklet';
      isDecaying.value = false;
      rotation.value = withSpring(valueToRotation(50), { damping: 20, stiffness: 280 });
      velocity.value = 0;
      runOnJS(onValueChange)(knobId, 50);
      runOnJS(triggerHaptic)(0.05);
    });

  const composed = Gesture.Exclusive(doubleTap, pan);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }, { scale: scaleAnim.value }],
  }));

  const indicatorStyle = useAnimatedStyle(() => {
    const angle = rotation.value;
    const rad = ((angle - 90) * Math.PI) / 180;
    const radius = size * 0.38;
    return { transform: [{ translateX: Math.cos(rad) * radius }, { translateY: Math.sin(rad) * radius }] };
  });

  const progressStyle = useAnimatedStyle(() => {
    const progress = (rotation.value - START_ANGLE) / ROTATION_RANGE;
    const radiusVal = (size - STROKE_WIDTH) / 2;
    const circumference = 2 * Math.PI * radiusVal;
    return { strokeDashoffset: circumference * (1 - progress) };
  });

  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const displayValue = Math.round(rotationToValue(rotation.value));
  const isAtCenter = Math.abs(displayValue - 50) < 3;

  const onLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setLayout({ x, y, width, height });
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, !enabled && styles.labelDisabled]}>{label}</Text>
      <GestureDetector gesture={composed}>
        <View style={[styles.knobContainer, { width: size, height: size }]} onLayout={onLayout}>
          <View style={[styles.bgCircle, { width: size, height: size }]} />
          <Svg width={size} height={size} style={styles.progressRing}>
            <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.track} strokeWidth={STROKE_WIDTH} fill="none" />
            <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeDasharray={circumference} animatedProps={progressStyle} style={{ opacity: enabled ? 1 : 0.3 }} />
          </Svg>
          <Animated.View style={[styles.knob, knobStyle]}>
            <View style={styles.knobInner} />
          </Animated.View>
          <Animated.View style={[styles.indicator, indicatorStyle]}>
            <View style={[styles.indicatorDot, { backgroundColor: color }, !enabled && styles.indicatorDisabled, isAtCenter && styles.indicatorCenter]} />
          </Animated.View>
          <View style={styles.centerMarker} />
        </View>
      </GestureDetector>
      <Text style={[styles.valueText, !enabled && styles.valueDisabled]}>{displayValue}%</Text>
    </View>
  );
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  label: { color: COLORS.text, fontSize: moderateScale(11), fontWeight: '600', marginBottom: verticalScale(6), textTransform: 'capitalize', letterSpacing: 0.5 },
  labelDisabled: { color: COLORS.muted },
  knobContainer: { justifyContent: 'center', alignItems: 'center' },
  bgCircle: { position: 'absolute', borderRadius: 1000, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: '#222' },
  progressRing: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  knob: { width: '70%', height: '70%', borderRadius: 1000, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 },
  knobInner: { width: '25%', height: '25%', borderRadius: 1000, backgroundColor: '#2a2a2a' },
  indicator: { position: 'absolute', width: scale(14), height: scale(14), justifyContent: 'center', alignItems: 'center' },
  indicatorDot: { width: scale(8), height: scale(8), borderRadius: scale(4), shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.5, shadowRadius: 2 },
  indicatorCenter: { transform: [{ scale: 1.2 }], shadowOpacity: 0.8 },
  indicatorDisabled: { backgroundColor: '#333' },
  centerMarker: { position: 'absolute', width: scale(2), height: scale(2), borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  valueText: { marginTop: verticalScale(6), color: COLORS.text, fontSize: moderateScale(12), fontWeight: '700', fontFamily: 'monospace' },
  valueDisabled: { color: COLORS.muted },
});
