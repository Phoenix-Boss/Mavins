// ============================================================================
// COMPONENTS/EQUALIZER/FXControls.tsx (REVAMPED)
// ============================================================================
// Poweramp-style FX modal

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import * as Haptics from 'expo-haptics';

type FXMode = 'reverb'|'delay'|'chorus'|'flanger'|'phaser';

interface FXControlsProps {
  enabled: boolean;
  fxState: {
    mode: FXMode;
    mix: number;
    bypass: boolean;
  };
  onUpdate: (updates: Partial<FXControlsProps['fxState']>) => void;
}

const FX_MODES: { id: FXMode; name: string; color: string }[] = [
  { id: 'reverb', name: 'REVERB', color: '#4ade80' },
  { id: 'delay', name: 'DELAY', color: '#facc15' },
  { id: 'chorus', name: 'CHORUS', color: '#60a5fa' },
  { id: 'flanger', name: 'FLANGER', color: '#f97316' },
  { id: 'phaser', name: 'PHASER', color: '#a78bfa' },
];

export const FXControls: React.FC<FXControlsProps> = ({ enabled, fxState, onUpdate }) => {
  const { mode, mix, bypass } = fxState;

  const handleModeChange = useCallback((newMode: FXMode) => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdate({ mode: newMode });
  }, [enabled, onUpdate]);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container}>
      <View style={styles.modeGrid}>
        {FX_MODES.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={[
              styles.modeItem,
              mode === m.id && styles.modeItemActive,
              { borderColor: m.color },
            ]}
            onPress={() => handleModeChange(m.id)}
            disabled={!enabled}
          >
            <Text style={[
              styles.modeName,
              mode === m.id && { color: m.color },
            ]}>
              {m.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.knobSection}>
        <RotaryKnob
          value={mix}
          label="MIX"
          onChange={(v) => onUpdate({ mix: v })}
          enabled={enabled && !bypass}
        />
      </View>

      <TouchableOpacity
        style={[styles.bypassBtn, bypass && styles.bypassBtnActive]}
        onPress={() => onUpdate({ bypass: !bypass })}
        disabled={!enabled}
      >
        <Text style={[styles.bypassText, bypass && styles.bypassTextActive]}>
          {bypass ? 'BYPASSED' : 'ACTIVE'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: verticalScale(16),
    paddingHorizontal: scale(16),
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: scale(8),
    marginBottom: verticalScale(20),
  },
  modeItem: {
    flex: 1,
    minWidth: scale(70),
    paddingVertical: verticalScale(12),
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  modeItemActive: {
    backgroundColor: '#2a2a2a',
  },
  modeName: {
    color: '#888',
    fontSize: moderateScale(10),
    fontWeight: '700',
  },
  knobSection: {
    alignItems: 'center',
    marginBottom: verticalScale(20),
  },
  bypassBtn: {
    alignSelf: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(32),
    borderRadius: 24,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
  },
  bypassBtnActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  bypassText: {
    color: '#888',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  bypassTextActive: {
    color: '#000',
  },
});