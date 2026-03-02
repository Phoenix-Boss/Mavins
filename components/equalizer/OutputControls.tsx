// components/equalizer/OutputControls.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { RotaryKnob } from './RotaryKnob';
import { Colors } from '../../constants/Colors';

interface OutputControlsProps {
  enabled: boolean;
  outputState: {
    balance: number;
    stereoExpand: number;
    tempo: number;
    volume: number;
    mono: boolean;
  };
  onUpdate: (updates: Partial<{
    balance: number;
    stereoExpand: number;
    tempo: number;
    volume: number;
    mono: boolean;
  }>) => void;
}

export const OutputControls: React.FC<OutputControlsProps> = ({
  enabled,
  outputState,
  onUpdate
}) => {
  const { balance, stereoExpand, tempo, volume, mono } = outputState;

  const createUpdater = (key: keyof typeof outputState) => (value: number) => {
    if (!enabled) return;
    onUpdate({ [key]: value } as any);
  };

  const handleTempoAdjust = (delta: number) => {
    if (!enabled) return;
    const newTempo = Math.max(50, Math.min(200, tempo + delta));
    onUpdate({ tempo: newTempo });
  };

  const toggleMono = () => {
    if (!enabled) return;
    onUpdate({ mono: !mono });
  };

  const handleReset = () => {
    if (!enabled) return;
    Alert.alert(
      'Reset Output',
      'Reset all output controls?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => 
          onUpdate({ 
            balance: 50, 
            stereoExpand: 50, 
            tempo: 100, 
            volume: 67, 
            mono: false 
          })
        }
      ]
    );
  };

  return (
    <>
      <View style={styles.stereoControls}>
        <RotaryKnob 
          value={balance} 
          label="Balance" 
          onChange={createUpdater('balance')}
          color={Colors.metallicBrown.primary} 
          size={110}
          enabled={enabled}
        />
        <RotaryKnob 
          value={stereoExpand} 
          label="Stereo Expand" 
          onChange={createUpdater('stereoExpand')}
          color={Colors.metallicBrown.secondary} 
          size={110}
          enabled={enabled}
        />
      </View>

      <View style={styles.tempoSection}>
        <TouchableOpacity style={styles.tempoButton} activeOpacity={0.7}>
          <Text style={styles.tempoButtonText}>Tempo</Text>
        </TouchableOpacity>
        
        <View style={styles.tempoContainer}>
          <RotaryKnob 
            value={tempo} 
            label="" 
            onChange={createUpdater('tempo')}
            color={Colors.metallicBrown.primary} 
            size={150} 
            showValue={false}
            enabled={enabled}
          />
          <Text style={styles.tempoValue}>{(tempo / 100).toFixed(2)}x</Text>
        </View>

        <View style={styles.tempoButtons}>
          <TouchableOpacity 
            style={styles.tempoAdjustButton} 
            onPress={() => handleTempoAdjust(5)}
            activeOpacity={0.7}
            disabled={!enabled}
          >
            <MaterialIcons name="add" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.tempoAdjustButton} 
            onPress={() => handleTempoAdjust(-5)}
            activeOpacity={0.7}
            disabled={!enabled}
          >
            <MaterialIcons name="remove" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.outputModeButtons}>
        <TouchableOpacity 
          style={[
            styles.outputModeButton, 
            mono && styles.outputModeButtonActive
          ]} 
          onPress={toggleMono}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.outputModeButtonText}>Mono</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.outputModeButton} 
          onPress={handleReset}
          activeOpacity={0.7}
          disabled={!enabled}
        >
          <Text style={styles.outputModeButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.masterVolumeContainer}>
        <RotaryKnob 
          value={volume} 
          label="Volume" 
          onChange={createUpdater('volume')}
          color="#00FF00" 
          size={160}
          enabled={enabled}
        />
        <Text style={styles.volumeValue}>{volume}%</Text>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  stereoControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: verticalScale(20),
  },
  tempoSection: {
    marginTop: verticalScale(30),
    alignItems: 'center',
  },
  tempoButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
    marginBottom: verticalScale(20),
  },
  tempoButtonText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  tempoContainer: {
    alignItems: 'center',
  },
  tempoValue: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginTop: verticalScale(10),
  },
  tempoButtons: {
    flexDirection: 'row',
    gap: scale(10),
    marginTop: verticalScale(15),
  },
  tempoAdjustButton: {
    width: scale(40),
    height: scale(40),
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  outputModeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    marginTop: verticalScale(25),
  },
  outputModeButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
    alignItems: 'center',
    marginHorizontal: scale(5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  outputModeButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  outputModeButtonText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  masterVolumeContainer: {
    alignItems: 'center',
    marginTop: verticalScale(30),
  },
  volumeValue: {
    color: Colors.metallicBrown.primary,
    fontSize: moderateScale(12),
    fontWeight: '700',
    marginTop: verticalScale(10),
  },
});
