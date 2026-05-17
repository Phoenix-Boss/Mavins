// ============================================================================
// COMPONENTS/EQUALIZER/parametricEq.tsx (REVAMPED)
// ============================================================================

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type FilterType = 'lowpass'|'highpass'|'bandpass'|'lowshelf'|'highshelf'|'peaking'|'notch';

interface ParametricEQProps {
  enabled: boolean;
  parametricState: {
    selectedFilter: FilterType;
    filterEnabled: boolean;
    gain: number;
    frequency: number;
    q: number;
  };
  onUpdate: (updates: Partial<ParametricEQProps['parametricState']>) => void;
}

const FILTERS: { id: FilterType; name: string }[] = [
  { id: 'peaking', name: 'Peaking' },
  { id: 'lowshelf', name: 'Low Shelf' },
  { id: 'highshelf', name: 'High Shelf' },
  { id: 'lowpass', name: 'Low Pass' },
  { id: 'highpass', name: 'High Pass' },
  { id: 'bandpass', name: 'Band Pass' },
  { id: 'notch', name: 'Notch' },
];

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  enabled, parametricState, onUpdate,
}) => {
  const { selectedFilter, filterEnabled, gain, frequency, q } = parametricState;
  const [modalVisible, setModalVisible] = useState(false);

  const freqToKnob = (f: number) => {
    const logRange = Math.log10(20000) - Math.log10(20);
    return ((Math.log10(Math.max(20, Math.min(20000, f))) - Math.log10(20)) / logRange) * 100;
  };

  const knobToFreq = (k: number) => {
    const logRange = Math.log10(20000) - Math.log10(20);
    return Math.round(Math.pow(10, (k / 100) * logRange + Math.log10(20)));
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.filterBtn, !enabled && styles.disabled]}
        onPress={() => setModalVisible(true)}
        disabled={!enabled}
      >
        <Text style={styles.filterText}>
          {FILTERS.find(f => f.id === selectedFilter)?.name}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#888" />
      </TouchableOpacity>

      <View style={styles.knobsRow}>
        <RotaryKnob
          value={((gain + 15) / 30) * 100}
          label="GAIN"
          onChange={(v) => onUpdate({ gain: (v / 100) * 30 - 15 })}
          enabled={enabled && filterEnabled}
        />
        <RotaryKnob
          value={freqToKnob(frequency)}
          label="FREQ"
          onChange={(v) => onUpdate({ frequency: knobToFreq(v) })}
          enabled={enabled && filterEnabled}
        />
        <RotaryKnob
          value={(q / 10) * 100}
          label="Q"
          onChange={(v) => onUpdate({ q: (v / 100) * 10 })}
          enabled={enabled && filterEnabled}
        />
      </View>

      <TouchableOpacity
        style={[styles.toggleBtn, filterEnabled && styles.toggleBtnActive]}
        onPress={() => onUpdate({ filterEnabled: !filterEnabled })}
      >
        <Text style={[styles.toggleText, filterEnabled && styles.toggleTextActive]}>
          {filterEnabled ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <FlatList
              data={FILTERS}
              keyExtractor={f => f.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.filterItem,
                    selectedFilter === item.id && styles.filterItemActive,
                  ]}
                  onPress={() => {
                    onUpdate({ selectedFilter: item.id });
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.filterItemText}>{item.name}</Text>
                  {selectedFilter === item.id && (
                    <Ionicons name="checkmark" size={18} color="#4ade80" />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: scale(16),
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    padding: scale(14),
    borderRadius: 12,
    marginBottom: verticalScale(20),
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  filterText: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  knobsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: verticalScale(20),
  },
  toggleBtn: {
    alignSelf: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(40),
    borderRadius: 24,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleBtnActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  toggleText: {
    color: '#888',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  toggleTextActive: {
    color: '#000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: scale(16),
    maxHeight: '70%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: scale(36),
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    marginBottom: verticalScale(12),
  },
  filterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(14),
    paddingHorizontal: scale(12),
    borderRadius: 10,
    marginBottom: verticalScale(6),
  },
  filterItemActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
  },
  filterItemText: {
    color: '#fff',
    fontSize: moderateScale(14),
  },
});
