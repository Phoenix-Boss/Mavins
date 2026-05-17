// ============================================================================
// COMPONENTS/EQUALIZER/EQGraph.tsx
// ============================================================================
// PURE UI COMPONENT - Visualizes EQ curve based on band values
// ============================================================================

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, interpolate, Extrapolation } from 'react-native-reanimated';
import { scale, verticalScale } from 'react-native-size-matters/extend';

const { width: SCREEN_W } = Dimensions.get('window');

interface EQGraphProps {
  bandValues: number[];  // Array of 10 band values (-15 to +15 dB)
  enabled?: boolean;
  style?: any;
}

const NUM_BARS = 32;

function getBarColor(index: number, intensity: number): string {
  'worklet';
  const normalizedIntensity = Math.min(1, Math.max(0, intensity));
  if (index < 6) return `rgba(139, 92, 246, ${0.4 + normalizedIntensity * 0.6})`;
  if (index < 12) return `rgba(59, 130, 246, ${0.5 + normalizedIntensity * 0.5})`;
  if (index < 18) return `rgba(34, 211, 238, ${0.5 + normalizedIntensity * 0.5})`;
  if (index < 24) return `rgba(234, 179, 8, ${0.5 + normalizedIntensity * 0.5})`;
  if (index < 30) return `rgba(249, 115, 22, ${0.5 + normalizedIntensity * 0.5})`;
  return `rgba(239, 68, 68, ${0.5 + normalizedIntensity * 0.5})`;
}

const SpectrumBar: React.FC<{ index: number; targetHeight: Animated.SharedValue<number>; isActive: boolean }> = ({ index, targetHeight, isActive }) => {
  const currentHeight = useSharedValue(0.05);

  useAnimatedStyle(() => {
    if (!isActive) {
      currentHeight.value = withSpring(0.05, { damping: 18, stiffness: 200 });
    } else {
      const diff = targetHeight.value - currentHeight.value;
      currentHeight.value = currentHeight.value + diff * 0.35;
    }
    return {};
  });

  const barStyle = useAnimatedStyle(() => ({
    height: `${Math.max(0.05, Math.min(1, currentHeight.value)) * 100}%`,
    opacity: interpolate(currentHeight.value, [0, 0.3, 0.7, 1], [0.2, 0.5, 0.8, 1], Extrapolation.CLAMP),
  }));

  const intensity = useSharedValue(0);
  const color = useSharedValue('#666');

  return (
    <View style={styles.barWrapper}>
      <Animated.View style={[styles.bar, barStyle, { backgroundColor: color.value }]} />
    </View>
  );
};

export const EQGraph: React.FC<EQGraphProps> = ({ bandValues = [], enabled = true, style }) => {
  const targetHeights = useRef<Animated.SharedValue<number>[]>([]);

  useEffect(() => {
    for (let i = 0; i < NUM_BARS; i++) {
      if (!targetHeights.current[i]) {
        targetHeights.current[i] = useSharedValue(0.05);
      }
    }
  }, []);

  useEffect(() => {
    for (let i = 0; i < NUM_BARS; i++) {
      let intensity = 0.05;
      if (bandValues.length > 0) {
        const bandIndex = Math.floor((i / NUM_BARS) * bandValues.length);
        const eqValue = bandValues[bandIndex] || 0;
        const normalizedGain = (eqValue + 15) / 30;
        intensity = 0.1 + normalizedGain * 0.6;
      }
      targetHeights.current[i].value = withSpring(Math.max(0.05, Math.min(0.95, intensity)), { damping: 18, stiffness: 200, mass: 0.8 });
    }
  }, [bandValues]);

  const isActive = enabled;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.barsContainer}>
        {Array.from({ length: NUM_BARS }, (_, i) => (
          <SpectrumBar key={i} index={i} targetHeight={targetHeights.current[i] || useSharedValue(0.05)} isActive={isActive} />
        ))}
      </View>
      <View style={styles.gridLines}>
        {[0, 0.25, 0.5, 0.75, 1].map((pos, i) => (
          <View key={i} style={[styles.gridLine, { bottom: `${pos * 100}%` }, pos === 0.5 && styles.gridLineCenter]} />
        ))}
      </View>
      <View style={styles.dbScale}>
        <Text style={styles.dbLabel}>+15</Text>
        <Text style={styles.dbLabel}>0</Text>
        <Text style={styles.dbLabel}>-15</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { height: verticalScale(120), backgroundColor: '#0a0a0a', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#1a1a1a' },
  barsContainer: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: scale(4), paddingBottom: verticalScale(2) },
  barWrapper: { flex: 1, height: '100%', justifyContent: 'flex-end', marginHorizontal: scale(0.5) },
  bar: { width: '100%', borderRadius: 1, minHeight: 2 },
  gridLines: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.05)' },
  gridLineCenter: { backgroundColor: 'rgba(255,255,255,0.12)', height: 0.8 },
  dbScale: { position: 'absolute', right: scale(6), top: verticalScale(6), bottom: verticalScale(6), justifyContent: 'space-between', alignItems: 'flex-end' },
  dbLabel: { color: 'rgba(255,255,255,0.25)', fontSize: scale(7), fontWeight: '600', fontFamily: 'monospace' },
});
