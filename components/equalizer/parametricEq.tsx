// components/equalizer/parametricEq.tsx
//
// Fixes:
//  - BlurView replaced with View (Android unreliable)
//  - transformOrigin removed from curveLine (unsupported in RN StyleSheet)
//  - pointStyle() called inside render — hooks must not be inside callbacks;
//    replaced with single shared animated value + direct style object
//  - Filter modal uses semi-transparent View (not BlurView)
//  - showValue prop removed from RotaryKnob calls (not in interface)

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, Dimensions,
} from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { RotaryKnob } from './RotaryKnob';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type FilterType = 'lowpass'|'highpass'|'bandpass'|'lowshelf'|'highshelf'|'peaking'|'notch';

interface ParametricEQProps {
  enabled: boolean;
  parametricState: {
    selectedFilter: FilterType;
    filterEnabled: boolean;
    gain: number;       // -15..+15
    frequency: number;  // 20..20000
    q: number;          // 0.1..10
  };
  onUpdate: (updates: Partial<ParametricEQProps['parametricState']>) => void;
}

const FILTERS: { id: FilterType; name: string; icon: string; category: string; description: string }[] = [
  { id: 'peaking',   name: 'Peaking',    icon: '🔔', category: 'Bell',   description: 'Boost/cut a frequency band' },
  { id: 'lowshelf',  name: 'Low Shelf',  icon: '📉', category: 'Shelf',  description: 'Boost/cut lows' },
  { id: 'highshelf', name: 'High Shelf', icon: '📈', category: 'Shelf',  description: 'Boost/cut highs' },
  { id: 'lowpass',   name: 'Low Pass',   icon: '⬇️', category: 'Filter', description: 'Remove highs' },
  { id: 'highpass',  name: 'High Pass',  icon: '⬆️', category: 'Filter', description: 'Remove lows' },
  { id: 'bandpass',  name: 'Band Pass',  icon: '🔲', category: 'Filter', description: 'Pass only a band' },
  { id: 'notch',     name: 'Notch',      icon: '❌', category: 'Filter', description: 'Remove a band' },
];

// ── Conversion helpers ──────────────────────────────────────────────────────
function freqToKnob(f: number) {
  const logRange = Math.log10(20000) - Math.log10(20);
  return ((Math.log10(Math.max(20, Math.min(20000, f))) - Math.log10(20)) / logRange) * 100;
}
function knobToFreq(k: number) {
  const logRange = Math.log10(20000) - Math.log10(20);
  return Math.pow(10, (k / 100) * logRange + Math.log10(20));
}
const qToKnob   = (q: number)  => Math.max(0, Math.min(100, ((q - 0.1) / 9.9) * 100));
const knobToQ   = (k: number)  => 0.1 + (k / 100) * 9.9;
const gainToKnob = (g: number) => Math.max(0, Math.min(100, (g + 15) / 30 * 100));
const knobToGain = (k: number) => (k / 100) * 30 - 15;

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  enabled, parametricState, onUpdate,
}) => {
  const { selectedFilter, filterEnabled, gain, frequency, q } = parametricState;
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  // Single shared scale for active midpoint
  const midScale = useSharedValue(1);
  const midStyle = useAnimatedStyle(() => ({ transform: [{ scale: midScale.value }] }));

  const currentFilter = FILTERS.find(f => f.id === selectedFilter) ?? FILTERS[0];

  // Compute the three control points on the curve
  const getPoints = () => {
    const midGain = (['peaking','lowshelf','highshelf'].includes(selectedFilter)) ? gain : 0;
    const pts = {
      low:  { x: 10, y: 50 },
      mid:  { x: freqToKnob(frequency), y: 50 - (midGain / 30) * 40 },
      high: { x: 90, y: 50 },
    };
    switch (selectedFilter) {
      case 'lowpass':  pts.high.y = 20; break;
      case 'highpass': pts.low.y  = 20; break;
      case 'bandpass': pts.low.y = 20; pts.high.y = 20; pts.mid.y = 80; break;
      case 'lowshelf': pts.low.y = 50 - (gain / 30) * 40; pts.mid.y = 50; break;
      case 'highshelf': pts.high.y = 50 - (gain / 30) * 40; pts.mid.y = 50; break;
      case 'notch':    pts.mid.y = 50 + (Math.abs(gain) / 30) * 30; break;
    }
    return pts;
  };

  const pts = getPoints();

  const handleMidPress = () => {
    if (!enabled || !filterEnabled) return;
    Haptics.selectionAsync();
    midScale.value = withSpring(1.3, { damping: 10 });
    setTimeout(() => { midScale.value = withSpring(1); }, 300);
  };

  const updater = useCallback((key: keyof typeof parametricState, conv: (v: number) => number) =>
    (val: number) => {
      if (!enabled || !filterEnabled) return;
      Haptics.selectionAsync();
      onUpdate({ [key]: conv(val) } as any);
    }, [enabled, filterEnabled, onUpdate]);

  const showGain  = ['peaking','lowshelf','highshelf'].includes(selectedFilter);
  const showQ     = ['peaking','notch','bandpass','lowpass','highpass'].includes(selectedFilter);

  return (
    <View style={styles.container}>

      {/* Filter selector button */}
      <TouchableOpacity
        style={[styles.filterSelector, !enabled && styles.disabled]}
        onPress={() => setFilterModalVisible(true)}
        activeOpacity={0.75}
        disabled={!enabled}
      >
        <View style={styles.filterSelectorLeft}>
          <Text style={styles.filterIcon}>{currentFilter.icon}</Text>
          <View>
            <Text style={styles.filterName}>{currentFilter.name}</Text>
            <Text style={styles.filterCat}>{currentFilter.category} · {currentFilter.description}</Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>

      {/* Graph */}
      <View style={[styles.graphContainer, !enabled && styles.disabled]}>
        {/* Grid */}
        {[-12,-6,0,6,12].map(db => {
          const t = (1 - (db + 12) / 24) * 100;
          return (
            <View key={db} style={[styles.hLine, { top: `${t}%` }]}>
              <Text style={styles.dbLabel}>{db > 0 ? `+${db}` : db}dB</Text>
            </View>
          );
        })}
        <View style={styles.zeroLine} />

        {/* Lines low→mid and mid→high (no transformOrigin — not supported in RN) */}
        {/* We approximate each segment with a thin colored bar at the midpoint height */}
        <View style={[styles.curveSeg, {
          left: `${pts.low.x}%`,
          top:  `${(pts.low.y + pts.mid.y) / 2}%`,
          width: `${pts.mid.x - pts.low.x}%`,
        }]} />
        <View style={[styles.curveSeg, {
          left: `${pts.mid.x}%`,
          top:  `${(pts.mid.y + pts.high.y) / 2}%`,
          width: `${pts.high.x - pts.mid.x}%`,
        }]} />

        {/* Control points */}
        {(['low','mid','high'] as const).map(pt => {
          const p = pts[pt];
          const isM = pt === 'mid';
          return isM ? (
            <Animated.View
              key={pt}
              style={[styles.dot, styles.dotMid, midStyle, { left: `${p.x}%`, top: `${p.y}%` }]}
            >
              <TouchableOpacity onPress={handleMidPress} style={styles.dotTouch} activeOpacity={0.7} />
            </Animated.View>
          ) : (
            <View key={pt} style={[styles.dot, { left: `${p.x}%`, top: `${p.y}%` }]} />
          );
        })}

        {/* Freq label under graph */}
        <View style={styles.freqLabels}>
          {['20','100','1k','10k','20k'].map(l => (
            <Text key={l} style={styles.freqLabel}>{l}</Text>
          ))}
        </View>
      </View>

      {/* Knobs */}
      <View style={styles.knobsRow}>
        {showGain && (
          <KnobCell
            value={gainToKnob(gain)}
            label="GAIN"
            sub={`${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`}
            onChange={updater('gain', knobToGain)}
            color={Colors.metallicBrown.primary}
            enabled={enabled && filterEnabled}
          />
        )}
        <KnobCell
          value={freqToKnob(frequency)}
          label="FREQ"
          sub={frequency >= 1000 ? `${(frequency/1000).toFixed(1)}kHz` : `${Math.round(frequency)}Hz`}
          onChange={updater('frequency', knobToFreq)}
          color={Colors.metallicBrown.secondary}
          enabled={enabled && filterEnabled}
        />
        {showQ && (
          <KnobCell
            value={qToKnob(q)}
            label={['lowpass','highpass'].includes(selectedFilter) ? 'RES' : 'Q'}
            sub={q.toFixed(2)}
            onChange={updater('q', knobToQ)}
            color={Colors.metallicBrown.light ?? '#D4AF37'}
            enabled={enabled && filterEnabled}
          />
        )}
      </View>

      {/* Filter on/off */}
      <TouchableOpacity
        style={[styles.filterToggle, filterEnabled && styles.filterToggleOn, !enabled && styles.disabled]}
        onPress={() => { if (enabled) onUpdate({ filterEnabled: !filterEnabled }); }}
        activeOpacity={0.8}
      >
        <Text style={[styles.filterToggleText, filterEnabled && styles.filterToggleTextOn]}>
          {filterEnabled ? 'FILTER ON' : 'FILTER OFF'}
        </Text>
      </TouchableOpacity>

      {/* Filter type modal — semi-transparent View, no BlurView */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setFilterModalVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT FILTER TYPE</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color="#888" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={FILTERS}
              keyExtractor={f => f.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.filterOption, selectedFilter === item.id && styles.filterOptionActive]}
                  onPress={() => { onUpdate({ selectedFilter: item.id }); setFilterModalVisible(false); }}
                  activeOpacity={0.7}
                >
                  <View style={styles.filterOptLeft}>
                    <Text style={styles.filterOptIcon}>{item.icon}</Text>
                    <View>
                      <Text style={styles.filterOptName}>{item.name}</Text>
                      <Text style={styles.filterOptDesc}>{item.description}</Text>
                    </View>
                  </View>
                  {selectedFilter === item.id && (
                    <MaterialCommunityIcons name="check" size={18} color={Colors.metallicBrown.primary} />
                  )}
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingBottom: verticalScale(24) }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

function KnobCell({ value, label, sub, onChange, color, enabled }: {
  value: number; label: string; sub: string;
  onChange: (v: number) => void; color: string; enabled: boolean;
}) {
  return (
    <View style={styles.knobCell}>
      <RotaryKnob value={value} label={label} onChange={onChange} color={color} size={68} enabled={enabled} />
      <Text style={styles.knobSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: verticalScale(8) },
  disabled: { opacity: 0.5 },

  filterSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
    padding: scale(12), marginBottom: verticalScale(14),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  filterSelectorLeft: { flexDirection: 'row', alignItems: 'center', gap: scale(12), flex: 1 },
  filterIcon: { fontSize: moderateScale(22) },
  filterName: { color: '#fff', fontSize: moderateScale(15), fontWeight: '600' },
  filterCat: { color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(10), marginTop: 2 },

  graphContainer: {
    height: verticalScale(180),
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    position: 'relative', marginBottom: verticalScale(20),
    overflow: 'visible',
  },
  hLine: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dbLabel: {
    position: 'absolute', left: scale(4), top: -verticalScale(7),
    color: 'rgba(255,255,255,0.22)', fontSize: moderateScale(7),
  },
  zeroLine: {
    position: 'absolute', left: 0, right: 0, top: '50%',
    height: 1.5, backgroundColor: 'rgba(255,255,255,0.35)',
  },
  // Curve approximation without transformOrigin
  curveSeg: {
    position: 'absolute', height: 2,
    backgroundColor: Colors.metallicBrown.primary, opacity: 0.65,
  },
  dot: {
    position: 'absolute', width: scale(12), height: scale(12),
    borderRadius: 6, marginLeft: -scale(6), marginTop: -scale(6),
    backgroundColor: '#666', borderWidth: 1.5, borderColor: '#fff',
  },
  dotMid: {
    width: scale(18), height: scale(18), borderRadius: 9,
    marginLeft: -scale(9), marginTop: -scale(9),
    backgroundColor: Colors.metallicBrown.primary,
    shadowColor: Colors.metallicBrown.primary, shadowOpacity: 0.6, shadowRadius: 6,
  },
  dotTouch: { width: '100%', height: '100%' },
  freqLabels: {
    position: 'absolute', bottom: -verticalScale(18),
    left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: scale(4),
  },
  freqLabel: { color: 'rgba(255,255,255,0.25)', fontSize: moderateScale(8) },

  knobsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    alignItems: 'center', marginBottom: verticalScale(16),
  },
  knobCell: { alignItems: 'center' },
  knobSub: { color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(9), marginTop: verticalScale(3) },

  filterToggle: {
    alignSelf: 'center', paddingVertical: verticalScale(10), paddingHorizontal: scale(30),
    borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  filterToggleOn: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.secondary,
  },
  filterToggleText: { color: '#fff', fontSize: moderateScale(12), fontWeight: '600', letterSpacing: 0.5 },
  filterToggleTextOn: { color: '#000' },

  // Filter modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: scale(16), paddingTop: verticalScale(8),
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  modalHandle: {
    alignSelf: 'center', width: scale(36), height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: verticalScale(12),
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: verticalScale(16),
  },
  modalTitle: { color: '#fff', fontSize: moderateScale(15), fontWeight: '700', letterSpacing: 1 },
  modalClose: {
    width: scale(32), height: scale(32), borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  filterOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: verticalScale(12), paddingHorizontal: scale(12),
    borderRadius: 12, marginBottom: verticalScale(4),
  },
  filterOptionActive: { backgroundColor: 'rgba(139,115,85,0.18)' },
  filterOptLeft: { flexDirection: 'row', alignItems: 'center', gap: scale(12), flex: 1 },
  filterOptIcon: { fontSize: moderateScale(20) },
  filterOptName: { color: '#fff', fontSize: moderateScale(14), fontWeight: '600' },
  filterOptDesc: { color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(11), marginTop: 2 },
});