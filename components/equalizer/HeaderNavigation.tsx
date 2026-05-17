// ============================================================================
// COMPONENTS/EQUALIZER/HeaderNavigation.tsx (REVAMPED)
// ============================================================================
// Simplified - now part of equalizer.tsx main layout

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';

interface HeaderNavigationProps {
  activePage: 'eq' | 'fx' | 'mastering';
  onPageChange: (page: 'eq' | 'fx' | 'mastering') => void;
  eqEnabled: boolean;
  onEqToggle: () => void;
  insets: { top: number; bottom: number; left: number; right: number };
}

export const HeaderNavigation: React.FC<HeaderNavigationProps> = ({
  activePage,
  onPageChange,
  eqEnabled,
  onEqToggle,
  insets,
}) => {
  return (
    <View style={[styles.container, { paddingTop: insets.top + verticalScale(6) }]}>
      <View style={styles.modeButtons}>
        {(['eq', 'tone', 'limit'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeBtn, activePage === mode && styles.modeBtnActive]}
            onPress={() => onPageChange(mode)}
          >
            <Text style={[styles.modeText, activePage === mode && styles.modeTextActive]}>
              {mode.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <TouchableOpacity 
        style={[styles.powerBtn, eqEnabled && styles.powerBtnActive]}
        onPress={onEqToggle}
      >
        <Ionicons name="power" size={24} color={eqEnabled ? '#000' : '#4ade80'} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(12),
    paddingBottom: verticalScale(10),
  },
  modeButtons: {
    flexDirection: 'row',
    gap: scale(6),
  },
  modeBtn: {
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(7),
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  modeBtnActive: {
    backgroundColor: '#2a2a2a',
    borderColor: '#4ade80',
  },
  modeText: {
    color: '#888',
    fontSize: moderateScale(10),
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  modeTextActive: {
    color: '#fff',
  },
  powerBtn: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(24),
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  powerBtnActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
});
