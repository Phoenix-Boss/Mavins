// components/equalizer/FXControls.tsx
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import { Colors } from '../../constants/Colors';

interface FXControlsProps {
  enabled: boolean;
  fxState: {
    mode: 'Reverb' | 'Echo';
    damp: number;
    filter: number;
    fade: number;
    preDelay: number;
    preDelayMix: number;
    size: number;
    mix: number;
  };
  onUpdate: (updates: Partial<{
    mode: 'Reverb' | 'Echo';
    damp: number;
    filter: number;
    fade: number;
    preDelay: number;
    preDelayMix: number;
    size: number;
    mix: number;
  }>) => void;
}

export const FXControls: React.FC<FXControlsProps> = ({
  enabled,
  fxState,
  onUpdate
}) => {
  const { mode, damp, filter, fade, preDelay, preDelayMix, size, mix } = fxState;

  // Reset to mode-appropriate defaults
  const resetForMode = useCallback((newMode: 'Reverb' | 'Echo') => {
    const defaults = newMode === 'Reverb' ? {
      damp: 36, filter: 91, fade: 27, preDelay: 54, preDelayMix: 58, size: 73, mix: 37
    } : {
      damp: 20, filter: 80, fade: 40, preDelay: 30, preDelayMix: 20, size: 50, mix: 25
    };
    
    onUpdate({ mode: newMode, ...defaults });
  }, [onUpdate]);

  const handleModeChange = useCallback((newMode: 'Reverb' | 'Echo') => {
    if (!enabled) return;
    resetForMode(newMode);
  }, [enabled, resetForMode]);

  const handleSave = useCallback(() => {
    if (!enabled) return;
    Alert.alert('FX Saved', 'FX preset saved successfully!');
    // Could save to AsyncStorage here
  }, [enabled]);

  const handleReset = useCallback(() => {
    if (!enabled) return;
    Alert.alert(
      'Reset FX',
      'Reset all FX controls?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetForMode(mode) }
      ]
    );
  }, [enabled, mode, resetForMode]);

  // Update handlers - respect enabled state
  const createUpdater = (key: keyof typeof fxState) => (value: number) => {
    if (!enabled) return;
    onUpdate({ [key]: value } as any);
  };

  return (
    <>
      <View style={styles.fxGrid}>
        <RotaryKnob 
          value={damp} 
          label="Damp" 
          onChange={createUpdater('damp')}
          color="#00FF00" 
          size={90} 
          enabled={enabled}
        />
        <RotaryKnob 
          value={filter} 
          label="Filter" 
          onChange={createUpdater('filter')}
          color="#FF6600" 
          size={110} 
          enabled={enabled}
        />
        <RotaryKnob 
          value={fade} 
          label="Fade" 
          onChange={createUpdater('fade')}
          color="#00FFFF" 
          size={90} 
          enabled={enabled}
        />
        <RotaryKnob 
          value={preDelay} 
          label="Pre-Delay" 
          onChange={createUpdater('preDelay')}
          color="#00FF00" 
          size={90} 
          enabled={enabled}
        />
        <RotaryKnob 
          value={preDelayMix} 
          label="Pre-Dly Mix" 
          onChange={createUpdater('preDelayMix')}
          color="#00FF00" 
          size={90} 
          enabled={enabled}
        />
        <RotaryKnob 
          value={size} 
          label="Size" 
          onChange={createUpdater('size')}
          color="#FFFF00" 
          size={90} 
          enabled={enabled}
        />
      </View>

      <View style={styles.fxModeBar}>
        <TouchableOpacity 
          style={[styles.fxModeButton, mode === 'Reverb' && styles.fxModeButtonActive]} 
          onPress={() => handleModeChange('Reverb')}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.fxModeButtonText}>Reverb</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.fxModeButton, mode === 'Echo' && styles.fxModeButtonActive]} 
          onPress={() => handleModeChange('Echo')}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.fxModeButtonText}>Echo</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.fxModeButton} 
          onPress={handleSave}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.fxModeButtonText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.fxModeButton} 
          onPress={handleReset}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.fxModeButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.masterMixContainer}>
        <Text style={styles.masterMixLabel}>Mix</Text>
        <Text style={styles.masterMixValue}>{(mix / 100).toFixed(2)}</Text>
        <RotaryKnob 
          value={mix} 
          label="" 
          onChange={createUpdater('mix')}
          color="#00FF00" 
          size={130} 
          showValue={false}
          enabled={enabled}
        />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  fxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginTop: verticalScale(20),
    gap: verticalScale(20),
  },
  fxModeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: verticalScale(25),
    paddingHorizontal: scale(5),
    gap: scale(10),
  },
  fxModeButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(16),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  fxModeButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  fxModeButtonText: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
  masterMixContainer: {
    alignItems: 'center',
    marginTop: verticalScale(30),
  },
  masterMixLabel: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
  masterMixValue: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    marginBottom: verticalScale(10),
  },
});
