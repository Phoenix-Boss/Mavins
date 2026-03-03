// components/equalizer/MasteringControls.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';

interface MasteringControlsProps {
  enabled: boolean;
  masteringState: {
    balance: number;        // 0-100 (L/R balance)
    stereoWidth: number;    // 0-100 (stereo enhancement)
    loudness: number;       // 0-100 (perceived loudness)
    limiter: boolean;       // true/false
    mono: boolean;
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
  
  const handleBalanceChange = (value: number) => {
    if (!enabled || isFactory) return;
    onUpdate({ balance: value });
  };

  const handleStereoWidthChange = (value: number) => {
    if (!enabled || isFactory) return;
    onUpdate({ stereoWidth: value });
  };

  const handleLoudnessChange = (value: number) => {
    if (!enabled || isFactory) return;
    onUpdate({ loudness: value });
  };

  const toggleLimiter = () => {
    if (!enabled || isFactory) return;
    onUpdate({ limiter: !masteringState.limiter });
  };

  const toggleMono = () => {
    if (!enabled || isFactory) return;
    onUpdate({ mono: !masteringState.mono });
  };

  // Calculate balance indicator position
  const getBalanceIndicator = () => {
    const balance = masteringState.balance;
    if (balance < 50) {
      // More left
      return `${(50 - balance) * 2}%`;
    } else if (balance > 50) {
      // More right
      return `${(balance - 50) * 2}%`;
    } else {
      return '0%';
    }
  };

  return (
    <ScrollView 
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Master Volume Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MASTER VOLUME</Text>
          <Text style={styles.sectionValue}>{Math.round(masteringState.loudness)}%</Text>
        </View>
        
        <View style={styles.sliderContainer}>
          <Text style={styles.sliderLabel}>MIN</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            value={masteringState.loudness}
            onValueChange={handleLoudnessChange}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor={Colors.metallicBrown.primary}
            disabled={!enabled || isFactory}
          />
          <Text style={styles.sliderLabel}>MAX</Text>
        </View>
      </View>

      {/* Balance Control */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>BALANCE</Text>
          <Text style={styles.sectionValue}>
            {masteringState.balance < 50 ? 'L' : masteringState.balance > 50 ? 'R' : 'C'}
          </Text>
        </View>

        <View style={styles.balanceContainer}>
          <Text style={styles.balanceLabel}>L</Text>
          <View style={styles.balanceTrack}>
            <View 
              style={[
                styles.balanceIndicator,
                { 
                  left: getBalanceIndicator(),
                  opacity: enabled && !isFactory ? 1 : 0.5
                }
              ]} 
            />
            <Slider
              style={styles.balanceSlider}
              minimumValue={0}
              maximumValue={100}
              value={masteringState.balance}
              onValueChange={handleBalanceChange}
              minimumTrackTintColor="transparent"
              maximumTrackTintColor="transparent"
              thumbTintColor={enabled && !isFactory ? Colors.metallicBrown.primary : '#666'}
              disabled={!enabled || isFactory}
            />
          </View>
          <Text style={styles.balanceLabel}>R</Text>
        </View>
      </View>

      {/* Stereo Width */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>STEREO WIDTH</Text>
          <Text style={styles.sectionValue}>{Math.round(masteringState.stereoWidth)}%</Text>
        </View>
        
        <View style={styles.sliderContainer}>
          <Text style={styles.sliderLabel}>MONO</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            value={masteringState.stereoWidth}
            onValueChange={handleStereoWidthChange}
            minimumTrackTintColor={Colors.metallicBrown.primary}
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor={Colors.metallicBrown.primary}
            disabled={!enabled || isFactory}
          />
          <Text style={styles.sliderLabel}>WIDE</Text>
        </View>

        {/* Stereo Visualization */}
        <View style={styles.stereoViz}>
          <View style={[styles.stereoBar, { 
            width: `${masteringState.stereoWidth}%`,
            backgroundColor: Colors.metallicBrown.primary,
            opacity: enabled && !isFactory ? 1 : 0.5
          }]} />
        </View>
      </View>

      {/* Toggle Controls Row */}
      <View style={styles.toggleRow}>
        {/* Limiter Toggle */}
        <TouchableOpacity
          style={[
            styles.toggleButton,
            masteringState.limiter && styles.toggleButtonActive,
            (!enabled || isFactory) && styles.toggleButtonDisabled
          ]}
          onPress={toggleLimiter}
          activeOpacity={0.7}
          disabled={!enabled || isFactory}
        >
          <LinearGradient
            colors={masteringState.limiter && enabled && !isFactory 
              ? [Colors.metallicBrown.primary, Colors.metallicBrown.secondary]
              : ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)']
            }
            style={styles.toggleGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[
              styles.toggleLabel,
              masteringState.limiter && enabled && !isFactory && styles.toggleLabelActive
            ]}>LIMITER</Text>
            <Text style={[
              styles.toggleValue,
              masteringState.limiter && enabled && !isFactory && styles.toggleValueActive
            ]}>
              {masteringState.limiter ? 'ON' : 'OFF'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Mono Toggle */}
        <TouchableOpacity
          style={[
            styles.toggleButton,
            masteringState.mono && styles.toggleButtonActive,
            (!enabled || isFactory) && styles.toggleButtonDisabled
          ]}
          onPress={toggleMono}
          activeOpacity={0.7}
          disabled={!enabled || isFactory}
        >
          <LinearGradient
            colors={masteringState.mono && enabled && !isFactory 
              ? [Colors.metallicBrown.primary, Colors.metallicBrown.secondary]
              : ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)']
            }
            style={styles.toggleGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[
              styles.toggleLabel,
              masteringState.mono && enabled && !isFactory && styles.toggleLabelActive
            ]}>MONO</Text>
            <Text style={[
              styles.toggleValue,
              masteringState.mono && enabled && !isFactory && styles.toggleValueActive
            ]}>
              {masteringState.mono ? 'ON' : 'OFF'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Info Note */}
      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          {!enabled 
            ? 'Enable EQ to adjust mastering controls'
            : isFactory 
            ? 'Factory presets are locked - create a custom preset to edit'
            : 'All adjustments affect the currently playing song'
          }
        </Text>
      </View>

      {/* Visual Meter (just for show) */}
      <View style={styles.meterContainer}>
        <Text style={styles.meterLabel}>OUTPUT METER</Text>
        <View style={styles.meterBars}>
          <View style={styles.meterBarLeft}>
            <View style={[styles.meterFill, { 
              width: `${Math.min(100, masteringState.loudness + 20)}%`,
              backgroundColor: Colors.metallicBrown.primary 
            }]} />
          </View>
          <View style={styles.meterBarRight}>
            <View style={[styles.meterFill, { 
              width: `${Math.min(100, masteringState.loudness + 20)}%`,
              backgroundColor: Colors.metallicBrown.secondary 
            }]} />
          </View>
        </View>
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
  section: {
    marginBottom: verticalScale(20),
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: scale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(12),
  },
  sectionTitle: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  sectionValue: {
    color: Colors.metallicBrown.primary,
    fontSize: moderateScale(16),
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
    fontSize: moderateScale(10),
    fontWeight: '600',
    opacity: 0.5,
    width: scale(35),
    textAlign: 'center',
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  balanceLabel: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '700',
    width: scale(20),
    textAlign: 'center',
  },
  balanceTrack: {
    flex: 1,
    height: verticalScale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    position: 'relative',
  },
  balanceIndicator: {
    position: 'absolute',
    width: scale(8),
    height: scale(8),
    borderRadius: 4,
    backgroundColor: Colors.metallicBrown.primary,
    top: -2,
    zIndex: 10,
  },
  balanceSlider: {
    flex: 1,
    height: verticalScale(30),
    marginTop: -verticalScale(13),
  },
  stereoViz: {
    marginTop: verticalScale(8),
    height: verticalScale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  stereoBar: {
    height: '100%',
    borderRadius: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: scale(12),
    marginBottom: verticalScale(20),
  },
  toggleButton: {
    flex: 1,
    height: verticalScale(70),
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  toggleButtonActive: {
    borderColor: Colors.metallicBrown.primary,
  },
  toggleButtonDisabled: {
    opacity: 0.5,
  },
  toggleGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleLabel: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '600',
    opacity: 0.7,
    marginBottom: verticalScale(4),
  },
  toggleLabelActive: {
    color: '#000',
    opacity: 1,
  },
  toggleValue: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '700',
  },
  toggleValueActive: {
    color: '#000',
  },
  infoContainer: {
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(20),
    borderWidth: 1,
    borderColor: 'rgba(139, 115, 85, 0.3)',
  },
  infoText: {
    color: '#fff',
    fontSize: moderateScale(11),
    textAlign: 'center',
    opacity: 0.8,
  },
  meterContainer: {
    marginBottom: verticalScale(10),
  },
  meterLabel: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '600',
    opacity: 0.5,
    marginBottom: verticalScale(5),
  },
  meterBars: {
    flexDirection: 'row',
    gap: scale(2),
  },
  meterBarLeft: {
    flex: 1,
    height: verticalScale(20),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterBarRight: {
    flex: 1,
    height: verticalScale(20),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 4,
  },
});