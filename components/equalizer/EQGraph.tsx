// ============================================================================
// COMPONENTS/EQUALIZER/EQGraph.tsx (FIXED)
// ============================================================================
// Poweramp-style spectrum visualization

import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { scale, verticalScale } from 'react-native-size-matters/extend';

const { width: SCREEN_W } = Dimensions.get('window');

interface EQGraphProps {
  values: number[];
  enabled?: boolean;
  isPlaying?: boolean;
  style?: any;
}

const NUM_BARS = 32;

// Worklet function for color calculation
function getBarColorWorklet(index: number): string {
  'worklet';
  if (index < 8) return '#4ade80';
  if (index < 16) return '#a3e635';
  if (index < 24) return '#facc15';
  return '#f97316';
}

// Individual bar component
const SpectrumBar = ({ 
  index, 
  enabled, 
  isPlaying, 
  eqValues 
}: { 
  index: number; 
  enabled: boolean; 
  isPlaying: boolean;
  eqValues: number[];
}) => {
  const animatedValue = useSharedValue(0.05);
  
  // Calculate target value based on playing state and EQ
  useEffect(() => {
    if (!isPlaying || !enabled) {
      animatedValue.value = withTiming(0.05, { duration: 300 });
      return;
    }

    const interval = setInterval(() => {
      const eqIndex = Math.floor(index / 3.2);
      const eqValue = eqValues[eqIndex] || 0;
      const baseHeight = 0.1 + Math.random() * 0.35;
      const eqBoost = (eqValue / 30) * 0.4;
      const target = Math.min(0.95, Math.max(0.05, baseHeight + eqBoost));
      
      animatedValue.value = withSpring(target, {
        damping: 12,
        stiffness: 200,
        mass: 0.5,
      });
    }, 50 + (index * 10)); // Stagger animations

    return () => clearInterval(interval);
  }, [isPlaying, enabled, eqValues, index]);

  const style = useAnimatedStyle(() => ({
    height: `${animatedValue.value * 100}%`,
    opacity: enabled ? interpolate(
      animatedValue.value,
      [0, 0.5, 1],
      [0.3, 0.7, 1],
      Extrapolation.CLAMP
    ) : 0.2,
  }));

  // Get color on JS thread
  const getColor = () => {
    if (index < 8) return '#4ade80';
    if (index < 16) return '#a3e635';
    if (index < 24) return '#facc15';
    return '#f97316';
  };

  return (
    <Animated.View style={[styles.bar, { backgroundColor: getColor() }, style]} />
  );
};

export const EQGraph: React.FC<EQGraphProps> = ({
  values = [], // Default to empty array
  enabled = true,
  isPlaying = false,
  style,
}) => {
  // Memoize bar indices to prevent unnecessary re-renders
  const barIndices = useMemo(() => Array.from({ length: NUM_BARS }, (_, i) => i), []);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.barsContainer}>
        {barIndices.map((index) => (
          <SpectrumBar 
            key={index} 
            index={index} 
            enabled={enabled} 
            isPlaying={isPlaying}
            eqValues={values}
          />
        ))}
      </View>
      <View style={styles.curveOverlay} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: verticalScale(56),
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    overflow: 'hidden',
    marginHorizontal: scale(16),
    marginVertical: verticalScale(6),
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: scale(4),
    paddingBottom: verticalScale(2),
  },
  bar: {
    flex: 1,
    marginHorizontal: scale(0.5),
    borderRadius: 1,
    minHeight: 2,
  },
  curveOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(74, 222, 128, 0.2)',
  },
});