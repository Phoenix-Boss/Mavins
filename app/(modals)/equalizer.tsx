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
import { MasteringControls } from "@/components/equalizer/MasteringControls"; // Renamed from OutputControls
import { ParametricEQ } from "@/components/equalizer/parametricEq";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const PlayerTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  artwork: z.union([z.string(), z.number()]).optional(),
});

type PlayerTrack = z.infer<typeof PlayerTrackSchema>;

// ✅ UPDATED STATE TO MATCH NEW ARCHITECTURE
interface EQState {
  // Core EQ - applies to both graphic and parametric
  enabled: boolean;
  
  // Graphic EQ
  graphic: {
    preamp: number;           // -15 to +15
    bands: number[];          // 9 bands, -15 to +15 each
    bass: number;             // 0-100
    treble: number;           // 0-100
  };
  
  // Parametric EQ
  parametric: {
    selectedFilter: 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';
    filterEnabled: boolean;
    gain: number;           // -15 to +15
    frequency: number;      // 20-20000 Hz
    q: number;              // 0.1-10
  };

  // FX Page
  fx: {
    mode: 'Reverb' | 'Echo';
    damp: number;
    filter: number;
    fade: number;
    preDelay: number;
    preDelayMix: number;
    size: number;
    mix: number;
  };

  // Mastering Page (renamed from output)
  mastering: {
    balance: number;        // 0-100 (L/R balance)
    stereoWidth: number;    // 0-100 (stereo enhancement)
    loudness: number;       // 0-100 (perceived loudness)
    limiter: boolean;       // true/false
    mono: boolean;
  };

  // Preset management
  selectedPreset: string;
  presetType: 'factory' | 'custom'; // Track if current preset is factory or custom
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

// Separate factory and custom presets
const FACTORY_PRESETS = [
  { id: '1', name: 'Flat', values: [0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, type: 'factory' },
  { id: '2', name: 'Rock', values: [4, 3, 2, 1, 0, -1, -2, -3, -4], preamp: 2, type: 'factory' },
  { id: '3', name: 'Pop', values: [2, 2, 1, 0, -1, -1, 0, 1, 2], preamp: 1, type: 'factory' },
  { id: '4', name: 'Jazz', values: [3, 2, 1, 0, 1, 2, 3, 2, 1], preamp: 1.5, type: 'factory' },
  { id: '5', name: 'Classical', values: [2, 1, 0, 0, 0, 0, 1, 2, 3], preamp: 0.5, type: 'factory' },
  { id: '6', name: 'Hip Hop', values: [5, 4, 3, 2, 0, -2, -3, -4, -5], preamp: 2.5, type: 'factory' },
  { id: '7', name: 'Electronic', values: [4, 3, 2, 0, -1, -2, 0, 2, 4], preamp: 2, type: 'factory' },
  { id: '8', name: 'Acoustic', values: [1, 1, 0, -1, -1, 0, 1, 2, 3], preamp: 0, type: 'factory' },
  { id: '9', name: 'Bass Boost', values: [6, 5, 4, 2, 0, -2, -4, -5, -6], preamp: 3, type: 'factory' },
  { id: '10', name: 'Treble Boost', values: [-4, -3, -2, 0, 2, 3, 4, 5, 6], preamp: 2, type: 'factory' },
];

// Start with some example custom presets
const CUSTOM_PRESETS = [
  { id: 'c1', name: 'My Voice', values: [2, 1, 0, -1, 0, 1, 2, 3, 2], preamp: 1, type: 'custom' },
  { id: 'c2', name: 'Night Listening', values: [-2, -1, 0, 1, 2, 1, 0, -1, -2], preamp: -1, type: 'custom' },
];

export default function EqualizerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isMusicPlaying } = useGlobalUIState();

  // New state for header
  const [activePage, setActivePage] = useState<"eq" | "fx" | "mastering">("eq");
  const [eqMode, setEqMode] = useState<'graphic' | 'parametric'>('graphic');
  
  // ✅ UPDATED INITIAL STATE
  const [eqState, setEqState] = useState<EQState>({
    enabled: false,
    graphic: {
      preamp: 0,
      bands: Array(9).fill(0),
      bass: 50,
      treble: 50,
    },
    parametric: {
      selectedFilter: 'peaking',
      filterEnabled: false,
      gain: 0,
      frequency: 1000,
      q: 1.0,
    },
    fx: {
      mode: 'Reverb',
      damp: 36, 
      filter: 91, 
      fade: 27, 
      preDelay: 54, 
      preDelayMix: 58, 
      size: 73, 
      mix: 37,
    },
    mastering: {
      balance: 50, 
      stereoWidth: 50, 
      loudness: 67, 
      limiter: true,
      mono: false,
    },
    selectedPreset: "Flat",
    presetType: 'factory',
  });

  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [presetFilter, setPresetFilter] = useState<'all' | 'factory' | 'custom'>('all');
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

  // ✅ PERSISTENCE
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
        const parsed = JSON.parse(saved) as EQState;
        setEqState(parsed);
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

  // GRAPHIC EQ HANDLERS
  const handleBandChange = useCallback((index: number, value: number) => {
    if (eqState.presetType === 'factory') return; // Can't edit factory presets
    setEqState(prev => ({
      ...prev,
      graphic: {
        ...prev.graphic,
        bands: prev.graphic.bands.map((v, i) => i === index ? value : v)
      }
    }));
  }, [eqState.presetType]);

  const handlePreampChange = useCallback((value: number) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, preamp: value }
    }));
  }, [eqState.presetType]);

  const handleBassChange = useCallback((value: number) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, bass: value }
    }));
  }, [eqState.presetType]);

  const handleTrebleChange = useCallback((value: number) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, treble: value }
    }));
  }, [eqState.presetType]);

  // PARAMETRIC EQ HANDLERS
  const handleParametricUpdate = useCallback((updates: Partial<EQState['parametric']>) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      parametric: { ...prev.parametric, ...updates }
    }));
  }, [eqState.presetType]);

  // FX HANDLERS
  const handleFXUpdate = useCallback((updates: Partial<EQState['fx']>) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      fx: { ...prev.fx, ...updates }
    }));
  }, [eqState.presetType]);

  // MASTERING HANDLERS
  const handleMasteringUpdate = useCallback((updates: Partial<EQState['mastering']>) => {
    if (eqState.presetType === 'factory') return;
    setEqState(prev => ({
      ...prev,
      mastering: { ...prev.mastering, ...updates }
    }));
  }, [eqState.presetType]);

  // PRESET HANDLERS
  const selectPreset = useCallback((preset: any) => {
    setEqState(prev => ({
      ...prev,
      enabled: true, // Auto-enable when selecting preset
      graphic: {
        ...prev.graphic,
        preamp: preset.preamp,
        bands: preset.values,
        bass: 50,
        treble: 50,
      },
      selectedPreset: preset.name,
      presetType: preset.type,
    }));
    setPresetModalVisible(false);
  }, []);

  const saveAsCustomPreset = useCallback(() => {
    Alert.prompt(
      'Save Custom Preset',
      'Enter a name for your preset',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (presetName) => {
            if (!presetName) return;
            
            // Create new custom preset
            const newPreset = {
              id: `c${Date.now()}`,
              name: presetName,
              values: eqState.graphic.bands,
              preamp: eqState.graphic.preamp,
              type: 'custom'
            };
            
            // In a real app, you'd save this to AsyncStorage
            Alert.alert('Success', 'Preset saved!');
            
            // Update state to show it's now a custom preset
            setEqState(prev => ({
              ...prev,
              selectedPreset: presetName,
              presetType: 'custom',
            }));
          }
        }
      ]
    );
  }, [eqState.graphic]);

  const toggleEQ = useCallback(() => {
    setEqState(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  // Get combined presets for modal
  const allPresets = useMemo(() => {
    if (presetFilter === 'factory') return FACTORY_PRESETS;
    if (presetFilter === 'custom') return CUSTOM_PRESETS;
    return [...FACTORY_PRESETS, ...CUSTOM_PRESETS];
  }, [presetFilter]);

  const { enabled, graphic, parametric, fx, mastering, selectedPreset, presetType } = eqState;

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

          {/* Watermark */}
          <Watermark source={require("@/assets/images/mavins.png")} />

          {/* Updated Header with all new props */}
          <HeaderNavigation 
            activePage={activePage}
            onPageChange={setActivePage}
            eqMode={eqMode}
            onEqModeChange={setEqMode}
            eqEnabled={enabled}
            onEqToggle={toggleEQ}
            insets={insets}
          />

          <View style={[styles.contentContainer, { 
            paddingTop: insets.top + 100, // Increased to account for two-row header
            paddingBottom: insets.bottom + verticalScale(10)
          }]}>
            
            {/* Now Playing Bar */}
            <NowPlayingBar 
              track={validatedTrack} 
              compact 
              isPlaying={isMusicPlaying}
              progress={0.42}
              onPlayPause={() => Alert.alert('Player', 'Play/Pause tapped')}
              onPress={() => router.push('/player')}
            />

            {/* EQ PAGE - Shows either Graphic or Parametric based on mode */}
            {activePage === "eq" && (
              <View style={styles.pageContainer}>
                {eqMode === 'graphic' ? (
                  // Graphic EQ View
                  <>
                    <View style={styles.eqSlidersContainer}>
                      <VerticalEQSlider
                        value={graphic.preamp}
                        onChange={handlePreampChange}
                        isPreamp={true}
                        label="Level"
                        enabled={enabled && presetType === 'custom'}
                        isFactory={presetType === 'factory'}
                      />
                      {FREQUENCY_BANDS.map((band, index) => (
                        <VerticalEQSlider
                          key={band.label}
                          value={graphic.bands[index]}
                          onChange={(value) => handleBandChange(index, value)}
                          label={band.label}
                          enabled={enabled && presetType === 'custom'}
                          frequency={band.frequency}
                          isFactory={presetType === 'factory'}
                        />
                      ))}
                    </View>

                    <EQGraph values={graphic.bands} enabled={enabled} />

                    <View style={styles.controlRow}>
                      {/* Preset selector - always works */}
                      <TouchableOpacity 
                        style={styles.presetButton} 
                        onPress={() => setPresetModalVisible(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.presetButtonText}>{selectedPreset}</Text>
                        {presetType === 'factory' && (
                          <Text style={styles.lockIcon}>🔒</Text>
                        )}
                      </TouchableOpacity>

                      {/* Save button - only for custom mode */}
                      {presetType === 'custom' && (
                        <TouchableOpacity 
                          style={styles.saveButton}
                          onPress={saveAsCustomPreset}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.saveButtonText}>SAVE</Text>
                        </TouchableOpacity>
                      )}
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
                          value={graphic.bass}
                          label="BASS"
                          onChange={handleBassChange}
                          color={Colors.metallicBrown.primary}
                          size={70}
                          enabled={enabled && presetType === 'custom'}
                          isFactory={presetType === 'factory'}
                        />
                        <RotaryKnob
                          value={graphic.treble}
                          label="TREBLE"
                          onChange={handleTrebleChange}
                          color={Colors.metallicBrown.secondary}
                          size={70}
                          enabled={enabled && presetType === 'custom'}
                          isFactory={presetType === 'factory'}
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  // Parametric EQ View
                  <ParametricEQ 
                    enabled={enabled && presetType === 'custom'}
                    parametricState={parametric}
                    onUpdate={handleParametricUpdate}
                    isFactory={presetType === 'factory'}
                  />
                )}
              </View>
            )}

            {/* FX PAGE - Presets and effects */}
            {activePage === "fx" && (
              <View style={styles.pageContainer}>
                <FXControls 
                  enabled={enabled && presetType === 'custom'}
                  fxState={fx}
                  onUpdate={handleFXUpdate}
                  isFactory={presetType === 'factory'}
                />
              </View>
            )}

            {/* MASTERING PAGE - All processing affects the playing song */}
            {activePage === "mastering" && (
              <View style={styles.pageContainer}>
                <MasteringControls 
                  enabled={enabled && presetType === 'custom'}
                  masteringState={mastering}
                  onUpdate={handleMasteringUpdate}
                  isFactory={presetType === 'factory'}
                />
              </View>
            )}

          </View>

          {/* Enhanced Preset Modal */}
          <Modal
            animationType="slide"
            transparent={true}
            visible={presetModalVisible}
            onRequestClose={() => setPresetModalVisible(false)}
          >
            <BlurView intensity={80} style={styles.modalOverlay}>
              <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>PRESETS</Text>
                  <TouchableOpacity onPress={() => setPresetModalVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Filter tabs */}
                <View style={styles.filterTabs}>
                  <TouchableOpacity 
                    style={[styles.filterTab, presetFilter === 'all' && styles.filterTabActive]}
                    onPress={() => setPresetFilter('all')}
                  >
                    <Text style={[styles.filterTabText, presetFilter === 'all' && styles.filterTabTextActive]}>ALL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.filterTab, presetFilter === 'factory' && styles.filterTabActive]}
                    onPress={() => setPresetFilter('factory')}
                  >
                    <Text style={[styles.filterTabText, presetFilter === 'factory' && styles.filterTabTextActive]}>FACTORY</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.filterTab, presetFilter === 'custom' && styles.filterTabActive]}
                    onPress={() => setPresetFilter('custom')}
                  >
                    <Text style={[styles.filterTabText, presetFilter === 'custom' && styles.filterTabTextActive]}>CUSTOM</Text>
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={allPresets}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={[styles.presetItem, selectedPreset === item.name && styles.presetItemSelected]}
                      onPress={() => selectPreset(item)}
                    >
                      <View style={styles.presetItemLeft}>
                        <Text style={styles.presetItemName}>{item.name}</Text>
                        {item.type === 'factory' && (
                          <Text style={styles.presetTypeIcon}>🔒</Text>
                        )}
                        <View style={styles.presetCurve}>
                          {item.values.map((val: number, idx: number) => (
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
    justifyContent: "center",
    alignItems: "center",
    marginTop: verticalScale(10),
    paddingHorizontal: scale(5),
    gap: scale(10),
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginRight: scale(5),
  },
  lockIcon: {
    fontSize: moderateScale(12),
    marginLeft: scale(5),
  },
  saveButton: {
    backgroundColor: Colors.metallicBrown.primary,
    borderRadius: 20,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(20),
  },
  saveButtonText: {
    color: "#000",
    fontSize: moderateScale(12),
    fontWeight: "700",
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
    maxHeight: SCREEN_HEIGHT * 0.8,
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
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
    padding: scale(2),
    marginBottom: verticalScale(20),
  },
  filterTab: {
    flex: 1,
    paddingVertical: verticalScale(8),
    alignItems: 'center',
    borderRadius: 18,
  },
  filterTabActive: {
    backgroundColor: Colors.metallicBrown.primary,
  },
  filterTabText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#000',
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
    borderRadius: 8,
  },
  presetItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
  },
  presetItemName: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '500',
    width: scale(80),
  },
  presetTypeIcon: {
    fontSize: moderateScale(12),
    width: scale(20),
  },
  presetCurve: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: verticalScale(30),
    gap: 2,
    marginLeft: scale(5),
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