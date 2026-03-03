// components/equalizer/HeaderNavigation.tsx

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { screenPadding } from '@/constants/tokens';
import { Colors } from '@/constants/Colors';
import Animated, { 
  useAnimatedStyle, 
  withSpring, 
  withTiming,
  interpolateColor
} from 'react-native-reanimated';

interface HeaderNavigationProps {
  activePage: 'eq' | 'fx' | 'mastering';
  onPageChange: (page: 'eq' | 'fx' | 'mastering') => void;
  eqMode: 'graphic' | 'parametric';
  onEqModeChange: (mode: 'graphic' | 'parametric') => void;
  eqEnabled: boolean;
  onEqToggle: () => void;
  insets: any;
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

  // Mode indicator animation
  const modeIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: withSpring(eqMode === 'graphic' ? 0 : scale(70), {
        damping: 20,
        stiffness: 200
      })
    }]
  }));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      
      {/* Top Row: EQ Toggle + Mode Selector (only visible on EQ page) */}
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

        {/* EQ Mode Selector - only visible when EQ page is active */}
        {activePage === 'eq' && (
          <View style={styles.modeSelector}>
            <Animated.View style={[styles.modeIndicator, modeIndicatorStyle]} />
            
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onEqModeChange('graphic')}
              style={styles.modeButton}
            >
              <Text style={[
                styles.modeButtonText,
                eqMode === 'graphic' && styles.modeButtonTextActive
              ]}>GRAPHIC</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onEqModeChange('parametric')}
              style={styles.modeButton}
            >
              <Text style={[
                styles.modeButtonText,
                eqMode === 'parametric' && styles.modeButtonTextActive
              ]}>PARAMETRIC</Text>
            </TouchableOpacity>
          </View>
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
            size={24} 
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
            name="adjust" 
            size={24} 
            color={activePage === 'fx' ? Colors.metallicBrown.primary : "#666"} 
          />
          {activePage === 'fx' && <View style={styles.activeDot} />}
        </TouchableOpacity>
        
        {/* Mastering Page Icon (renamed from output) */}
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => onPageChange('mastering')}
          style={styles.navItem}
        >
          <MaterialCommunityIcons 
            name="waveform" 
            size={24} 
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
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingBottom: verticalScale(8),
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenPadding.horizontal,
    marginBottom: verticalScale(8),
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
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: scale(2),
    width: scale(140),
    height: scale(36),
    position: 'relative',
  },
  modeIndicator: {
    position: 'absolute',
    width: scale(68),
    height: scale(32),
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 18,
    top: scale(2),
    left: scale(2),
  },
  modeButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  modeButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: moderateScale(11),
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  modeButtonTextActive: {
    color: '#000',
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: screenPadding.horizontal,
  },
  navItem: {
    padding: scale(8),
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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