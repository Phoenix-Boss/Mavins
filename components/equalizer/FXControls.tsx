// ============================================================================
// COMPONENTS/EQUALIZER/FXControls.tsx
// ============================================================================
// PURE UI COMPONENT - No native module calls
// All native FX calls are handled by the parent EQ page
// ============================================================================

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import * as Haptics from 'expo-haptics';

export type FXMode = 'reverb' | 'delay' | 'chorus' | 'flanger' | 'phaser';

export interface FXState {
  mode: FXMode;
  mix: number;
  bypass: boolean;
  // Reverb specific
  reverbRoomSize: number;
  reverbDecay: number;
  reverbPreDelay: number;
  reverbDamping: number;
  // Delay specific
  delayTime: number;
  delayFeedback: number;
  delayLowCut: number;
  delayHighCut: number;
  // Modulation specific (Chorus/Flanger/Phaser)
  modRate: number;
  modDepth: number;
  modPhase: number;
  modFeedback: number;
}

interface FXControlsProps {
  enabled: boolean;
  fxState: FXState;
  onFXUpdate: (updates: Partial<FXState>) => void;
}

const FX_MODES: { id: FXMode; name: string; color: string; icon: string }[] = [
  { id: 'reverb', name: 'REVERB', color: '#4ade80', icon: '🌊' },
  { id: 'delay', name: 'DELAY', color: '#facc15', icon: '⏱️' },
  { id: 'chorus', name: 'CHORUS', color: '#60a5fa', icon: '🎵' },
  { id: 'flanger', name: 'FLANGER', color: '#f97316', icon: '🌀' },
  { id: 'phaser', name: 'PHASER', color: '#a78bfa', icon: '⚡' },
];

// Parameter configurations per mode
const getParametersForMode = (mode: FXMode) => {
  switch (mode) {
    case 'reverb':
      return [
        { id: 'reverbRoomSize', label: 'SIZE', min: 0, max: 100, unit: '%' },
        { id: 'reverbDecay', label: 'DECAY', min: 0, max: 100, unit: '%' },
        { id: 'reverbPreDelay', label: 'PRE DELAY', min: 0, max: 100, unit: 'ms' },
        { id: 'reverbDamping', label: 'DAMPING', min: 0, max: 100, unit: '%' },
      ];
    case 'delay':
      return [
        { id: 'delayTime', label: 'TIME', min: 0, max: 100, unit: '%' },
        { id: 'delayFeedback', label: 'FEEDBACK', min: 0, max: 100, unit: '%' },
        { id: 'delayLowCut', label: 'LOW CUT', min: 0, max: 100, unit: 'Hz' },
        { id: 'delayHighCut', label: 'HIGH CUT', min: 0, max: 100, unit: 'Hz' },
      ];
    case 'chorus':
    case 'flanger':
    case 'phaser':
      return [
        { id: 'modRate', label: 'RATE', min: 0, max: 100, unit: 'Hz' },
        { id: 'modDepth', label: 'DEPTH', min: 0, max: 100, unit: '%' },
        { id: 'modPhase', label: 'PHASE', min: 0, max: 100, unit: '°' },
        { id: 'modFeedback', label: 'FEEDBACK', min: 0, max: 100, unit: '%' },
      ];
    default:
      return [];
  }
};

export const FXControls: React.FC<FXControlsProps> = ({
  enabled,
  fxState,
  onFXUpdate,
}) => {
  const { mode, mix, bypass, ...params } = fxState;

  const handleModeChange = useCallback((newMode: FXMode) => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFXUpdate({ mode: newMode });
  }, [enabled, onFXUpdate]);

  const handleParameterChange = useCallback((paramId: string, value: number) => {
    if (!enabled || bypass) return;
    Haptics.selectionAsync();
    onFXUpdate({ [paramId]: value } as Partial<FXState>);
  }, [enabled, bypass, onFXUpdate]);

  const handleMixChange = useCallback((knobId: string, value: number) => {
    if (!enabled) return;
    Haptics.selectionAsync();
    onFXUpdate({ mix: value });
  }, [enabled, onFXUpdate]);

  const handleBypassToggle = useCallback(() => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onFXUpdate({ bypass: !bypass });
  }, [enabled, bypass, onFXUpdate]);

  const currentParameters = getParametersForMode(mode);
  const currentFX = FX_MODES.find(fx => fx.id === mode)!;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {/* Effect Mode Selector */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>EFFECT TYPE</Text>
        <View style={styles.modeGrid}>
          {FX_MODES.map((fx) => (
            <TouchableOpacity
              key={fx.id}
              style={[
                styles.modeCard,
                mode === fx.id && styles.modeCardActive,
                { borderColor: mode === fx.id ? fx.color : '#2a2a2a' },
              ]}
              onPress={() => handleModeChange(fx.id)}
              disabled={!enabled}
            >
              <Text style={styles.modeIcon}>{fx.icon}</Text>
              <Text style={[
                styles.modeName,
                mode === fx.id && { color: fx.color }
              ]}>
                {fx.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Parameters Section */}
      {currentParameters.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PARAMETERS</Text>
          <View style={styles.parametersGrid}>
            {currentParameters.map((param) => (
              <View key={param.id} style={styles.parameterItem}>
                <RotaryKnob
                  knobId={param.id}
                  value={fxState[param.id as keyof FXState] as number}
                  label={param.label}
                  size={scale(70)}
                  enabled={enabled && !bypass}
                  onValueChange={(id, val) => handleParameterChange(id, val)}
                />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Mix Control */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MIX CONTROL</Text>
        <View style={styles.mixContainer}>
          <RotaryKnob
            knobId="fxMix"
            value={mix}
            label="WET / DRY"
            size={scale(80)}
            enabled={enabled && !bypass}
            onValueChange={handleMixChange}
          />
        </View>
      </View>

      {/* Bypass Button */}
      <TouchableOpacity
        style={[
          styles.bypassBtn,
          bypass && styles.bypassBtnActive,
          !enabled && styles.bypassBtnDisabled,
        ]}
        onPress={handleBypassToggle}
        disabled={!enabled}
      >
        <Text style={[
          styles.bypassText,
          bypass && styles.bypassTextActive,
          !enabled && styles.bypassTextDisabled,
        ]}>
          {bypass ? 'EFFECT BYPASSED' : 'EFFECT ACTIVE'}
        </Text>
      </TouchableOpacity>

      {/* Active Effect Indicator */}
      {enabled && !bypass && (
        <View style={[styles.activeIndicator, { backgroundColor: currentFX.color }]}>
          <Text style={styles.activeText}>{currentFX.name} PROCESSING</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: verticalScale(16),
    paddingHorizontal: scale(16),
  },
  section: {
    marginBottom: verticalScale(24),
  },
  sectionTitle: {
    color: '#e8d9c0',
    fontSize: moderateScale(11),
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: verticalScale(12),
    textTransform: 'uppercase',
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: scale(8),
  },
  modeCard: {
    flex: 1,
    minWidth: scale(65),
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  modeCardActive: {
    backgroundColor: 'rgba(200,164,100,0.15)',
  },
  modeIcon: {
    fontSize: moderateScale(18),
    marginBottom: verticalScale(4),
  },
  modeName: {
    color: '#888',
    fontSize: moderateScale(9),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  parametersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: scale(12),
  },
  parameterItem: {
    alignItems: 'center',
    minWidth: scale(70),
  },
  mixContainer: {
    alignItems: 'center',
  },
  bypassBtn: {
    alignSelf: 'center',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(40),
    borderRadius: 30,
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    borderColor: '#333',
    marginTop: verticalScale(8),
    marginBottom: verticalScale(16),
  },
  bypassBtnActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  bypassBtnDisabled: {
    opacity: 0.5,
  },
  bypassText: {
    color: '#888',
    fontSize: moderateScale(12),
    fontWeight: '800',
    letterSpacing: 1,
  },
  bypassTextActive: {
    color: '#0a0908',
  },
  bypassTextDisabled: {
    color: '#555',
  },
  activeIndicator: {
    alignSelf: 'center',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(6),
    borderRadius: 20,
    marginTop: verticalScale(8),
  },
  activeText: {
    color: '#0a0908',
    fontSize: moderateScale(9),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
