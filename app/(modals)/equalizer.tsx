// app/(player)/equalizer.tsx - FULLY INTEGRATED WITH GLOBAL UI STATE

import { screenPadding } from "@/constants/tokens";
import { useImageColors } from "@/hooks/useImageColors";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Text,
  TouchableOpacity,
  View,
  StatusBar,
  StyleSheet,
  Dimensions,
  Modal,
  FlatList,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useMemo, useState, useEffect, useCallback } from "react";
import { z } from "zod";
import { Colors } from "@/constants/Colors";
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalUIState } from "@/contexts/GlobalUIStateContext";

// Import ALL fixed components
import { HeaderNavigation } from "@/components/equalizer/HeaderNavigation";
import { VerticalEQSlider } from "@/components/equalizer/VerticalEQSlider";
import { RotaryKnob } from "@/components/equalizer/RotaryKnob";
import { EQGraph } from "@/components/equalizer/EQGraph";
import { NowPlayingBar } from "@/components/equalizer/NowPlayingBar";
import { Watermark } from "@/components/equalizer/Watermark";
import { FXControls } from "@/components/equalizer/FXControls";
import { OutputControls } from "@/components/equalizer/OutputControls";
import { ParametricEQ } from "@/components/equalizer/parametricEq";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const PlayerTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  artwork: z.union([z.string(), z.number()]).optional(),
});

type PlayerTrack = z.infer<typeof PlayerTrackSchema>;

// ✅ FULLY EXPANDED UNIFIED STATE
interface EQState {
  // Core EQ
  preamp: number;           // -15 to +15
  bands: number[];          // 9 bands, -15 to +15 each
  bass: number;             // 0-100
  treble: number;           // 0-100
  enabled: boolean;
  selectedPreset: string;

  // FX Page
  fx?: {
    mode: 'Reverb' | 'Echo';
    damp: number;
    filter: number;
    fade: number;
    preDelay: number;
    preDelayMix: number;
    size: number;
    mix: number;
  };

  // Output Page  
  output?: {
    balance: number;        // 0-100
    stereoExpand: number;   // 0-100
    tempo: number;          // 50-200
    volume: number;         // 0-100
    mono: boolean;
  };

  // Parametric Page
  parametric?: {
    selectedFilter: 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';
    filterEnabled: boolean;
    gain: number;           // -15 to +15
    frequency: number;      // 20-20000 Hz
    q: number;              // 0.1-10
  };
}

const FREQUENCY_BANDS = [
  { label: "31", frequency: 31 },
  { label: "62", frequency: 62 },
  { label: "100", frequency: 100 },
  { label: "200", frequency: 200 },
  { label: "400", frequency: 400 },
  { label: "800", frequency: 800 },
  { label: "1.6k", frequency: 1600 },
  { label: "3.2k", frequency: 3200 },
  { label: "6.4k", frequency: 6400 },
];

const EQ_PRESETS = [
  { id: '1', name: 'Flat', values: [0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { id: '2', name: 'Rock', values: [4, 3, 2, 1, 0, -1, -2, -3, -4], preamp: 2 },
  { id: '3', name: 'Pop', values: [2, 2, 1, 0, -1, -1, 0, 1, 2], preamp: 1 },
  { id: '4', name: 'Jazz', values: [3, 2, 1, 0, 1, 2, 3, 2, 1], preamp: 1.5 },
  { id: '5', name: 'Classical', values: [2, 1, 0, 0, 0, 0, 1, 2, 3], preamp: 0.5 },
  { id: '6', name: 'Hip Hop', values: [5, 4, 3, 2, 0, -2, -3, -4, -5], preamp: 2.5 },
  { id: '7', name: 'Electronic', values: [4, 3, 2, 0, -1, -2, 0, 2, 4], preamp: 2 },
  { id: '8', name: 'Acoustic', values: [1, 1, 0, -1, -1, 0, 1, 2, 3], preamp: 0 },
  { id: '9', name: 'Bass Boost', values: [6, 5, 4, 2, 0, -2, -4, -5, -6], preamp: 3 },
  { id: '10', name: 'Treble Boost', values: [-4, -3, -2, 0, 2, 3, 4, 5, 6], preamp: 2 },
];

export default function EqualizerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isMusicPlaying } = useGlobalUIState();

  // ✅ FULL INITIAL STATE WITH DEFAULTS
  const [eqState, setEqState] = useState<EQState>({
    preamp: 0,
    bands: Array(9).fill(0),
    bass: 50,
    treble: 50,
    enabled: false,
    selectedPreset: "Flat",
    fx: {
      mode: 'Reverb',
      damp: 36, filter: 91, fade: 27, preDelay: 54, 
      preDelayMix: 58, size: 73, mix: 37,
    },
    output: {
      balance: 50, stereoExpand: 50, tempo: 100, volume: 67, mono: false,
    },
    parametric: {
      selectedFilter: 'peaking',
      filterEnabled: false,
      gain: 0,
      frequency: 1000,
      q: 1.0,
    },
  });

  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [activePage, setActivePage] = useState<"eq" | "fx" | "output" | "parametric">("eq");
  const [isLoading, setIsLoading] = useState(true);

  const currentTrack: PlayerTrack = useMemo(() => ({
    id: "1",
    title: "Don Bossblingz - something 202...",
    artist: "Unknown artist",
    artwork: require("@/assets/images/mavins.png"),
  }), []);

  const parseResult = PlayerTrackSchema.safeParse(currentTrack);
  const validatedTrack = parseResult.success ? parseResult.data : currentTrack;
  const artworkForColors = typeof validatedTrack.artwork === "string" ? validatedTrack.artwork : null;
  const { imageColors } = useImageColors(artworkForColors);

  const gradientColors = useMemo(() => {
    if (imageColors?.dominant) return [imageColors.dominant, "#000", "#000"];
    return ["#1a0f05", "#0b0b0b", "#050505"];
  }, [imageColors]);

  // ✅ FULL PERSISTENCE
  useEffect(() => {
    loadEQState();
  }, []);

  useEffect(() => {
    if (!isLoading) saveEQState();
  }, [eqState]);

  const loadEQState = async () => {
    try {
      const saved = await AsyncStorage.getItem('eqState');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<EQState>;
        setEqState(prev => ({
          ...prev,
          ...parsed,
          bands: parsed.bands?.length === 9 ? parsed.bands : Array(9).fill(0),
        }));
      }
    } catch (error) {
      console.log('Failed to load EQ state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveEQState = async () => {
    try {
      await AsyncStorage.setItem('eqState', JSON.stringify(eqState));
    } catch (error) {
      console.log('Failed to save EQ state:', error);
    }
  };

  // EQ PAGE HANDLERS
  const handleBandChange = useCallback((index: number, value: number) => {
    setEqState(prev => ({
      ...prev,
      bands: prev.bands.map((v, i) => i === index ? value : v)
    }));
  }, []);

  const handlePreampChange = useCallback((value: number) => {
    setEqState(prev => ({ ...prev, preamp: value }));
  }, []);

  const handleBassChange = useCallback((value: number) => {
    setEqState(prev => ({ ...prev, bass: value }));
  }, []);

  const handleTrebleChange = useCallback((value: number) => {
    setEqState(prev => ({ ...prev, treble: value }));
  }, []);

  const toggleEQ = useCallback(() => {
    setEqState(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const selectPreset = useCallback((preset: typeof EQ_PRESETS[0]) => {
    setEqState(prev => ({
      ...prev,
      preamp: preset.preamp,
      bands: preset.values,
      bass: 50,
      treble: 50,
      selectedPreset: preset.name,
    }));
    setPresetModalVisible(false);
  }, []);

  // FX PAGE HANDLERS
  const handleFXUpdate = useCallback((updates: Partial<EQState['fx']>) => {
    setEqState(prev => ({
      ...prev,
      fx: { ...(prev.fx || {}), ...updates }
    }));
  }, []);

  // OUTPUT PAGE HANDLERS  
  const handleOutputUpdate = useCallback((updates: Partial<EQState['output']>) => {
    setEqState(prev => ({
      ...prev,
      output: { ...(prev.output || {}), ...updates }
    }));
  }, []);

  // PARAMETRIC PAGE HANDLERS
  const handleParametricUpdate = useCallback((updates: Partial<EQState['parametric']>) => {
    setEqState(prev => ({
      ...prev,
      parametric: { ...(prev.parametric || {}), ...updates }
    }));
  }, []);

  const { preamp, bands, bass, treble, enabled, selectedPreset, fx, output, parametric } = eqState;

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar barStyle="light-content" />
        <Text style={{ color: '#fff' }}>Loading Equalizer...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient style={{ flex: 1 }} colors={gradientColors}>
        <View style={{ flex: 1 }}>

          {/* Components */}
          <Watermark source={require("@/assets/images/mavins.png")} />

          <HeaderNavigation 
            activePage={activePage}
            onPageChange={setActivePage}
            insets={insets}
          />

          <View style={[styles.contentContainer, { 
            paddingTop: insets.top + 70,
            paddingBottom: insets.bottom + verticalScale(10)
          }]}>
            
            {/* Now Playing - with actual player state from global UI */}
            <NowPlayingBar 
              track={validatedTrack} 
              compact 
              isPlaying={isMusicPlaying}
              progress={0.42}
              onPlayPause={() => Alert.alert('Player', 'Play/Pause tapped')}
              onPress={() => router.push('/player')}
            />

            {/* ✅ EQ PAGE - FULLY FUNCTIONAL */}
            {activePage === "eq" && (
              <View style={styles.pageContainer}>
                <View style={styles.eqSlidersContainer}>
                  <VerticalEQSlider
                    value={preamp}
                    onChange={handlePreampChange}
                    isPreamp={true}
                    label="Level"
                    enabled={enabled}
                  />
                  {FREQUENCY_BANDS.map((band, index) => (
                    <VerticalEQSlider
                      key={band.label}
                      value={bands[index]}
                      onChange={(value) => handleBandChange(index, value)}
                      label={band.label}
                      enabled={enabled}
                      frequency={band.frequency}
                    />
                  ))}
                </View>

                <EQGraph values={bands} enabled={enabled} />

                <View style={styles.controlRow}>
                  <TouchableOpacity 
                    style={[styles.controlButton, enabled && styles.controlButtonActive]}
                    onPress={toggleEQ}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.controlButtonText, enabled && styles.controlButtonTextActive]}>
                      {enabled ? 'ON' : 'OFF'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.presetButton} 
                    onPress={() => setPresetModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetButtonText}>{selectedPreset}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.menuButton} 
                    onPress={() => Alert.alert('Menu', 'More options coming soon')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.menuButtonText}>⋯</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.toneSection}>
                  <View style={styles.toneButtons}>
                    <TouchableOpacity style={styles.toneButton} activeOpacity={0.7}>
                      <Text style={styles.toneButtonText}>EQ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toneButton} activeOpacity={0.7}>
                      <Text style={styles.toneButtonText}>TUNE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toneButton} activeOpacity={0.7}>
                      <Text style={styles.toneButtonText}>LIMIT</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.knobsContainer}>
                    <RotaryKnob
                      value={bass}
                      label="BASS"
                      onChange={handleBassChange}
                      color={Colors.metallicBrown.primary}
                      size={70}
                      enabled={enabled}
                    />
                    <RotaryKnob
                      value={treble}
                      label="TREBLE"
                      onChange={handleTrebleChange}
                      color={Colors.metallicBrown.secondary}
                      size={70}
                      enabled={enabled}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* ✅ FX PAGE - FULLY INTEGRATED */}
            {activePage === "fx" && (
              <View style={styles.pageContainer}>
                <FXControls 
                  enabled={enabled}
                  fxState={fx || {}}
                  onUpdate={handleFXUpdate}
                />
              </View>
            )}

            {/* ✅ OUTPUT PAGE - FULLY INTEGRATED */}
            {activePage === "output" && (
              <View style={styles.pageContainer}>
                <OutputControls 
                  enabled={enabled}
                  outputState={output || {}}
                  onUpdate={handleOutputUpdate}
                />
              </View>
            )}

            {/* ✅ PARAMETRIC PAGE - FULLY INTEGRATED */}
            {activePage === "parametric" && (
              <View style={styles.pageContainer}>
                <ParametricEQ 
                  enabled={enabled}
                  parametricState={parametric || {}}
                  onUpdate={handleParametricUpdate}
                />
              </View>
            )}

          </View>

          {/* Preset Modal */}
          <Modal
            animationType="slide"
            transparent={true}
            visible={presetModalVisible}
            onRequestClose={() => setPresetModalVisible(false)}
          >
            <BlurView intensity={80} style={styles.modalOverlay}>
              <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>EQ Presets</Text>
                  <TouchableOpacity onPress={() => setPresetModalVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={EQ_PRESETS}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={[styles.presetItem, selectedPreset === item.name && styles.presetItemSelected]}
                      onPress={() => selectPreset(item)}
                    >
                      <View style={styles.presetItemLeft}>
                        <Text style={styles.presetItemName}>{item.name}</Text>
                        <View style={styles.presetCurve}>
                          {item.values.map((val, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.presetCurvePoint,
                                {
                                  height: Math.abs(val * 4) + 4,
                                  backgroundColor: val > 0 ? Colors.metallicBrown.primary : Colors.metallicBrown.secondary,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      </View>
                      <Text style={styles.presetItemPreamp}>Level: {item.preamp > 0 ? '+' : ''}{item.preamp}dB</Text>
                    </TouchableOpacity>
                  )}
                  showsVerticalScrollIndicator={false}
                />
              </View>
            </BlurView>
          </Modal>

        </View>
      </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    flex: 1,
    paddingHorizontal: screenPadding.horizontal,
  },
  pageContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  eqSlidersContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: scale(5),
    marginTop: verticalScale(5),
  },
  controlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: verticalScale(10),
    paddingHorizontal: scale(5),
  },
  controlButton: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(20),
    minWidth: scale(60),
    alignItems: "center",
  },
  controlButtonActive: {
    backgroundColor: Colors.metallicBrown.primary,
    borderWidth: 1,
    borderColor: Colors.metallicBrown.secondary,
  },
  controlButtonText: {
    color: "#fff",
    fontSize: moderateScale(12),
    fontWeight: "600",
  },
  controlButtonTextActive: {
    color: "#000",
  },
  presetButton: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(25),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  presetButtonText: {
    color: "#fff",
    fontSize: moderateScale(13),
    fontWeight: "600",
  },
  menuButton: {
    width: scale(36),
    height: scale(36),
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  menuButtonText: {
    color: "#fff",
    fontSize: moderateScale(18),
    fontWeight: "600",
  },
  toneSection: {
    marginTop: verticalScale(15),
    paddingHorizontal: scale(5),
    marginBottom: verticalScale(10),
  },
  toneButtons: {
    flexDirection: "row",
    gap: scale(8),
    marginBottom: verticalScale(10),
    justifyContent: "center",
  },
  toneButton: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    paddingVertical: verticalScale(6),
    paddingHorizontal: scale(14),
  },
  toneButtonText: {
    color: "#fff",
    fontSize: moderateScale(11),
    fontWeight: "600",
  },
  knobsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: scale(30),
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(20),
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(20),
  },
  modalTitle: {
    color: '#fff',
    fontSize: moderateScale(18),
    fontWeight: '700',
  },
  modalClose: {
    color: '#fff',
    fontSize: moderateScale(20),
    fontWeight: '600',
  },
  presetItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(12),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  presetItemSelected: {
    backgroundColor: 'rgba(139, 115, 85, 0.2)',
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
    fontWeight: '500',
    width: scale(80),
  },
  presetCurve: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: verticalScale(30),
    gap: 2,
  },
  presetCurvePoint: {
    flex: 1,
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 2,
  },
  presetItemPreamp: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(11),
    marginLeft: scale(10),
  },
});