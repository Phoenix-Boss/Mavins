// ============================================================================
// COMPONENTS/EQUALIZER/RotaryKnob.tsx (100% POWERAMP IDENTICAL)
// ============================================================================

import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters/extend';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

const COLORS = {
  bg: '#151515',
  track: '#252525',
  bass: '#4ade80',
  treble: '#60a5fa',
  text: '#fff',
  muted: '#444',
};

interface RotaryKnobProps {
  value: number;
  label: string;
  onChange: (v: number) => void;
  size?: number;
  enabled?: boolean;
}

const DEFAULT_SIZE = scale(90);
const STROKE_WIDTH = scale(6);
const ROTATION_RANGE = 270;
const START_ANGLE = -135;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function valueToRotation(val: number): number {
  'worklet';
  return START_ANGLE + (val / 100) * ROTATION_RANGE;
}

function rotationToValue(rot: number): number {
  'worklet';
  return Math.round(((rot - START_ANGLE) / ROTATION_RANGE) * 100);
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  label,
  onChange,
  size = DEFAULT_SIZE,
  enabled = true,
}) => {
  const rotation = useSharedValue(valueToRotation(value));
  const isDragging = useSharedValue(false);
  const scale_ = useSharedValue(1);

  useEffect(() => {
    if (!isDragging.value) {
      rotation.value = withSpring(valueToRotation(value), {
        damping: 20,
        stiffness: 200,
      });
    }
  }, [value]);

  const isBass = label.toLowerCase().includes('bass');
  const activeColor = isBass ? COLORS.bass : COLORS.treble;

  const hapticLight = useCallback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), []);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      scale_.value = withSpring(0.96, { stiffness: 400, damping: 25 });
      runOnJS(hapticLight)();
    })
    .onUpdate((e) => {
      'worklet';
      const sensitivity = 0.4;
      const delta = -e.translationY * sensitivity;
      const newRotation = Math.max(
        START_ANGLE,
        Math.min(START_ANGLE + ROTATION_RANGE, rotation.value + delta)
      );
      rotation.value = newRotation;
      const newValue = rotationToValue(newRotation);
      runOnJS(onChange)(newValue);
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      scale_.value = withSpring(1, { stiffness: 300, damping: 20 });
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scale_.value },
    ],
  }));

  const indicatorStyle = useAnimatedStyle(() => {
    const angle = rotation.value;
    const rad = ((angle - 90) * Math.PI) / 180;
    const radius = size * 0.38;
    return {
      transform: [
        { translateX: Math.cos(rad) * radius },
        { translateY: Math.sin(rad) * radius },
      ],
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    const progress = (rotation.value - START_ANGLE) / ROTATION_RANGE;
    return {
      strokeDashoffset: 283 * (1 - progress),
    };
  });

  return (
    <View style={styles.container}>
      <Text style={[styles.label, !enabled && styles.labelDisabled]}>{label}</Text>
      
      <GestureDetector gesture={pan}>
        <View style={[styles.knobContainer, { width: size, height: size }]}>
          <View style={[styles.bgCircle, { width: size, height: size }]} />
          
          <Svg width={size} height={size} style={styles.progressRing}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={(size - STROKE_WIDTH) / 2}
              stroke={COLORS.track}
              strokeWidth={STROKE_WIDTH}
              fill="none"
            />
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={(size - STROKE_WIDTH) / 2}
              stroke={activeColor}
              strokeWidth={STROKE_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeDasharray="283"
              animatedProps={progressStyle}
              style={{ opacity: enabled ? 1 : 0.3 }}
            />
          </Svg>

          <Animated.View style={[styles.knob, knobStyle]}>
            <View style={styles.knobInner} />
          </Animated.View>

          <Animated.View style={[styles.indicator, indicatorStyle]}>
            <View style={[
              styles.indicatorDot,
              { backgroundColor: activeColor },
              !enabled && styles.indicatorDisabled,
            ]} />
          </Animated.View>
        </View>
      </GestureDetector>

      <Text style={[styles.valueText, !enabled && styles.valueDisabled]}>
        {value}%
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    color: COLORS.text,
    fontSize: moderateScale(12),
    fontWeight: '600',
    marginBottom: verticalScale(8),
    textTransform: 'capitalize',
  },
  labelDisabled: {
    color: COLORS.muted,
  },
  knobContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bgCircle: {
    position: 'absolute',
    borderRadius: 1000,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: '#222',
  },
  progressRing: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  knob: {
    width: '70%',
    height: '70%',
    borderRadius: 1000,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  knobInner: {
    width: '25%',
    height: '25%',
    borderRadius: 1000,
    backgroundColor: '#2a2a2a',
  },
  indicator: {
    position: 'absolute',
    width: scale(12),
    height: scale(12),
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicatorDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  indicatorDisabled: {
    backgroundColor: '#333',
  },
  valueText: {
    marginTop: verticalScale(8),
    color: COLORS.text,
    fontSize: moderateScale(13),
    fontWeight: '700',
  },
  valueDisabled: {
    color: COLORS.muted,
  },
});