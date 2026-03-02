// components/equalizer/RotaryKnob.tsx - FIXED 360° ROTATION

import React, { useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  PanResponder,
  Animated 
} from 'react-native';
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
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  label,
  onChange,
  size = 80,
  color = Colors.metallicBrown.primary,
  showValue = true,
  enabled = true,
}) => {
  // Animation values
  const rotation = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  
  // Track previous value for haptics
  const previousValue = useRef(value);
  
  // Convert value to rotation angle (0-100% -> 0-360°)
  const valueToAngle = (val: number) => (val / 100) * 360;
  
  // Convert angle to value with proper wrapping
  const angleToValue = (angle: number) => {
    // Normalize angle to 0-360
    let normalized = angle % 360;
    if (normalized < 0) normalized += 360;
    
    // Convert to 0-100
    return Math.round((normalized / 360) * 100);
  };

  // Update rotation when value changes
  React.useEffect(() => {
    Animated.spring(rotation, {
      toValue: valueToAngle(value),
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
      mass: 1,
    }).start();
  }, [value]);

  // PanResponder for smooth 360° rotation
  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: () => enabled,
    
    onPanResponderGrant: (evt) => {
      if (!enabled) return;
      
      // Press feedback
      Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
        damping: 15,
        stiffness: 300,
      }).start();
      
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    
    onPanResponderMove: (evt, gestureState) => {
      if (!enabled) return;
      
      // Get touch position relative to knob center
      const { locationX, locationY } = evt.nativeEvent;
      const centerX = size / 2;
      const centerY = size / 2;
      
      // Calculate angle from center to touch point
      const dx = locationX - centerX;
      const dy = locationY - centerY;
      
      // Get angle in radians, convert to degrees
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      
      // Convert to 0-360 range (atan2 returns -180 to 180)
      angle = (angle + 360) % 360;
      
      // Convert angle to value
      const newValue = angleToValue(angle);
      
      // Trigger haptic on significant changes
      if (Math.abs(newValue - previousValue.current) >= 5) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        previousValue.current = newValue;
      }
      
      // Update parent
      onChange(newValue);
    },
    
    onPanResponderRelease: () => {
      if (!enabled) return;
      
      // Release animation
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 15,
        stiffness: 300,
      }).start();
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  }), [enabled, size, onChange]);

  const rotateInterpolation = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View 
      style={[
        styles.container,
        {
          opacity: enabled ? 1 : 0.5,
          transform: [{ scale: scaleAnim }]
        }
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      
      {showValue && (
        <Text style={[styles.value, { color: enabled ? color : '#666' }]}>
          {value}%
        </Text>
      )}
      
      {/* Touchable knob area */}
      <View 
        style={[styles.knobWrapper, { width: size, height: size }]}
        {...panResponder.panHandlers}
      >
        {/* Background ring */}
        <View style={[styles.ring, { 
          width: size, 
          height: size, 
          borderRadius: size / 2,
          borderColor: enabled ? color : '#333',
        }]} />
        
        {/* Rotating knob */}
        <Animated.View
          style={[
            styles.knob,
            {
              width: size * 0.8,
              height: size * 0.8,
              borderRadius: (size * 0.8) / 2,
              backgroundColor: '#2a2a2a',
              transform: [{ rotate: rotateInterpolation }],
            }
          ]}
        >
          {/* Indicator dot */}
          <View style={[styles.indicator, { 
            backgroundColor: enabled ? color : '#666',
            top: size * 0.1,
          }]} />
        </Animated.View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: scale(95),
  },
  label: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
    marginBottom: verticalScale(4),
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
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.3,
  },
  knob: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  indicator: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});