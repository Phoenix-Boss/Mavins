// ============================================================================
// COMPONENTS/EQUALIZER/MasteringControls.tsx (REVAMPED)
// ============================================================================

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

interface MasteringControlsProps {
  enabled: boolean;
  masteringState: {
    balance: number;
    stereoWidth: number;
    loudness: number;
    limiter: boolean;
    mono: boolean;
  };
  onUpdate: (updates: Partial<MasteringControlsProps['masteringState']>) => void;
}

export const MasteringControls: React.FC<MasteringControlsProps> = ({
  enabled, masteringState, onUpdate,
}) => {
  const { balance, stereoWidth, loudness, limiter, mono } = masteringState;

  const update = useCallback((key: keyof typeof masteringState, value: any) => {
    if (!enabled) return;
    Haptics.selectionAsync();
    onUpdate({ [key]: value });
  }, [enabled, onUpdate]);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>STEREO FIELD</Text>
        
        <Text style={styles.label}>BALANCE</Text>
        <Slider
          style={styles.slider}
          value={balance}
          onValueChange={(v) => update('balance', v)}
          minimumValue={0}
          maximumValue={100}
          minimumTrackTintColor="#4ade80"
          maximumTrackTintColor="#2a2a2a"
          thumbTintColor={enabled ? '#4ade80' : '#444'}
          disabled={!enabled}
        />

        <Text style={styles.label}>WIDTH</Text>
        <Slider
          style={styles.slider}
          value={stereoWidth}
          onValueChange={(v) => update('stereoWidth', v)}
          minimumValue={0}
          maximumValue={100}
          minimumTrackTintColor="#4ade80"
          maximumTrackTintColor="#2a2a2a"
          thumbTintColor={enabled ? '#4ade80' : '#444'}
          disabled={!enabled}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DYNAMICS</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.dynBtn, limiter && styles.dynBtnActive]}
            onPress={() => update('limiter', !limiter)}
          >
            <Text style={[styles.dynText, limiter && styles.dynTextActive]}>LIMITER</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.dynBtn, mono && styles.dynBtnActive]}
            onPress={() => update('mono', !mono)}
          >
            <Text style={[styles.dynText, mono && styles.dynTextActive]}>MONO</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: scale(16),
  },
  section: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: scale(14),
    marginBottom: verticalScale(12),
  },
  sectionTitle: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '700',
    marginBottom: verticalScale(12),
    letterSpacing: 0.5,
  },
  label: {
    color: '#888',
    fontSize: moderateScale(10),
    marginBottom: verticalScale(6),
    marginTop: verticalScale(8),
  },
  slider: {
    width: '100%',
    height: verticalScale(30),
  },
  buttonRow: {
    flexDirection: 'row',
    gap: scale(10),
  },
  dynBtn: {
    flex: 1,
    paddingVertical: verticalScale(12),
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  dynBtnActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  dynText: {
    color: '#888',
    fontSize: moderateScale(11),
    fontWeight: '700',
  },
  dynTextActive: {
    color: '#000',
  },
});