// app/(modals)/equalizer.tsx
//
// Architecture:
//  - EQ page: 9-band graphic sliders + graph + preset row + bass/treble knobs
//  - FX, Mastering, Parametric, Presets → all in bottom-sheet Modals
//  - mavin-eq native DynamicsProcessing wired via TrackPlayer.getAudioSessionId()
//  - Supabase preset browser reads autoeq_headphones + autoeq_filters tables
//  - Custom presets saved to Supabase eq_presets table AND AsyncStorage
//  - No BlurView anywhere (Android unreliable)
//  - HeaderNavigation component used (not duplicated inline)

import React, {
  useMemo, useState, useEffect, useCallback, useRef,
} from 'react';
import {
  Text, TouchableOpacity, View, StyleSheet,
  Dimensions, Modal, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalUIState } from '@/contexts/GlobalUIStateContext';
import { useActiveTrack } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { supabase } from '@/libs/supabase';
import { screenPadding } from '@/constants/tokens';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

// ── mavin-eq native module ─────────────────────────────────────────────────
import MyEQ from '@/modules/expo-autoeq-engine';

// ── Sub-components ─────────────────────────────────────────────────────────
import { VerticalEQSlider }  from '@/components/equalizer/VerticalEQSlider';
import { RotaryKnob }        from '@/components/equalizer/RotaryKnob';
import { EQGraph }           from '@/components/equalizer/EQGraph';
import { Watermark }         from '@/components/equalizer/Watermark';
import FloatingPlayer        from '@/components/FloatingPlayer';
import { HeaderNavigation }  from '@/components/equalizer/HeaderNavigation';
import { FXControls }        from '@/components/equalizer/FXControls';
import { MasteringControls } from '@/components/equalizer/MasteringControls';
import { ParametricEQ }      from '@/components/equalizer/parametricEq';
import { PresetModal }       from '@/components/equalizer/PresetDisplay';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const STORAGE_KEY = 'eqState_v4';
const DEBOUNCE_MS = 600;

const FREQUENCY_BANDS = [
  { label: '31',  frequency: 31   },
  { label: '62',  frequency: 62   },
  { label: '125', frequency: 125  },
  { label: '250', frequency: 250  },
  { label: '500', frequency: 500  },
  { label: '1k',  frequency: 1000 },
  { label: '2k',  frequency: 2000 },
  { label: '4k',  frequency: 4000 },
  { label: '8k',  frequency: 8000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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
  Array(9).fill(null).map(() => ({ bypassed: false, soloed: false, muted: false }));

const DEFAULT_STATE: EQState = {
  enabled: false,
  graphic: { preamp: 0, bands: Array(9).fill(0), bass: 50, treble: 50 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EqualizerScreen() {
  const router             = useRouter();
  const insets             = useSafeAreaInsets();
  const { isMusicPlaying } = useGlobalUIState();
  const activeTrack        = useActiveTrack();

  // ── EQ state ──────────────────────────────────────────────────────────────
  const [eqState,   setEqState]   = useState<EQState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Native EQ session ─────────────────────────────────────────────────────
  // Attach DynamicsProcessing when EQ is enabled and a track is playing.
  const eqSetupRef = useRef(false);

  useEffect(() => {
    if (!eqState.enabled) {
      MyEQ.setEnabled(false).catch(() => {});
      return;
    }
    const attachEQ = async () => {
      try {
        const sessionId = await TrackPlayer.getAudioSessionId();
        if (!sessionId || sessionId <= 0) return;
        if (!eqSetupRef.current) {
          await MyEQ.setupEQ(sessionId);
          eqSetupRef.current = true;
        }
        await MyEQ.setEnabled(true);
        // Apply current bands
        const { preamp, bands } = eqState.graphic;
        const gains = bands.map((b, i) =>
          (eqState.bandBypass[i]?.bypassed ? 0 : b) + (i === 0 ? preamp : 0)
        );
        await MyEQ.applyBands(gains);
      } catch (e) {
        console.warn('[EQ] native attach:', e);
      }
    };
    attachEQ();
  }, [eqState.enabled]);

  // Re-apply bands whenever graphic state changes (if enabled)
  useEffect(() => {
    if (!eqState.enabled || !eqSetupRef.current) return;
    const { preamp, bands } = eqState.graphic;
    const gains = bands.map((b, i) =>
      eqState.bandBypass[i]?.bypassed ? 0 : b
    );
    // Preamp applied to all bands via offset on first band is wrong —
    // DynamicsProcessing doesn't have a preamp gain. Instead we normalise:
    // If any gain+preamp would exceed ±12dB, scale down.
    const withPreamp = gains.map(g => Math.max(-12, Math.min(12, g + preamp)));
    MyEQ.applyBands(withPreamp).catch(() => {});
  }, [eqState.graphic, eqState.bandBypass, eqState.enabled]);

  // Release on unmount
  useEffect(() => {
    return () => {
      MyEQ.release().catch(() => {});
      eqSetupRef.current = false;
    };
  }, []);

  // ── Mode / page navigation ─────────────────────────────────────────────
  const [eqMode, setEqMode] = useState<'graphic'|'parametric'>('graphic');

  // ── Modal visibility ──────────────────────────────────────────────────────
  const [fxModalVisible,        setFxModalVisible]        = useState(false);
  const [masteringModalVisible, setMasteringModalVisible] = useState(false);
  const [presetModalVisible,    setPresetModalVisible]    = useState(false);
  const [saveModalVisible,      setSaveModalVisible]      = useState(false);
  const [headerHeight,          setHeaderHeight]          = useState(insets.top + 130);

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(json => {
      if (json) {
        try {
          const parsed = JSON.parse(json) as Partial<EQState>;
          setEqState(prev => ({
            ...prev, ...parsed,
            fx:        { ...DEFAULT_STATE.fx,        ...(parsed.fx        ?? {}) },
            mastering: { ...DEFAULT_STATE.mastering,  ...(parsed.mastering ?? {}) },
            graphic:   { ...DEFAULT_STATE.graphic,    ...(parsed.graphic   ?? {}) },
            bandBypass: parsed.bandBypass ?? defaultBandBypass(),
          }));
        } catch {}
      }
    }).finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(eqState)).catch(() => {});
    }, DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [eqState, isLoading]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const detach = (prev: EQState) =>
    prev.presetType === 'factory'
      ? { selectedPreset: 'Custom', presetType: 'custom' as const }
      : { selectedPreset: prev.selectedPreset, presetType: prev.presetType };

  const handleBandChange = useCallback((index: number, value: number) => {
    setEqState(prev => ({
      ...prev, ...detach(prev),
      graphic: { ...prev.graphic, bands: prev.graphic.bands.map((v, i) => i === index ? value : v) },
    }));
  }, []);

  const handlePreampChange = useCallback((value: number) => {
    setEqState(prev => ({ ...prev, ...detach(prev), graphic: { ...prev.graphic, preamp: value } }));
  }, []);

  const handleBassChange   = useCallback((v: number) =>
    setEqState(p => ({ ...p, ...detach(p), graphic: { ...p.graphic, bass: v } })), []);

  const handleTrebleChange = useCallback((v: number) =>
    setEqState(p => ({ ...p, ...detach(p), graphic: { ...p.graphic, treble: v } })), []);

  const handleParametricUpdate = useCallback((u: Partial<ParametricState>) =>
    setEqState(p => ({ ...p, ...detach(p), parametric: { ...p.parametric, ...u } })), []);

  const handleFXUpdate = useCallback((u: Partial<FXState>) =>
    setEqState(p => ({ ...p, fx: { ...p.fx, ...u } })), []);

  const handleMasteringUpdate = useCallback((u: Partial<MasteringState>) =>
    setEqState(p => ({ ...p, mastering: { ...p.mastering, ...u } })), []);

  const toggleEQ = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEqState(p => ({ ...p, enabled: !p.enabled }));
  }, []);

  const handleBandBypass = useCallback((i: number) =>
    setEqState(p => { const bb=[...p.bandBypass]; bb[i]={...bb[i],bypassed:!bb[i].bypassed}; return {...p,bandBypass:bb}; }), []);

  const handleBandSolo = useCallback((i: number) =>
    setEqState(p => ({ ...p, bandBypass: p.bandBypass.map((b,j)=>({...b,soloed:j===i?!b.soloed:false})) })), []);

  const handleBandMute = useCallback((i: number) =>
    setEqState(p => { const bb=[...p.bandBypass]; bb[i]={...bb[i],muted:!bb[i].muted}; return {...p,bandBypass:bb}; }), []);

  // Called by PresetModal when user taps a preset
  const handleSelectPreset = useCallback((preset: { name: string; bands: number[]; preamp: number; is_factory: boolean }) => {
    Haptics.selectionAsync();
    setEqState(prev => ({
      ...prev,
      enabled: true,
      graphic: { ...prev.graphic, preamp: preset.preamp, bands: preset.bands, bass: 50, treble: 50 },
      selectedPreset: preset.name,
      presetType: preset.is_factory ? 'factory' : 'custom',
    }));
    setPresetModalVisible(false);
  }, []);

  const gradientColors = useMemo<[string,string,string]>(() => ['#1a0f05','#0b0b0b','#050505'], []);
  const bottomPad = insets.bottom + verticalScale(70);

  const { enabled, graphic, parametric, fx, mastering, selectedPreset, presetType, bandBypass } = eqState;

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.loadingText}>Loading Equalizer…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient style={styles.root} colors={gradientColors}>
        <Watermark source={require('@/assets/images/mavins.png')} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View
          style={[styles.header, { paddingTop: insets.top + verticalScale(8) }]}
          onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-down" size={moderateScale(24)} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Equalizer</Text>

          {/* EQ on/off */}
          <TouchableOpacity
            style={[styles.eqToggle, enabled && styles.eqToggleOn]}
            onPress={toggleEQ}
            activeOpacity={0.8}
          >
            <Text style={[styles.eqToggleText, enabled && styles.eqToggleTextOn]}>EQ</Text>
          </TouchableOpacity>

          {/* EQ / Graphic|Parametric switch row */}
          <View style={styles.tabRow}>
            {/* Graphic / Parametric */}
            <View style={styles.modePill}>
              {(['graphic','parametric'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeTab, eqMode === m && styles.modeTabActive]}
                  onPress={() => setEqMode(m)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.modeTabText, eqMode === m && styles.modeTabTextActive]}>
                    {m === 'graphic' ? 'GRAPHIC' : 'PARAM'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* FX and MASTER open modals */}
            <TouchableOpacity
              style={styles.pageBtn}
              onPress={() => { Haptics.selectionAsync(); setFxModalVisible(true); }}
              activeOpacity={0.75}
            >
              <Text style={styles.pageBtnText}>FX</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pageBtn}
              onPress={() => { Haptics.selectionAsync(); setMasteringModalVisible(true); }}
              activeOpacity={0.75}
            >
              <Text style={styles.pageBtnText}>MASTER</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Scrollable EQ content ───────────────────────────────────────── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingTop: headerHeight, paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* FloatingPlayer in EQ bar mode — shows track info inline */}
          <FloatingPlayer eqBarMode />

          {/* ── Graphic EQ ──────────────────────────────────────────────── */}
          {eqMode === 'graphic' ? (
            <>
              <View style={styles.slidersRow}>
                <VerticalEQSlider
                  value={graphic.preamp}
                  onChange={handlePreampChange}
                  isPreamp
                  label="PRE"
                  enabled={enabled}
                />
                {FREQUENCY_BANDS.map((band, index) => (
                  <VerticalEQSlider
                    key={band.label}
                    value={graphic.bands[index]}
                    onChange={val => handleBandChange(index, val)}
                    label={band.label}
                    enabled={enabled}
                    frequency={band.frequency}
                    bypassed={bandBypass[index]?.bypassed ?? false}
                    isSoloed={bandBypass[index]?.soloed   ?? false}
                    isMuted={bandBypass[index]?.muted     ?? false}
                    onBypass={() => handleBandBypass(index)}
                    onSolo={()   => handleBandSolo(index)}
                    onMute={()   => handleBandMute(index)}
                  />
                ))}
              </View>

              <EQGraph values={graphic.bands} enabled={enabled} />

              {/* Preset row */}
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={styles.presetBtn}
                  onPress={() => setPresetModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="options-outline" size={14} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.presetBtnText} numberOfLines={1}>{selectedPreset}</Text>
                  {presetType === 'factory' && <Text style={styles.lockIcon}>🔒</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => setSaveModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.saveBtnText}>SAVE</Text>
                </TouchableOpacity>
              </View>

              {/* Bass + Treble */}
              <View style={styles.knobsRow}>
                <RotaryKnob
                  value={graphic.bass}
                  label="BASS"
                  onChange={handleBassChange}
                  color={Colors.metallicBrown.primary}
                  size={70}
                  enabled={enabled}
                />
                <RotaryKnob
                  value={graphic.treble}
                  label="TREBLE"
                  onChange={handleTrebleChange}
                  color={Colors.metallicBrown.secondary}
                  size={70}
                  enabled={enabled}
                />
              </View>
            </>
          ) : (
            /* ── Parametric EQ ─────────────────────────────────────────── */
            <ParametricEQ
              enabled={enabled}
              parametricState={parametric}
              onUpdate={handleParametricUpdate}
            />
          )}
        </ScrollView>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* FX BOTTOM SHEET MODAL                                           */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Modal
          animationType="slide"
          transparent
          visible={fxModalVisible}
          onRequestClose={() => setFxModalVisible(false)}
        >
          <View style={styles.sheetBackdrop}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(8) }]}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>FX PROCESSOR</Text>
                <TouchableOpacity
                  style={styles.sheetClose}
                  onPress={() => setFxModalVisible(false)}
                >
                  <Ionicons name="close" size={18} color="#888" />
                </TouchableOpacity>
              </View>
              <FXControls
                enabled={enabled}
                fxState={fx}
                onUpdate={handleFXUpdate}
              />
            </View>
          </View>
        </Modal>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* MASTERING BOTTOM SHEET MODAL                                    */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Modal
          animationType="slide"
          transparent
          visible={masteringModalVisible}
          onRequestClose={() => setMasteringModalVisible(false)}
        >
          <View style={styles.sheetBackdrop}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + scale(8) }]}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>MASTERING SUITE</Text>
                <TouchableOpacity
                  style={styles.sheetClose}
                  onPress={() => setMasteringModalVisible(false)}
                >
                  <Ionicons name="close" size={18} color="#888" />
                </TouchableOpacity>
              </View>
              <MasteringControls
                enabled={enabled}
                masteringState={mastering}
                onUpdate={handleMasteringUpdate}
              />
            </View>
          </View>
        </Modal>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* PRESET BROWSER MODAL — reads from Supabase                     */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <PresetModal
          visible={presetModalVisible}
          onClose={() => setPresetModalVisible(false)}
          selectedPreset={selectedPreset}
          onSelectPreset={handleSelectPreset}
          insets={insets}
        />

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* SAVE PRESET MODAL                                               */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <SavePresetModal
          visible={saveModalVisible}
          onClose={() => setSaveModalVisible(false)}
          bands={graphic.bands}
          preamp={graphic.preamp}
          onSaved={(name) => {
            setEqState(p => ({ ...p, selectedPreset: name, presetType: 'custom' }));
            setSaveModalVisible(false);
          }}
          insets={insets}
        />

      </LinearGradient>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SavePresetModal — inline sub-component (no separate file needed)
// Saves to Supabase eq_presets AND AsyncStorage
// ─────────────────────────────────────────────────────────────────────────────

interface SavePresetModalProps {
  visible: boolean;
  onClose: () => void;
  bands: number[];
  preamp: number;
  onSaved: (name: string) => void;
  insets: { bottom: number };
}

const CUSTOM_PRESETS_KEY = 'eqCustomPresets_v4';

function SavePresetModal({ visible, onClose, bands, preamp, onSaved, insets }: SavePresetModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Name required', 'Enter a preset name.'); return; }
    setSaving(true);
    try {
      // 1. Save to Supabase
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        await supabase.from('eq_presets').upsert({
          user_id:   authData.user.id,
          name:      trimmed,
          type:      'graphic_31band',
          gains_31:  bands,
          preamp_db: preamp,
        }, { onConflict: 'user_id,name' });
      }
      // 2. Also persist locally for offline
      const existing = await AsyncStorage.getItem(CUSTOM_PRESETS_KEY);
      const list = existing ? JSON.parse(existing) : [];
      const updated = [
        ...list.filter((p: any) => p.name !== trimmed),
        { id: `c${Date.now()}`, name: trimmed, bands, preamp, is_factory: false, category: 'user', display_order: list.length },
      ];
      await AsyncStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
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
          <View style={saveStyles.inputWrap}>
            <Text style={saveStyles.inputLabel}>PRESET NAME</Text>
            <View style={saveStyles.input}>
              <Text
                style={saveStyles.inputText}
                onPress={() => {}}
              />
            </View>
            {/* React Native TextInput */}
            <SaveInput value={name} onChange={setName} onSubmit={handleSave} />
          </View>
          {/* Band preview */}
          <View style={saveStyles.preview}>
            {bands.map((v, i) => (
              <View
                key={i}
                style={[
                  saveStyles.previewBar,
                  {
                    height: Math.abs(v * 3.5) + 2,
                    backgroundColor: v > 0 ? Colors.metallicBrown.primary : Colors.metallicBrown.secondary,
                    alignSelf: 'flex-end',
                  },
                ]}
              />
            ))}
          </View>
          <Text style={saveStyles.preamp}>Preamp: {preamp > 0 ? '+' : ''}{preamp}dB</Text>
          <View style={saveStyles.btns}>
            <TouchableOpacity style={saveStyles.btnCancel} onPress={onClose}>
              <Text style={saveStyles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[saveStyles.btnSave, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={saveStyles.btnSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Minimal TextInput wrapper to avoid JSX inside non-JSX component above
import { TextInput } from 'react-native';
function SaveInput({ value, onChange, onSubmit }: { value: string; onChange: (s: string) => void; onSubmit: () => void }) {
  return (
    <TextInput
      style={saveStyles.textInput}
      placeholder="e.g. My Bass Boost"
      placeholderTextColor="#555"
      value={value}
      onChangeText={onChange}
      autoFocus
      maxLength={40}
      returnKeyType="done"
      onSubmitEditing={onSubmit}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingScreen: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', fontSize: moderateScale(13) },

  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: scale(16),
    paddingBottom: verticalScale(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: {
    position: 'absolute', top: verticalScale(8), left: scale(12),
    zIndex: 10, padding: scale(4),
  },
  headerTitle: {
    textAlign: 'center', color: '#fff',
    fontSize: moderateScale(15), fontWeight: '700', letterSpacing: 0.5,
  },
  eqToggle: {
    position: 'absolute', top: 0, right: scale(12),
    paddingHorizontal: scale(18), paddingVertical: verticalScale(5),
    borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  eqToggleOn: { backgroundColor: Colors.metallicBrown.primary, borderColor: Colors.metallicBrown.primary },
  eqToggleText: { color: '#fff', fontSize: moderateScale(13), fontWeight: '700' },
  eqToggleTextOn: { color: '#000' },

  tabRow: {
    flexDirection: 'row', alignItems: 'center', gap: scale(8),
    marginTop: verticalScale(36),
  },
  modePill: {
    flex: 1, flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20, padding: scale(2),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  modeTab: {
    flex: 1, paddingVertical: verticalScale(6),
    alignItems: 'center', borderRadius: 18,
  },
  modeTabActive: { backgroundColor: Colors.metallicBrown.primary },
  modeTabText: { color: 'rgba(255,255,255,0.6)', fontSize: moderateScale(10), fontWeight: '700' },
  modeTabTextActive: { color: '#000' },
  pageBtn: {
    paddingHorizontal: scale(14), paddingVertical: verticalScale(6),
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  pageBtnText: { color: '#fff', fontSize: moderateScale(11), fontWeight: '700' },

  content: { paddingHorizontal: screenPadding.horizontal },

  slidersRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: scale(2), marginTop: verticalScale(8),
  },

  presetRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: verticalScale(12), gap: scale(10),
  },
  presetBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: scale(8),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20, paddingVertical: verticalScale(8), paddingHorizontal: scale(14),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  presetBtnText: { color: '#fff', fontSize: moderateScale(13), fontWeight: '600', flex: 1 },
  lockIcon: { fontSize: moderateScale(12) },
  saveBtn: {
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 20, paddingVertical: verticalScale(8), paddingHorizontal: scale(20),
  },
  saveBtnText: { color: '#000', fontSize: moderateScale(12), fontWeight: '700' },

  knobsRow: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: scale(40),
    marginTop: verticalScale(16), marginBottom: verticalScale(8),
  },

  // ── Bottom sheet shared styles ─────────────────────────────────────────
  sheetBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: scale(16), paddingTop: verticalScale(8),
    maxHeight: SCREEN_HEIGHT * 0.88,
  },
  sheetHandle: {
    alignSelf: 'center', width: scale(36), height: 4,
    borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: verticalScale(10),
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: verticalScale(16),
  },
  sheetTitle: {
    color: '#fff', fontSize: moderateScale(15),
    fontWeight: '700', letterSpacing: 1,
  },
  sheetClose: {
    width: scale(32), height: scale(32), borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
});

const saveStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.80)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  card: {
    width: SCREEN_WIDTH * 0.92,
    backgroundColor: '#181818', borderRadius: 20,
    padding: scale(20),
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: '#fff', fontSize: moderateScale(16),
    fontWeight: '700', letterSpacing: 0.5, marginBottom: verticalScale(16),
  },
  inputWrap: { marginBottom: verticalScale(12) },
  inputLabel: {
    color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(10),
    fontWeight: '700', letterSpacing: 0.5, marginBottom: verticalScale(6),
  },
  input: {},
  inputText: {},
  textInput: {
    backgroundColor: '#252525', borderRadius: 12,
    paddingHorizontal: scale(14), height: verticalScale(46),
    color: '#fff', fontSize: moderateScale(14),
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  preview: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: verticalScale(36), marginVertical: verticalScale(12),
    paddingHorizontal: scale(4),
  },
  previewBar: { flex: 1, marginHorizontal: 1, borderRadius: 2 },
  preamp: { color: 'rgba(255,255,255,0.4)', fontSize: moderateScale(10), textAlign: 'center', marginBottom: verticalScale(16) },
  btns: { flexDirection: 'row', gap: scale(10) },
  btnCancel: {
    flex: 1, height: verticalScale(44), borderRadius: 12,
    backgroundColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center',
  },
  btnCancelText: { color: '#fff', fontSize: moderateScale(14), fontWeight: '600' },
  btnSave: {
    flex: 1, height: verticalScale(44), borderRadius: 12,
    backgroundColor: Colors.metallicBrown.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  btnSaveText: { color: '#000', fontSize: moderateScale(14), fontWeight: '700' },
});