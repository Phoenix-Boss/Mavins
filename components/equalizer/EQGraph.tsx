// components/equalizer/EQGraph.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { scale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '../../constants/Colors';

interface EQGraphProps {
  values: number[];
  enabled?: boolean;  // ✅ Added enabled prop
}

export const EQGraph: React.FC<EQGraphProps> = ({ 
  values, 
  enabled = true  // ✅ Default true for backward compat
}) => {
  // Safely access colors with fallback
  const primaryColor = Colors?.metallicBrown?.primary || "#8B7355";
  const secondaryColor = Colors?.metallicBrown?.secondary || "#A68A6A";
  
  // ✅ Clamp values to valid range (-12 to +12 dB → 0-100%)
  const clampValue = (val: number): number => {
    const normalized = (val + 12) / 24; // -12→0, 0→0.5, +12→1.0
    return Math.max(0, Math.min(1, normalized)) * 100;
  };

  // ✅ Flat line when disabled
  const displayValues = enabled ? values : Array(values.length).fill(0);

  return (
    <View style={styles.graphContainer}>
      <View style={[
        styles.graphTrack, 
        !enabled && styles.graphTrackDisabled  // ✅ Visual feedback
      ]}>
        {/* Center line */}
        <View style={[
          styles.graphLine, 
          { 
            backgroundColor: enabled ? primaryColor : 'rgba(255,255,255,0.1)' 
          }
        ]} />
        
        {/* Frequency points */}
        <View style={styles.graphCurve}>
          {displayValues.map((val, idx) => (
            <View
              key={idx}
              style={[
                styles.graphPoint,
                {
                  left: `${(idx / Math.max(1, values.length - 1)) * 100}%`,
                  bottom: `${clampValue(val)}%`,  // ✅ Valid 0-100%
                  backgroundColor: enabled ? primaryColor : secondaryColor,
                  opacity: enabled ? 1 : 0.4,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  graphContainer: {
    marginTop: verticalScale(20),
    height: verticalScale(80),
    paddingHorizontal: scale(10),
  },
  graphTrack: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  graphTrackDisabled: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  graphLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.3,
  },
  graphCurve: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  graphPoint: {
    position: 'absolute',
    width: scale(8),
    height: scale(8),
    borderRadius: 4,
    marginLeft: -4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
});
