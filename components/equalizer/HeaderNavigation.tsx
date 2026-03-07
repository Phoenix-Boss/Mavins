// components/equalizer/HeaderNavigation.tsx

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import Animated, { 
  useAnimatedStyle, 
  withSpring, 
  interpolateColor 
} from 'react-native-reanimated';

interface HeaderNavigationProps {
  activePage: 'eq' | 'fx' | 'mastering';
  onPageChange: (page: 'eq' | 'fx' | 'mastering') => void;
  eqMode: 'graphic' | 'parametric';
  onEqModeChange: (mode: 'graphic' | 'parametric') => void;
  eqEnabled: boolean;
  onEqToggle: () => void;
  insets: { top: number; bottom: number; left: number; right: number };
}

export const HeaderNavigation: React.FC<HeaderNavigationProps> = ({
  activePage,
  onPageChange,
  eqMode,
  onEqModeChange,
  eqEnabled,
  onEqToggle,
  insets,
}) => {
  
  // Animated styles for EQ toggle button
  const eqToggleAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      eqEnabled ? 1 : 0,
      [0, 1],
      ['rgba(255,255,255,0.1)', Colors.metallicBrown.primary]
    ),
    transform: [{
      scale: withSpring(eqEnabled ? 1.05 : 1, {
        damping: 15,
        stiffness: 150
      })
    }]
  }));

  const eqToggleTextStyle = useAnimatedStyle(() => ({
    color: eqEnabled ? '#000' : '#fff'
  }));

  // Toggle EQ Mode handler
  const toggleMode = () => {
    onEqModeChange(eqMode === 'graphic' ? 'parametric' : 'graphic');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + verticalScale(5) }]}>
      
      {/* Top Row: EQ Toggle + Mode Switch */}
      <View style={styles.topRow}>
        {/* EQ On/Off Button */}
        <TouchableOpacity 
          activeOpacity={0.8}
          onPress={onEqToggle}
          style={styles.eqToggleWrapper}
        >
          <Animated.View style={[styles.eqToggle, eqToggleAnimatedStyle]}>
            <Animated.Text style={[styles.eqToggleText, eqToggleTextStyle]}>
              EQ
            </Animated.Text>
          </Animated.View>
        </TouchableOpacity>

        {/* EQ Mode Switch - Only visible on EQ page */}
        {activePage === 'eq' && (
          <TouchableOpacity 
            activeOpacity={0.7}
            onPress={toggleMode}
            style={styles.modeSwitchContainer}
          >
            <MaterialCommunityIcons 
              name="swap-horizontal" 
              size={16} 
              color="#fff" 
              style={styles.switchIcon}
            />
            <Text style={styles.modeSwitchText}>
              {eqMode === 'graphic' ? 'GRAPHIC' : 'PARAMETRIC'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom Row: Navigation Icons */}
      <View style={styles.navRow}>
        {/* EQ Page Icon */}
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => onPageChange('eq')}
          style={styles.navItem}
        >
          <MaterialCommunityIcons 
            name="equalizer" 
            size={moderateScale(24)} 
            color={activePage === 'eq' ? Colors.metallicBrown.primary : "#666"} 
          />
          {activePage === 'eq' && <View style={styles.activeDot} />}
        </TouchableOpacity>
        
        {/* FX Page Icon */}
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => onPageChange('fx')}
          style={styles.navItem}
        >
          <MaterialIcons 
            name="auto-fix-high" 
            size={moderateScale(24)} 
            color={activePage === 'fx' ? Colors.metallicBrown.primary : "#666"} 
          />
          {activePage === 'fx' && <View style={styles.activeDot} />}
        </TouchableOpacity>
        
        {/* Mastering Page Icon */}
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => onPageChange('mastering')}
          style={styles.navItem}
        >
          <MaterialCommunityIcons 
            name="waveform" 
            size={moderateScale(24)} 
            color={activePage === 'mastering' ? Colors.metallicBrown.primary : "#666"} 
          />
          {activePage === 'mastering' && <View style={styles.activeDot} />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.4)', // Slightly visible background
    paddingBottom: verticalScale(8),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    marginBottom: verticalScale(10),
    height: verticalScale(36), // Fixed height for stability
  },
  eqToggleWrapper: {
    width: scale(60),
    height: scale(36),
  },
  eqToggle: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  eqToggleText: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Mode Switch Styles (The new single button)
  modeSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    minWidth: scale(130),
  },
  switchIcon: {
    marginRight: scale(6),
    opacity: 0.8,
  },
  modeSwitchText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Navigation Row
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-around', // Distribute icons evenly
    alignItems: 'center',
    paddingHorizontal: scale(20),
  },
  navItem: {
    padding: scale(8),
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: scale(60), // Ensure equal width for spacing
  },
  activeDot: {
    position: 'absolute',
    bottom: -scale(4),
    width: scale(4),
    height: scale(4),
    borderRadius: 2,
    backgroundColor: Colors.metallicBrown.primary,
  },
});