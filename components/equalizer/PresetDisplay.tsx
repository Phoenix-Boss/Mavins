// ============================================================================
// COMPONENTS/EQUALIZER/PresetDisplay.tsx (REVAMPED)
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const CUSTOM_PRESETS_KEY = 'eqCustomPresets_v5';

export interface PresetItem {
  id: string;
  name: string;
  bands: number[];
  preamp: number;
  category: string;
  is_factory: boolean;
}

interface PresetModalProps {
  visible: boolean;
  onClose: () => void;
  selectedPreset: string;
  onSelectPreset: (preset: PresetItem) => void;
  insets: { bottom: number };
}

const FACTORY_PRESETS: PresetItem[] = [
  { id: 'flat', name: 'Flat', bands: Array(10).fill(0), preamp: 0, category: 'factory', is_factory: true },
  { id: 'bass', name: 'Bass Boost', bands: [4, 4, 3, 1, 0, 0, 0, 0, 0, 0], preamp: -2, category: 'factory', is_factory: true },
  { id: 'treble', name: 'Treble Boost', bands: [0, 0, 0, 0, 0, 0, 1, 3, 4, 4], preamp: -2, category: 'factory', is_factory: true },
  { id: 'vshape', name: 'V-Shape', bands: [4, 3, 1, 0, -2, -2, 0, 1, 3, 4], preamp: -3, category: 'factory', is_factory: true },
  { id: 'rock', name: 'Rock', bands: [3, 2, 0, -1, -2, -1, 0, 2, 3, 3], preamp: -2, category: 'factory', is_factory: true },
];

export const PresetModal: React.FC<PresetModalProps> = ({
  visible, onClose, selectedPreset, onSelectPreset, insets,
}) => {
  const [customPresets, setCustomPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    loadCustomPresets();
  }, [visible]);

  const loadCustomPresets = async () => {
    setLoading(true);
    try {
      const saved = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
      if (saved) setCustomPresets(JSON.parse(saved));
    } catch (e) {
      console.warn('Failed to load presets:', e);
    } finally {
      setLoading(false);
    }
  };

  const allPresets = useMemo(() => [...FACTORY_PRESETS, ...customPresets], [customPresets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allPresets;
    const q = search.toLowerCase();
    return allPresets.filter(p => p.name.toLowerCase().includes(q));
  }, [allPresets, search]);

  const handleSelect = (item: PresetItem) => {
    Haptics.selectionAsync();
    onSelectPreset(item);
  };

  const renderItem = ({ item }: { item: PresetItem }) => {
    const isActive = item.name === selectedPreset;
    return (
      <TouchableOpacity
        style={[styles.item, isActive && styles.itemActive]}
        onPress={() => handleSelect(item)}
      >
        <View style={styles.itemLeft}>
          <Text style={[styles.itemName, isActive && styles.itemNameActive]} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.curve}>
            {item.bands.map((v, i) => (
              <View
                key={i}
                style={[
                  styles.curveBar,
                  {
                    height: Math.abs(v * 3) + 2,
                    backgroundColor: v > 0 ? '#4ade80' : v < 0 ? '#f97316' : '#444',
                  },
                ]}
              />
            ))}
          </View>
        </View>
        {isActive && <Ionicons name="checkmark" size={20} color="#4ade80" />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(16) }]}>
          <View style={styles.handle} />
          
          <View style={styles.header}>
            <Text style={styles.title}>PRESETS</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#888" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#555" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              placeholderTextColor="#555"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {loading ? (
            <ActivityIndicator color="#4ade80" style={styles.loader} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={p => p.id}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(12),
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: scale(36),
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    marginBottom: verticalScale(12),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: verticalScale(12),
  },
  title: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '800',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: scale(12),
    marginBottom: verticalScale(12),
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: moderateScale(14),
    paddingVertical: verticalScale(10),
    marginLeft: scale(8),
  },
  loader: {
    marginVertical: verticalScale(40),
  },
  list: {
    paddingBottom: verticalScale(16),
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: scale(12),
    borderRadius: 10,
    marginBottom: verticalScale(6),
    backgroundColor: '#111',
  },
  itemActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.3)',
  },
  itemLeft: {
    flex: 1,
  },
  itemName: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginBottom: verticalScale(6),
  },
  itemNameActive: {
    color: '#4ade80',
  },
  curve: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: verticalScale(20),
    gap: 2,
  },
  curveBar: {
    width: scale(4),
    borderRadius: 1,
  },
});