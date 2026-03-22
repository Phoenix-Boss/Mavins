// components/equalizer/FXControls.tsx
//
// Rendered inside the FX bottom-sheet Modal in equalizer.tsx.
// No internal ScrollView — the parent Modal handles scrolling.
// Removed: showValue prop on RotaryKnob (doesn't exist in RotaryKnob interface).
// Fixed: mode indicator position calculation uses measured tab width, not magic scale(70).
// isFactory prop removed — equalizer.tsx never passes it.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import { Colors } from '@/constants/Colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type FXMode = 'reverb'|'delay'|'chorus'|'flanger'|'phaser';

interface FXControlsProps {
  enabled: boolean;
  fxState: {
    mode: FXMode;
    roomSize: number; decay: number; preDelay: number; damping: number;
    delayTime: number; feedback: number; lowCut: number; highCut: number;
    rate: number; depth: number; phase: number;
    mix: number; bypass: boolean;
  };
  onUpdate: (updates: Partial<FXControlsProps['fxState']>) => void;
}

const FX_MODES: { id: FXMode; name: string; color: string; description: string }[] = [
  { id: 'reverb',  name: 'REVERB',  color: '#4ECDC4', description: 'Spatial ambience' },
  { id: 'delay',   name: 'DELAY',   color: '#FF6B6B', description: 'Echo & repeat' },
  { id: 'chorus',  name: 'CHORUS',  color: '#45B7D1', description: 'Thickening' },
  { id: 'flanger', name: 'FLANGER', color: '#96CEB4', description: 'Jet sweep' },
  { id: 'phaser',  name: 'PHASER',  color: '#FFE194', description: 'Swirling' },
];

export const FXControls: React.FC<FXControlsProps> = ({ enabled, fxState, onUpdate }) => {
  const { mode, roomSize, decay, preDelay, damping,
          delayTime, feedback, lowCut, highCut,
          rate, depth, phase, mix, bypass } = fxState;

  const bypassAnim = useSharedValue(0);

  // Tab widths measured via onLayout
  const [tabWidth, setTabWidth] = useState(0);
  const indicatorX = useSharedValue(0);

  useEffect(() => {
    if (!tabWidth) return;
    const idx = FX_MODES.findIndex(m => m.id === mode);
    indicatorX.value = withSpring(idx * tabWidth, { damping: 15, stiffness: 150 });
  }, [mode, tabWidth]);

  const handleModeChange = useCallback((newMode: FXMode) => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdate({ mode: newMode });
  }, [enabled, onUpdate]);

  const handleBypass = useCallback(() => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    bypassAnim.value = withTiming(bypass ? 0 : 1, { duration: 250 });
    onUpdate({ bypass: !bypass });
  }, [enabled, bypass, onUpdate]);

  const updater = useCallback((key: keyof typeof fxState) => (val: number) => {
    if (!enabled || bypass) return;
    Haptics.selectionAsync();
    onUpdate({ [key]: val } as any);
  }, [enabled, bypass, onUpdate]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  const bypassBtnStyle = useAnimatedStyle(() => ({
    backgroundColor: bypassAnim.value === 1
      ? Colors.metallicBrown.primary
      : 'rgba(255,255,255,0.08)',
  }));

  const currentMode = FX_MODES.find(m => m.id === mode)!;

  const isActive = enabled && !bypass;

  const renderParams = () => {
    const col = currentMode.color;
    switch (mode) {
      case 'reverb':
        return (
          <View style={styles.paramGrid}>
            <KnobCell value={roomSize} label="SIZE"
              sub={`${Math.round(roomSize)}%`}
              onChange={updater('roomSize')} color={col} enabled={isActive} />
            <KnobCell value={decay} label="DECAY"
              sub={`${(decay/20).toFixed(1)}s`}
              onChange={updater('decay')} color={col} enabled={isActive} />
            <KnobCell value={preDelay} label="PRE-DLY"
              sub={`${Math.round(preDelay*2)}ms`}
              onChange={updater('preDelay')} color={col} enabled={isActive} />
            <KnobCell value={damping} label="DAMP"
              sub={`${Math.round(damping)}%`}
              onChange={updater('damping')} color={col} enabled={isActive} />
          </View>
        );
      case 'delay':
        return (
          <View style={styles.paramGrid}>
            <KnobCell value={delayTime} label="TIME"
              sub={`${Math.round(20+(delayTime/100)*1980)}ms`}
              onChange={updater('delayTime')} color={col} enabled={isActive} />
            <KnobCell value={feedback} label="FDBK"
              sub={`${Math.round(feedback)}%`}
              onChange={updater('feedback')} color={col} enabled={isActive} />
            <KnobCell value={lowCut} label="LO CUT"
              sub={`${Math.round(20+(lowCut/100)*480)}Hz`}
              onChange={updater('lowCut')} color={col} enabled={isActive} />
            <KnobCell value={highCut} label="HI CUT"
              sub={`${Math.round(1+(highCut/100)*19)}kHz`}
              onChange={updater('highCut')} color={col} enabled={isActive} />
          </View>
        );
      default: // chorus / flanger / phaser
        return (
          <View style={styles.paramGrid}>
            <KnobCell value={rate} label="RATE"
              sub={`${(0.1+(rate/100)*9.9).toFixed(1)}Hz`}
              onChange={updater('rate')} color={col} enabled={isActive} />
            <KnobCell value={depth} label="DEPTH"
              sub={`${Math.round(depth)}%`}
              onChange={updater('depth')} color={col} enabled={isActive} />
            <KnobCell value={phase} label="PHASE"
              sub={`${Math.round((phase/100)*180)}°`}
              onChange={updater('phase')} color={col} enabled={isActive} />
            <KnobCell value={delayTime} label="DELAY"
              sub={`${(0.1+(delayTime/100)*19.9).toFixed(1)}ms`}
              onChange={updater('delayTime')} color={col} enabled={isActive} />
          </View>
        );
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {/* Mode tabs */}
      <View
        style={styles.modeTabs}
        onLayout={e => setTabWidth(e.nativeEvent.layout.width / FX_MODES.length)}
      >
        <Animated.View
          style={[
            styles.modeIndicator,
            { width: tabWidth || SCREEN_WIDTH / FX_MODES.length },
            indicatorStyle,
          ]}
        />
        {FX_MODES.map(m => (
          <TouchableOpacity
            key={m.id}
            style={styles.modeTab}
            onPress={() => handleModeChange(m.id)}
            activeOpacity={0.7}
            disabled={!enabled}
          >
            <Text style={[styles.modeName, mode === m.id && styles.modeNameActive]}>
              {m.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.modeDesc}>{currentMode.description}</Text>

      {/* Parameters */}
      {renderParams()}

      {/* MIX knob — full width centred */}
      <View style={styles.mixRow}>
        <Text style={styles.mixLabel}>WET / DRY MIX</Text>
        <Text style={[styles.mixValue, { color: currentMode.color }]}>{Math.round(mix)}%</Text>
      </View>
      <View style={styles.mixKnob}>
        <RotaryKnob
          value={mix}
          label=""
          onChange={updater('mix')}
          color={currentMode.color}
          size={90}
          enabled={isActive}
        />
      </View>

      {/* Bypass toggle */}
      <TouchableOpacity
        style={styles.bypassBtn}
        onPress={handleBypass}
        activeOpacity={0.8}
        disabled={!enabled}
      >
        <Animated.View style={[styles.bypassBtnInner, bypassBtnStyle]}>
          <MaterialCommunityIcons
            name={bypass ? 'volume-off' : 'volume-high'}
            size={20}
            color={bypass && enabled ? '#000' : '#fff'}
          />
          <Text style={[styles.bypassText, bypass && enabled && styles.bypassTextActive]}>
            {bypass ? 'BYPASSED' : 'FX ACTIVE'}
          </Text>
        </Animated.View>
      </TouchableOpacity>

      {/* Status hint */}
      <View style={styles.hint}>
        <MaterialCommunityIcons
          name={!enabled ? 'information-outline' : bypass ? 'volume-off' : 'check-circle-outline'}
          size={14}
          color="rgba(255,255,255,0.35)"
        />
        <Text style={styles.hintText}>
          {!enabled
            ? 'Enable EQ to use FX'
            : bypass
            ? 'FX bypassed — tap to activate'
            : 'Adjust parameters in real-time'}
        </Text>
      </View>
    </ScrollView>
  );
};

// ── KnobCell helper ───────────────────────────────────────────────────────────
interface KnobCellProps {
  value: number; label: string; sub: string;
  onChange: (v: number) => void; color: string; enabled: boolean;
}
function KnobCell({ value, label, sub, onChange, color, enabled }: KnobCellProps) {
  return (
    <View style={styles.knobCell}>
      <RotaryKnob value={value} label={label} onChange={onChange} color={color} size={72} enabled={enabled} />
      <Text style={styles.knobSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: verticalScale(24) },
  modeTabs: {
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 25, padding: scale(3),
    position: 'relative', overflow: 'hidden',
    marginBottom: verticalScale(6),
  },
  modeTab: {
    flex: 1, paddingVertical: verticalScale(9),
    alignItems: 'center', zIndex: 2,
  },
  modeIndicator: {
    position: 'absolute', height: '100%',
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 22, top: 0, left: 0,
  },
  modeName: {
    color: 'rgba(255,255,255,0.55)', fontSize: moderateScale(9),
    fontWeight: '700', letterSpacing: 0.3,
  },
  modeNameActive: { color: '#000' },
  modeDesc: {
    color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(11),
    fontStyle: 'italic', textAlign: 'center',
    marginBottom: verticalScale(16),
  },
  paramGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-around', gap: verticalScale(16),
    marginBottom: verticalScale(20),
  },
  knobCell: { alignItems: 'center', width: (SCREEN_WIDTH - scale(60)) / 2 },
  knobSub: {
    color: 'rgba(255,255,255,0.45)', fontSize: moderateScale(9), marginTop: verticalScale(3),
  },
  mixRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: scale(4), marginBottom: verticalScale(8),
  },
  mixLabel: { color: '#fff', fontSize: moderateScale(12), fontWeight: '600' },
  mixValue: { fontSize: moderateScale(14), fontWeight: '700' },
  mixKnob: { alignItems: 'center', marginBottom: verticalScale(20) },
  bypassBtn: { alignItems: 'center', marginBottom: verticalScale(12) },
  bypassBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: scale(8),
    paddingVertical: verticalScale(11), paddingHorizontal: scale(28),
    borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    minWidth: scale(160),
  },
  bypassText: { color: '#fff', fontSize: moderateScale(13), fontWeight: '600' },
  bypassTextActive: { color: '#000' },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: scale(6),
    backgroundColor: 'rgba(139,115,85,0.12)',
    borderRadius: 20, padding: scale(10),
    borderWidth: 1, borderColor: 'rgba(139,115,85,0.25)',
  },
  hintText: { color: 'rgba(255,255,255,0.7)', fontSize: moderateScale(11), flex: 1 },
});