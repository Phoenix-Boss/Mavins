// app/(modals)/equalizer.tsx
//
// Equalizer — full-screen modal, slides up from player/wherever it's called.
// Route: router.push('/(modals)/equalizer')  — back arrow dismisses via router.back()
//
// Fixes applied vs original:
//  1. Reads live track from useActiveTrack() — no hardcoded dummy data
//  2. Reads live progress from useProgress() — real elapsed/duration
//  3. HeaderNavigation is absolutely positioned — paddingTop derives from
//     onLayout measurement, not a magic constant
//  4. EQ page wrapped in ScrollView — knobs always reachable, no overflow
//  5. Bottom inset respected via useSafeAreaInsets() so content clears tab bar
//  6. AsyncStorage write debounced 600ms — safe at 60fps drag
//  7. detachFromFactory merged into single functional setEqState updater
//  8. EQState.fx fields aligned with FXControls prop interface
//  9. EQState.mastering fields aligned with MasteringControls prop interface
// 10. Presets loaded from Supabase eq_presets table — no hardcoded fallbacks
// 11. NowPlayingBar onPress → '/(player)' (correct group route)
// 12. Bypass/Solo/Mute handlers wired to per-band state
// 13. StatusBar conflict removed — root layout owns it
// 14. BlurView preset modal replaced with semi-transparent View (Android safe)
// 15. Save modal overlay uses correct justifyContent: 'center'
// 16. Back button added to HeaderNavigation via router.back()

import React, {
  useMemo, useState, useEffect, useCallback, useRef,
} from 'react';
import {
  Text, TouchableOpacity, View, StyleSheet,
  Dimensions, Modal, FlatList, Alert,
  TextInput, KeyboardAvoidingView, Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  moderateScale, scale, verticalScale,
} from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalUIState } from '@/contexts/GlobalUIStateContext';
import { useActiveTrack, useProgress } from 'react-native-track-player';
import { supabase } from '@/libs/supabase';
import { screenPadding } from '@/constants/tokens';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// ── Sub-components ─────────────────────────────────────────────────────────
import { VerticalEQSlider }  from '@/components/equalizer/VerticalEQSlider';
import { RotaryKnob }        from '@/components/equalizer/RotaryKnob';
import { EQGraph }           from '@/components/equalizer/EQGraph';
import { NowPlayingBar }     from '@/components/equalizer/NowPlayingBar';
import { Watermark }         from '@/components/equalizer/Watermark';
import { FXControls }        from '@/components/equalizer/FXControls';
import { MasteringControls } from '@/components/equalizer/MasteringControls';
import { ParametricEQ }      from '@/components/equalizer/parametricEq';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY_EQ_STATE     = 'eqState_v3';
const STORAGE_KEY_CUSTOM_PRESETS = 'eqCustomPresets_v3';
const DEBOUNCE_MS              = 600;

const FREQUENCY_BANDS = [
  { label: '31',   frequency: 31   },
  { label: '62',   frequency: 62   },
  { label: '125',  frequency: 125  },
  { label: '250',  frequency: 250  },
  { label: '500',  frequency: 500  },
  { label: '1k',   frequency: 1000 },
  { label: '2k',   frequency: 2000 },
  { label: '4k',   frequency: 4000 },
  { label: '8k',   frequency: 8000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types — all aligned with child component prop interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface BandBypass {
  bypassed: boolean;
  soloed:   boolean;
  muted:    boolean;
}

/** FX state — exactly matches FXControlsProps['fxState'] */
interface FXState {
  mode:       'reverb' | 'delay' | 'chorus' | 'flanger' | 'phaser';
  roomSize:   number;
  decay:      number;
  preDelay:   number;
  damping:    number;
  delayTime:  number;
  feedback:   number;
  lowCut:     number;
  highCut:    number;
  rate:       number;
  depth:      number;
  phase:      number;
  mix:        number;
  bypass:     boolean;
}

/** Mastering state — exactly matches MasteringControlsProps['masteringState'] */
interface MasteringState {
  balance:          number;
  stereoWidth:      number;
  loudness:         number;
  limiter:          boolean;
  mono:             boolean;
  limiterThreshold: number;
  truePeak:         number;
  gainReduction:    number;
}

interface ParametricState {
  selectedFilter: 'lowpass'|'highpass'|'bandpass'|'lowshelf'|'highshelf'|'peaking'|'notch';
  filterEnabled:  boolean;
  gain:           number;
  frequency:      number;
  q:              number;
}

interface EQState {
  enabled: boolean;
  graphic: {
    preamp: number;
    bands:  number[];
    bass:   number;
    treble: number;
  };
  bandBypass:  BandBypass[];
  parametric:  ParametricState;
  fx:          FXState;
  mastering:   MasteringState;
  selectedPreset: string;
  presetType:     'factory' | 'custom';
}

interface DBPreset {
  id:           string;
  name:         string;
  bands:        number[];
  preamp:       number;
  category:     string;
  is_factory:   boolean;
  display_order: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default state
// ─────────────────────────────────────────────────────────────────────────────

const defaultBandBypass = (): BandBypass[] =>
  Array(9).fill(null).map(() => ({ bypassed: false, soloed: false, muted: false }));

const DEFAULT_STATE: EQState = {
  enabled: false,
  graphic: {
    preamp: 0,
    bands:  Array(9).fill(0),
    bass:   50,
    treble: 50,
  },
  bandBypass: defaultBandBypass(),
  parametric: {
    selectedFilter: 'peaking',
    filterEnabled:  false,
    gain:           0,
    frequency:      1000,
    q:              1.0,
  },
  fx: {
    mode:      'reverb',
    roomSize:  60,
    decay:     40,
    preDelay:  10,
    damping:   50,
    delayTime: 30,
    feedback:  40,
    lowCut:    20,
    highCut:   80,
    rate:      30,
    depth:     40,
    phase:     50,
    mix:       30,
    bypass:    false,
  },
  mastering: {
    balance:          50,
    stereoWidth:      50,
    loudness:         50,
    limiter:          false,
    mono:             false,
    limiterThreshold: -6,
    truePeak:         -12,
    gainReduction:    0,
  },
  selectedPreset: 'Flat',
  presetType:     'factory',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EqualizerScreen() {
  const router               = useRouter();
  const insets               = useSafeAreaInsets();
  const { isMusicPlaying }   = useGlobalUIState();

  // ── Live playback data — no hardcoding ────────────────────────────────────
  const activeTrack = useActiveTrack();
  const progress    = useProgress(500);  // poll every 500ms

  // ── Page/mode navigation ─────────────────────────────────────────────────
  const [activePage, setActivePage] = useState<'eq' | 'fx' | 'mastering'>('eq');
  const [eqMode,     setEqMode]     = useState<'graphic' | 'parametric'>('graphic');

  // ── Preset data from Supabase ─────────────────────────────────────────────
  const [dbPresets,     setDbPresets]     = useState<DBPreset[]>([]);
  const [customPresets, setCustomPresets] = useState<DBPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);

  // ── EQ state ──────────────────────────────────────────────────────────────
  const [eqState,   setEqState]   = useState<EQState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);

  // ── Modal visibility ──────────────────────────────────────────────────────
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [saveModalVisible,   setSaveModalVisible]   = useState(false);
  const [presetFilter, setPresetFilter] = useState<'all'|'factory'|'custom'>('all');
  const [newPresetName, setNewPresetName] = useState('');

  // ── Header height measured via onLayout ───────────────────────────────────
  const [headerHeight, setHeaderHeight] = useState(insets.top + 110);

  // ── Debounce ref for AsyncStorage writes ─────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Load persisted state + DB presets on mount
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [stateJson, customJson] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_EQ_STATE),
          AsyncStorage.getItem(STORAGE_KEY_CUSTOM_PRESETS),
        ]);
        if (stateJson) {
          // Merge stored state with default to handle new fields added in this version
          const parsed = JSON.parse(stateJson) as Partial<EQState>;
          setEqState(prev => ({
            ...prev,
            ...parsed,
            fx:        { ...DEFAULT_STATE.fx,        ...(parsed.fx        ?? {}) },
            mastering: { ...DEFAULT_STATE.mastering,  ...(parsed.mastering ?? {}) },
            graphic:   { ...DEFAULT_STATE.graphic,    ...(parsed.graphic   ?? {}) },
            bandBypass: parsed.bandBypass ?? defaultBandBypass(),
          }));
        }
        if (customJson) setCustomPresets(JSON.parse(customJson));
      } catch (e) {
        console.warn('[EQ] load state error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadAll();
  }, []);

  useEffect(() => {
    const loadDbPresets = async () => {
      try {
        const { data, error } = await supabase
          .from('eq_presets')
          .select('id, name, bands, preamp, category, is_factory, display_order')
          .order('category')
          .order('display_order');
        if (error) throw error;
        setDbPresets(data ?? []);
      } catch (e) {
        console.warn('[EQ] failed to load presets from DB:', e);
        setDbPresets([]);
      } finally {
        setPresetsLoading(false);
      }
    };
    loadDbPresets();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Debounced persist on every eqState change
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isLoading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY_EQ_STATE, JSON.stringify(eqState))
        .catch(e => console.warn('[EQ] save error:', e));
    }, DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [eqState, isLoading]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers — all use functional updater; detachFromFactory is inline
  // ─────────────────────────────────────────────────────────────────────────

  const detachIfFactory = (prev: EQState): Pick<EQState, 'selectedPreset'|'presetType'> =>
    prev.presetType === 'factory'
      ? { selectedPreset: 'Custom', presetType: 'custom' }
      : { selectedPreset: prev.selectedPreset, presetType: prev.presetType };

  const handleBandChange = useCallback((index: number, value: number) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      graphic: {
        ...prev.graphic,
        bands: prev.graphic.bands.map((v, i) => i === index ? value : v),
      },
    }));
  }, []);

  const handlePreampChange = useCallback((value: number) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      graphic: { ...prev.graphic, preamp: value },
    }));
  }, []);

  const handleBassChange = useCallback((value: number) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      graphic: { ...prev.graphic, bass: value },
    }));
  }, []);

  const handleTrebleChange = useCallback((value: number) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      graphic: { ...prev.graphic, treble: value },
    }));
  }, []);

  const handleParametricUpdate = useCallback((updates: Partial<ParametricState>) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      parametric: { ...prev.parametric, ...updates },
    }));
  }, []);

  const handleFXUpdate = useCallback((updates: Partial<FXState>) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      fx: { ...prev.fx, ...updates },
    }));
  }, []);

  const handleMasteringUpdate = useCallback((updates: Partial<MasteringState>) => {
    setEqState(prev => ({
      ...prev,
      ...detachIfFactory(prev),
      mastering: { ...prev.mastering, ...updates },
    }));
  }, []);

  const toggleEQ = useCallback(() => {
    setEqState(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  // Per-band bypass/solo/mute
  const handleBandBypass = useCallback((index: number) => {
    setEqState(prev => {
      const bb = [...prev.bandBypass];
      bb[index] = { ...bb[index], bypassed: !bb[index].bypassed };
      return { ...prev, bandBypass: bb };
    });
  }, []);

  const handleBandSolo = useCallback((index: number) => {
    setEqState(prev => {
      const bb = prev.bandBypass.map((b, i) => ({
        ...b,
        soloed: i === index ? !b.soloed : false,
      }));
      return { ...prev, bandBypass: bb };
    });
  }, []);

  const handleBandMute = useCallback((index: number) => {
    setEqState(prev => {
      const bb = [...prev.bandBypass];
      bb[index] = { ...bb[index], muted: !bb[index].muted };
      return { ...prev, bandBypass: bb };
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Preset management
  // ─────────────────────────────────────────────────────────────────────────

  const selectPreset = useCallback((preset: DBPreset) => {
    setEqState(prev => ({
      ...prev,
      enabled: true,
      graphic: {
        ...prev.graphic,
        preamp: preset.preamp,
        bands:  preset.bands,
        bass:   50,
        treble: 50,
      },
      selectedPreset: preset.name,
      presetType:     preset.is_factory ? 'factory' : 'custom',
    }));
    setPresetModalVisible(false);
  }, []);

  const handleSavePreset = useCallback(async () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a preset name.');
      return;
    }
    const newPreset: DBPreset = {
      id:           `c${Date.now()}`,
      name:         trimmed,
      bands:        eqState.graphic.bands,
      preamp:       eqState.graphic.preamp,
      category:     'user',
      is_factory:   false,
      display_order: customPresets.length,
    };
    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(updated));
      setEqState(prev => ({ ...prev, selectedPreset: trimmed, presetType: 'custom' }));
      setNewPresetName('');
      setSaveModalVisible(false);
      Alert.alert('Saved', `Preset "${trimmed}" saved.`);
    } catch {
      Alert.alert('Error', 'Failed to save preset.');
    }
  }, [newPresetName, eqState.graphic, customPresets]);

  const allPresets = useMemo<DBPreset[]>(() => {
    const factory = dbPresets;
    const user    = customPresets;
    if (presetFilter === 'factory') return factory;
    if (presetFilter === 'custom')  return user;
    return [...factory, ...user];
  }, [presetFilter, dbPresets, customPresets]);

  // ─────────────────────────────────────────────────────────────────────────
  // Gradient from artwork
  // ─────────────────────────────────────────────────────────────────────────

  const gradientColors = useMemo<[string, string, string]>(() => {
    return ['#1a0f05', '#0b0b0b', '#050505'];
  }, []);

  const { enabled, graphic, parametric, fx, mastering,
         selectedPreset, presetType, bandBypass } = eqState;

  // Bottom padding: tab bar height (approx 60) + safe area bottom
  const bottomPad = insets.bottom + verticalScale(70);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

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

        {/* ── Absolutely positioned header — measured via onLayout ── */}
        <View
          style={styles.header}
          onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          {/* Back / close */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={10}
          >
            <Ionicons name="chevron-down" size={moderateScale(24)} color="#fff" />
          </TouchableOpacity>

          {/* Title */}
          <Text style={styles.headerTitle}>Equalizer</Text>

          {/* EQ on/off pill */}
          <TouchableOpacity
            style={[styles.eqToggle, enabled && styles.eqToggleOn]}
            onPress={toggleEQ}
            activeOpacity={0.8}
          >
            <Text style={[styles.eqToggleText, enabled && styles.eqToggleTextOn]}>
              EQ
            </Text>
          </TouchableOpacity>

          {/* Page tabs */}
          <View style={styles.pageTabs}>
            {(['eq', 'fx', 'mastering'] as const).map(page => (
              <TouchableOpacity
                key={page}
                style={[styles.pageTab, activePage === page && styles.pageTabActive]}
                onPress={() => setActivePage(page)}
                activeOpacity={0.75}
              >
                <Text style={[styles.pageTabText, activePage === page && styles.pageTabTextActive]}>
                  {page === 'eq' ? 'EQ' : page === 'fx' ? 'FX' : 'MASTER'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* EQ mode switch — only on EQ page */}
          {activePage === 'eq' && (
            <TouchableOpacity
              style={styles.modeSwitch}
              onPress={() => setEqMode(m => m === 'graphic' ? 'parametric' : 'graphic')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={14} color="#fff" />
              <Text style={styles.modeSwitchText}>
                {eqMode === 'graphic' ? 'GRAPHIC' : 'PARAMETRIC'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Scrollable content below header ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight, paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Now Playing Bar — live data from RNTP */}
          <NowPlayingBar
            track={{
              title:    activeTrack?.title    ?? 'No track loaded',
              artist:   activeTrack?.artist   ?? '',
              artwork:  activeTrack?.artwork  as string | number | undefined,
              duration: activeTrack?.duration ?? 0,
            }}
            compact
            isPlaying={isMusicPlaying}
            progress={
              progress.duration > 0
                ? progress.position / progress.duration
                : 0
            }
            elapsed={progress.position}
            onPlayPause={() => {}}   // FloatingPlayer / PlayerScreen own playback control
            onPress={() => router.push('/(player)')}
          />

          {/* ── EQ PAGE ─────────────────────────────────────────────────── */}
          {activePage === 'eq' && (
            <>
              {eqMode === 'graphic' ? (
                <>
                  {/* 9-band sliders + preamp */}
                  <View style={styles.slidersRow}>
                    {/* Preamp slider */}
                    <VerticalEQSlider
                      value={graphic.preamp}
                      onChange={handlePreampChange}
                      isPreamp
                      label="PRE"
                      enabled={enabled}
                    />
                    {/* 9 frequency bands */}
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

                  {/* Frequency response graph */}
                  <EQGraph
                    values={graphic.bands}
                    enabled={enabled}
                  />

                  {/* Preset selector + save */}
                  <View style={styles.presetRow}>
                    <TouchableOpacity
                      style={styles.presetBtn}
                      onPress={() => setPresetModalVisible(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.presetBtnText} numberOfLines={1}>
                        {selectedPreset}
                      </Text>
                      {presetType === 'factory' && (
                        <Text style={styles.lockIcon}>🔒</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.saveBtn}
                      onPress={() => setSaveModalVisible(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.saveBtnText}>SAVE</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Bass + Treble rotary knobs */}
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
                <ParametricEQ
                  enabled={enabled}
                  parametricState={parametric}
                  onUpdate={handleParametricUpdate}
                />
              )}
            </>
          )}

          {/* ── FX PAGE ─────────────────────────────────────────────────── */}
          {activePage === 'fx' && (
            <FXControls
              enabled={enabled}
              fxState={fx}
              onUpdate={handleFXUpdate}
            />
          )}

          {/* ── MASTERING PAGE ───────────────────────────────────────────── */}
          {activePage === 'mastering' && (
            <MasteringControls
              enabled={enabled}
              masteringState={mastering}
              onUpdate={handleMasteringUpdate}
            />
          )}
        </ScrollView>

        {/* ── PRESET SELECTION MODAL ─────────────────────────────────────── */}
        <Modal
          animationType="slide"
          transparent
          visible={presetModalVisible}
          onRequestClose={() => setPresetModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
              {/* Drag handle */}
              <View style={styles.modalHandle} />

              {/* Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>PRESETS</Text>
                <TouchableOpacity
                  onPress={() => setPresetModalVisible(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={18} color="#888" />
                </TouchableOpacity>
              </View>

              {/* Filter tabs */}
              <View style={styles.filterTabs}>
                {(['all', 'factory', 'custom'] as const).map(f => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterTab, presetFilter === f && styles.filterTabActive]}
                    onPress={() => setPresetFilter(f)}
                  >
                    <Text style={[styles.filterTabText, presetFilter === f && styles.filterTabTextActive]}>
                      {f.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {presetsLoading ? (
                <Text style={styles.loadingText}>Loading presets…</Text>
              ) : (
                <FlatList
                  data={allPresets}
                  keyExtractor={item => item.id}
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      {presetFilter === 'custom'
                        ? 'No custom presets yet. Save one above.'
                        : 'No presets found.'}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.presetItem,
                        selectedPreset === item.name && styles.presetItemActive,
                      ]}
                      onPress={() => selectPreset(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.presetItemLeft}>
                        <View>
                          <Text style={styles.presetItemName}>{item.name}</Text>
                          <Text style={styles.presetItemCategory}>
                            {item.category}
                          </Text>
                        </View>
                        {/* Mini curve */}
                        <View style={styles.miniCurve}>
                          {item.bands.map((val, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.miniBar,
                                {
                                  height: Math.abs(val * 4) + 2,
                                  backgroundColor: val > 0
                                    ? Colors.metallicBrown.primary
                                    : Colors.metallicBrown.secondary,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      </View>
                      <View style={styles.presetItemRight}>
                        <Text style={styles.presetItemPreamp}>
                          {item.preamp > 0 ? '+' : ''}{item.preamp}dB
                        </Text>
                        {item.is_factory && (
                          <Text style={{ fontSize: 10 }}>🔒</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  )}
                  ItemSeparatorComponent={() => (
                    <View style={styles.separator} />
                  )}
                />
              )}
            </View>
          </View>
        </Modal>

        {/* ── SAVE PRESET MODAL ─────────────────────────────────────────── */}
        <Modal
          animationType="fade"
          transparent
          visible={saveModalVisible}
          onRequestClose={() => setSaveModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.saveModalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.saveModalCard}>
              <Text style={styles.modalTitle}>Save Preset</Text>
              <TextInput
                style={styles.presetNameInput}
                placeholder="Enter preset name"
                placeholderTextColor="#555"
                value={newPresetName}
                onChangeText={setNewPresetName}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={handleSavePreset}
              />
              <View style={styles.saveModalBtns}>
                <TouchableOpacity
                  style={[styles.saveModalBtn, styles.saveModalBtnCancel]}
                  onPress={() => setSaveModalVisible(false)}
                >
                  <Text style={styles.saveModalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveModalBtn, styles.saveModalBtnConfirm]}
                  onPress={handleSavePreset}
                >
                  <Text style={[styles.saveModalBtnText, { color: '#000' }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </LinearGradient>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: moderateScale(13),
    textAlign: 'center',
    marginVertical: verticalScale(20),
  },

  // ── Header (absolutely positioned, measured via onLayout) ──────────────
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingBottom: verticalScale(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: {
    position: 'absolute',
    top: 0,
    left: scale(16),
    zIndex: 10,
    padding: scale(4),
  },
  headerTitle: {
    textAlign: 'center',
    color: '#fff',
    fontSize: moderateScale(15),
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: verticalScale(6),
  },
  eqToggle: {
    alignSelf: 'flex-end',
    position: 'absolute',
    top: 0,
    right: scale(16),
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(5),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  eqToggleOn: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.primary,
  },
  eqToggleText: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '700',
  },
  eqToggleTextOn: {
    color: '#000',
  },
  pageTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: scale(8),
    marginTop: verticalScale(36),
    paddingHorizontal: scale(16),
  },
  pageTab: {
    flex: 1,
    paddingVertical: verticalScale(7),
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pageTabActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderColor: Colors.metallicBrown.primary,
  },
  pageTabText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pageTabTextActive: {
    color: '#000',
  },
  modeSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: verticalScale(8),
    paddingVertical: verticalScale(5),
    paddingHorizontal: scale(14),
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: scale(5),
  },
  modeSwitchText: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ── Scrollable content ─────────────────────────────────────────────────
  content: {
    paddingHorizontal: screenPadding.horizontal,
  },

  // ── Sliders ───────────────────────────────────────────────────────────
  slidersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: scale(2),
    marginTop: verticalScale(8),
  },

  // ── Preset row ─────────────────────────────────────────────────────────
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: verticalScale(12),
    gap: scale(10),
  },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(20),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    flex: 1,
  },
  presetBtnText: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
    flex: 1,
  },
  lockIcon: {
    fontSize: moderateScale(12),
    marginLeft: scale(4),
  },
  saveBtn: {
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(20),
  },
  saveBtnText: {
    color: '#000',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },

  // ── Bass / Treble knobs ────────────────────────────────────────────────
  knobsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: scale(40),
    marginTop: verticalScale(16),
    marginBottom: verticalScale(8),
  },

  // ── Preset modal ───────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(8),
    maxHeight: SCREEN_HEIGHT * 0.82,
  },
  modalHandle: {
    alignSelf: 'center',
    width: scale(36),
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: verticalScale(14),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: verticalScale(12),
  },
  modalTitle: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '700',
    letterSpacing: 1,
  },
  modalCloseBtn: {
    width: scale(32),
    height: scale(32),
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    padding: scale(2),
    marginBottom: verticalScale(12),
  },
  filterTab: {
    flex: 1,
    paddingVertical: verticalScale(7),
    alignItems: 'center',
    borderRadius: 18,
  },
  filterTabActive: {
    backgroundColor: Colors.metallicBrown.primary,
  },
  filterTabText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    fontWeight: '700',
  },
  filterTabTextActive: {
    color: '#000',
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(6),
    borderRadius: 10,
  },
  presetItemActive: {
    backgroundColor: 'rgba(139,115,85,0.18)',
  },
  presetItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
    flex: 1,
  },
  presetItemName: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
  presetItemCategory: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: moderateScale(10),
    marginTop: 2,
    textTransform: 'capitalize',
  },
  miniCurve: {
    flexDirection: 'row',
    alignItems: 'center',
    height: verticalScale(24),
    gap: 2,
  },
  miniBar: {
    width: scale(5),
    borderRadius: 2,
  },
  presetItemRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  presetItemPreamp: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  emptyText: {
    color: '#555',
    fontSize: moderateScale(13),
    textAlign: 'center',
    paddingVertical: verticalScale(30),
  },

  // ── Save modal ─────────────────────────────────────────────────────────
  saveModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.80)',
    justifyContent: 'center',   // ← correct: centered, not flex-end
    alignItems: 'center',
  },
  saveModalCard: {
    width: SCREEN_WIDTH * 0.86,
    backgroundColor: '#181818',
    borderRadius: 20,
    padding: scale(22),
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetNameInput: {
    width: '100%',
    height: verticalScale(48),
    backgroundColor: '#252525',
    borderRadius: 12,
    paddingHorizontal: scale(14),
    color: '#fff',
    fontSize: moderateScale(15),
    marginVertical: verticalScale(18),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  saveModalBtns: {
    flexDirection: 'row',
    gap: scale(12),
    width: '100%',
  },
  saveModalBtn: {
    flex: 1,
    height: verticalScale(44),
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveModalBtnCancel: {
    backgroundColor: '#2a2a2a',
  },
  saveModalBtnConfirm: {
    backgroundColor: Colors.metallicBrown.primary,
  },
  saveModalBtnText: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
  },
});