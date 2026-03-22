// components/equalizer/MasteringControls.tsx
//
// Rendered inside the Mastering bottom-sheet Modal in equalizer.tsx.
// Fixes:
//  - Removed fake setInterval that called runOnJS(onUpdate) at 10Hz
//    (was writing truePeak and gainReduction to state every 100ms)
//  - Peak meters animate based on loudness value, not simulated audio
//  - No BlurView, no isFactory prop
//  - Internal ScrollView kept for sheet overflow

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

interface MasteringControlsProps {
  enabled: boolean;
  masteringState: {
    balance: number;          // 0-100
    stereoWidth: number;      // 0-100
    loudness: number;         // 0-100
    limiter: boolean;
    mono: boolean;
    limiterThreshold: number; // -12 to 0
    truePeak: number;
    gainReduction: number;
  };
  onUpdate: (updates: Partial<MasteringControlsProps['masteringState']>) => void;
}

export const MasteringControls: React.FC<MasteringControlsProps> = ({
  enabled, masteringState, onUpdate,
}) => {
  const {
    balance, stereoWidth, loudness,
    limiter, mono, limiterThreshold,
  } = masteringState;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const limiterGlow = useSharedValue(limiter ? 1 : 0);

  // Derived visual level from loudness (0-100) — not from fake audio sim
  const levelL = Math.min(1, (loudness / 100) * 1.1);
  const levelR = Math.min(1, (loudness / 100) * 1.05);

  const update = useCallback((u: Partial<MasteringControlsProps['masteringState']>) => {
    if (!enabled) return;
    Haptics.selectionAsync();
    onUpdate(u);
  }, [enabled, onUpdate]);

  const toggleLimiter = useCallback(() => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    limiterGlow.value = withTiming(limiter ? 0 : 1, { duration: 250 });
    onUpdate({ limiter: !limiter });
  }, [enabled, limiter, onUpdate]);

  const toggleMono = useCallback(() => {
    if (!enabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdate({ mono: !mono });
  }, [enabled, mono, onUpdate]);

  const handleReset = useCallback(() => {
    if (!enabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onUpdate({ balance: 50, stereoWidth: 50, loudness: 50, limiter: false, mono: false, limiterThreshold: -6 });
  }, [enabled, onUpdate]);

  const limiterStyle = useAnimatedStyle(() => ({
    borderColor: limiterGlow.value > 0
      ? Colors.metallicBrown.primary
      : 'rgba(255,255,255,0.12)',
    backgroundColor: limiterGlow.value > 0
      ? `rgba(139,115,85,${0.22 * limiterGlow.value})`
      : 'rgba(255,255,255,0.05)',
  }));

  const isDisabled = !enabled;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container}>

      {/* ── Peak meters ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LEVELS</Text>
        <View style={styles.meters}>
          <Text style={styles.meterCh}>L</Text>
          <View style={styles.meterBar}>
            <View style={[styles.meterFill, {
              width: `${levelL * 100}%`,
              backgroundColor: levelL > 0.9 ? '#F44336' : Colors.metallicBrown.primary,
            }]} />
          </View>
          <View style={styles.meterBar}>
            <View style={[styles.meterFill, {
              width: `${levelR * 100}%`,
              backgroundColor: levelR > 0.9 ? '#F44336' : Colors.metallicBrown.secondary,
            }]} />
          </View>
          <Text style={styles.meterCh}>R</Text>
        </View>
        <View style={styles.meterLabels}>
          <Text style={styles.meterLabel}>-∞</Text>
          <Text style={styles.meterLabel}>-20</Text>
          <Text style={styles.meterLabel}>-10</Text>
          <Text style={styles.meterLabel}>-6</Text>
          <Text style={styles.meterLabel}>0</Text>
        </View>
      </View>

      {/* ── Loudness ─────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>LOUDNESS</Text>
          <Text style={[styles.sectionValue, { color: Colors.metallicBrown.primary }]}>
            {Math.round((loudness - 50) * 0.8 * 10) / 10} dB
          </Text>
        </View>
        <View style={styles.sliderRow}>
          <Text style={styles.rangeLabel}>-20</Text>
          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={100}
            value={loudness}
            onValueChange={v => update({ loudness: v })}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled ? Colors.metallicBrown.primary : '#666'}
            disabled={isDisabled}
          />
          <Text style={styles.rangeLabel}>+20</Text>
        </View>
      </View>

      {/* ── Stereo field ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>STEREO FIELD</Text>

        {/* Balance */}
        <Text style={styles.controlLabel}>BALANCE</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.rangeLabel}>L</Text>
          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={100}
            value={balance}
            onValueChange={v => update({ balance: v })}
            minimumTrackTintColor={balance < 50 ? Colors.metallicBrown.primary : 'rgba(255,255,255,0.1)'}
            maximumTrackTintColor={balance > 50 ? Colors.metallicBrown.primary : 'rgba(255,255,255,0.1)'}
            thumbTintColor={enabled ? Colors.metallicBrown.primary : '#666'}
            disabled={isDisabled}
          />
          <Text style={styles.rangeLabel}>R</Text>
        </View>

        {/* Stereo width */}
        <Text style={[styles.controlLabel, { marginTop: verticalScale(10) }]}>STEREO WIDTH</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.rangeLabel}>MONO</Text>
          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={100}
            value={stereoWidth}
            onValueChange={v => update({ stereoWidth: v })}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled ? Colors.metallicBrown.primary : '#666'}
            disabled={isDisabled}
          />
          <Text style={styles.rangeLabel}>WIDE</Text>
        </View>
      </View>

      {/* ── Dynamics buttons ─────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DYNAMICS</Text>
        <View style={styles.dynRow}>

          <TouchableOpacity
            style={styles.dynBtn}
            onPress={toggleLimiter}
            activeOpacity={0.75}
            disabled={isDisabled}
          >
            <Animated.View style={[styles.dynBtnInner, limiterStyle]}>
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={22}
                color={limiter && enabled ? Colors.metallicBrown.primary : '#888'}
              />
              <Text style={[styles.dynBtnLabel, limiter && enabled && styles.dynBtnLabelActive]}>
                LIMITER
              </Text>
              <Text style={[styles.dynBtnState, limiter && enabled && styles.dynBtnStateActive]}>
                {limiter ? 'ON' : 'OFF'}
              </Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dynBtn, mono && enabled && styles.dynBtnOn]}
            onPress={toggleMono}
            activeOpacity={0.75}
            disabled={isDisabled}
          >
            <View style={styles.dynBtnInner}>
              <MaterialCommunityIcons
                name="circle-double"
                size={22}
                color={mono && enabled ? Colors.metallicBrown.primary : '#888'}
              />
              <Text style={[styles.dynBtnLabel, mono && enabled && styles.dynBtnLabelActive]}>MONO</Text>
              <Text style={[styles.dynBtnState, mono && enabled && styles.dynBtnStateActive]}>
                {mono ? 'ON' : 'OFF'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dynBtn}
            onPress={handleReset}
            activeOpacity={0.75}
            disabled={isDisabled}
          >
            <View style={styles.dynBtnInner}>
              <MaterialCommunityIcons name="refresh" size={22} color="#888" />
              <Text style={styles.dynBtnLabel}>RESET</Text>
              <Text style={styles.dynBtnState}>↺</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Advanced ─────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setShowAdvanced(s => !s)}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons name="cog-outline" size={14} color="rgba(255,255,255,0.4)" />
        <Text style={styles.advancedToggleText}>ADVANCED</Text>
        <MaterialCommunityIcons
          name={showAdvanced ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="rgba(255,255,255,0.4)"
        />
      </TouchableOpacity>

      {showAdvanced && (
        <View style={styles.advancedSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.controlLabel}>LIMITER THRESHOLD</Text>
            <Text style={[styles.sectionValue, { color: Colors.metallicBrown.primary }]}>
              {limiterThreshold.toFixed(1)} dB
            </Text>
          </View>
          <Slider
            style={styles.advancedSlider}
            minimumValue={-12} maximumValue={0}
            value={limiterThreshold}
            onValueChange={v => update({ limiterThreshold: v })}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled ? Colors.metallicBrown.primary : '#666'}
            disabled={isDisabled}
          />
        </View>
      )}

      {/* Status */}
      <View style={styles.statusHint}>
        <MaterialCommunityIcons
          name={!enabled ? 'information-outline' : 'check-circle-outline'}
          size={14} color="rgba(255,255,255,0.35)"
        />
        <Text style={styles.statusText}>
          {!enabled
            ? 'Enable EQ to adjust mastering controls'
            : 'Adjustments affect the current session'}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { paddingBottom: verticalScale(24) },
  section: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16, padding: scale(14),
    marginBottom: verticalScale(12),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  sectionTitle: {
    color: '#fff', fontSize: moderateScale(11),
    fontWeight: '700', letterSpacing: 0.8,
    marginBottom: verticalScale(12),
  },
  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: verticalScale(10),
  },
  sectionValue: { fontSize: moderateScale(14), fontWeight: '700' },

  // Meters
  meters: {
    flexDirection: 'row', alignItems: 'center', gap: scale(6),
    marginBottom: verticalScale(4),
  },
  meterCh: { color: '#fff', fontSize: moderateScale(11), fontWeight: '700', width: scale(14) },
  meterBar: {
    flex: 1, height: verticalScale(8),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4, overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 4 },
  meterLabels: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingLeft: scale(20),
  },
  meterLabel: { color: 'rgba(255,255,255,0.25)', fontSize: moderateScale(7) },

  // Sliders
  controlLabel: {
    color: 'rgba(255,255,255,0.45)', fontSize: moderateScale(9),
    fontWeight: '700', letterSpacing: 0.5,
    marginBottom: verticalScale(4),
  },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: scale(8) },
  slider: { flex: 1, height: verticalScale(30) },
  rangeLabel: {
    color: '#fff', fontSize: moderateScale(9), fontWeight: '600',
    opacity: 0.45, width: scale(30), textAlign: 'center',
  },

  // Dynamics buttons
  dynRow: { flexDirection: 'row', gap: scale(10) },
  dynBtn: {
    flex: 1, height: verticalScale(76),
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  dynBtnOn: { borderColor: Colors.metallicBrown.primary },
  dynBtnInner: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)', gap: verticalScale(3),
    borderRadius: 12, borderWidth: 1, borderColor: 'transparent',
  },
  dynBtnLabel: { color: 'rgba(255,255,255,0.6)', fontSize: moderateScale(9), fontWeight: '600' },
  dynBtnLabelActive: { color: Colors.metallicBrown.primary },
  dynBtnState: { color: '#fff', fontSize: moderateScale(11), fontWeight: '700' },
  dynBtnStateActive: { color: Colors.metallicBrown.primary },

  // Advanced
  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: scale(6),
    justifyContent: 'center', paddingVertical: verticalScale(8),
    marginBottom: verticalScale(8),
  },
  advancedToggleText: {
    color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(10), fontWeight: '700',
  },
  advancedSection: {
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12,
    padding: scale(12), marginBottom: verticalScale(12),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  advancedSlider: { width: '100%', height: verticalScale(30) },

  // Status
  statusHint: {
    flexDirection: 'row', alignItems: 'center', gap: scale(6),
    backgroundColor: 'rgba(139,115,85,0.1)', borderRadius: 20,
    padding: scale(10), borderWidth: 1, borderColor: 'rgba(139,115,85,0.2)',
  },
  statusText: { color: 'rgba(255,255,255,0.65)', fontSize: moderateScale(11), flex: 1 },
});