// components/equalizer/PresetModal.tsx
//
// Reads presets from Supabase:
//   - autoeq_headphones (factory/community presets — from our seeded data)
//   - eq_presets (user-saved presets for the current auth user)
//   - Offline fallback: AsyncStorage cache from SavePresetModal
//
// No BlurView (Android unreliable). No hardcoded dummy data.
// Categories: All / Factory / My Presets — searchable by display_name or name.
// Mini bar curve rendered from bands array.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator, Dimensions,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { supabase } from '@/libs/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CUSTOM_PRESETS_KEY = 'eqCustomPresets_v4';

export interface PresetItem {
  id: string;
  name: string;
  bands: number[];        // 9-band gains
  preamp: number;
  category: string;
  is_factory: boolean;
  display_order?: number;
}

interface PresetModalProps {
  visible: boolean;
  onClose: () => void;
  selectedPreset: string;
  onSelectPreset: (preset: PresetItem) => void;
  insets: { bottom: number };
}

type FilterTab = 'all' | 'factory' | 'mine';

export const PresetModal: React.FC<PresetModalProps> = ({
  visible, onClose, selectedPreset, onSelectPreset, insets,
}) => {
  const [factoryPresets, setFactoryPresets] = useState<PresetItem[]>([]);
  const [userPresets,    setUserPresets]    = useState<PresetItem[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [tab,            setTab]            = useState<FilterTab>('all');
  const [search,         setSearch]         = useState('');

  // ── Load presets when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const load = async () => {
      try {
        // 1. Factory presets from autoeq_headphones (seeded data)
        //    We fetch the view autoeq_headphone_with_filters which includes
        //    the filters jsonb array. We map each to a 9-band array by
        //    finding the 9 ISO bands nearest to our graphic EQ centers.
        const { data: hpData, error: hpErr } = await supabase
          .from('autoeq_headphone_with_filters')
          .select('id, display_name, technical_name, preamp_db, category, filters, source')
          .in('category', ['headphone', 'celebrity', 'genre', 'mood'])
          .limit(200);

        if (!hpErr && hpData) {
          const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000];
          const mapped: PresetItem[] = hpData.map((hp: any) => {
            const filters: any[] = hp.filters ?? [];
            // For each of our 9 EQ bands, find the nearest filter gain
            const bands = EQ_FREQS.map(targetHz => {
              let best = 0;
              let bestDist = Infinity;
              for (const f of filters) {
                if (!['PK','LS','HS'].includes((f.filter_type ?? '').toUpperCase())) continue;
                const dist = Math.abs(Math.log10(f.fc / targetHz));
                if (dist < bestDist) { bestDist = dist; best = f.gain_db ?? 0; }
              }
              return Math.max(-12, Math.min(12, parseFloat(best.toFixed(1))));
            });
            return {
              id:           hp.id,
              name:         hp.display_name ?? hp.technical_name,
              bands,
              preamp:       parseFloat((hp.preamp_db ?? 0).toFixed(1)),
              category:     hp.category ?? 'headphone',
              is_factory:   true,
              display_order: 0,
            };
          });
          setFactoryPresets(mapped);
        }

        // 2. User presets from eq_presets table
        const { data: authData } = await supabase.auth.getUser();
        if (authData.user) {
          const { data: upData } = await supabase
            .from('eq_presets')
            .select('id, name, gains_31, preamp_db, type, created_at')
            .eq('user_id', authData.user.id)
            .eq('type', 'graphic_31band')
            .order('created_at', { ascending: false });

          if (upData) {
            // gains_31 is 31 bands; we pick 9 of them at our ISO centers
            // indices into 31-band array for our 9 bands:
            const IDX_MAP = [2, 5, 7, 10, 13, 17, 20, 23, 26]; // 31.5→idx2, 63→idx5, etc.
            const userMapped: PresetItem[] = upData.map((r: any) => ({
              id: r.id,
              name: r.name,
              bands: IDX_MAP.map(i => {
                const g = r.gains_31?.[i];
                return g !== undefined ? g : 0;
              }),
              preamp: r.preamp_db ?? 0,
              category: 'user',
              is_factory: false,
            }));
            setUserPresets(userMapped);
            return;
          }
        }

        // 3. Offline fallback — custom presets from AsyncStorage
        const local = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
        if (local) setUserPresets(JSON.parse(local));

      } catch (e) {
        console.warn('[PresetModal] load:', e);
        // Offline fallback
        const local = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
        if (local) setUserPresets(JSON.parse(local));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [visible]);

  const displayed = useMemo(() => {
    let list: PresetItem[] = tab === 'factory'
      ? factoryPresets
      : tab === 'mine'
      ? userPresets
      : [...factoryPresets, ...userPresets];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return list;
  }, [tab, search, factoryPresets, userPresets]);

  const handleSelect = useCallback((item: PresetItem) => {
    Haptics.selectionAsync();
    onSelectPreset(item);
  }, [onSelectPreset]);

  const renderItem = ({ item }: { item: PresetItem }) => {
    const isActive = item.name === selectedPreset;
    return (
      <TouchableOpacity
        style={[styles.item, isActive && styles.itemActive]}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        <View style={styles.itemLeft}>
          <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.itemCat}>{item.category}</Text>
        </View>

        {/* Mini bar curve */}
        <View style={styles.curve}>
          {item.bands.map((v, i) => (
            <View
              key={i}
              style={[
                styles.curveBar,
                {
                  height: Math.abs(v * 2.8) + 2,
                  backgroundColor: v > 0 ? Colors.metallicBrown.primary : Colors.metallicBrown.secondary,
                  alignSelf: 'flex-end',
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.itemRight}>
          <Text style={styles.itemPreamp}>
            {item.preamp > 0 ? '+' : ''}{item.preamp}dB
          </Text>
          {item.is_factory
            ? <Text style={styles.lockIcon}>🔒</Text>
            : isActive
            ? <Ionicons name="checkmark-circle" size={16} color={Colors.metallicBrown.primary} />
            : null
          }
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(8) }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>PRESET BROWSER</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <MaterialCommunityIcons name="magnify" size={16} color="#666" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search presets…"
              placeholderTextColor="#555"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <MaterialCommunityIcons name="close-circle" size={14} color="#555" />
              </TouchableOpacity>
            )}
          </View>

          {/* Category tabs */}
          <View style={styles.tabs}>
            {(['all','factory','mine'] as FilterTab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.tabActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'all' ? 'ALL' : t === 'factory' ? 'FACTORY' : 'MY PRESETS'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Count */}
          {!loading && (
            <Text style={styles.count}>
              {displayed.length} preset{displayed.length !== 1 ? 's' : ''}
            </Text>
          )}

          {/* List */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={Colors.metallicBrown.primary} />
              <Text style={styles.loadingText}>Loading presets…</Text>
            </View>
          ) : (
            <FlatList
              data={displayed}
              keyExtractor={p => p.id}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {tab === 'mine'
                    ? 'No saved presets yet. Adjust the EQ and tap SAVE.'
                    : 'No presets found.'}
                </Text>
              }
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              contentContainerStyle={{ paddingBottom: verticalScale(16) }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: scale(16), paddingTop: verticalScale(8),
    maxHeight: SCREEN_HEIGHT * 0.88,
  },
  handle: {
    alignSelf: 'center', width: scale(36), height: 4,
    borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: verticalScale(12),
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: verticalScale(12),
  },
  title: { color: '#fff', fontSize: moderateScale(16), fontWeight: '700', letterSpacing: 1 },
  closeBtn: {
    width: scale(32), height: scale(32), borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: scale(8),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20, paddingHorizontal: scale(12),
    paddingVertical: verticalScale(8),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: verticalScale(12),
  },
  searchInput: { flex: 1, color: '#fff', fontSize: moderateScale(13) },
  tabs: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20, padding: scale(2), marginBottom: verticalScale(8),
  },
  tab: { flex: 1, paddingVertical: verticalScale(7), alignItems: 'center', borderRadius: 18 },
  tabActive: { backgroundColor: Colors.metallicBrown.primary },
  tabText: { color: 'rgba(255,255,255,0.5)', fontSize: moderateScale(10), fontWeight: '700' },
  tabTextActive: { color: '#000' },
  count: { color: 'rgba(255,255,255,0.3)', fontSize: moderateScale(10), marginBottom: verticalScale(8) },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: verticalScale(11), paddingHorizontal: scale(6),
    borderRadius: 10,
  },
  itemActive: { backgroundColor: 'rgba(139,115,85,0.18)' },
  itemLeft: { flex: 1 },
  itemName: { color: '#fff', fontSize: moderateScale(13), fontWeight: '600' },
  itemCat: { color: 'rgba(255,255,255,0.35)', fontSize: moderateScale(9), marginTop: 2, textTransform: 'capitalize' },
  curve: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: verticalScale(24), gap: 2, marginHorizontal: scale(12),
  },
  curveBar: { width: scale(5), borderRadius: 2 },
  itemRight: { alignItems: 'flex-end', gap: 4, minWidth: scale(36) },
  itemPreamp: { color: 'rgba(255,255,255,0.5)', fontSize: moderateScale(10), fontWeight: '600' },
  lockIcon: { fontSize: 11 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.06)' },
  loadingWrap: { paddingVertical: verticalScale(30), alignItems: 'center', gap: verticalScale(8) },
  loadingText: { color: '#555', fontSize: moderateScale(12) },
  emptyText: { color: '#555', fontSize: moderateScale(13), textAlign: 'center', paddingVertical: verticalScale(30) },
});