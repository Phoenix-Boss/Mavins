// ============================================================================
// APP/(MODALS)/EQUALIZER.TSX
// ============================================================================
// MAIN EQ PAGE - SINGLE SOURCE OF TRUTH FOR NATIVE MODULE CALLS
// All MavinPlayer native calls originate from this page only
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Text, TouchableOpacity, View, StyleSheet, Dimensions, Modal, ScrollView, Platform, TextInput, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/libs/supabase';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence, FadeIn } from 'react-native-reanimated';

import MavinPlayer from '@/modules/mavin-eq';
import { ProfessionalEQSlider } from '@/components/equalizer/ProfessionalEQSlider';
import { RotaryKnob } from '@/components/equalizer/RotaryKnob';
import { EQGraph } from '@/components/equalizer/EQGraph';
import { Watermark } from '@/components/equalizer/Watermark';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORAGE_KEY = 'eqState_v6';
const DEBOUNCE_MS = 600;

const FREQUENCY_BANDS = [
  { label: '31', bandIndex: 0 }, { label: '62', bandIndex: 1 }, { label: '125', bandIndex: 2 },
  { label: '250', bandIndex: 3 }, { label: '500', bandIndex: 4 }, { label: '1k', bandIndex: 5 },
  { label: '2k', bandIndex: 6 }, { label: '4k', bandIndex: 7 }, { label: '8k', bandIndex: 8 }, { label: '16k', bandIndex: 9 },
];

const BAND_MAP: [number, number][] = [
  [0, 1], [2, 3], [4, 6], [7, 9], [10, 13], [14, 17], [18, 21], [22, 25], [26, 29], [30, 30],
];

interface EQState {
  enabled: boolean;
  bands: number[];
  bass: number;
  treble: number;
  selectedPreset: string;
}

const DEFAULT_STATE: EQState = {
  enabled: true,
  bands: Array(10).fill(0),
  bass: 50,
  treble: 50,
  selectedPreset: 'Flat',
};

function sanitiseBands(raw: any[]): number[] {
  const out = Array(10).fill(0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < 10; i++) {
    const v = raw[i];
    out[i] = typeof v === 'number' && isFinite(v) ? Math.max(-15, Math.min(15, v)) : 0;
  }
  return out;
}

function uiBandsToNative31(bands: number[]): number[] {
  const native = Array(31).fill(0);
  bands.forEach((gain, uiIdx) => {
    const [start, end] = BAND_MAP[uiIdx] ?? [0, 0];
    for (let i = start; i <= end; i++) native[i] = gain;
  });
  return native;
}

export default function EqualizerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const eqToggleScale = useSharedValue(1);

  const [eqState, setEqState] = useState<EQState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = eqState.enabled && Platform.OS === 'android';

  // ── Apply all EQ bands to native ──────────────────────────────────────────
  const applyAllBandsToNative = useCallback(async (bands: number[]) => {
    if (!isActive) return;
    const nativeGains = uiBandsToNative31(bands);
    await MavinPlayer.applyEQBands(nativeGains).catch(e => console.warn('[EQ] applyEQBands failed:', e));
  }, [isActive]);

  // ── Apply single band to native ───────────────────────────────────────────
  const applyBandToNative = useCallback(async (uiIndex: number, gain: number) => {
    if (!isActive) return;
    const [start, end] = BAND_MAP[uiIndex] ?? [0, 0];
    const nativeGains = uiBandsToNative31(eqState.bands);
    for (let i = start; i <= end; i++) nativeGains[i] = gain;
    await MavinPlayer.applyEQBands(nativeGains).catch(e => console.warn('[EQ] applyBand failed:', e));
  }, [isActive, eqState.bands]);

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(json => {
      if (json) {
        try {
          const parsed = JSON.parse(json) as Partial<EQState>;
          setEqState(prev => ({
            ...prev,
            enabled: parsed.enabled ?? prev.enabled,
            bands: sanitiseBands(parsed.bands ?? []),
            bass: parsed.bass ?? prev.bass,
            treble: parsed.treble ?? prev.treble,
            selectedPreset: parsed.selectedPreset ?? prev.selectedPreset,
          }));
        } catch (e) { console.warn('Load error:', e); }
      }
    }).finally(() => setIsLoading(false));
  }, []);

  // ── Save state to storage (debounced) ─────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(eqState)).catch(() => {});
    }, DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [eqState, isLoading]);

  // ── Apply restored EQ to native on mount ──────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    applyAllBandsToNative(eqState.bands);
  }, [isLoading, applyAllBandsToNative]);

  // ── Handle band change (called from slider) ───────────────────────────────
  const handleBandChange = useCallback(async (uiIndex: number, value: number) => {
    setEqState(prev => ({
      ...prev,
      bands: prev.bands.map((v, i) => i === uiIndex ? value : v),
      selectedPreset: 'Custom',
    }));
    await applyBandToNative(uiIndex, value);
  }, [applyBandToNative]);

  // ── Handle bass change ────────────────────────────────────────────────────
  const handleBassChange = useCallback(async (knobId: string, value: number) => {
    const bassGain = (value - 50) / 50 * 8;
    setEqState(prev => ({ ...prev, bass: value, selectedPreset: 'Custom' }));
    if (!isActive) return;
    const newBands = [...eqState.bands];
    for (let i = 0; i < 4; i++) newBands[i] = bassGain;
    const nativeGains = uiBandsToNative31(newBands);
    await MavinPlayer.applyEQBands(nativeGains).catch(() => {});
  }, [isActive, eqState.bands]);

  // ── Handle treble change ──────────────────────────────────────────────────
  const handleTrebleChange = useCallback(async (knobId: string, value: number) => {
    const trebleGain = (value - 50) / 50 * 8;
    setEqState(prev => ({ ...prev, treble: value, selectedPreset: 'Custom' }));
    if (!isActive) return;
    const newBands = [...eqState.bands];
    for (let i = 6; i < 10; i++) newBands[i] = trebleGain;
    const nativeGains = uiBandsToNative31(newBands);
    await MavinPlayer.applyEQBands(nativeGains).catch(() => {});
  }, [isActive, eqState.bands]);

  // ── Handle preset selection ───────────────────────────────────────────────
  const handleSelectPreset = useCallback(async (preset: { name: string; bands: number[]; preamp: number; is_factory: boolean }) => {
    Haptics.selectionAsync();
    const newBands = sanitiseBands(preset.bands);
    setEqState(prev => ({ ...prev, bands: newBands, selectedPreset: preset.name }));
    await applyAllBandsToNative(newBands);
    setPresetModalVisible(false);
  }, [applyAllBandsToNative]);

  // ── Toggle EQ on/off ──────────────────────────────────────────────────────
  const toggleEQ = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    eqToggleScale.value = withSequence(withSpring(0.88, { damping: 10 }), withSpring(1, { damping: 15 }));
    const next = !eqState.enabled;
    setEqState(p => ({ ...p, enabled: next }));
    await MavinPlayer.setEQEnabled(next).catch(() => {});
  }, [eqState.enabled, eqToggleScale]);

  const eqToggleAnim = useAnimatedStyle(() => ({ transform: [{ scale: eqToggleScale.value }] }));

  const { enabled, bands, bass, treble, selectedPreset } = eqState;
  const safeBands = sanitiseBands(bands);

  const HEADER_H = insets.top + verticalScale(44);
  const BOTTOM_BAR_H = insets.bottom + verticalScale(56);

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.loadingText}>Loading Equalizer…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient style={StyleSheet.absoluteFill} colors={['#0a0908', '#141210', '#0a0908']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />
      <Watermark source={require('@/assets/images/mavins.png')} />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + verticalScale(4) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-down" size={moderateScale(26)} color="rgba(220,200,160,0.9)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerCenter} onPress={() => setPresetModalVisible(true)}>
          <Text style={styles.headerTitle}>EQUALIZER</Text>
          <View style={styles.presetRow}>
            <Text style={styles.presetName} numberOfLines={1}>{selectedPreset}</Text>
            <MaterialCommunityIcons name="chevron-down" size={12} color="rgba(200,170,110,0.7)" />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.modeBtn} onPress={() => {}}>
          <Text style={styles.modeBtnText}>GRAPHIC</Text>
        </TouchableOpacity>
      </View>

      {/* SCROLL CONTENT */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingTop: HEADER_H, paddingBottom: BOTTOM_BAR_H + verticalScale(8) }]} showsVerticalScrollIndicator={false}>
        {Platform.OS !== 'android' && (
          <Animated.View entering={FadeIn} style={styles.sessionBanner}>
            <Ionicons name="information-circle-outline" size={13} color="#f0a030" />
            <Text style={styles.sessionBannerText}>EQ is available on Android only</Text>
          </Animated.View>
        )}

        {/* EQ Graph */}
        <View style={styles.graphWrap}>
          <EQGraph bandValues={safeBands} enabled={isActive} style={styles.eqGraph} />
          <View style={styles.graphOverlayLabel}>
            <View style={[styles.eqStatusDot, { backgroundColor: isActive ? '#4cde80' : '#555' }]} />
            <Text style={styles.graphLabel}>{isActive ? 'ACTIVE' : 'BYPASSED'}</Text>
          </View>
        </View>

        {/* Sliders Section */}
        <View style={styles.slidersSection}>
          <View style={styles.dbScale}>
            {['+15', '+6', '0', '-6', '-15'].map(v => (<Text key={v} style={styles.dbMark}>{v}</Text>))}
          </View>
          <View style={styles.slidersRow}>
            {FREQUENCY_BANDS.map((band, idx) => (
              <ProfessionalEQSlider
                key={band.label}
                bandIndex={idx}
                frequencyLabel={band.label}
                value={safeBands[idx]}
                enabled={isActive}
                onValueChange={handleBandChange}
              />
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Bass/Treble Knobs */}
        <View style={styles.knobsRow}>
          <View style={styles.knobCell}>
            <RotaryKnob knobId="bass" value={bass} label="BASS" size={scale(72)} enabled={isActive} onValueChange={handleBassChange} />
          </View>
          <View style={styles.knobCenter}>
            <TouchableOpacity style={styles.presetCenterBtn} onPress={() => setPresetModalVisible(true)}>
              <MaterialCommunityIcons name="music-note-outline" size={14} color={Colors.metallicBrown.primary} />
              <Text style={styles.presetCenterText} numberOfLines={1}>{selectedPreset}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => setSaveModalVisible(true)}>
              <MaterialCommunityIcons name="content-save-outline" size={13} color="#888" />
              <Text style={styles.saveBtnText}>SAVE</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.knobCell}>
            <RotaryKnob knobId="treble" value={treble} label="TREBLE" size={scale(72)} enabled={isActive} onValueChange={handleTrebleChange} />
          </View>
        </View>
      </ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + verticalScale(6) }]}>
        <View style={styles.bottomTopBorder} />
        <View style={styles.bottomRow}>
          <TouchableOpacity style={styles.bottomSideBtn} onPress={() => {}}>
            <MaterialCommunityIcons name="magic-staff" size={moderateScale(20)} color="#888" />
            <Text style={styles.bottomSideBtnText}>FX</Text>
          </TouchableOpacity>
          <Animated.View style={eqToggleAnim}>
            <TouchableOpacity style={[styles.eqToggle, enabled && styles.eqToggleOn]} onPress={toggleEQ} activeOpacity={0.8} disabled={Platform.OS !== 'android'}>
              <MaterialCommunityIcons name="power" size={moderateScale(22)} color={enabled ? '#0a0908' : 'rgba(200,180,140,0.5)'} />
              <Text style={[styles.eqToggleText, enabled && styles.eqToggleTextOn]}>{enabled ? 'EQ ON' : 'EQ OFF'}</Text>
              {enabled && <View style={styles.eqGlow} />}
            </TouchableOpacity>
          </Animated.View>
          <TouchableOpacity style={styles.bottomSideBtn} onPress={() => {}}>
            <MaterialCommunityIcons name="tune-vertical" size={moderateScale(20)} color="#888" />
            <Text style={styles.bottomSideBtnText}>TONE</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Preset Modal */}
      <PresetModal visible={presetModalVisible} onClose={() => setPresetModalVisible(false)} selectedPreset={selectedPreset} onSelectPreset={handleSelectPreset} insets={insets} />

      {/* Save Preset Modal */}
      <SavePresetModal visible={saveModalVisible} onClose={() => setSaveModalVisible(false)} bands={safeBands} preamp={0} onSaved={name => { setEqState(p => ({ ...p, selectedPreset: name })); setSaveModalVisible(false); }} insets={insets} />
    </View>
  );
}

// ── PresetModal Component ──────────────────────────────────────────────────────
const CUSTOM_PRESETS_KEY = 'eqCustomPresets_v5';

interface PresetItem { id: string; name: string; bands: number[]; preamp: number; is_factory: boolean; }

const FACTORY_PRESETS: PresetItem[] = [
  { id: 'flat', name: 'Flat', bands: Array(10).fill(0), preamp: 0, is_factory: true },
  { id: 'bass', name: 'Bass Boost', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -2, is_factory: true },
  { id: 'treble', name: 'Treble Boost', bands: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6], preamp: -2, is_factory: true },
  { id: 'vshape', name: 'V-Shape', bands: [5, 4, 2, 0, -2, -3, -2, 0, 3, 5], preamp: -3, is_factory: true },
  { id: 'rock', name: 'Rock', bands: [4, 3, 2, 0, -1, -2, -1, 1, 3, 4], preamp: -2, is_factory: true },
];

const PresetModal: React.FC<{ visible: boolean; onClose: () => void; selectedPreset: string; onSelectPreset: (preset: PresetItem) => void; insets: { bottom: number } }> = ({ visible, onClose, selectedPreset, onSelectPreset, insets }) => {
  const [customPresets, setCustomPresets] = useState<PresetItem[]>([]);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(CUSTOM_PRESETS_KEY).then(saved => {
      if (saved) setCustomPresets(JSON.parse(saved));
    });
  }, [visible]);

  const allPresets = [...FACTORY_PRESETS, ...customPresets];

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="slide">
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.sheet, { paddingBottom: insets.bottom + scale(16) }]}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>PRESETS</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#888" /></TouchableOpacity>
          </View>
          <FlatList data={allPresets} keyExtractor={p => p.id} renderItem={({ item }) => (
            <TouchableOpacity style={[modalStyles.item, selectedPreset === item.name && modalStyles.itemActive]} onPress={() => onSelectPreset(item)}>
              <Text style={[modalStyles.itemName, selectedPreset === item.name && modalStyles.itemNameActive]}>{item.name}</Text>
              {selectedPreset === item.name && <Ionicons name="checkmark" size={18} color="#c8a464" />}
            </TouchableOpacity>
          )} contentContainerStyle={modalStyles.list} />
        </View>
      </View>
    </Modal>
  );
};

const SavePresetModal: React.FC<{ visible: boolean; onClose: () => void; bands: number[]; preamp: number; onSaved: (name: string) => void; insets: { bottom: number } }> = ({ visible, onClose, bands, preamp, onSaved, insets }) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Name required', 'Enter a preset name.'); return; }
    setSaving(true);
    try {
      const existing = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      await AsyncStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify([...list.filter((p: any) => p.name !== trimmed), { id: `c${Date.now()}`, name: trimmed, bands, preamp, is_factory: false }]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(trimmed);
      setName('');
    } catch (e: any) { Alert.alert('Save failed', e?.message ?? 'Unknown error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="fade">
      <View style={saveStyles.overlay}>
        <View style={[saveStyles.card, { marginBottom: insets.bottom + scale(20) }]}>
          <Text style={saveStyles.title}>Save Preset</Text>
          <TextInput style={saveStyles.textInput} placeholder="Preset name" placeholderTextColor="#555" value={name} onChangeText={setName} autoFocus />
          <View style={saveStyles.btns}>
            <TouchableOpacity style={saveStyles.btnCancel} onPress={onClose}><Text style={saveStyles.btnCancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[saveStyles.btnSave, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}><Text style={saveStyles.btnSaveText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// Styles
const GOLD = Colors.metallicBrown.primary;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0908' },
  loadingScreen: { flex: 1, backgroundColor: '#0a0908', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#666', fontSize: moderateScale(13) },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 200, flexDirection: 'row', alignItems: 'center', paddingHorizontal: scale(10), paddingBottom: verticalScale(10), backgroundColor: 'rgba(10,9,8,0.96)', borderBottomWidth: 1, borderBottomColor: `${GOLD}33` },
  backBtn: { padding: scale(8), width: scale(40) },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#e8d9c0', fontSize: moderateScale(13), fontWeight: '800', letterSpacing: 2 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: scale(4), marginTop: verticalScale(2) },
  presetName: { color: GOLD, fontSize: moderateScale(11), fontWeight: '600', maxWidth: scale(150) },
  modeBtn: { paddingHorizontal: scale(10), paddingVertical: verticalScale(5), backgroundColor: 'rgba(139,115,85,0.12)', borderRadius: 12, borderWidth: 1, borderColor: `${GOLD}44`, width: scale(68), alignItems: 'center' },
  modeBtnText: { color: GOLD, fontSize: moderateScale(9), fontWeight: '800', letterSpacing: 0.5 },
  scrollContent: { paddingHorizontal: scale(8) },
  sessionBanner: { flexDirection: 'row', alignItems: 'center', gap: scale(8), backgroundColor: 'rgba(240,160,48,0.1)', borderWidth: 1, borderColor: 'rgba(240,160,48,0.3)', borderRadius: 8, paddingHorizontal: scale(12), paddingVertical: verticalScale(7), marginBottom: verticalScale(8) },
  sessionBannerText: { flex: 1, color: '#f0a030', fontSize: moderateScale(10), fontWeight: '600' },
  graphWrap: { marginBottom: verticalScale(4), borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: `${GOLD}22`, position: 'relative' },
  eqGraph: { marginVertical: 0 },
  graphOverlayLabel: { position: 'absolute', top: verticalScale(6), right: scale(10), flexDirection: 'row', alignItems: 'center', gap: scale(4), backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: scale(7), paddingVertical: verticalScale(3) },
  eqStatusDot: { width: scale(5), height: scale(5), borderRadius: 3 },
  graphLabel: { color: 'rgba(255,255,255,0.5)', fontSize: moderateScale(8), fontWeight: '700', letterSpacing: 0.5 },
  slidersSection: { flexDirection: 'row', alignItems: 'stretch', marginBottom: verticalScale(4), paddingHorizontal: scale(2) },
  dbScale: { width: scale(22), justifyContent: 'space-between', paddingVertical: verticalScale(14), alignItems: 'flex-end', paddingRight: scale(4) },
  dbMark: { color: 'rgba(200,180,140,0.35)', fontSize: moderateScale(7), fontWeight: '600', fontFamily: 'monospace' },
  slidersRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  divider: { height: 1, backgroundColor: `${GOLD}2a`, marginHorizontal: scale(8), marginVertical: verticalScale(8) },
  knobsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: scale(8), paddingBottom: verticalScale(8) },
  knobCell: { alignItems: 'center' },
  knobCenter: { alignItems: 'center', gap: verticalScale(8) },
  presetCenterBtn: { flexDirection: 'row', alignItems: 'center', gap: scale(5), paddingHorizontal: scale(12), paddingVertical: verticalScale(6), backgroundColor: 'rgba(139,115,85,0.12)', borderRadius: 14, borderWidth: 1, borderColor: `${GOLD}40`, maxWidth: scale(130) },
  presetCenterText: { color: GOLD, fontSize: moderateScale(11), fontWeight: '700', maxWidth: scale(100) },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: scale(4), paddingHorizontal: scale(10), paddingVertical: verticalScale(4), backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  saveBtnText: { color: '#777', fontSize: moderateScale(9), fontWeight: '700', letterSpacing: 0.5 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 300, backgroundColor: 'rgba(10,9,8,0.97)' },
  bottomTopBorder: { height: 1, backgroundColor: `${GOLD}44` },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: scale(20), paddingTop: verticalScale(10) },
  bottomSideBtn: { alignItems: 'center', gap: verticalScale(3), padding: scale(8), width: scale(56) },
  bottomSideBtnText: { color: '#777', fontSize: moderateScale(9), fontWeight: '700', letterSpacing: 0.5 },
  eqToggle: { flexDirection: 'row', alignItems: 'center', gap: scale(7), paddingHorizontal: scale(22), paddingVertical: verticalScale(13), borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', minWidth: scale(130), justifyContent: 'center' },
  eqToggleOn: { backgroundColor: GOLD, borderColor: '#c8a464', shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, elevation: 12 },
  eqToggleText: { color: 'rgba(200,180,140,0.55)', fontSize: moderateScale(12), fontWeight: '800', letterSpacing: 1 },
  eqToggleTextOn: { color: '#0a0908' },
  eqGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: GOLD, opacity: 0.15 },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111009', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: scale(16), paddingTop: verticalScale(12), maxHeight: '70%' },
  handle: { alignSelf: 'center', width: scale(36), height: 4, borderRadius: 2, backgroundColor: `${GOLD}44`, marginBottom: verticalScale(12) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: verticalScale(12) },
  title: { color: '#e8d9c0', fontSize: moderateScale(16), fontWeight: '800', letterSpacing: 1.5 },
  list: { paddingBottom: verticalScale(16) },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: scale(14), borderRadius: 10, marginBottom: verticalScale(6), backgroundColor: '#1a1816' },
  itemActive: { backgroundColor: 'rgba(200,164,100,0.15)', borderWidth: 1, borderColor: `${GOLD}44` },
  itemName: { color: '#e8d9c0', fontSize: moderateScale(14), fontWeight: '500' },
  itemNameActive: { color: GOLD, fontWeight: '700' },
});

const saveStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  card: { width: SCREEN_WIDTH * 0.85, backgroundColor: '#1a1816', borderRadius: 16, padding: scale(20), borderWidth: 1, borderColor: `${GOLD}44` },
  title: { color: '#e8d9c0', fontSize: moderateScale(17), fontWeight: '800', marginBottom: verticalScale(14) },
  textInput: { backgroundColor: '#2a2826', borderRadius: 10, paddingHorizontal: scale(14), height: verticalScale(46), color: '#fff', fontSize: moderateScale(15), marginBottom: verticalScale(14), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  btns: { flexDirection: 'row', gap: scale(10) },
  btnCancel: { flex: 1, height: verticalScale(44), borderRadius: 10, backgroundColor: '#2a2826', justifyContent: 'center', alignItems: 'center' },
  btnCancelText: { color: '#aaa', fontSize: moderateScale(14), fontWeight: '600' },
  btnSave: { flex: 1, height: verticalScale(44), borderRadius: 10, backgroundColor: GOLD, justifyContent: 'center', alignItems: 'center' },
  btnSaveText: { color: '#0a0908', fontSize: moderateScale(14), fontWeight: '800' },
});