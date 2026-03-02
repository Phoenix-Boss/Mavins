// components/equalizer/ParametricEQ.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { RotaryKnob } from './RotaryKnob';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';

interface ParametricEQProps {
  enabled: boolean;  // ✅ From parent EQ state
  parametricState: {
    selectedFilter: FilterType;
    filterEnabled: boolean;
    gain: number;      // -15 to +15 dB
    frequency: number; // 20-20k Hz  
    q: number;         // 0.1-10
  };
  onUpdate: (updates: Partial<{
    selectedFilter: FilterType;
    filterEnabled: boolean;
    gain: number;
    frequency: number;
    q: number;
  }>) => void;
}

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  enabled,
  parametricState,
  onUpdate
}) => {
  const { selectedFilter, filterEnabled, gain, frequency, q } = parametricState;

  // ✅ Safe frequency conversion (20Hz-20kHz → 0-100 knob range)
  const freqToKnob = (freq: number): number => {
    const normalized = Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20);
    const range = Math.log10(20000) - Math.log10(20);
    return (normalized / range) * 100;
  };

  const knobToFreq = (knob: number): number => {
    const normalized = (knob / 100) * (Math.log10(20000) - Math.log10(20));
    return Math.pow(10, normalized + Math.log10(20));
  };

  // ✅ Safe Q conversion (0.1-10 → 0-100)
  const qToKnob = (qVal: number): number => 
    Math.max(0, Math.min(100, ((qVal - 0.1) / (10 - 0.1)) * 100));
  const knobToQ = (knob: number): number => 
    0.1 + (knob / 100) * (10 - 0.1);

  // ✅ Safe Gain conversion (-15/+15 → 0-100)
  const gainToKnob = (gainVal: number): number => 
    Math.max(0, Math.min(100, (gainVal + 15) / 30 * 100));
  const knobToGain = (knob: number): number => 
    ((knob / 100) * 30) - 15;

  const handleFilterChange = (filter: FilterType) => {
    if (!enabled) return;
    onUpdate({ selectedFilter: filter });
  };

  const toggleFilter = () => {
    if (!enabled) return;
    onUpdate({ filterEnabled: !filterEnabled });
  };

  const createKnobUpdater = (converter: (knob: number) => number, key: keyof typeof parametricState) => 
    (value: number) => {
      if (!enabled) return;
      onUpdate({ [key]: converter(value) } as any);
    };

  // ✅ Dynamic graph position for main control point
  const controlPointX = freqToKnob(frequency);
  const controlPointY = verticalScale(150) - gainToKnob(Math.abs(gain)) * 1.2;

  return (
    <View style={styles.container}>
      <View style={styles.filterGrid}>
        {FILTER_PRESETS.map((filter) => (
          <TouchableOpacity
            key={filter.id}
            style={[
              styles.filterButton,
              selectedFilter === filter.id && styles.filterButtonActive,
            ]}
            onPress={() => handleFilterChange(filter.id)}
            activeOpacity={0.7}
            disabled={!enabled}
          >
            <Text style={styles.filterIcon}>{filter.icon}</Text>
            <Text style={[
              styles.filterName,
              selectedFilter === filter.id && styles.filterNameActive
            ]}>
              {filter.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.graphContainer}>
        <View style={[
          styles.graphBackground, 
          !enabled && { opacity: 0.3 }
        ]}>
          {/* Grid lines - unchanged but now respects enabled */}
          {[-15, -10, -5, 0, 5, 10, 15].map((value, index) => {
            const y = verticalScale(90) - (value / 15) * verticalScale(70);
            return (
              <View 
                key={`h-${index}`}
                style={[
                  styles.gridLine,
                  { 
                    top: y,
                    backgroundColor: value === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                  }
                ]}
              />
            );
          })}

          {/* Dynamic main control point */}
          <View style={[
            styles.controlPoint, 
            { 
              left: `${controlPointX}%`, 
              top: `${controlPointY}px`,
              backgroundColor: enabled ? Colors.metallicBrown.primary : '#666',
              opacity: enabled ? 1 : 0.5
            }
          ]}>
            <Text style={styles.pointLabel}>●</Text>
          </View>

          {/* Frequency labels */}
          <View style={styles.xAxisLabels}>
            <Text style={styles.axisLabel}>20Hz</Text>
            <Text style={styles.axisLabel}>100Hz</Text>
            <Text style={styles.axisLabel}>1kHz</Text>
            <Text style={styles.axisLabel}>10kHz</Text>
            <Text style={styles.axisLabel}>20kHz</Text>
          </View>
        </View>
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.knobGroup}>
          <Text style={styles.knobGroupLabel}>{selectedFilter}</Text>
        </View>

        <RotaryKnob
          value={gainToKnob(gain)}
          label="Gain"
          onChange={createKnobUpdater(knobToGain, 'gain')}
          color={Colors.metallicBrown.primary}
          size={70}
          enabled={enabled && filterEnabled}
        />

        <RotaryKnob
          value={freqToKnob(frequency)}
          label="Freq"
          onChange={createKnobUpdater(knobToFreq, 'frequency')}
          color={Colors.metallicBrown.secondary}
          size={70}
          enabled={enabled && filterEnabled}
        />

        <RotaryKnob
          value={qToKnob(q)}
          label="Q"
          onChange={createKnobUpdater(knobToQ, 'q')}
          color={Colors.metallicBrown.light || '#D4AF37'}
          size={70}
          enabled={enabled && filterEnabled}
        />
      </View>

      <TouchableOpacity 
        style={[
          styles.powerButton, 
          filterEnabled && styles.powerButtonActive
        ]}
        onPress={toggleFilter}
        activeOpacity={0.7}
        disabled={!enabled}
      >
        <Text style={[
          styles.powerButtonText, 
          filterEnabled && styles.powerButtonTextActive
        ]}>
          {filterEnabled ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// Keep FILTER_PRESETS the same...
const FILTER_PRESETS = [
  { id: 'lowpass' as FilterType, name: 'Low Pass', icon: '⬇️' },
  { id: 'highpass' as FilterType, name: 'High Pass', icon: '⬆️' },
  { id: 'bandpass' as FilterType, name: 'Band Pass', icon: '🔲' },
  { id: 'lowshelf' as FilterType, name: 'Low Shelf', icon: '📉' },
  { id: 'highshelf' as FilterType, name: 'High Shelf', icon: '📈' },
  { id: 'peaking' as FilterType, name: 'Peaking', icon: '🔔' },
  { id: 'notch' as FilterType, name: 'Notch', icon: '❌' },
];


const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: verticalScale(10),
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: verticalScale(15),
  },
  filterButton: {
    width: (SCREEN_WIDTH - scale(60)) / 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: verticalScale(8),
    alignItems: 'center',
    marginBottom: verticalScale(8),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  filterButtonActive: {
    borderColor: Colors.metallicBrown.primary,
    backgroundColor: 'rgba(139, 115, 85, 0.2)',
  },
  filterIcon: {
    fontSize: moderateScale(16),
    marginBottom: verticalScale(2),
  },
  filterName: {
    color: '#fff',
    fontSize: moderateScale(9),
    fontWeight: '500',
  },
  filterNameActive: {
    color: Colors.metallicBrown.primary,
  },
  graphContainer: {
    marginVertical: verticalScale(10),
    position: 'relative',
    height: verticalScale(180),
  },
  graphBackground: {
    height: verticalScale(150),
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    width: '100%',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  curveLine: {
    position: 'absolute',
    left: scale(20),
    right: scale(20),
    top: verticalScale(50),
    height: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.metallicBrown.primary,
    opacity: 0.5,
  },
  controlPoint: {
    position: 'absolute',
    width: scale(24),
    height: scale(24),
    borderRadius: 12,
    backgroundColor: Colors.metallicBrown.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pointLabel: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '700',
  },
  xAxisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: scale(30),
    marginTop: verticalScale(5),
  },
  yAxisLabels: {
    position: 'absolute',
    left: 0,
    top: verticalScale(20),
    bottom: verticalScale(30),
    justifyContent: 'space-between',
  },
  axisLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(8),
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: verticalScale(10),
  },
  knobGroup: {
    alignItems: 'center',
  },
  knobGroupLabel: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '600',
    marginBottom: verticalScale(4),
  },
  presetIndicator: {
    flexDirection: 'row',
    gap: scale(4),
  },
  presetDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: 4,
    backgroundColor: '#666',
  },
  powerButton: {
    alignSelf: 'center',
    marginTop: verticalScale(15),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(30),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  powerButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  powerButtonText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  powerButtonTextActive: {
    color: '#000',
  },
});