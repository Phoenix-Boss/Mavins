// app/(modals)/equalizer.tsx
//
// UPDATED FOR MAVIN-PLAYER:
//   - All mavin-eq imports removed (useEqualizer, getAudioSessionId, setupEQAuto, getMixerSessionId)
//   - All audioSessionId / mixerReady / sessionError state removed
//   - useEqualizer hook replaced with useMavinPlayer() which exposes setEQBand / applyEQBands
//   - isActive now derives purely from player state — no session check needed
//   - EQ works from the first frame because the AudioProcessor is inside ExoPlayer

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text, TouchableOpacity, View, StyleSheet, Dimensions,
  Modal, ScrollView, Platform, TextInput, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/libs/supabase';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withSequence, FadeIn,
} from 'react-native-reanimated';

// ── MavinPlayer replaces mavin-eq ──────────────────────────────────────────
import MavinPlayer, { useMavinPlayer, ISO_FREQ_CENTERS } from "@/modules/mavin-player";

import { ProfessionalEQSlider } from '@/components/equalizer/ProfessionalEQSlider';
import { RotaryKnob } from '@/components/equalizer/RotaryKnob';
import { EQGraph } from '@/components/equalizer/EQGraph';
import { Watermark } from '@/components/equalizer/Watermark';
import { FXControls } from '@/components/equalizer/FXControls';
import { MasteringControls } from '@/components/equalizer/MasteringControls';
import { ParametricEQ } from '@/components/equalizer/parametricEq';
import { PresetModal } from '@/components/equalizer/PresetDisplay';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORAGE_KEY  = 'eqState_v5';
const DEBOUNCE_MS  = 600;

const FREQUENCY_BANDS = [
  { label: '31',  frequency: 31 },
  { label: '62',  frequency: 62 },
  { label: '125', frequency: 125 },
  { label: '250', frequency: 250 },
  { label: '500', frequency: 500 },
  { label: '1k',  frequency: 1000 },
  { label: '2k',  frequency: 2000 },
  { label: '4k',  frequency: 4000 },
  { label: '8k',  frequency: 8000 },
  { label: '16k', frequency: 16000 },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface BandBypass { bypassed: boolean; soloed: boolean; muted: boolean }
interface FXState {
  mode: 'reverb'|'delay'|'chorus'|'flanger'|'phaser';
  roomSize: number; decay: number; preDelay: number; damping: number;
  delayTime: number; feedback: number; lowCut: number; highCut: number;
  rate: number; depth: number; phase: number; mix: number; bypass: boolean;
}
interface MasteringState {
  balance: number; stereoWidth: number; loudness: number;
  limiter: boolean; mono: boolean;
  limiterThreshold: number; truePeak: number; gainReduction: number;
}
interface ParametricState {
  selectedFilter: 'lowpass'|'highpass'|'bandpass'|'lowshelf'|'highshelf'|'peaking'|'notch';
  filterEnabled: boolean; gain: number; frequency: number; q: number;
}
interface EQState {
  enabled: boolean;
  graphic: { preamp: number; bands: number[]; bass: number; treble: number };
  bandBypass: BandBypass[];
  parametric: ParametricState;
  fx: FXState;
  mastering: MasteringState;
  selectedPreset: string;
  presetType: 'factory'|'custom';
}

const defaultBandBypass = (): BandBypass[] =>
  Array(10).fill(null).map(() => ({ bypassed: false, soloed: false, muted: false }));

const DEFAULT_STATE: EQState = {
  enabled: true,
  graphic: { preamp: 0, bands: Array(10).fill(0), bass: 50, treble: 50 },
  bandBypass: defaultBandBypass(),
  parametric: { selectedFilter: 'peaking', filterEnabled: false, gain: 0, frequency: 1000, q: 1.0 },
  fx: {
    mode: 'reverb', roomSize: 60, decay: 40, preDelay: 10, damping: 50,
    delayTime: 30, feedback: 40, lowCut: 20, highCut: 80,
    rate: 30, depth: 40, phase: 50, mix: 30, bypass: false,
  },
  mastering: {
    balance: 50, stereoWidth: 50, loudness: 50,
    limiter: false, mono: false,
    limiterThreshold: -6, truePeak: -12, gainReduction: 0,
  },
  selectedPreset: 'Flat',
  presetType: 'factory',
};

function sanitiseBands(raw: any[]): number[] {
  const out = Array(10).fill(0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < 10; i++) {
    const v = raw[i];
    out[i] = typeof v === 'number' && isFinite(v) ? v : 0;
  }
  return out;
}

// Maps 10 UI bands → 31 ISO bands
const BAND_MAP: [number, number][] = [
  [0,1],[2,3],[4,6],[7,9],[10,13],[14,17],[18,21],[22,25],[26,29],[30,30],
];

// ── EqualizerScreen ───────────────────────────────────────────────────────────
export default function EqualizerScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const player  = useMavinPlayer();         // ← replaces useEqualizer
  const eqToggleScale = useSharedValue(1);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [eqState,               setEqState              ] = useState<EQState>(DEFAULT_STATE);
  const [isLoading,              setIsLoading            ] = useState(true);
  const [eqMode,                 setEqMode               ] = useState<'graphic'|'parametric'>('graphic');
  const [fxModalVisible,         setFxModalVisible       ] = useState(false);
  const [masteringModalVisible,  setMasteringModalVisible] = useState(false);
  const [presetModalVisible,     setPresetModalVisible   ] = useState(false);
  const [saveModalVisible,       setSaveModalVisible     ] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── isActive ──────────────────────────────────────────────────────────────
  // EQ is always available — the AudioProcessor is inside ExoPlayer from boot.
  // No session IDs, no mixer checks. Active as long as EQ is enabled.
  // On iOS we disable since MavinPlayer is Android-only.
  const isActive = eqState.enabled && Platform.OS === 'android';

  // ── Persistence: load ─────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(json => {
      if (json) {
        try {
          const parsed = JSON.parse(json) as Partial<EQState>;
          setEqState(prev => ({
            ...prev, ...parsed,
            graphic: {
              ...DEFAULT_STATE.graphic,
              ...(parsed.graphic ?? {}),
              bands: sanitiseBands(parsed.graphic?.bands ?? []),
            },
            bandBypass: parsed.bandBypass ?? defaultBandBypass(),
          }));
        } catch (e) { console.warn('Load error:', e); }
      }
    }).finally(() => setIsLoading(false));
  }, []);

  // ── Persistence: save (debounced) ─────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(eqState)).catch(() => {});
    }, DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [eqState, isLoading]);

  // ── Apply restored EQ to native on load ───────────────────────────────────
  // When the screen mounts and we've loaded saved state, push it to the processor.
  useEffect(() => {
    if (isLoading || !isActive) return;
    const gains = Array(31).fill(0);
    eqState.graphic.bands.forEach((gain, ui) => {
      const [start, end] = BAND_MAP[ui] ?? [0, 0];
      for (let i = start; i <= end; i++) gains[i] = gain;
    });
    MavinPlayer.applyEQBands(gains).catch(() => {});
  }, [isLoading]); // only on mount after load

  // ── Helpers ───────────────────────────────────────────────────────────────
  const detach = (prev: EQState) =>
    prev.presetType === 'factory'
      ? { selectedPreset: 'Custom', presetType: 'custom' as const }
      : {};

  // ── Band change ───────────────────────────────────────────────────────────
  const handleBandChange = useCallback(async (index: number, value: number) => {
    setEqState(prev => ({
      ...prev, ...detach(prev),
      graphic: { ...prev.graphic, bands: prev.graphic.bands.map((v, i) => i === index ? value : v) },
    }));

    if (!isActive) return;

    // Map UI band → native 31-band gains
    const [start, end] = BAND_MAP[index];
    const nativeGains = Array(31).fill(null).map((_, i) => {
      const uiBand = BAND_MAP.findIndex(([s, e]) => i >= s && i <= e);
      return eqState.graphic.bands[uiBand] ?? 0;
    });
    for (let i = start; i <= end; i++) nativeGains[i] = value;

    try { await MavinPlayer.applyEQBands(nativeGains); }
    catch (e) { console.warn('[EQ] applyEQBands failed:', e); }
  }, [isActive, eqState.graphic.bands]);

  const handleBassChange = useCallback((v: number) => {
    setEqState(p => ({ ...p, ...detach(p), graphic: { ...p.graphic, bass: v } }));
    if (!isActive) return;
    const bassGain = (v - 50) * 0.24;
    const gains = Array(31).fill(0);
    for (let i = 0; i < 8; i++) gains[i] = bassGain;
    MavinPlayer.applyEQBands(gains).catch(() => {});
  }, [isActive]);

  const handleTrebleChange = useCallback((v: number) => {
    setEqState(p => ({ ...p, ...detach(p), graphic: { ...p.graphic, treble: v } }));
    if (!isActive) return;
    const trebleGain = (v - 50) * 0.24;
    const gains = Array(31).fill(0);
    for (let i = 23; i < 31; i++) gains[i] = trebleGain;
    MavinPlayer.applyEQBands(gains).catch(() => {});
  }, [isActive]);

  const handleFXUpdate         = useCallback((u: Partial<FXState>)        => setEqState(p => ({ ...p, fx: { ...p.fx, ...u } })), []);
  const handleMasteringUpdate  = useCallback((u: Partial<MasteringState>) => setEqState(p => ({ ...p, mastering: { ...p.mastering, ...u } })), []);
  const handleParametricUpdate = useCallback((u: Partial<ParametricState>) =>
    setEqState(p => ({ ...p, ...detach(p), parametric: { ...p.parametric, ...u } })), []);

  const handleBandBypass = useCallback((i: number) =>
    setEqState(p => {
      const bb = [...p.bandBypass];
      bb[i] = { ...bb[i], bypassed: !bb[i].bypassed };
      return { ...p, bandBypass: bb };
    }), []);

  const handleSelectPreset = useCallback(async (preset: {
    name: string; bands: number[]; preamp: number; is_factory: boolean;
  }) => {
    Haptics.selectionAsync();
    const result = Array(31).fill(0);
    preset.bands.forEach((gain, i) => {
      const [start, end] = BAND_MAP[i] ?? [0, 0];
      for (let j = start; j <= end; j++) result[j] = gain;
    });
    if (isActive) {
      await MavinPlayer.applyEQBands(result).catch(e => console.warn('[EQ] applyPreset failed:', e));
    }
    setEqState(prev => ({
      ...prev, enabled: true,
      graphic: { ...prev.graphic, preamp: preset.preamp ?? 0, bands: sanitiseBands(preset.bands) },
      selectedPreset: preset.name,
      presetType: preset.is_factory ? 'factory' : 'custom',
    }));
    setPresetModalVisible(false);
  }, [isActive]);

  const toggleEQ = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    eqToggleScale.value = withSequence(
      withSpring(0.88, { damping: 10 }),
      withSpring(1,    { damping: 15 }),
    );
    const next = !eqState.enabled;
    setEqState(p => ({ ...p, enabled: next }));
    await MavinPlayer.setEQEnabled(next).catch(() => {});
  }, [eqState.enabled, eqToggleScale]);

  const eqToggleAnim = useAnimatedStyle(() => ({
    transform: [{ scale: eqToggleScale.value }],
  }));

  // ── Derived ───────────────────────────────────────────────────────────────
  const { enabled, graphic, parametric, fx, mastering, selectedPreset, bandBypass } = eqState;
  const safeBands  = sanitiseBands(graphic.bands);
  const safePreamp = typeof graphic.preamp === 'number' && isFinite(graphic.preamp) ? graphic.preamp : 0;

  const HEADER_H     = insets.top + verticalScale(44);
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
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={['#0a0908', '#141210', '#0a0908']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
      />
      <Watermark source={require('@/assets/images/mavins.png')} />

      {/* ── HEADER ───────────────────────────────────────────────────────── */}
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
        <TouchableOpacity
          style={styles.modeBtn}
          onPress={() => { Haptics.selectionAsync(); setEqMode(m => m === 'graphic' ? 'parametric' : 'graphic'); }}
        >
          <Text style={styles.modeBtnText}>{eqMode === 'graphic' ? 'GRAPHIC' : 'PARAM'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── SCROLL ───────────────────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: HEADER_H, paddingBottom: BOTTOM_BAR_H + verticalScale(8) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* iOS banner */}
        {Platform.OS !== 'android' && (
          <Animated.View entering={FadeIn} style={styles.sessionBanner}>
            <Ionicons name="information-circle-outline" size={13} color="#f0a030" />
            <Text style={styles.sessionBannerText}>EQ is available on Android only</Text>
          </Animated.View>
        )}

        {eqMode === 'graphic' ? (
          <>
            <View style={styles.graphWrap}>
              <EQGraph values={safeBands} enabled={isActive} style={styles.eqGraph} />
              <View style={styles.graphOverlayLabel}>
                <View style={[styles.eqStatusDot, { backgroundColor: isActive ? '#4cde80' : '#555' }]} />
                <Text style={styles.graphLabel}>{isActive ? 'ACTIVE' : 'BYPASSED'}</Text>
              </View>
            </View>

            <View style={styles.slidersSection}>
              <View style={styles.dbScale}>
                {['+15', '+6', '0', '-6', '-15'].map(v => (
                  <Text key={v} style={styles.dbMark}>{v}</Text>
                ))}
              </View>
              <View style={styles.slidersRow}>
                {FREQUENCY_BANDS.map((band, index) => (
                  <ProfessionalEQSlider
                    key={band.label}
                    value={safeBands[index]}
                    onChange={val => handleBandChange(index, val)}
                    label={band.label}
                    enabled={isActive}
                    bypassed={bandBypass[index]?.bypassed ?? false}
                    onBypass={() => handleBandBypass(index)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.knobsRow}>
              <View style={styles.knobCell}>
                <RotaryKnob value={graphic.bass} label="BASS" onChange={handleBassChange}
                  color={Colors.metallicBrown.primary} size={scale(72)} enabled={isActive} />
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
                <RotaryKnob value={graphic.treble} label="TREBLE" onChange={handleTrebleChange}
                  color={Colors.metallicBrown.secondary} size={scale(72)} enabled={isActive} />
              </View>
            </View>
          </>
        ) : (
          <ParametricEQ enabled={isActive} parametricState={parametric} onUpdate={handleParametricUpdate} />
        )}
      </ScrollView>

      {/* ── BOTTOM BAR ───────────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + verticalScale(6) }]}>
        <View style={styles.bottomTopBorder} />
        <View style={styles.bottomRow}>
          <TouchableOpacity style={styles.bottomSideBtn} onPress={() => { Haptics.selectionAsync(); setFxModalVisible(true); }}>
            <MaterialCommunityIcons name="magic-staff" size={moderateScale(20)} color="#888" />
            <Text style={styles.bottomSideBtnText}>FX</Text>
          </TouchableOpacity>

          <Animated.View style={eqToggleAnim}>
            <TouchableOpacity
              style={[styles.eqToggle, enabled && styles.eqToggleOn]}
              onPress={toggleEQ}
              activeOpacity={0.8}
              disabled={Platform.OS !== 'android'}
            >
              <MaterialCommunityIcons name="power" size={moderateScale(22)}
                color={enabled ? '#0a0908' : 'rgba(200,180,140,0.5)'} />
              <Text style={[styles.eqToggleText, enabled && styles.eqToggleTextOn]}>
                {enabled ? 'EQ  ON' : 'EQ  OFF'}
              </Text>
              {enabled && <View style={styles.eqGlow} />}
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity style={styles.bottomSideBtn} onPress={() => { Haptics.selectionAsync(); setMasteringModalVisible(true); }}>
            <MaterialCommunityIcons name="tune-vertical" size={moderateScale(20)} color="#888" />
            <Text style={styles.bottomSideBtnText}>TONE</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── MODALS ───────────────────────────────────────────────────────── */}
      <Modal animationType="slide" transparent visible={fxModalVisible} onRequestClose={() => setFxModalVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(8) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>FX PROCESSOR</Text>
              <TouchableOpacity style={styles.sheetClose} onPress={() => setFxModalVisible(false)}>
                <Ionicons name="close" size={18} color="#888" />
              </TouchableOpacity>
            </View>
            <FXControls enabled={isActive} fxState={fx} onUpdate={handleFXUpdate} />
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={masteringModalVisible} onRequestClose={() => setMasteringModalVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(8) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>TONE CONTROLS</Text>
              <TouchableOpacity style={styles.sheetClose} onPress={() => setMasteringModalVisible(false)}>
                <Ionicons name="close" size={18} color="#888" />
              </TouchableOpacity>
            </View>
            <MasteringControls enabled={isActive} masteringState={mastering} onUpdate={handleMasteringUpdate} />
          </View>
        </View>
      </Modal>

      <PresetModal
        visible={presetModalVisible} onClose={() => setPresetModalVisible(false)}
        selectedPreset={selectedPreset} onSelectPreset={handleSelectPreset} insets={insets}
      />

      <SavePresetModal
        visible={saveModalVisible} onClose={() => setSaveModalVisible(false)}
        bands={safeBands} preamp={safePreamp}
        onSaved={name => { setEqState(p => ({ ...p, selectedPreset: name, presetType: 'custom' })); setSaveModalVisible(false); }}
        insets={insets}
      />
    </View>
  );
}

// ── SavePresetModal ───────────────────────────────────────────────────────────
const CUSTOM_PRESETS_KEY = 'eqCustomPresets_v5';

function SavePresetModal({ visible, onClose, bands, preamp, onSaved, insets }: {
  visible: boolean; onClose: () => void; bands: number[]; preamp: number;
  onSaved: (name: string) => void; insets: { bottom: number };
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Name required', 'Enter a preset name.'); return; }
    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        await supabase.from('eq_presets').upsert({
          user_id: authData.user.id, name: trimmed,
          type: 'graphic_31band', gains_31: bands, preamp_db: preamp,
        }, { onConflict: 'user_id,name' });
      }
      const existing = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      await AsyncStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify([
        ...list.filter((p: any) => p.name !== trimmed),
        { id: `c${Date.now()}`, name: trimmed, bands, preamp, is_factory: false, category: 'user', display_order: list.length },
      ]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(trimmed);
      setName('');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={saveStyles.overlay}>
        <View style={[saveStyles.card, { marginBottom: insets.bottom + scale(20) }]}>
          <Text style={saveStyles.title}>Save Preset</Text>
          <TextInput style={saveStyles.textInput} placeholder="Preset name" placeholderTextColor="#555"
            value={name} onChangeText={setName} autoFocus maxLength={40} returnKeyType="done" onSubmitEditing={handleSave} />
          <View style={saveStyles.preview}>
            {bands.map((v, i) => (
              <View key={i} style={[saveStyles.previewBar, {
                height: Math.abs((v ?? 0) * 2) + 2,
                backgroundColor: (v ?? 0) > 0 ? Colors.metallicBrown.primary : '#444',
              }]} />
            ))}
          </View>
          <View style={saveStyles.btns}>
            <TouchableOpacity style={saveStyles.btnCancel} onPress={onClose}>
              <Text style={saveStyles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[saveStyles.btnSave, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              <Text style={saveStyles.btnSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const GOLD  = Colors.metallicBrown.primary;
const GOLD2 = Colors.metallicBrown.secondary;

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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111009', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: scale(16), paddingTop: verticalScale(12), maxHeight: SCREEN_HEIGHT * 0.85, borderTopWidth: 1, borderColor: `${GOLD}33` },
  sheetHandle: { alignSelf: 'center', width: scale(36), height: 4, borderRadius: 2, backgroundColor: `${GOLD}44`, marginBottom: verticalScale(12) },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: verticalScale(14), paddingBottom: verticalScale(10), borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sheetTitle: { color: '#e8d9c0', fontSize: moderateScale(15), fontWeight: '800', letterSpacing: 0.8 },
  sheetClose: { padding: scale(6) },
});

const saveStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: verticalScale(40) },
  card: { width: SCREEN_WIDTH * 0.9, backgroundColor: '#131110', borderRadius: 16, padding: scale(20), borderWidth: 1, borderColor: `${Colors.metallicBrown.primary}44` },
  title: { color: '#e8d9c0', fontSize: moderateScale(17), fontWeight: '800', marginBottom: verticalScale(14) },
  textInput: { backgroundColor: '#1e1c1a', borderRadius: 10, paddingHorizontal: scale(14), height: verticalScale(46), color: '#fff', fontSize: moderateScale(15), marginBottom: verticalScale(14), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  preview: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: verticalScale(36), marginBottom: verticalScale(14), paddingHorizontal: scale(4) },
  previewBar: { flex: 1, marginHorizontal: 1, borderRadius: 1 },
  btns: { flexDirection: 'row', gap: scale(10) },
  btnCancel: { flex: 1, height: verticalScale(44), borderRadius: 10, backgroundColor: '#2a2826', justifyContent: 'center', alignItems: 'center' },
  btnCancelText: { color: '#aaa', fontSize: moderateScale(14), fontWeight: '600' },
  btnSave: { flex: 1, height: verticalScale(44), borderRadius: 10, backgroundColor: Colors.metallicBrown.primary, justifyContent: 'center', alignItems: 'center' },
  btnSaveText: { color: '#0a0908', fontSize: moderateScale(14), fontWeight: '800' },
});