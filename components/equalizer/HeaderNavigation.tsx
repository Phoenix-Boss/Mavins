// components/equalizer/HeaderNavigation.tsx

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { scale } from 'react-native-size-matters/extend';
import { screenPadding } from '@/constants/tokens';
import { Colors } from '@/constants/Colors';

interface HeaderNavigationProps {
  activePage: 'eq' | 'fx' | 'output' | 'parametric';
  onPageChange: (page: 'eq' | 'fx' | 'output' | 'parametric') => void;
  insets: any;
}

export const HeaderNavigation: React.FC<HeaderNavigationProps> = ({
  activePage,
  onPageChange,
  insets,
}) => {
  return (
    <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => onPageChange('eq')}
        style={styles.headerIconContainer}
      >
        <MaterialCommunityIcons 
          name="equalizer" 
          size={24} 
          color={activePage === 'eq' ? Colors.metallicBrown.primary : "#666"} 
        />
      </TouchableOpacity>
      
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => onPageChange('fx')}
        style={styles.headerIconContainer}
      >
        <MaterialIcons 
          name="adjust" 
          size={24} 
          color={activePage === 'fx' ? Colors.metallicBrown.primary : "#666"} 
        />
      </TouchableOpacity>
      
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => onPageChange('output')}
        style={styles.headerIconContainer}
      >
        <MaterialCommunityIcons 
          name="audio-video" 
          size={24} 
          color={activePage === 'output' ? Colors.metallicBrown.primary : "#666"} 
        />
      </TouchableOpacity>

      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => onPageChange('parametric')}
        style={styles.headerIconContainer}
      >
        <MaterialCommunityIcons 
          name="chart-bell-curve" 
          size={24} 
          color={activePage === 'parametric' ? Colors.metallicBrown.primary : "#666"} 
        />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  headerBar: {
    position: 'absolute',
    left: screenPadding.horizontal,
    right: screenPadding.horizontal,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 1000,
  },
  headerIconContainer: {
    padding: 8,
  },
});