// components/equalizer/ParametricEQ.tsx - PROFESSIONAL PARAMETRIC EQ WITH FILTER MENU

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  FlatList,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { RotaryKnob } from './RotaryKnob';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';

interface ParametricEQProps {
  enabled: boolean;
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

// Filter definitions with metadata
const FILTERS: { id: FilterType; name: string; icon: string; category: string; description: string }[] = [
  { id: 'peaking', name: 'Peaking', icon: '🔔', category: 'Bell', description: 'Boost/cut a frequency band' },
  { id: 'lowshelf', name: 'Low Shelf', icon: '📉', category: 'Shelf', description: 'Boost/cut low frequencies' },
  { id: 'highshelf', name: 'High Shelf', icon: '📈', category: 'Shelf', description: 'Boost/cut high frequencies' },
  { id: 'lowpass', name: 'Low Pass', icon: '⬇️', category: 'Filter', description: 'Remove high frequencies' },
  { id: 'highpass', name: 'High Pass', icon: '⬆️', category: 'Filter', description: 'Remove low frequencies' },
  { id: 'bandpass', name: 'Band Pass', icon: '🔲', category: 'Filter', description: 'Pass only a frequency band' },
  { id: 'notch', name: 'Notch', icon: '❌', category: 'Filter', description: 'Remove a frequency band' },
];

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  enabled,
  parametricState,
  onUpdate
}) => {
  const { selectedFilter, filterEnabled, gain, frequency, q } = parametricState;
  
  // UI state
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [activePoint, setActivePoint] = useState<'low' | 'mid' | 'high'>('mid');
  
  // Animation values
  const pointScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);

  // Safe conversions
  const freqToKnob = (freq: number): number => {
    const normalized = Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20);
    const range = Math.log10(20000) - Math.log10(20);
    return (normalized / range) * 100;
  };

  const knobToFreq = (knob: number): number => {
    const normalized = (knob / 100) * (Math.log10(20000) - Math.log10(20));
    return Math.pow(10, normalized + Math.log10(20));
  };

  const qToKnob = (qVal: number): number => 
    Math.max(0, Math.min(100, ((qVal - 0.1) / (10 - 0.1)) * 100));
  
  const knobToQ = (knob: number): number => 
    0.1 + (knob / 100) * (10 - 0.1);

  const gainToKnob = (gainVal: number): number => 
    Math.max(0, Math.min(100, (gainVal + 15) / 30 * 100));
  
  const knobToGain = (knob: number): number => 
    ((knob / 100) * 30) - 15;

  // Calculate curve points (low, mid, high)
  const getFilterPoints = () => {
    const points = {
      low: { x: 10, y: 50 },
      mid: { x: 50, y: 50 - (gain / 30) * 40 },
      high: { x: 90, y: 50 },
    };

    // Adjust based on filter type
    switch (selectedFilter) {
      case 'lowpass':
        points.low.y = 80;
        points.mid.y = 50;
        points.high.y = 20;
        break;
      case 'highpass':
        points.low.y = 20;
        points.mid.y = 50;
        points.high.y = 80;
        break;
      case 'bandpass':
        points.low.y = 20;
        points.mid.y = 80;
        points.high.y = 20;
        break;
      case 'lowshelf':
        points.low.y = 50 - (gain / 30) * 40;
        points.mid.y = 50;
        points.high.y = 50;
        break;
      case 'highshelf':
        points.low.y = 50;
        points.mid.y = 50;
        points.high.y = 50 - (gain / 30) * 40;
        break;
      case 'notch':
        points.low.y = 50;
        points.mid.y = 50 - (Math.abs(gain) / 30) * 30;
        points.high.y = 50;
        break;
      default: // peaking
        points.mid.y = 50 - (gain / 30) * 40;
        break;
    }

    return points;
  };

  const points = getFilterPoints();

  // Handle point selection
  const handlePointPress = (point: 'low' | 'mid' | 'high') => {
    if (!enabled || !filterEnabled) return;
    setActivePoint(point);
    pointScale.value = withSpring(1.3, { damping: 10, stiffness: 200 });
    glowOpacity.value = withTiming(0.5, { duration: 200 });
    
    setTimeout(() => {
      pointScale.value = withSpring(1, { damping: 15, stiffness: 250 });
      glowOpacity.value = withTiming(0, { duration: 300 });
    }, 300);
  };

  const createKnobUpdater = (converter: (knob: number) => number, key: keyof typeof parametricState) => 
    (value: number) => {
      if (!enabled || !filterEnabled) return;
      onUpdate({ [key]: converter(value) } as any);
    };

  // Animated styles for points
  const pointStyle = (point: 'low' | 'mid' | 'high') => useAnimatedStyle(() => ({
    transform: [{ scale: activePoint === point ? pointScale.value : 1 }],
    shadowOpacity: activePoint === point ? glowOpacity.value : 0,
  }));

  // Get current filter display name
  const currentFilter = FILTERS.find(f => f.id === selectedFilter) || FILTERS[0];

  return (
    <View style={styles.container}>
      {/* Filter Selection Button (Peaking as default) */}
      <TouchableOpacity
        style={[
          styles.filterSelector,
          !enabled && styles.disabled,
        ]}
        onPress={() => setFilterModalVisible(true)}
        activeOpacity={0.7}
        disabled={!enabled}
      >
        <View style={styles.filterSelectorLeft}>
          <Text style={styles.filterSelectorIcon}>{currentFilter.icon}</Text>
          <View>
            <Text style={styles.filterSelectorName}>{currentFilter.name}</Text>
            <Text style={styles.filterSelectorCategory}>{currentFilter.category}</Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Graph Area with 3 Control Points */}
      <View style={styles.graphContainer}>
        <View style={[styles.graph, !enabled && styles.disabled]}>
          {/* Grid Lines */}
          <View style={styles.grid}>
            {[-12, -6, 0, 6, 12].map((value, index) => {
              const y = (1 - (value + 12) / 24) * 100;
              return (
                <View key={`h-${index}`} style={[styles.gridLine, { top: `${y}%` }]}>
                  <Text style={styles.gridLabel}>{value}dB</Text>
                </View>
              );
            })}
            {[20, 100, 1000, 10000, 20000].map((freq, index) => {
              const x = (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100;
              return (
                <View key={`v-${index}`} style={[styles.gridLineVertical, { left: `${x}%` }]}>
                  <Text style={styles.gridLabelVertical}>{freq < 1000 ? `${freq}Hz` : `${freq/1000}kHz`}</Text>
                </View>
              );
            })}
          </View>

          {/* Frequency Response Curve */}
          <View style={styles.curveContainer}>
            {/* Low to Mid line */}
            <View style={[styles.curveLine, {
              left: `${points.low.x}%`,
              top: `${points.low.y}%`,
              width: `${points.mid.x - points.low.x}%`,
              transform: [{ rotate: `${Math.atan2(points.mid.y - points.low.y, points.mid.x - points.low.x)}rad` }],
            }]} />
            
            {/* Mid to High line */}
            <View style={[styles.curveLine, {
              left: `${points.mid.x}%`,
              top: `${points.mid.y}%`,
              width: `${points.high.x - points.mid.x}%`,
              transform: [{ rotate: `${Math.atan2(points.high.y - points.mid.y, points.high.x - points.mid.x)}rad` }],
            }]} />

            {/* Control Points */}
            <Animated.View
              style={[
                styles.controlPoint,
                pointStyle('low'),
                {
                  left: `${points.low.x}%`,
                  top: `${points.low.y}%`,
                  backgroundColor: activePoint === 'low' ? Colors.metallicBrown.primary : '#666',
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => handlePointPress('low')}
                activeOpacity={0.7}
              >
                <View style={styles.pointInner}>
                  <View style={styles.pointCore} />
                </View>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View
              style={[
                styles.controlPoint,
                pointStyle('mid'),
                {
                  left: `${points.mid.x}%`,
                  top: `${points.mid.y}%`,
                  backgroundColor: activePoint === 'mid' ? Colors.metallicBrown.primary : '#666',
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => handlePointPress('mid')}
                activeOpacity={0.7}
              >
                <View style={styles.pointInner}>
                  <View style={styles.pointCore} />
                </View>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View
              style={[
                styles.controlPoint,
                pointStyle('high'),
                {
                  left: `${points.high.x}%`,
                  top: `${points.high.y}%`,
                  backgroundColor: activePoint === 'high' ? Colors.metallicBrown.primary : '#666',
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => handlePointPress('high')}
                activeOpacity={0.7}
              >
                <View style={styles.pointInner}>
                  <View style={styles.pointCore} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
      </View>

      {/* Knobs - Conditionally shown based on filter type */}
      <View style={styles.knobsRow}>
        {/* Gain knob - only for filters that use gain */}
        {(selectedFilter === 'peaking' || selectedFilter === 'lowshelf' || selectedFilter === 'highshelf') && (
          <RotaryKnob
            value={gainToKnob(gain)}
            label="GAIN"
            onChange={createKnobUpdater(knobToGain, 'gain')}
            color={Colors.metallicBrown.primary}
            size={65}
            enabled={enabled && filterEnabled}
            showValue={true}
          />
        )}

        {/* Frequency knob - all filters use frequency */}
        <RotaryKnob
          value={freqToKnob(frequency)}
          label="FREQ"
          onChange={createKnobUpdater(knobToFreq, 'frequency')}
          color={Colors.metallicBrown.secondary}
          size={65}
          enabled={enabled && filterEnabled}
          showValue={true}
        />

        {/* Q/Resonance knob - for filters that use Q */}
        {(selectedFilter === 'peaking' || selectedFilter === 'notch' || selectedFilter === 'bandpass' || 
          selectedFilter === 'lowpass' || selectedFilter === 'highpass') && (
          <RotaryKnob
            value={qToKnob(q)}
            label={selectedFilter === 'lowpass' || selectedFilter === 'highpass' ? 'RES' : 'Q'}
            onChange={createKnobUpdater(knobToQ, 'q')}
            color={Colors.metallicBrown.light || '#D4AF37'}
            size={65}
            enabled={enabled && filterEnabled}
            showValue={true}
          />
        )}
      </View>

      {/* Filter Toggle Button */}
      <TouchableOpacity
        style={[
          styles.powerButton,
          filterEnabled && styles.powerButtonActive,
          !enabled && styles.disabled,
        ]}
        onPress={() => onUpdate({ filterEnabled: !filterEnabled })}
        activeOpacity={0.7}
        disabled={!enabled}
      >
        <Text style={[
          styles.powerButtonText,
          filterEnabled && styles.powerButtonTextActive,
        ]}>
          {filterEnabled ? 'FILTER ON' : 'FILTER OFF'}
        </Text>
      </TouchableOpacity>

      {/* Filter Selection Modal */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <BlurView intensity={90} style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalCloseArea}
            activeOpacity={1}
            onPress={() => setFilterModalVisible(false)}
          />
          
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT FILTER TYPE</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={FILTERS}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.filterOption,
                    selectedFilter === item.id && styles.filterOptionSelected,
                  ]}
                  onPress={() => {
                    onUpdate({ selectedFilter: item.id });
                    setFilterModalVisible(false);
                  }}
                >
                  <View style={styles.filterOptionLeft}>
                    <Text style={styles.filterOptionIcon}>{item.icon}</Text>
                    <View>
                      <Text style={styles.filterOptionName}>{item.name}</Text>
                      <Text style={styles.filterOptionDesc}>{item.description}</Text>
                    </View>
                  </View>
                  {selectedFilter === item.id && (
                    <MaterialCommunityIcons name="check" size={20} color={Colors.metallicBrown.primary} />
                  )}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </BlurView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: verticalScale(10),
  },
  disabled: {
    opacity: 0.5,
  },
  filterSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: scale(12),
    marginBottom: verticalScale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
  },
  filterSelectorIcon: {
    fontSize: moderateScale(24),
  },
  filterSelectorName: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '600',
  },
  filterSelectorCategory: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(11),
  },
  graphContainer: {
    height: verticalScale(200),
    marginVertical: verticalScale(10),
  },
  graph: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
    position: 'relative',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gridLabel: {
    position: 'absolute',
    left: scale(5),
    top: -verticalScale(8),
    color: 'rgba(255,255,255,0.2)',
    fontSize: moderateScale(8),
  },
  gridLabelVertical: {
    position: 'absolute',
    bottom: -verticalScale(15),
    left: -scale(10),
    color: 'rgba(255,255,255,0.2)',
    fontSize: moderateScale(8),
  },
  curveContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  curveLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: Colors.metallicBrown.primary,
    opacity: 0.5,
    transformOrigin: 'left',
  },
  controlPoint: {
    position: 'absolute',
    width: scale(32),
    height: scale(32),
    marginLeft: -scale(16),
    marginTop: -scale(16),
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.metallicBrown.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
  },
  pointInner: {
    width: scale(24),
    height: scale(24),
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pointCore: {
    width: scale(8),
    height: scale(8),
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  knobsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: verticalScale(15),
    paddingHorizontal: scale(10),
  },
  powerButton: {
    alignSelf: 'center',
    marginTop: verticalScale(20),
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(30),
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  powerButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  powerButtonText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  powerButtonTextActive: {
    color: '#000',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCloseArea: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: scale(20),
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(20),
  },
  modalTitle: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '700',
    letterSpacing: 1,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(15),
    borderRadius: 12,
    marginBottom: verticalScale(5),
  },
  filterOptionSelected: {
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
  },
  filterOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
  },
  filterOptionIcon: {
    fontSize: moderateScale(20),
  },
  filterOptionName: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
  },
  filterOptionDesc: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(11),
  },
});