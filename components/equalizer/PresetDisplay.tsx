// components/equalizer/PresetDisplay.tsx

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';

interface PresetDisplayProps {
  preset: string;
}

export const PresetDisplay: React.FC<PresetDisplayProps> = ({ preset }) => {
  return (
    <View style={styles.presetLabelContainer}>
      <Text style={styles.presetLabelText}>{preset}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  presetLabelContainer: {
    alignItems: 'center',
    marginTop: verticalScale(15),
    marginBottom: verticalScale(20),
  },
  presetLabelText: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '600',
    letterSpacing: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 12,
  },
});