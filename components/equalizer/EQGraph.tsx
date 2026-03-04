// components/equalizer/EQGraph.tsx - PROFESSIONAL FREQUENCY RESPONSE VISUALIZER

import React, { useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
  runOnJS,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

interface EQGraphProps {
  values: number[];           // -15 to +15 dB for each band
  frequencies?: number[];      // Frequency values for x-axis labels
  enabled?: boolean;
  activeBand?: number;         // Currently selected band index
  onBandPress?: (index: number) => void; // Optional band selection
  showFill?: boolean;          // Show filled area under curve
  glowIntensity?: number;      // 0-1 glow effect intensity
}

// Frequency labels for common bands
const DEFAULT_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQGraph: React.FC<EQGraphProps> = ({
  values,
  frequencies = DEFAULT_FREQUENCIES,
  enabled = true,
  activeBand = -1,
  onBandPress,
  showFill = true,
  glowIntensity = 0.5,
}) => {
  // Animation values
  const glowOpacity = useSharedValue(0);
  const curvePoints = useSharedValue<number[]>([]);
  
  // Update curve when values change
  useEffect(() => {
    curvePoints.value = withTiming(values, { duration: 200 });
  }, [values]);

  // Animate glow when enabled/disabled
  useEffect(() => {
    glowOpacity.value = withTiming(enabled ? glowIntensity : 0, { duration: 300 });
  }, [enabled, glowIntensity]);

  // Convert dB value to Y position (0-100%)
  const dBToY = (db: number): number => {
    'worklet';
    // Map -15..+15 dB to 0..100% (0% = bottom/-15dB, 100% = top/+15dB)
    const normalized = (db + 15) / 30;
    return Math.max(0, Math.min(100, normalized * 100));
  };

  // Format frequency for display
  const formatFrequency = (freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}k`;
    }
    return freq.toString();
  };

  // Generate SVG-like path for the curve
  const generateCurvePath = (vals: number[]): string => {
    'worklet';
    if (vals.length < 2) return '';
    
    const points = vals.map((val, index) => {
      const x = (index / (vals.length - 1)) * 100;
      const y = 100 - dBToY(val); // Invert Y for coordinate system (0 at top)
      return { x, y };
    });

    // Create smooth curve using cubic bezier
    let path = `M ${points[0].x},${points[0].y}`;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      
      // Calculate control points for smooth curve
      const cp1x = p0.x + (p1.x - p0.x) * 0.3;
      const cp1y = p0.y;
      const cp2x = p1.x - (p1.x - p0.x) * 0.3;
      const cp2y = p1.y;
      
      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`;
    }
    
    return path;
  };

  // Animated styles
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const curveStyle = useAnimatedStyle(() => {
    const currentVals = curvePoints.value.length === values.length 
      ? curvePoints.value 
      : values;
    
    return {
      // This would need a proper SVG implementation
      // For now, we'll use a simplified approach
    };
  });

  // Generate fill path (for area under curve)
  const generateFillPath = (vals: number[]): string => {
    'worklet';
    const curvePath = generateCurvePath(vals);
    if (!curvePath) return '';
    
    // Close the path to create fill area
    return `${curvePath} L 100,100 L 0,100 Z`;
  };

  return (
    <View style={styles.container}>
      <View style={[
        styles.graphContainer,
        !enabled && styles.graphDisabled
      ]}>
        
        {/* Grid Lines */}
        <View style={styles.grid}>
          {/* Horizontal grid lines (dB levels) */}
          {[-12, -6, 0, 6, 12].map((db, index) => {
            const y = 100 - dBToY(db);
            return (
              <View key={`h-${index}`} style={[styles.gridLine, { top: `${y}%` }]}>
                <Text style={styles.gridLabel}>{db > 0 ? `+${db}` : db}dB</Text>
              </View>
            );
          })}
          
          {/* Vertical grid lines (frequency markers) */}
          {frequencies.map((freq, index) => {
            const x = (index / (frequencies.length - 1)) * 100;
            return (
              <View key={`v-${index}`} style={[styles.gridLineVertical, { left: `${x}%` }]}>
                <Text style={styles.gridLabelVertical}>{formatFrequency(freq)}</Text>
              </View>
            );
          })}
        </View>

        {/* Glow Effect Background */}
        <Animated.View style={[styles.glowContainer, glowStyle]}>
          <BlurView intensity={20} style={StyleSheet.absoluteFill}>
            <View style={[styles.glowFill, { backgroundColor: Colors.metallicBrown.primary }]} />
          </BlurView>
        </Animated.View>

        {/* Fill Area Under Curve */}
        {showFill && (
          <View style={styles.fillContainer}>
            {values.map((val, index) => {
              if (index === values.length - 1) return null;
              
              const x1 = (index / (values.length - 1)) * 100;
              const x2 = ((index + 1) / (values.length - 1)) * 100;
              const y1 = 100 - dBToY(val);
              const y2 = 100 - dBToY(values[index + 1]);
              
              // Create trapezoid for each segment
              return (
                <View
                  key={`fill-${index}`}
                  style={[
                    styles.fillSegment,
                    {
                      left: `${x1}%`,
                      width: `${x2 - x1}%`,
                      top: `${Math.min(y1, y2)}%`,
                      height: `${Math.abs(y1 - y2)}%`,
                      backgroundColor: val > 0 
                        ? 'rgba(139, 115, 85, 0.2)' 
                        : 'rgba(100, 100, 100, 0.1)',
                    },
                  ]}
                />
              );
            })}
          </View>
        )}

        {/* Main Curve Line */}
        <View style={styles.curveContainer}>
          {values.map((val, index) => {
            if (index === values.length - 1) return null;
            
            const x1 = (index / (values.length - 1)) * 100;
            const x2 = ((index + 1) / (values.length - 1)) * 100;
            const y1 = 100 - dBToY(val);
            const y2 = 100 - dBToY(values[index + 1]);
            
            // Calculate angle and length for connecting line
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
            return (
              <View
                key={`line-${index}`}
                style={[
                  styles.curveLine,
                  {
                    left: `${x1}%`,
                    top: `${y1}%`,
                    width: `${length}%`,
                    transform: [
                      { translateY: -0.5 },
                      { rotate: `${angle}deg` },
                    ],
                    backgroundColor: val > 0 || values[index + 1] > 0
                      ? Colors.metallicBrown.primary
                      : Colors.metallicBrown.secondary,
                    opacity: enabled ? 0.8 : 0.3,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Frequency Points/Nodes */}
        <View style={styles.pointsContainer}>
          {values.map((val, index) => {
            const x = (index / (values.length - 1)) * 100;
            const y = 100 - dBToY(val);
            const isActive = index === activeBand;
            
            return (
              <Animated.View
                key={`point-${index}`}
                style={[
                  styles.pointWrapper,
                  {
                    left: `${x}%`,
                    top: `${y}%`,
                  },
                ]}
              >
                <TouchableOpacity
                  onPress={() => onBandPress?.(index)}
                  activeOpacity={0.7}
                  disabled={!enabled}
                >
                  <View style={[
                    styles.graphPoint,
                    {
                      backgroundColor: val > 0 
                        ? Colors.metallicBrown.primary 
                        : val < 0 
                        ? Colors.metallicBrown.secondary 
                        : '#fff',
                      width: isActive ? scale(14) : scale(10),
                      height: isActive ? scale(14) : scale(10),
                      borderRadius: isActive ? 7 : 5,
                      borderWidth: isActive ? 2 : 1,
                      borderColor: '#fff',
                    },
                    !enabled && styles.pointDisabled,
                  ]}>
                    {isActive && (
                      <View style={styles.pointPulse}>
                        <View style={[styles.pulseRing, { borderColor: Colors.metallicBrown.primary }]} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {/* Center Line (0dB) */}
        <View style={[styles.centerLine, { 
          top: `${100 - dBToY(0)}%`,
          backgroundColor: enabled ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
        }]}>
          <Text style={styles.centerLineLabel}>0dB</Text>
        </View>
      </View>

      {/* Frequency Range Indicator */}
      <View style={styles.freqRange}>
        <Text style={styles.freqRangeText}>20Hz</Text>
        <Text style={styles.freqRangeText}>20kHz</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: verticalScale(20),
    marginBottom: verticalScale(10),
  },
  graphContainer: {
    height: verticalScale(150),
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  graphDisabled: {
    opacity: 0.5,
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  gridLabel: {
    position: 'absolute',
    left: scale(5),
    top: -verticalScale(6),
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(8),
    fontWeight: '500',
  },
  gridLabelVertical: {
    position: 'absolute',
    bottom: -verticalScale(12),
    left: -scale(10),
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(8),
    fontWeight: '500',
    width: scale(30),
    textAlign: 'center',
  },
  glowContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  glowFill: {
    flex: 1,
    opacity: 0.1,
  },
  fillContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  fillSegment: {
    position: 'absolute',
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
  },
  curveContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  curveLine: {
    position: 'absolute',
    height: 2,
    transformOrigin: 'left',
    shadowColor: Colors.metallicBrown.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  pointsContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  pointWrapper: {
    position: 'absolute',
    marginLeft: -scale(5),
    marginTop: -scale(5),
    zIndex: 10,
  },
  graphPoint: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  pointDisabled: {
    opacity: 0.5,
  },
  pointPulse: {
    position: 'absolute',
    top: -scale(4),
    left: -scale(4),
    right: -scale(4),
    bottom: -scale(4),
  },
  pulseRing: {
    flex: 1,
    borderWidth: 2,
    borderRadius: scale(12),
    opacity: 0.5,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  centerLineLabel: {
    position: 'absolute',
    right: scale(5),
    top: -verticalScale(8),
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(8),
    fontWeight: '600',
  },
  freqRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: scale(5),
    marginTop: verticalScale(4),
  },
  freqRangeText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(8),
    fontWeight: '500',
  },
});

