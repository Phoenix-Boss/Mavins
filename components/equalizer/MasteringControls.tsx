// components/equalizer/MasteringControls.tsx - PROFESSIONAL MASTERING SUITE

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MasteringControlsProps {
  enabled: boolean;
  masteringState: {
    balance: number;        // 0-100 (L/R balance)
    stereoWidth: number;    // 0-100 (stereo enhancement)
    loudness: number;       // -20 to +20 dB (converted to 0-100)
    limiter: boolean;       // true/false
    mono: boolean;
    limiterThreshold?: number; // -12 to 0 dB
    truePeak?: number;      // -60 to 0 dB
    gainReduction?: number; // 0 to 20 dB
  };
  onUpdate: (updates: Partial<MasteringControlsProps['masteringState']>) => void;
  isFactory?: boolean;
}

export const MasteringControls: React.FC<MasteringControlsProps> = ({
  enabled,
  masteringState,
  onUpdate,
  isFactory = false,
}) => {
  const {
    balance,
    stereoWidth,
    loudness,
    limiter,
    mono,
    limiterThreshold = -6,
    truePeak = -12,
    gainReduction = 0,
  } = masteringState;

  // Animation values
  const peakMeterLeft = useSharedValue(0);
  const peakMeterRight = useSharedValue(0);
  const gainReductionHeight = useSharedValue(0);
  const limiterGlow = useSharedValue(0);
  const correlationValue = useSharedValue(0.8); // Phase correlation meter

  // UI State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [correlation, setCorrelation] = useState(0.8); // -1 to 1

  // Simulate peak meters (in real app, this would come from audio engine)
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      // Simulate audio peaks based on loudness
      const baseLevel = (loudness / 100) * 0.8 + 0.2;
      const leftPeak = Math.random() * 0.3 + baseLevel;
      const rightPeak = Math.random() * 0.3 + baseLevel;
      
      peakMeterLeft.value = withSpring(leftPeak, { damping: 15, stiffness: 120 });
      peakMeterRight.value = withSpring(rightPeak, { damping: 15, stiffness: 120 });
      
      // Simulate gain reduction when limiter is on
      if (limiter && leftPeak > 0.9) {
        const reduction = Math.min(20, (leftPeak - 0.9) * 100);
        gainReductionHeight.value = withSpring(reduction / 20, { damping: 10 });
        runOnJS(onUpdate)({ gainReduction: reduction });
      } else {
        gainReductionHeight.value = withSpring(0, { damping: 15 });
      }
      
      // Simulate phase correlation
      const newCorrelation = Math.max(-1, Math.min(1, correlation + (Math.random() - 0.5) * 0.1));
      setCorrelation(newCorrelation);
      correlationValue.value = withTiming(newCorrelation, { duration: 100 });
      
      // Simulate true peak
      const newTruePeak = -20 + (leftPeak * 15);
      runOnJS(onUpdate)({ truePeak: newTruePeak });
    }, 100);

    return () => clearInterval(interval);
  }, [enabled, loudness, limiter]);

  // Handlers
  const handleBalanceChange = (value: number) => {
    if (!enabled || isFactory) return;
    Haptics.selectionAsync();
    onUpdate({ balance: value });
  };

  const handleStereoWidthChange = (value: number) => {
    if (!enabled || isFactory) return;
    Haptics.selectionAsync();
    onUpdate({ stereoWidth: value });
  };

  const handleLoudnessChange = (value: number) => {
    if (!enabled || isFactory) return;
    Haptics.selectionAsync();
    onUpdate({ loudness: value });
  };

  const toggleLimiter = () => {
    if (!enabled || isFactory) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    limiterGlow.value = withTiming(limiter ? 0 : 0.5, { duration: 300 });
    onUpdate({ limiter: !limiter });
  };

  const toggleMono = () => {
    if (!enabled || isFactory) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdate({ mono: !mono });
  };

  const handleReset = () => {
    if (!enabled || isFactory) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onUpdate({
      balance: 50,
      stereoWidth: 50,
      loudness: 50,
      limiter: false,
      mono: false,
    });
  };

  // Animated styles
  const leftMeterStyle = useAnimatedStyle(() => ({
    height: `${peakMeterLeft.value * 100}%`,
  }));

  const rightMeterStyle = useAnimatedStyle(() => ({
    height: `${peakMeterRight.value * 100}%`,
  }));

  const gainReductionStyle = useAnimatedStyle(() => ({
    height: `${gainReductionHeight.value * 100}%`,
  }));

  const correlationStyle = useAnimatedStyle(() => ({
    width: `${(correlationValue.value + 1) * 50}%`,
    backgroundColor: correlationValue.value > 0.5 ? '#4CAF50' : correlationValue.value > 0 ? '#FFC107' : '#F44336',
  }));

  const limiterStyle = useAnimatedStyle(() => ({
    shadowColor: Colors.metallicBrown.primary,
    shadowOpacity: limiterGlow.value,
    shadowRadius: 10 * limiterGlow.value,
  }));

  // Convert loudness to dB
  const loudnessToDb = (val: number) => {
    return `${Math.round((val - 50) * 0.8)} dB`;
  };

  // Calculate balance indicator position
  const getBalanceIndicator = () => {
    if (balance < 50) return `${(50 - balance) * 2}%`;
    if (balance > 50) return `${(balance - 50) * 2}%`;
    return '0%';
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Master Section with Peak Meters */}
      <View style={styles.masterSection}>
        <View style={styles.masterHeader}>
          <Text style={styles.sectionTitle}>MASTER SECTION</Text>
          <TouchableOpacity onPress={() => setShowAdvanced(!showAdvanced)}>
            <MaterialCommunityIcons
              name={showAdvanced ? 'chevron-up' : 'chevron-down'}
              size={24}
              color="rgba(255,255,255,0.5)"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.masterContent}>
          {/* Peak Meters */}
          <View style={styles.peakMeters}>
            <View style={styles.meterLabel}>
              <Text style={styles.meterLabelText}>L</Text>
            </View>
            <View style={styles.meterContainer}>
              <View style={styles.meterBackground}>
                <Animated.View style={[styles.meterFill, leftMeterStyle, { backgroundColor: Colors.metallicBrown.primary }]} />
              </View>
              <View style={styles.meterBackground}>
                <Animated.View style={[styles.meterFill, rightMeterStyle, { backgroundColor: Colors.metallicBrown.secondary }]} />
              </View>
            </View>
            <View style={styles.meterLabel}>
              <Text style={styles.meterLabelText}>R</Text>
            </View>
          </View>

          {/* True Peak Reading */}
          <View style={styles.truePeakContainer}>
            <Text style={styles.truePeakLabel}>TRUE PEAK</Text>
            <Text style={[styles.truePeakValue, { color: truePeak > -1 ? '#F44336' : '#fff' }]}>
              {truePeak.toFixed(1)} dB
            </Text>
          </View>
        </View>
      </View>

      {/* Loudness Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <MaterialCommunityIcons name="volume-high" size={20} color={Colors.metallicBrown.primary} />
            <Text style={styles.sectionTitle}>LOUDNESS</Text>
          </View>
          <Text style={styles.sectionValue}>{loudnessToDb(loudness)}</Text>
        </View>

        <View style={styles.sliderContainer}>
          <Text style={styles.sliderLabel}>-20</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            value={loudness}
            onValueChange={handleLoudnessChange}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled && !isFactory ? Colors.metallicBrown.primary : '#666'}
            disabled={!enabled || isFactory}
          />
          <Text style={styles.sliderLabel}>+20</Text>
        </View>

        {/* Gain Reduction Meter (when limiter active) */}
        {limiter && (
          <View style={styles.grMeterContainer}>
            <Text style={styles.grLabel}>GAIN REDUCTION</Text>
            <View style={styles.grMeter}>
              <Animated.View style={[styles.grMeterFill, gainReductionStyle, { backgroundColor: '#F44336' }]} />
            </View>
            <Text style={styles.grValue}>{gainReduction.toFixed(1)} dB</Text>
          </View>
        )}
      </View>

      {/* Stereo Field Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <MaterialCommunityIcons name="stereo" size={20} color={Colors.metallicBrown.primary} />
            <Text style={styles.sectionTitle}>STEREO FIELD</Text>
          </View>
        </View>

        {/* Phase Correlation Meter */}
        <View style={styles.correlationContainer}>
          <Text style={styles.correlationLabel}>PHASE CORRELATION</Text>
          <View style={styles.correlationMeter}>
            <View style={styles.correlationBackground}>
              <Animated.View style={[styles.correlationFill, correlationStyle]} />
            </View>
            <View style={styles.correlationMarkers}>
              <Text style={styles.correlationMarker}>⬅️ Out</Text>
              <Text style={styles.correlationMarker}>In Phase ➡️</Text>
            </View>
          </View>
        </View>

        {/* Balance Control */}
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>BALANCE</Text>
          <View style={styles.balanceContainer}>
            <Text style={styles.balanceIndicator}>L</Text>
            <View style={styles.balanceTrack}>
              <Animated.View
                style={[
                  styles.balanceIndicatorDot,
                  {
                    left: getBalanceIndicator(),
                    backgroundColor: enabled && !isFactory ? Colors.metallicBrown.primary : '#666',
                  },
                ]}
              />
              <Slider
                style={styles.balanceSlider}
                minimumValue={0}
                maximumValue={100}
                value={balance}
                onValueChange={handleBalanceChange}
                minimumTrackTintColor="transparent"
                maximumTrackTintColor="transparent"
                thumbTintColor="transparent"
                disabled={!enabled || isFactory}
              />
            </View>
            <Text style={styles.balanceIndicator}>R</Text>
          </View>
        </View>

        {/* Stereo Width Control */}
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>STEREO WIDTH</Text>
          <View style={styles.widthContainer}>
            <Text style={styles.widthLabel}>MONO</Text>
            <View style={styles.widthSliderContainer}>
              <Slider
                style={styles.widthSlider}
                minimumValue={0}
                maximumValue={100}
                value={stereoWidth}
                onValueChange={handleStereoWidthChange}
                minimumTrackTintColor={Colors.metallicBrown.primary}
                maximumTrackTintColor="rgba(255,255,255,0.1)"
                thumbTintColor={enabled && !isFactory ? Colors.metallicBrown.primary : '#666'}
                disabled={!enabled || isFactory}
              />
              <View style={styles.widthViz}>
                <View style={[styles.widthVizBar, { width: `${stereoWidth}%`, backgroundColor: Colors.metallicBrown.primary }]} />
              </View>
            </View>
            <Text style={styles.widthLabel}>WIDE</Text>
          </View>
        </View>
      </View>

      {/* Dynamics Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <MaterialCommunityIcons name="lightning-bolt" size={20} color={Colors.metallicBrown.primary} />
            <Text style={styles.sectionTitle}>DYNAMICS</Text>
          </View>
        </View>

        <View style={styles.dynamicsRow}>
          {/* Limiter Control */}
          <TouchableOpacity
            style={[
              styles.dynamicsButton,
              limiter && styles.dynamicsButtonActive,
              (!enabled || isFactory) && styles.disabled,
            ]}
            onPress={toggleLimiter}
            activeOpacity={0.7}
            disabled={!enabled || isFactory}
          >
            <Animated.View style={[styles.dynamicsButtonInner, limiterStyle]}>
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={24}
                color={limiter && enabled && !isFactory ? '#000' : '#fff'}
              />
              <Text style={[
                styles.dynamicsButtonLabel,
                limiter && enabled && !isFactory && styles.dynamicsButtonLabelActive,
              ]}>
                LIMITER
              </Text>
              <Text style={[
                styles.dynamicsButtonValue,
                limiter && enabled && !isFactory && styles.dynamicsButtonValueActive,
              ]}>
                {limiter ? 'ON' : 'OFF'}
              </Text>
            </Animated.View>
          </TouchableOpacity>

          {/* Mono Control */}
          <TouchableOpacity
            style={[
              styles.dynamicsButton,
              mono && styles.dynamicsButtonActive,
              (!enabled || isFactory) && styles.disabled,
            ]}
            onPress={toggleMono}
            activeOpacity={0.7}
            disabled={!enabled || isFactory}
          >
            <View style={styles.dynamicsButtonInner}>
              <MaterialCommunityIcons
                name="circle-outline"
                size={24}
                color={mono && enabled && !isFactory ? '#000' : '#fff'}
              />
              <Text style={[
                styles.dynamicsButtonLabel,
                mono && enabled && !isFactory && styles.dynamicsButtonLabelActive,
              ]}>
                MONO
              </Text>
              <Text style={[
                styles.dynamicsButtonValue,
                mono && enabled && !isFactory && styles.dynamicsButtonValueActive,
              ]}>
                {mono ? 'ON' : 'OFF'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Reset Control */}
          <TouchableOpacity
            style={[
              styles.dynamicsButton,
              (!enabled || isFactory) && styles.disabled,
            ]}
            onPress={handleReset}
            activeOpacity={0.7}
            disabled={!enabled || isFactory}
          >
            <View style={styles.dynamicsButtonInner}>
              <MaterialCommunityIcons
                name="refresh"
                size={24}
                color="#fff"
              />
              <Text style={styles.dynamicsButtonLabel}>RESET</Text>
              <Text style={styles.dynamicsButtonValue}>↺</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Advanced Settings (expandable) */}
      {showAdvanced && (
        <Animated.View style={styles.advancedSection}>
          <View style={styles.advancedHeader}>
            <MaterialCommunityIcons name="cog" size={16} color="rgba(255,255,255,0.5)" />
            <Text style={styles.advancedTitle}>ADVANCED SETTINGS</Text>
          </View>

          <View style={styles.advancedRow}>
            <Text style={styles.advancedLabel}>Limiter Threshold</Text>
            <Text style={styles.advancedValue}>{limiterThreshold} dB</Text>
          </View>
          <Slider
            style={styles.advancedSlider}
            minimumValue={-12}
            maximumValue={0}
            value={limiterThreshold}
            onValueChange={(val) => onUpdate({ limiterThreshold: val })}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled && !isFactory ? Colors.metallicBrown.primary : '#666'}
            disabled={!enabled || isFactory}
          />

          <View style={styles.advancedRow}>
            <Text style={styles.advancedLabel}>Lookahead</Text>
            <Text style={styles.advancedValue}>5 ms</Text>
          </View>
          <Slider
            style={styles.advancedSlider}
            minimumValue={0}
            maximumValue={20}
            value={5}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor={enabled && !isFactory ? Colors.metallicBrown.primary : '#666'}
            disabled={!enabled || isFactory}
          />
        </Animated.View>
      )}

      {/* Info Note */}
      <View style={styles.infoContainer}>
        <MaterialCommunityIcons
          name={!enabled ? 'information' : isFactory ? 'lock' : 'check-circle'}
          size={16}
          color="rgba(255,255,255,0.5)"
        />
        <Text style={styles.infoText}>
          {!enabled
            ? 'Enable EQ to adjust mastering controls'
            : isFactory
            ? 'Factory presets are locked - create a custom preset to edit'
            : 'All adjustments affect the currently playing song'}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: verticalScale(20),
  },
  masterSection: {
    marginBottom: verticalScale(20),
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 16,
    padding: scale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  masterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(12),
  },
  masterContent: {
    gap: verticalScale(10),
  },
  section: {
    marginBottom: verticalScale(20),
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16,
    padding: scale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(15),
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
  },
  sectionTitle: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.5,
    opacity: 0.9,
  },
  sectionValue: {
    color: Colors.metallicBrown.primary,
    fontSize: moderateScale(16),
    fontWeight: '700',
  },
  peakMeters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
  },
  meterLabel: {
    width: scale(20),
  },
  meterLabelText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
    textAlign: 'center',
  },
  meterContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: scale(2),
    height: verticalScale(60),
  },
  meterBackground: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  meterFill: {
    width: '100%',
    borderRadius: 4,
  },
  truePeakContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: verticalScale(8),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  truePeakLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(10),
    fontWeight: '600',
  },
  truePeakValue: {
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  slider: {
    flex: 1,
    height: verticalScale(30),
  },
  sliderLabel: {
    color: '#fff',
    fontSize: moderateScale(9),
    fontWeight: '600',
    opacity: 0.5,
    width: scale(30),
    textAlign: 'center',
  },
  grMeterContainer: {
    marginTop: verticalScale(10),
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  grLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(9),
    fontWeight: '600',
    width: scale(70),
  },
  grMeter: {
    flex: 1,
    height: verticalScale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  grMeterFill: {
    width: '100%',
    borderRadius: 2,
  },
  grValue: {
    color: '#F44336',
    fontSize: moderateScale(9),
    fontWeight: '700',
    width: scale(35),
    textAlign: 'right',
  },
  correlationContainer: {
    marginBottom: verticalScale(15),
  },
  correlationLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(9),
    fontWeight: '600',
    marginBottom: verticalScale(4),
  },
  correlationMeter: {
    gap: verticalScale(2),
  },
  correlationBackground: {
    height: verticalScale(6),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  correlationFill: {
    height: '100%',
    borderRadius: 3,
  },
  correlationMarkers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  correlationMarker: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(7),
  },
  controlRow: {
    marginBottom: verticalScale(15),
  },
  controlLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(9),
    fontWeight: '600',
    marginBottom: verticalScale(4),
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  balanceIndicator: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
    width: scale(15),
    textAlign: 'center',
  },
  balanceTrack: {
    flex: 1,
    height: verticalScale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    position: 'relative',
  },
  balanceIndicatorDot: {
    position: 'absolute',
    width: scale(10),
    height: scale(10),
    borderRadius: 5,
    top: -3,
    zIndex: 10,
  },
  balanceSlider: {
    flex: 1,
    height: verticalScale(30),
    marginTop: -verticalScale(13),
  },
  widthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  widthLabel: {
    color: '#fff',
    fontSize: moderateScale(9),
    fontWeight: '600',
    opacity: 0.5,
    width: scale(35),
  },
  widthSliderContainer: {
    flex: 1,
  },
  widthSlider: {
    height: verticalScale(30),
  },
  widthViz: {
    height: verticalScale(2),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    marginTop: verticalScale(2),
  },
  widthVizBar: {
    height: '100%',
    borderRadius: 1,
  },
  dynamicsRow: {
    flexDirection: 'row',
    gap: scale(10),
  },
  dynamicsButton: {
    flex: 1,
    height: verticalScale(80),
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  dynamicsButtonActive: {
    borderColor: Colors.metallicBrown.primary,
  },
  dynamicsButtonInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    gap: verticalScale(4),
  },
  dynamicsButtonLabel: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '600',
    opacity: 0.7,
  },
  dynamicsButtonLabelActive: {
    color: '#000',
    opacity: 1,
  },
  dynamicsButtonValue: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  dynamicsButtonValueActive: {
    color: '#000',
  },
  advancedSection: {
    marginBottom: verticalScale(20),
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    padding: scale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    marginBottom: verticalScale(12),
  },
  advancedTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(10),
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  advancedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(4),
  },
  advancedLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: moderateScale(10),
  },
  advancedValue: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '600',
  },
  advancedSlider: {
    width: '100%',
    height: verticalScale(30),
    marginBottom: verticalScale(10),
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
    borderRadius: 20,
    padding: scale(12),
    marginBottom: verticalScale(10),
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