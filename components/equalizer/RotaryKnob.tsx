// components/equalizer/RotaryKnob.tsx - PROFESSIONAL ROTARY KNOB WITH RELATIVE ROTATION
// Uses relative gesture detection (vertical drag) like professional audio plugins
// Smooth 360° rotation with acceleration, dead zone, and proper value wrapping

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import * as Haptics from 'expo-haptics';

interface RotaryKnobProps {
  value: number;           // 0-100
  label: string;
  onChange: (value: number) => void;
  size?: number;
  color?: string;
  showValue?: boolean;
  enabled?: boolean;
  sensitivity?: number;    // Rotation speed multiplier (default: 0.5)
  deadZone?: number;       // Pixels of movement before value changes (default: 3)
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  label,
  onChange,
  size = 80,
  color = Colors.metallicBrown.primary,
  showValue = true,
  enabled = true,
  sensitivity = 0.5,
  deadZone = 3,
}) => {
  // Animation values
  const rotation = useSharedValue(0);
  const scaleAnim = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  
  // Track drag state
  const dragStartY = useSharedValue(0);
  const accumulatedDelta = useSharedValue(0);
  const isDragging = useSharedValue(false);
  
  // Previous value for haptics
  const previousValue = useRef(value);
  
  // Convert value to rotation angle (0-100% -> 0-360°)
  const valueToAngle = (val: number) => {
    'worklet';
    return (val / 100) * 360;
  };
  
  // Convert angle to value with proper wrapping
  const angleToValue = (angle: number) => {
    'worklet';
    // Normalize angle to 0-360
    let normalized = angle % 360;
    if (normalized < 0) normalized += 360;
    
    // Convert to 0-100
    return Math.round((normalized / 360) * 100);
  };

  // Update rotation when value changes externally
  useEffect(() => {
    rotation.value = withSpring(valueToAngle(value), {
      damping: 20,
      stiffness: 200,
      mass: 1,
    });
  }, [value]);

  // Trigger haptic feedback
  const triggerHaptic = (type: 'light' | 'medium' | 'selection' | 'success') => {
    if (type === 'selection') {
      Haptics.selectionAsync();
    } else if (type === 'light') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (type === 'medium') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (type === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // Gesture for vertical drag rotation (like most professional plugins)
  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      scaleAnim.value = withSpring(0.95, { damping: 15, stiffness: 300 });
      glowOpacity.value = withTiming(0.3, { duration: 150 });
      runOnJS(triggerHaptic)('light');
    })
    .onUpdate((event) => {
      'worklet';
      
      // Initialize drag start position
      if (dragStartY.value === 0) {
        dragStartY.value = event.y;
        return;
      }
      
      // Calculate delta Y (negative = up, positive = down)
      const deltaY = dragStartY.value - event.y;
      
      // Apply dead zone
      const absDelta = Math.abs(deltaY);
      if (absDelta < deadZone) return;
      
      // Apply sensitivity and accumulate
      const effectiveDelta = deltaY * sensitivity;
      accumulatedDelta.value += effectiveDelta;
      
      // Convert to rotation change (1 pixel = ~2 degrees for fine control)
      const rotationChange = accumulatedDelta.value * 2;
      
      // Calculate new rotation
      let newRotation = rotation.value + rotationChange;
      
      // Normalize to 0-360
      newRotation = ((newRotation % 360) + 360) % 360;
      
      // Apply rotation
      rotation.value = newRotation;
      
      // Convert to value and notify
      const newValue = angleToValue(newRotation);
      
      // Trigger haptic on significant changes (every 5%)
      const valueInt = Math.floor(newValue / 5) * 5;
      const prevInt = Math.floor(previousValue.current / 5) * 5;
      
      if (valueInt !== prevInt && absDelta > deadZone * 2) {
        runOnJS(triggerHaptic)('selection');
      }
      
      // Update parent with new value
      runOnJS(onChange)(newValue);
      
      // Reset accumulated delta for next movement
      accumulatedDelta.value = 0;
      
      // Update drag start position for continuous movement
      dragStartY.value = event.y;
    })
    .onEnd(() => {
      'worklet';
      
      // Reset drag state
      dragStartY.value = 0;
      accumulatedDelta.value = 0;
      isDragging.value = false;
      
      // Animate back to normal
      scaleAnim.value = withSpring(1, { damping: 15, stiffness: 300 });
      glowOpacity.value = withTiming(0, { duration: 300 });
      
      runOnJS(triggerHaptic)('success');
    })
    .onFinalize(() => {
      'worklet';
      isDragging.value = false;
    });

  // Tap gesture for fine adjustments
  const tapGesture = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      // Double tap resets to center (50%)
      const centerValue = 50;
      const centerAngle = valueToAngle(centerValue);
      
      rotation.value = withSpring(centerAngle, {
        damping: 15,
        stiffness: 200,
      });
      
      runOnJS(onChange)(centerValue);
      runOnJS(triggerHaptic)('medium');
    });

  // Compose gestures
  const composedGesture = Gesture.Race(gesture, tapGesture);

  // Animated styles
  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scaleAnim.value },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    borderColor: enabled ? color : '#333',
    opacity: isDragging.value ? 1 : 0.5,
    shadowColor: color,
    shadowOpacity: glowOpacity.value,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  }));

  const indicatorStyle = useAnimatedStyle(() => ({
    backgroundColor: enabled ? color : '#666',
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Format value display
  const formattedValue = `${value}%`;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      
      {showValue && (
        <Text style={[styles.value, { color: enabled ? color : '#666' }]}>
          {formattedValue}
        </Text>
      )}
      
      <GestureDetector gesture={composedGesture}>
        <Animated.View 
          style={[
            styles.knobWrapper,
            { width: size, height: size },
            { transform: [{ scale: scaleAnim }] }
          ]}
        >
          {/* Outer ring with glow effect */}
          <Animated.View style={[
            styles.outerRing,
            {
              width: size + 4,
              height: size + 4,
              borderRadius: (size + 4) / 2,
              borderColor: color,
            },
            ringStyle,
          ]} />
          
          {/* Background track (shows full range) */}
          <View style={[styles.track, { 
            width: size * 0.9, 
            height: size * 0.9,
            borderRadius: (size * 0.9) / 2,
          }]}>
            {/* Tick marks at 0%, 25%, 50%, 75%, 100% */}
            {[0, 90, 180, 270, 360].map((angle, index) => (
              <View
                key={index}
                style={[
                  styles.tick,
                  {
                    transform: [
                      { rotate: `${angle}deg` },
                      { translateY: -(size * 0.4) },
                    ],
                    backgroundColor: index === 2 ? color : 'rgba(255,255,255,0.3)',
                    width: index === 2 ? 3 : 2,
                  },
                ]}
              />
            ))}
          </View>
          
          {/* Main knob */}
          <Animated.View
            style={[
              styles.knob,
              {
                width: size * 0.8,
                height: size * 0.8,
                borderRadius: (size * 0.8) / 2,
                backgroundColor: '#2a2a2a',
                borderColor: enabled ? color : '#444',
              },
              knobStyle,
            ]}
          >
            {/* Center dot */}
            <View style={[styles.centerDot, { backgroundColor: color }]} />
            
            {/* Indicator line */}
            <Animated.View style={[styles.indicatorLine, indicatorStyle]}>
              <View style={[styles.indicator, { backgroundColor: enabled ? color : '#666' }]} />
            </Animated.View>
          </Animated.View>
          
          {/* Center cap */}
          <View style={[styles.centerCap, { 
            width: size * 0.15,
            height: size * 0.15,
            borderRadius: (size * 0.15) / 2,
            backgroundColor: '#1a1a1a',
            borderColor: color,
          }]} />
        </Animated.View>
      </GestureDetector>
      
      {/* Instruction hint (only when enabled) */}
      {enabled && (
        <Text style={styles.hint}>drag ↑↓ • double-tap ↺</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: scale(100),
  },
  label: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
    marginBottom: verticalScale(2),
    letterSpacing: 0.5,
  },
  value: {
    fontSize: moderateScale(14),
    fontWeight: '900',
    marginBottom: verticalScale(6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  knobWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  outerRing: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.3,
  },
  track: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tick: {
    position: 'absolute',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 1,
  },
  knob: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    position: 'relative',
  },
  centerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  indicatorLine: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  indicator: {
    width: 3,
    height: '30%',
    borderRadius: 1.5,
    marginTop: '10%',
  },
  centerCap: {
    position: 'absolute',
    borderWidth: 1,
  },
  hint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(8),
    marginTop: verticalScale(4),
    letterSpacing: 0.3,
  },
});