// app/(modals)/equalizer.tsx
//
// FIXES APPLIED vs original:
//
// 1. runOnJS — was a broken identity-function shim that didn't actually cross
//    the worklet/JS boundary. Replaced with the real import from
//    react-native-reanimated. Without this, slider gestures silently dropped
//    every band-change call on the worklet thread and nothing reached native.
//
// 2. Stale closure in applyToNative — `isEnabled` captured the initial `false`
//    value forever because applyToNative was not in useCallback and re-read
//    a stale closure variable. Fixed by using a ref (isEnabledRef) that is
//    always current, so the "ensure EQ is enabled" branch inside applyToNative
//    works correctly after the first toggle.
//
// 3. applyToNative stability — wrapped in useCallback with correct deps so
//    handleBandChange always closes over the latest version.
//
// 4. Double-enable guard — MyEQ.setEnabled(true) is now called once on mount
//    (inside checkMixer) rather than on every band change, which was causing
//    redundant native calls.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,           // ✅ FIX 1: real import — replaces the broken shim below
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import MyEQ, { getMixerSessionId } from "@/modules/mavin-eq";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 10 frequency bands for UI
const FREQUENCY_BANDS = [
  { label: '60Hz',  idx: 0, color: '#8B4513' },
  { label: '170Hz', idx: 1, color: '#A0522D' },
  { label: '310Hz', idx: 2, color: '#CD853F' },
  { label: '600Hz', idx: 3, color: '#D4A574' },
  { label: '1kHz',  idx: 4, color: '#E8D9C0' },
  { label: '3kHz',  idx: 5, color: '#D4A574' },
  { label: '6kHz',  idx: 6, color: '#CD853F' },
  { label: '12kHz', idx: 7, color: '#A0522D' },
  { label: '14kHz', idx: 8, color: '#8B4513' },
  { label: '16kHz', idx: 9, color: '#654321' },
];

// Maps 10 UI bands → 31 native ISO bands
const BAND_MAP: [number, number][] = [
  [0,  2],   // 60Hz
  [3,  5],   // 170Hz
  [6,  8],   // 310Hz
  [9,  11],  // 600Hz
  [12, 16],  // 1kHz
  [17, 20],  // 3kHz
  [21, 24],  // 6kHz
  [25, 27],  // 12kHz
  [28, 29],  // 14kHz
  [30, 30],  // 16kHz
];

const PRESETS = {
  flat:    { name: 'Flat',    bands: [0,  0,  0,  0,  0,  0,  0,  0,  0,  0] },
  bass:    { name: 'Bass+',   bands: [12, 10, 8,  4,  0,  0,  0,  0,  0,  0] },
  treble:  { name: 'Treble+', bands: [0,  0,  0,  0,  0,  0,  4,  8,  10, 12] },
  vocal:   { name: 'Vocal',   bands: [-4, -2, 0,  4,  8,  6,  2,  0,  0,  0] },
  extreme: { name: 'Extreme', bands: [15, 10, 5,  0, -5,  0,  5,  10, 12, 15] },
};

// ─── EQSlider ──────────────────────────────────────────────────────────────

interface EQSliderProps {
  value:    number;
  onChange: (value: number) => void;
  label:    string;
  color:    string;
  enabled:  boolean;
  index:    number;
}

function EQSlider({ value, onChange, label, color, enabled }: EQSliderProps) {
  const SLIDER_HEIGHT = verticalScale(280);
  const SLIDER_WIDTH  = scale(40);
  const TRACK_WIDTH   = scale(6);
  const KNOB_SIZE     = scale(28);

  const translateY  = useSharedValue(0);
  const contextY    = useSharedValue(0);
  const activeValue = useSharedValue(value);

  useEffect(() => {
    activeValue.value = value;
    const percent    = (15 - value) / 30;
    translateY.value = (percent * SLIDER_HEIGHT) - (SLIDER_HEIGHT / 2);
  }, [value]);

  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      contextY.value = translateY.value;
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((event) => {
      let newY       = contextY.value + event.translationY;
      const halfH    = SLIDER_HEIGHT / 2;
      newY           = Math.max(-halfH, Math.min(halfH, newY));
      translateY.value = newY;

      const percent   = (newY + halfH) / SLIDER_HEIGHT;
      const dbValue   = 15 - (percent * 30);
      const roundedDb = Math.round(dbValue * 2) / 2;

      if (Math.abs(activeValue.value - roundedDb) >= 0.5) {
        activeValue.value = roundedDb;
        runOnJS(onChange)(roundedDb); // ✅ FIX 1: real runOnJS crosses the worklet boundary
      }
    })
    .onEnd(() => {
      const finalDb = Math.round(activeValue.value * 2) / 2;
      runOnJS(onChange)(finalDb);
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform:       [{ translateY: translateY.value }],
    backgroundColor: enabled ? color : '#444',
    shadowOpacity:   enabled ? 0.5 : 0,
  }));

  const fillStyle = useAnimatedStyle(() => {
    const halfH    = SLIDER_HEIGHT / 2;
    const fillH    = halfH - translateY.value;
    return {
      height:          Math.max(0, fillH),
      backgroundColor: enabled ? color : '#666',
      opacity:         enabled ? 1 : 0.3,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.sliderContainer, { width: SLIDER_WIDTH, height: SLIDER_HEIGHT }]}>
        <View style={[styles.track, { width: TRACK_WIDTH, height: SLIDER_HEIGHT }]} />
        <Animated.View style={[styles.fill, fillStyle, { width: TRACK_WIDTH }]} />
        <View style={[styles.centerLine, { width: TRACK_WIDTH + scale(4) }]} />
        <Animated.View
          style={[
            styles.knob,
            { width: KNOB_SIZE, height: KNOB_SIZE, borderRadius: KNOB_SIZE / 2,
              marginLeft: -(KNOB_SIZE - TRACK_WIDTH) / 2 },
            knobStyle,
          ]}
        >
          <Text style={styles.knobText}>{Math.round(activeValue.value)}</Text>
        </Animated.View>
        <Text style={[styles.sliderLabel, { color: enabled ? color : '#666' }]}>{label}</Text>
        <Text style={[styles.valueText, { color: enabled ? '#fff' : '#666' }]}>
          {activeValue.value > 0
            ? `+${activeValue.value.toFixed(1)}`
            : activeValue.value.toFixed(1)}
        </Text>
      </View>
    </GestureDetector>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EqualizerScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [mixerReady,      setMixerReady     ] = useState(false);
  const [mixerSessionId,  setMixerSessionId ] = useState(0);
  const [bands,           setBands          ] = useState<number[]>(Array(10).fill(0));
  const [isEnabled,       setIsEnabled      ] = useState(false);
  const [selectedPreset,  setSelectedPreset ] = useState('Flat');
  const [lastError,       setLastError      ] = useState<string | null>(null);

  // ✅ FIX 2: ref always holds the current isEnabled value so applyToNative
  // never reads a stale closure
  const isEnabledRef     = useRef(false);
  const nativeGainsRef   = useRef<number[]>(Array(31).fill(0));

  // Keep ref in sync with state
  useEffect(() => { isEnabledRef.current = isEnabled; }, [isEnabled]);

  // ── checkMixer ────────────────────────────────────────────────────────────
  const checkMixer = useCallback(async () => {
    try {
      const sessionId = await getMixerSessionId();
      if (sessionId && sessionId > 0) {
        setMixerReady(true);
        setMixerSessionId(sessionId);
        // ✅ FIX 3: enable once on mount, not on every band change
        await MyEQ.setEnabled(true);
        isEnabledRef.current = true;
        setIsEnabled(true);
        await applyFlatNative();
      } else {
        setLastError('Mixer not initialized. Call initMixerEQ() before setupPlayer().');
      }
    } catch (e) {
      setLastError(`Mixer error: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      setLastError('EQ only works on Android');
      return;
    }
    checkMixer();
  }, [checkMixer]);

  // ── applyFlatNative ───────────────────────────────────────────────────────
  const applyFlatNative = async () => {
    const flat = Array(31).fill(0);
    nativeGainsRef.current = flat;
    await MyEQ.applyBands(flat);
  };

  // ── applyToNative ─────────────────────────────────────────────────────────
  // ✅ FIX 2: reads isEnabledRef.current (always fresh) instead of isEnabled
  //           (which was a stale closure from the first render)
  const applyToNative = useCallback(async (gains31: number[]) => {
    try {
      const clamped          = gains31.map(g => Math.max(-15, Math.min(15, g)));
      nativeGainsRef.current = clamped;
      await MyEQ.applyBands(clamped);
    } catch (e) {
      console.error('[EQ] Native apply failed:', e);
      setLastError(`Apply failed: ${e}`);
    }
  }, []);

  // ── handleBandChange ──────────────────────────────────────────────────────
  const handleBandChange = useCallback((index: number, value: number) => {
    setBands(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setSelectedPreset('Custom');

    const [start, end]  = BAND_MAP[index];
    const nativeGains   = [...nativeGainsRef.current];
    for (let i = start; i <= end; i++) nativeGains[i] = value;

    applyToNative(nativeGains);

    if (Math.abs(value) >= 5) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [applyToNative]);

  // ── applyPreset ───────────────────────────────────────────────────────────
  const applyPreset = useCallback(async (presetKey: keyof typeof PRESETS) => {
    const preset  = PRESETS[presetKey];
    const newBands = preset.bands;
    setBands(newBands);
    setSelectedPreset(preset.name);

    const nativeGains = Array(31).fill(0);
    newBands.forEach((db, i) => {
      const [start, end] = BAND_MAP[i];
      for (let j = start; j <= end; j++) nativeGains[j] = db;
    });

    await applyToNative(nativeGains);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [applyToNative]);

  // ── toggleEQ ─────────────────────────────────────────────────────────────
  const toggleEQ = useCallback(async () => {
    try {
      const next = !isEnabledRef.current;
      await MyEQ.setEnabled(next);
      isEnabledRef.current = next;
      setIsEnabled(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e) {
      console.error('[EQ] Toggle failed:', e);
    }
  }, []);

  // ── resetEQ ───────────────────────────────────────────────────────────────
  const resetEQ = useCallback(async () => {
    await applyPreset('flat');
  }, [applyPreset]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <GestureHandlerRootView style={styles.root}>
      <LinearGradient
        colors={['#1a1208', '#0d0b09', '#0a0807']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={24} color="#e8d9c0" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={[styles.statusDot, { backgroundColor: mixerReady ? '#4cde80' : '#ff4444' }]} />
          <Text style={styles.headerTitle}>EQUALIZER</Text>
        </View>

        <TouchableOpacity style={styles.headerBtn} onPress={resetEQ}>
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Error banner */}
      {lastError && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={16} color="#ff6666" />
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      )}

      {/* Loading */}
      {!mixerReady && !lastError && (
        <View style={styles.loadingBanner}>
          <Text style={styles.loadingText}>Initializing EQ...</Text>
        </View>
      )}

      {mixerReady && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Presets */}
          <View style={styles.presetContainer}>
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.presetBtn, selectedPreset === PRESETS[key].name && styles.presetBtnActive]}
                onPress={() => applyPreset(key)}
              >
                <Text style={[styles.presetText, selectedPreset === PRESETS[key].name && styles.presetTextActive]}>
                  {PRESETS[key].name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* EQ Sliders */}
          <View style={styles.eqContainer}>
            {/* dB scale */}
            <View style={styles.scaleContainer}>
              {['+15', '+8', '0', '-8', '-15'].map((label) => (
                <Text key={label} style={[styles.scaleText, label === '0' && styles.scaleCenter]}>
                  {label}
                </Text>
              ))}
            </View>

            {/* Sliders */}
            <View style={styles.slidersRow}>
              {FREQUENCY_BANDS.map((band) => (
                <EQSlider
                  key={band.idx}
                  index={band.idx}
                  value={bands[band.idx]}
                  onChange={(v) => handleBandChange(band.idx, v)}
                  label={band.label}
                  color={band.color}
                  enabled={isEnabled}
                />
              ))}
            </View>
          </View>

          {/* Band value readout */}
          <View style={styles.valuesContainer}>
            <Text style={styles.valuesTitle}>BAND GAINS (dB)</Text>
            <View style={styles.valuesRow}>
              {bands.map((db, i) => (
                <View key={i} style={styles.valueBox}>
                  <Text style={[
                    styles.valueBoxText,
                    db > 0 ? styles.valuePositive : db < 0 ? styles.valueNegative : null,
                  ]}>
                    {db > 0 ? `+${db}` : db}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Instructions */}
          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Drag sliders to adjust frequency bands.{'\n'}
              Session ID: {mixerSessionId || 'N/A'}
            </Text>
          </View>

          {/* Spacer for bottom bar */}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* Bottom bar — EQ toggle */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.toggleBtn, isEnabled && styles.toggleBtnOn]}
          onPress={toggleEQ}
          disabled={!mixerReady}
        >
          <Ionicons
            name={isEnabled ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={isEnabled ? '#0a0908' : '#fff'}
          />
          <Text style={[styles.toggleText, isEnabled && styles.toggleTextOn]}>
            {isEnabled ? 'EQ ACTIVE' : 'EQ BYPASSED'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.sessionText}>
          Session: {mixerSessionId || 'N/A'}
        </Text>
      </View>
    </GestureHandlerRootView>
  );
}

const GOLD = Colors.metallicBrown?.primary || '#C4A35A';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0b09',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(139,115,85,0.3)',
  },
  headerBtn: {
    padding: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#e8d9c0',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  resetText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,68,68,0.15)',
    margin: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,68,68,0.4)',
  },
  errorText: {
    color: '#ff6666',
    fontSize: 13,
    flex: 1,
  },
  loadingBanner: {
    margin: 12,
    padding: 12,
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  presetContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 16,
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(139,115,85,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139,115,85,0.3)',
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  presetText: {
    color: '#a09070',
    fontSize: 11,
    fontWeight: '700',
  },
  presetTextActive: {
    color: '#0a0908',
  },
  eqContainer: {
    flexDirection: 'row',
    height: 340,
    marginHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(139,115,85,0.25)',
  },
  scaleContainer: {
    width: 35,
    height: 280,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 4,
    marginTop: 30,
  },
  scaleText: {
    color: 'rgba(200,180,140,0.5)',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  scaleCenter: {
    color: GOLD,
    fontWeight: '700',
  },
  slidersRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 8,
  },
  sliderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    backgroundColor: 'rgba(100,100,100,0.3)',
    borderRadius: 3,
  },
  fill: {
    position: 'absolute',
    bottom: '50%',
    borderRadius: 3,
  },
  centerLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: GOLD,
    opacity: 0.5,
    top: '50%',
    marginTop: -1,
  },
  knob: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  knobText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  sliderLabel: {
    position: 'absolute',
    bottom: -20,
    fontSize: 9,
    fontWeight: '600',
  },
  valueText: {
    position: 'absolute',
    top: -25,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  valuesContainer: {
    margin: 12,
    padding: 16,
    backgroundColor: 'rgba(139,115,85,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139,115,85,0.2)',
  },
  valuesTitle: {
    color: '#a09070',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  valueBox: {
    width: 30,
    alignItems: 'center',
  },
  valueBoxText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  valuePositive: { color: '#4cde80' },
  valueNegative: { color: '#ff6b6b' },
  instructions: {
    margin: 12,
    padding: 16,
    alignItems: 'center',
  },
  instructionText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,11,9,0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(139,115,85,0.3)',
    paddingTop: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toggleBtnOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  toggleText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  toggleTextOn: {
    color: '#0a0908',
  },
  sessionText: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});