// components/equalizer/RotaryKnob.tsx
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  clamp,
  useDerivedValue,
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
  enabled?: boolean;
}

// Constants for the knob physics
const ROTATION_RANGE = 270; // Total degrees of travel (270 degrees)
const KNOB_MIN_ANGLE = -135; // Start angle (fully left/down)
const KNOB_MAX_ANGLE = 135;  // End angle (fully right/up)

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  label,
  onChange,
  size = 80,
  color = Colors.metallicBrown.primary,
  enabled = true,
}) => {
  const rotation = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const scaleFactor = useSharedValue(1);

  // Convert value (0-100) to angle (-135 to +135)
  const valueToAngle = (val: number) => {
    'worklet';
    return KNOB_MIN_ANGLE + (val / 100) * ROTATION_RANGE;
  };

  // Convert angle back to value (0-100)
  const angleToValue = (angle: number) => {
    'worklet';
    const normalized = (angle - KNOB_MIN_ANGLE) / ROTATION_RANGE;
    return Math.round(clamp(normalized, 0, 1) * 100);
  };

  // Sync external value changes to rotation
  useEffect(() => {
    if (!isDragging.value) {
      rotation.value = withSpring(valueToAngle(value), {
        damping: 15,
        stiffness: 150,
      });
    }
  }, [value]);

  const triggerHaptic = () => {
    Haptics.selectionAsync();
  };

  // Pan Gesture
  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      isDragging.value = true;
      scaleFactor.value = withSpring(0.95, { stiffness: 300 });
    })
    .onUpdate((e) => {
      // Calculate rotation based on vertical drag
      // Dragging up (negative translationY) increases value
      const sensitivity = 0.5; // Adjust for feel
      const newAngle = rotation.value - e.translationY * sensitivity;
      
      // Clamp to physical limits
      rotation.value = clamp(newAngle, KNOB_MIN_ANGLE, KNOB_MAX_ANGLE);
      
      // Convert back to value and callback
      const newValue = angleToValue(rotation.value);
      runOnJS(onChange)(newValue);
      
      // Optional: Haptic on step changes
      // runOnJS(triggerHaptic)(); 
    })
    .onEnd(() => {
      isDragging.value = false;
      scaleFactor.value = withSpring(1, { stiffness: 300 });
    });

  // Double tap to reset to 50%
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      rotation.value = withSpring(valueToAngle(50));
      runOnJS(onChange)(50);
      runOnJS(triggerHaptic);
    });

  const composedGesture = Gesture.Race(gesture, doubleTap);

  // Knob visual rotation
  const knobAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scaleFactor.value },
    ],
  }));

  // The indicator line that rotates
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={[styles.container, { width: size + 20 }]}>
      <Text style={styles.label}>{label}</Text>
      
      <Text style={[styles.valueText, { color: enabled ? color : '#555' }]}>
        {value}%
      </Text>

      <GestureDetector gesture={composedGesture}>
        <View style={[styles.knobContainer, { width: size, height: size }]}>
          
          {/* Background Track (Static) */}
          <View style={styles.trackBackground}>
            <View style={[styles.activeArc, { borderBottomColor: color }]} />
          </View>

          {/* Rotating Knob */}
          <Animated.View
            style={[
              styles.knob,
              {
                width: size * 0.85,
                height: size * 0.85,
                borderRadius: (size * 0.85) / 2,
              },
              knobAnimatedStyle,
            ]}
          >
            {/* Indicator Dot */}
            <View style={styles.indicatorWrapper}>
               <Animated.View style={[styles.indicatorDot, { backgroundColor: enabled ? color : '#333' }, indicatorStyle]}>
                 <View style={styles.dot} />
               </Animated.View>
            </View>
            
            {/* Center Grip */}
            <View style={styles.innerCircle}>
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
    marginHorizontal: scale(5),
  },
  label: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '700',
    marginBottom: verticalScale(2),
    textTransform: 'uppercase',
  },
  valueText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '800',
    marginBottom: verticalScale(6),
  },
  knobContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  // The outer static ring
  trackBackground: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 100,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  activeArc: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 100,
    borderWidth: 2,
    borderBottomColor: 'transparent', // This is a simple visual, complex arcs require SVG
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    // Note: For a true arc, use react-native-svg. This is a CSS approximation.
  },
  knob: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  indicatorWrapper: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  indicatorDot: {
    marginTop: '10%', // Position near edge
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  innerCircle: {
    width: '40%',
    height: '40%',
    borderRadius: 100,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gripLine: {
    width: '60%',
    height: 1,
    backgroundColor: '#333',
  },
});