// components/equalizer/PresetModal.tsx - COMPLETE REDESIGN WITH FUTURISTIC UI

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PresetModalProps {
  visible: boolean;
  onClose: () => void;
  selectedPreset: string;
  onSelectPreset: (preset: any) => void;
  insets: any;
}

// Sample preset data structure
const PRESET_DATA = {
  builtIn: [
    { id: '1', name: 'Flat', values: [0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, category: 'builtIn' },
    { id: '2', name: 'Rock', values: [4, 3, 2, 1, 0, -1, -2, -3, -4], preamp: 2, category: 'builtIn' },
    { id: '3', name: 'Pop', values: [2, 2, 1, 0, -1, -1, 0, 1, 2], preamp: 1, category: 'builtIn' },
    { id: '4', name: 'Jazz', values: [3, 2, 1, 0, 1, 2, 3, 2, 1], preamp: 1.5, category: 'builtIn' },
    { id: '5', name: 'Classical', values: [2, 1, 0, 0, 0, 0, 1, 2, 3], preamp: 0.5, category: 'builtIn' },
  ],
  user: [
    { id: 'u1', name: 'My Voice', values: [2, 1, 0, -1, 0, 1, 2, 3, 2], preamp: 1, category: 'user' },
    { id: 'u2', name: 'Night Mode', values: [-2, -1, 0, 1, 2, 1, 0, -1, -2], preamp: -1, category: 'user' },
    { id: 'u3', name: 'Morning', values: [1, 1, 2, 3, 2, 1, 0, -1, -2], preamp: 0.5, category: 'user' },
  ],
  premium: [
    { id: 'p1', name: 'Studio Reference', values: [1, 1, 0, 0, 0, 0, 0, 1, 1], preamp: 0, category: 'premium', locked: true },
    { id: 'p2', name: 'Bass Cannon', values: [8, 7, 5, 2, 0, -2, -4, -6, -8], preamp: 4, category: 'premium', locked: true },
    { id: 'p3', name: 'Vocal Clarity', values: [2, 1, -1, -2, 0, 2, 4, 5, 4], preamp: 1, category: 'premium', locked: true },
  ],
  headphones: [
    { id: 'h1', name: 'AirPods Pro', values: [2, 2, 1, 0, -1, 0, 1, 2, 2], preamp: 1, category: 'headphones' },
    { id: 'h2', name: 'Sony XM4', values: [3, 2, 1, 0, -1, 0, 1, 2, 3], preamp: 1.5, category: 'headphones' },
    { id: 'h3', name: 'Bose QC', values: [2, 2, 2, 1, 0, 0, 1, 2, 2], preamp: 1, category: 'headphones' },
  ],
};

export const PresetModal: React.FC<PresetModalProps> = ({
  visible,
  onClose,
  selectedPreset,
  onSelectPreset,
  insets,
}) => {
  const [activeCategory, setActiveCategory] = useState<'builtIn' | 'user' | 'premium' | 'headphones'>('builtIn');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter presets based on search
  const filteredPresets = useMemo(() => {
    const presets = PRESET_DATA[activeCategory];
    if (!searchQuery.trim()) return presets;
    
    return presets.filter(preset => 
      preset.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [activeCategory, searchQuery]);

  // Futuristic graph line visualization
  const renderPresetCurve = (values: number[]) => {
    // Create points for the graph (normalized to 0-1)
    const points = values.map((val, index) => {
      const x = (index / (values.length - 1)) * 100;
      // Normalize -15..+15 to 0..1, then invert so top is +15
      const y = 50 - (val / 30) * 50;
      return `${x}%,${y}%`;
    }).join(', ');

    // Create connecting lines with nodes
    const linePoints = values.map((val, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 50 - (val / 30) * 50;
      return { x, y };
    });

    return (
      <View style={styles.presetGraph}>
        {/* Grid lines */}
        <View style={styles.graphGrid}>
          {[0, 25, 50, 75, 100].map((pos) => (
            <View key={pos} style={[styles.gridLine, { left: `${pos}%` }]} />
          ))}
          {[0, 25, 50, 75, 100].map((pos) => (
            <View key={pos} style={[styles.gridLineHorizontal, { top: `${pos}%` }]} />
          ))}
        </View>

        {/* Glow effect behind line */}
        <View style={[styles.graphGlow, { clipPath: `polygon(${points})` }]} />

        {/* Main line */}
        <View style={[styles.graphLine, { clipPath: `polygon(${points})` }]} />

        {/* Nodes at each frequency */}
        {linePoints.map((point, index) => (
          <Animated.View
            key={index}
            style={[
              styles.graphNode,
              {
                left: point.x,
                top: point.y,
                backgroundColor: values[index] > 0 
                  ? Colors.metallicBrown.primary 
                  : values[index] < 0 
                  ? Colors.metallicBrown.secondary 
                  : '#fff',
              },
            ]}
          >
            <View style={styles.nodePulse} />
          </Animated.View>
        ))}

        {/* Frequency labels */}
        <Text style={[styles.freqLabel, { left: '0%' }]}>31</Text>
        <Text style={[styles.freqLabel, { left: '25%' }]}>100</Text>
        <Text style={[styles.freqLabel, { left: '50%' }]}>800</Text>
        <Text style={[styles.freqLabel, { left: '75%' }]}>3.2k</Text>
        <Text style={[styles.freqLabel, { left: '100%' }]}>6.4k</Text>
      </View>
    );
  };

  const renderEmptyState = (category: string) => (
    <View style={styles.emptyContainer}>
      <View style={styles.lockIconContainer}>
        <MaterialCommunityIcons name="lock-outline" size={40} color="rgba(255,255,255,0.2)" />
      </View>
      <Text style={styles.emptyTitle}>No {category} presets</Text>
      <Text style={styles.emptySubtext}>
        {category === 'premium' 
          ? 'Unlock premium presets for professional sound'
          : category === 'user'
          ? 'Create and save your own custom presets'
          : category === 'headphones'
          ? 'Connect headphones to see optimized presets'
          : 'Check back later for new presets'}
      </Text>
    </View>
  );

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <BlurView intensity={90} style={styles.modalOverlay}>
        <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
          
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>PRESET BROWSER</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <MaterialCommunityIcons name="magnify" size={20} color="rgba(255,255,255,0.4)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search presets..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialCommunityIcons name="close-circle" size={16} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            )}
          </View>

          {/* Category Tabs */}
          <View style={styles.categoryTabs}>
            <TouchableOpacity
              style={[styles.categoryTab, activeCategory === 'builtIn' && styles.categoryTabActive]}
              onPress={() => setActiveCategory('builtIn')}
            >
              <Text style={[styles.categoryText, activeCategory === 'builtIn' && styles.categoryTextActive]}>
                BUILT-IN
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.categoryTab, activeCategory === 'user' && styles.categoryTabActive]}
              onPress={() => setActiveCategory('user')}
            >
              <Text style={[styles.categoryText, activeCategory === 'user' && styles.categoryTextActive]}>
                USER
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.categoryTab, activeCategory === 'premium' && styles.categoryTabActive]}
              onPress={() => setActiveCategory('premium')}
            >
              <Text style={[styles.categoryText, activeCategory === 'premium' && styles.categoryTextActive]}>
                PREMIUM
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.categoryTab, activeCategory === 'headphones' && styles.categoryTabActive]}
              onPress={() => setActiveCategory('headphones')}
            >
              <Text style={[styles.categoryText, activeCategory === 'headphones' && styles.categoryTextActive]}>
                HEADPHONES
              </Text>
            </TouchableOpacity>
          </View>

          {/* Preset List */}
          {filteredPresets.length === 0 ? (
            renderEmptyState(activeCategory)
          ) : (
            <FlatList
              data={filteredPresets}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.presetItem,
                    selectedPreset === item.name && styles.presetItemSelected,
                    item.locked && styles.presetItemLocked,
                  ]}
                  onPress={() => !item.locked && onSelectPreset(item)}
                  activeOpacity={item.locked ? 1 : 0.7}
                >
                  <View style={styles.presetItemLeft}>
                    <View>
                      <Text style={styles.presetItemName}>{item.name}</Text>
                      {item.category && (
                        <Text style={styles.presetCategory}>
                          {item.category === 'builtIn' ? '📦 Built-in' : 
                           item.category === 'user' ? '👤 User' : 
                           item.category === 'premium' ? '⭐ Premium' : '🎧 Headphones'}
                        </Text>
                      )}
                    </View>
                    
                    {/* Futuristic graph preview */}
                    {renderPresetCurve(item.values)}
                  </View>

                  <View style={styles.presetItemRight}>
                    <Text style={styles.presetItemPreamp}>
                      {item.preamp > 0 ? '+' : ''}{item.preamp}dB
                    </Text>
                    {item.locked && (
                      <MaterialCommunityIcons name="lock" size={14} color="rgba(255,255,255,0.3)" />
                    )}
                  </View>
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </BlurView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(20),
    maxHeight: SCREEN_HEIGHT * 0.85,
    borderWidth: 1,
    borderColor: 'rgba(139, 115, 85, 0.3)',
    borderBottomWidth: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(15),
  },
  modalTitle: {
    color: '#fff',
    fontSize: moderateScale(18),
    fontWeight: '700',
    letterSpacing: 2,
  },
  closeButton: {
    width: scale(36),
    height: scale(36),
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingHorizontal: scale(15),
    marginBottom: verticalScale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: moderateScale(14),
    paddingVertical: verticalScale(10),
    marginLeft: scale(8),
    fontFamily: 'monospace',
  },
  categoryTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 25,
    padding: scale(3),
    marginBottom: verticalScale(15),
    borderWidth: 1,
    borderColor: 'rgba(139, 115, 85, 0.3)',
  },
  categoryTab: {
    flex: 1,
    paddingVertical: verticalScale(8),
    alignItems: 'center',
    borderRadius: 22,
  },
  categoryTabActive: {
    backgroundColor: Colors.metallicBrown.primary,
  },
  categoryText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(10),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryTextActive: {
    color: '#000',
  },
  listContent: {
    paddingBottom: verticalScale(20),
  },
  presetItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(15),
    paddingHorizontal: scale(12),
    borderRadius: 16,
    marginBottom: verticalScale(8),
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  presetItemSelected: {
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
    borderColor: Colors.metallicBrown.primary,
  },
  presetItemLocked: {
    opacity: 0.6,
  },
  presetItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
  },
  presetItemName: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginBottom: verticalScale(2),
  },
  presetCategory: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(9),
    letterSpacing: 0.3,
  },
  presetItemRight: {
    alignItems: 'flex-end',
    gap: verticalScale(4),
  },
  presetItemPreamp: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
  presetGraph: {
    width: scale(100),
    height: verticalScale(40),
    position: 'relative',
    marginLeft: scale(8),
  },
  graphGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  gridLine: {
    position: 'absolute',
    width: 1,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  gridLineHorizontal: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  graphGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(139, 115, 85, 0.15)',
    shadowColor: Colors.metallicBrown.primary,
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  graphLine: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(139, 115, 85, 0.5)',
  },
  graphNode: {
    position: 'absolute',
    width: scale(6),
    height: scale(6),
    borderRadius: 3,
    marginLeft: -scale(3),
    marginTop: -scale(3),
  },
  nodePulse: {
    position: 'absolute',
    width: scale(12),
    height: scale(12),
    borderRadius: 6,
    backgroundColor: 'rgba(139, 115, 85, 0.3)',
    marginLeft: -scale(3),
    marginTop: -scale(3),
  },
  freqLabel: {
    position: 'absolute',
    bottom: -verticalScale(12),
    color: 'rgba(255,255,255,0.2)',
    fontSize: moderateScale(7),
    transform: [{ translateX: -scale(6) }],
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(40),
    paddingHorizontal: scale(30),
  },
  lockIconContainer: {
    width: scale(80),
    height: scale(80),
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.02)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: verticalScale(15),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  emptyTitle: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '600',
    marginBottom: verticalScale(8),
  },
  emptySubtext: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(12),
    textAlign: 'center',
    lineHeight: moderateScale(18),
  },
});