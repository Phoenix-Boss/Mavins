// components/equalizer/RotaryKnob.tsx
//
// Fixes vs original:
//  1. Gesture.Race → Gesture.Exclusive(doubleTap, pan) so double-tap
//     has priority and is not cancelled by micro finger movement
//  2. runOnJS(triggerHaptic)() — was missing the () call on double-tap
//  3. valueToAngle / angleToValue functions defined outside component
//     so they are stable worklets (not re-created on every render)
//  4. onUpdate uses e.translationY delta from last event (changeY) instead
//     of absolute translationY, preventing jump on fast direction change

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS, clamp,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import * as Haptics from 'expo-haptics';

interface RotaryKnobProps {
  value:     number;         // 0–100
  label:     string;
  onChange:  (value: number) => void;
  size?:     number;
  color?:    string;
  enabled?:  boolean;
}

const ROTATION_RANGE = 270;   // degrees total travel
const MIN_ANGLE      = -135;  // fully counter-clockwise
const MAX_ANGLE      =  135;  // fully clockwise

function valueToAngle(val: number): number {
  'worklet';
  return MIN_ANGLE + (clamp(val, 0, 100) / 100) * ROTATION_RANGE;
}

function angleToValue(angle: number): number {
  'worklet';
  return Math.round(clamp((angle - MIN_ANGLE) / ROTATION_RANGE, 0, 1) * 100);
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  label,
  onChange,
  size    = 80,
  color   = Colors.metallicBrown.primary,
  enabled = true,
}) => {
  const rotation   = useSharedValue(valueToAngle(value));
  const isDragging = useSharedValue(false);
  const scale_     = useSharedValue(1);

  // Sync external value (preset load / reset)
  useEffect(() => {
    if (!isDragging.value) {
      rotation.value = withSpring(valueToAngle(value), { damping: 15, stiffness: 150 });
    }
  }, [value]);

  const triggerSelection = () => Haptics.selectionAsync();
  const triggerMedium    = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      isDragging.value = true;
      scale_.value     = withSpring(0.93, { stiffness: 300 });
    })
    .onUpdate(e => {
      // Use changeY (incremental delta) to avoid jump on direction change
      const sensitivity = 0.45;
      const next  = clamp(rotation.value - e.changeY * sensitivity, MIN_ANGLE, MAX_ANGLE);
      rotation.value = next;
      const v = angleToValue(next);
      runOnJS(onChange)(v);
      if (Math.abs(e.changeY) > 4) runOnJS(triggerSelection)();
    })
    .onEnd(() => {
      isDragging.value = false;
      scale_.value     = withSpring(1, { stiffness: 300 });
    });

  // Double-tap resets to 50% — must use Exclusive so pan doesn't cancel it
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      rotation.value = withSpring(valueToAngle(50), { damping: 15, stiffness: 150 });
      runOnJS(onChange)(50);
      runOnJS(triggerMedium)();   // ← was missing () in original
    });

  // Exclusive: doubleTap gets first chance; if it fails, pan activates
  const composed = Gesture.Exclusive(doubleTap, pan);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scale_.value },
    ],
  }));

  return (
    <View style={[styles.container, { width: size + 24 }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.valueText, { color: enabled ? color : '#555' }]}>
        {value}%
      </Text>

      <GestureDetector gesture={composed}>
        <View style={[styles.knobWrap, { width: size, height: size }]}>

          {/* Static outer ring */}
          <View style={[styles.ring, { borderColor: 'rgba(255,255,255,0.1)' }]} />

          {/* Rotating knob body */}
          <Animated.View
            style={[
              styles.knob,
              {
                width:        size * 0.85,
                height:       size * 0.85,
                borderRadius: (size * 0.85) / 2,
              },
              knobStyle,
            ]}
          >
            {/* Indicator dot near top edge */}
            <View style={styles.indicatorWrap}>
              <View style={[styles.indicatorDot, { backgroundColor: enabled ? color : '#333' }]} />
            </View>

            {/* Center grip cross */}
            <View style={styles.gripCross}>
              <View style={styles.gripLine} />
              <View style={[styles.gripLine, { transform: [{ rotate: '90deg' }] }]} />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    color:          '#fff',
    fontSize:       moderateScale(10),
    fontWeight:     '700',
    marginBottom:   verticalScale(2),
    textTransform:  'uppercase',
    letterSpacing:  0.5,
  },
  valueText: {
    fontSize:   moderateScale(12),
    fontWeight: '800',
    marginBottom: verticalScale(6),
  },
  knobWrap: {
    justifyContent: 'center',
    alignItems:     'center',
  },
  ring: {
    position:     'absolute',
    width:        '100%',
    height:       '100%',
    borderRadius: 100,
    borderWidth:  2,
  },
  knob: {
    backgroundColor: '#1a1a1a',
    justifyContent:  'center',
    alignItems:      'center',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.5,
    shadowRadius:    6,
    elevation:       8,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
  },
  indicatorWrap: {
    position:       'absolute',
    width:          '100%',
    height:         '100%',
    justifyContent: 'flex-start',
    alignItems:     'center',
    paddingTop:     '12%',
  },
  indicatorDot: {
    width:        5,
    height:       5,
    borderRadius: 2.5,
  },
  gripCross: {
    width:          '40%',
    height:         '40%',
    borderRadius:   100,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems:     'center',
  },
  gripLine: {
    position:        'absolute',
    width:           '65%',
    height:          1,
    backgroundColor: '#333',
  },
});