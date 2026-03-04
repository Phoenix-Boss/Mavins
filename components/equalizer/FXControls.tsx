// components/equalizer/FXControls.tsx - PROFESSIONAL FX PROCESSOR

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import { Colors } from '@/constants/Colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type FXMode = 'reverb' | 'delay' | 'chorus' | 'flanger' | 'phaser';

interface FXControlsProps {
  enabled: boolean;
  fxState: {
    mode: FXMode;
    // Reverb parameters
    roomSize: number;      // 0-100
    decay: number;         // 0-100
    preDelay: number;      // 0-100
    damping: number;       // 0-100
    // Delay parameters
    delayTime: number;     // 0-100 (20-2000ms)
    feedback: number;      // 0-100
    lowCut: number;        // 0-100 (20-500Hz)
    highCut: number;       // 0-100 (1k-20kHz)
    // Modulation parameters
    rate: number;          // 0-100 (0.1-10Hz)
    depth: number;         // 0-100
    phase: number;         // 0-100 (0-180°)
    // Global
    mix: number;           // 0-100 (wet/dry)
    bypass: boolean;
  };
  onUpdate: (updates: Partial<FXControlsProps['fxState']>) => void;
  isFactory?: boolean;
}

// Mode definitions
const FX_MODES: { id: FXMode; name: string; icon: string; color: string; description: string }[] = [
  { id: 'reverb', name: 'REVERB', icon: '⚡', color: '#4ECDC4', description: 'Spatial ambience' },
  { id: 'delay', name: 'DELAY', icon: '⏱️', color: '#FF6B6B', description: 'Echo effects' },
  { id: 'chorus', name: 'CHORUS', icon: '🎵', color: '#45B7D1', description: 'Thickening' },
  { id: 'flanger', name: 'FLANGER', icon: '🌀', color: '#96CEB4', description: 'Jet sweep' },
  { id: 'phaser', name: 'PHASER', icon: '🌊', color: '#FFE194', description: 'Swirling' },
];

export const FXControls: React.FC<FXControlsProps> = ({
  enabled,
  fxState,
  onUpdate,
  isFactory = false,
}) => {
  const {
    mode,
    roomSize, decay, preDelay, damping,
    delayTime, feedback, lowCut, highCut,
    rate, depth, phase,
    mix,
    bypass,
  } = fxState;

  // UI State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Animation values
  const modeIndicatorPosition = useSharedValue(0);
  const bypassGlow = useSharedValue(0);
  const mixKnobScale = useSharedValue(1);

  // Update mode indicator position
  useEffect(() => {
    const modeIndex = FX_MODES.findIndex(m => m.id === mode);
    modeIndicatorPosition.value = withSpring(modeIndex * (scale(70)), {
      damping: 15,
      stiffness: 150,
    });
  }, [mode]);

  // Handlers with haptics
  const handleModeChange = (newMode: FXMode) => {
    if (!enabled || isFactory) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdate({ mode: newMode });
  };

  const handleBypass = () => {
    if (!enabled || isFactory) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    bypassGlow.value = withTiming(bypass ? 0 : 0.5, { duration: 300 });
    onUpdate({ bypass: !bypass });
  };

  const handleMixChange = (value: number) => {
    if (!enabled || isFactory || bypass) return;
    mixKnobScale.value = withSpring(1.1, { damping: 10, stiffness: 200 });
    setTimeout(() => mixKnobScale.value = withSpring(1), 100);
    Haptics.selectionAsync();
    onUpdate({ mix: value });
  };

  const createUpdater = (key: keyof typeof fxState) => (value: number) => {
    if (!enabled || isFactory || bypass) return;
    Haptics.selectionAsync();
    onUpdate({ [key]: value } as any);
  };

  // Animated styles
  const modeIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: modeIndicatorPosition.value }],
  }));

  const bypassStyle = useAnimatedStyle(() => ({
    shadowColor: Colors.metallicBrown.primary,
    shadowOpacity: bypassGlow.value,
    shadowRadius: 10 * bypassGlow.value,
  }));

  const mixKnobStyle = useAnimatedStyle(() => ({
    transform: [{ scale: mixKnobScale.value }],
  }));

  // Get current mode config
  const currentMode = FX_MODES.find(m => m.id === mode) || FX_MODES[0];

  // Render parameters based on mode
  const renderModeParameters = () => {
    switch (mode) {
      case 'reverb':
        return (
          <View style={styles.parametersContainer}>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={roomSize}
                  label="SIZE"
                  onChange={createUpdater('roomSize')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(roomSize)}%</Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={decay}
                  label="DECAY"
                  onChange={createUpdater('decay')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{(decay / 20).toFixed(1)}s</Text>
              </View>
            </View>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={preDelay}
                  label="PRE-DELAY"
                  onChange={createUpdater('preDelay')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(preDelay * 2)}ms</Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={damping}
                  label="DAMPING"
                  onChange={createUpdater('damping')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(damping)}%</Text>
              </View>
            </View>
          </View>
        );

      case 'delay':
        return (
          <View style={styles.parametersContainer}>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={delayTime}
                  label="TIME"
                  onChange={createUpdater('delayTime')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>
                  {Math.round(20 + (delayTime / 100) * 1980)}ms
                </Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={feedback}
                  label="FEEDBACK"
                  onChange={createUpdater('feedback')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(feedback)}%</Text>
              </View>
            </View>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={lowCut}
                  label="LOW CUT"
                  onChange={createUpdater('lowCut')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(20 + (lowCut / 100) * 480)}Hz</Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={highCut}
                  label="HIGH CUT"
                  onChange={createUpdater('highCut')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(1 + (highCut / 100) * 19)}kHz</Text>
              </View>
            </View>
          </View>
        );

      case 'chorus':
      case 'flanger':
      case 'phaser':
        return (
          <View style={styles.parametersContainer}>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={rate}
                  label="RATE"
                  onChange={createUpdater('rate')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{(0.1 + (rate / 100) * 9.9).toFixed(1)}Hz</Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={depth}
                  label="DEPTH"
                  onChange={createUpdater('depth')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(depth)}%</Text>
              </View>
            </View>
            <View style={styles.parameterRow}>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={phase}
                  label="PHASE"
                  onChange={createUpdater('phase')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round((phase / 100) * 180)}°</Text>
              </View>
              <View style={styles.parameterColumn}>
                <RotaryKnob
                  value={delayTime}
                  label="DELAY"
                  onChange={createUpdater('delayTime')}
                  color={currentMode.color}
                  size={80}
                  enabled={enabled && !isFactory && !bypass}
                  showValue={true}
                />
                <Text style={styles.parameterValue}>{Math.round(0.1 + (delayTime / 100) * 19.9)}ms</Text>
              </View>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Mode Selector Carousel */}
      <View style={styles.modeSelector}>
        <View style={styles.modeTabs}>
          {FX_MODES.map((m, index) => (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.modeTab,
                mode === m.id && styles.modeTabActive,
              ]}
              onPress={() => handleModeChange(m.id)}
              activeOpacity={0.7}
              disabled={!enabled || isFactory}
            >
              <Text style={styles.modeIcon}>{m.icon}</Text>
              <Text style={[
                styles.modeName,
                mode === m.id && styles.modeNameActive,
              ]}>
                {m.name}
              </Text>
            </TouchableOpacity>
          ))}
          <Animated.View style={[styles.modeIndicator, modeIndicatorStyle]} />
        </View>
      </View>

      {/* Mode Description */}
      <View style={styles.modeDescription}>
        <Text style={styles.descriptionText}>{currentMode.description}</Text>
      </View>

      {/* Parameters Grid - Scrollable */}
      <ScrollView
        style={styles.parametersScroll}
        contentContainerStyle={styles.parametersGrid}
        showsVerticalScrollIndicator={false}
      >
        {renderModeParameters()}

        {/* Mix Control - Full Width */}
        <View style={styles.mixSection}>
          <View style={styles.mixHeader}>
            <Text style={styles.mixLabel}>WET/DRY MIX</Text>
            <Text style={styles.mixPercentage}>{Math.round(mix)}%</Text>
          </View>
          <Animated.View style={[styles.mixKnobContainer, mixKnobStyle]}>
            <RotaryKnob
              value={mix}
              label=""
              onChange={handleMixChange}
              color={currentMode.color}
              size={100}
              enabled={enabled && !isFactory && !bypass}
              showValue={false}
            />
          </Animated.View>
        </View>

        {/* Bypass Button */}
        <Animated.View style={[styles.bypassContainer, bypassStyle]}>
          <TouchableOpacity
            style={[
              styles.bypassButton,
              bypass && styles.bypassButtonActive,
              (!enabled || isFactory) && styles.disabled,
            ]}
            onPress={handleBypass}
            activeOpacity={0.7}
            disabled={!enabled || isFactory}
          >
            <MaterialCommunityIcons
              name={bypass ? 'volume-off' : 'volume-high'}
              size={24}
              color={bypass && enabled && !isFactory ? '#000' : '#fff'}
            />
            <Text style={[
              styles.bypassText,
              bypass && enabled && !isFactory && styles.bypassTextActive,
            ]}>
              {bypass ? 'BYPASSED' : 'ACTIVE'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Info Note */}
        <View style={styles.infoContainer}>
          <MaterialCommunityIcons
            name={!enabled ? 'information' : isFactory ? 'lock' : bypass ? 'volume-off' : 'check-circle'}
            size={16}
            color="rgba(255,255,255,0.5)"
          />
          <Text style={styles.infoText}>
            {!enabled
              ? 'Enable EQ to adjust FX'
              : isFactory
              ? 'Factory presets are locked'
              : bypass
              ? 'FX is bypassed - tap to activate'
              : 'Adjust parameters in real-time'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modeSelector: {
    marginBottom: verticalScale(10),
    paddingHorizontal: scale(10),
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 25,
    padding: scale(3),
    position: 'relative',
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(4),
    borderRadius: 22,
    zIndex: 10,
    gap: scale(4),
  },
  modeTabActive: {
    // Active state handled by indicator
  },
  modeIcon: {
    fontSize: moderateScale(14),
  },
  modeName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(10),
    fontWeight: '600',
  },
  modeNameActive: {
    color: '#000',
  },
  modeIndicator: {
    position: 'absolute',
    width: scale(70),
    height: verticalScale(32),
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 22,
    top: scale(3),
    left: scale(3),
  },
  modeDescription: {
    paddingHorizontal: scale(15),
    marginBottom: verticalScale(15),
  },
  descriptionText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    fontStyle: 'italic',
  },
  parametersScroll: {
    flex: 1,
  },
  parametersGrid: {
    paddingHorizontal: scale(15),
    paddingBottom: verticalScale(20),
  },
  parametersContainer: {
    marginBottom: verticalScale(20),
  },
  parameterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: verticalScale(20),
  },
  parameterColumn: {
    flex: 1,
    alignItems: 'center',
    maxWidth: (SCREEN_WIDTH - scale(60)) / 2,
  },
  parameterValue: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(9),
    marginTop: verticalScale(4),
  },
  mixSection: {
    alignItems: 'center',
    marginVertical: verticalScale(20),
    paddingVertical: verticalScale(15),
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  mixHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: scale(20),
    marginBottom: verticalScale(10),
  },
  mixLabel: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  mixPercentage: {
    color: Colors.metallicBrown.primary,
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  mixKnobContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bypassContainer: {
    alignItems: 'center',
    marginVertical: verticalScale(10),
  },
  bypassButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(30),
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    minWidth: scale(160),
  },
  bypassButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  bypassText: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
  bypassTextActive: {
    color: '#000',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
    borderRadius: 20,
    padding: scale(12),
    marginVertical: verticalScale(10),
    borderWidth: 1,
    borderColor: 'rgba(139, 115, 85, 0.3)',
  },
  infoText: {
    color: '#fff',
    fontSize: moderateScale(11),
    textAlign: 'center',
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});