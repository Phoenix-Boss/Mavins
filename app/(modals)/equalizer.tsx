// app/(player)/equalizer.tsx - FULLY INTEGRATED & REFINED

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
  TextInput,
  KeyboardAvoidingView,
  Platform,
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
import { MasteringControls } from "@/components/equalizer/MasteringControls";
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
  enabled: boolean;
  
  // Graphic EQ
  graphic: {
    preamp: number;
    bands: number[];
    bass: number;
    treble: number;
  };
  
  // Parametric EQ
  parametric: {
    selectedFilter: 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch';
    filterEnabled: boolean;
    gain: number;
    frequency: number;
    q: number;
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

  // Mastering Page
  mastering: {
    balance: number;
    stereoWidth: number;
    loudness: number;
    limiter: boolean;
    mono: boolean;
  };

  // Preset management
  selectedPreset: string;
  presetType: 'factory' | 'custom';
}

// Storage Keys
const STORAGE_KEY_EQ_STATE = 'eqState_v2';
const STORAGE_KEY_CUSTOM_PRESETS = 'eqCustomPresets_v2';

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

// Factory presets are immutable
const FACTORY_PRESETS = [
  { id: '1', name: 'Flat', values: [0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, type: 'factory' as const },
  { id: '2', name: 'Rock', values: [4, 3, 2, 1, 0, -1, -2, -3, -4], preamp: 2, type: 'factory' as const },
  { id: '3', name: 'Pop', values: [2, 2, 1, 0, -1, -1, 0, 1, 2], preamp: 1, type: 'factory' as const },
  { id: '4', name: 'Jazz', values: [3, 2, 1, 0, 1, 2, 3, 2, 1], preamp: 1.5, type: 'factory' as const },
  { id: '5', name: 'Classical', values: [2, 1, 0, 0, 0, 0, 1, 2, 3], preamp: 0.5, type: 'factory' as const },
  { id: '6', name: 'Hip Hop', values: [5, 4, 3, 2, 0, -2, -3, -4, -5], preamp: 2.5, type: 'factory' as const },
  { id: '7', name: 'Electronic', values: [4, 3, 2, 0, -1, -2, 0, 2, 4], preamp: 2, type: 'factory' as const },
  { id: '8', name: 'Acoustic', values: [1, 1, 0, -1, -1, 0, 1, 2, 3], preamp: 0, type: 'factory' as const },
  { id: '9', name: 'Bass Boost', values: [6, 5, 4, 2, 0, -2, -4, -5, -6], preamp: 3, type: 'factory' as const },
  { id: '10', name: 'Treble Boost', values: [-4, -3, -2, 0, 2, 3, 4, 5, 6], preamp: 2, type: 'factory' as const },
];

export default function EqualizerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isMusicPlaying } = useGlobalUIState();

  // Navigation State
  const [activePage, setActivePage] = useState<"eq" | "fx" | "mastering">("eq");
  const [eqMode, setEqMode] = useState<'graphic' | 'parametric'>('graphic');
  
  // Data State
  const [customPresets, setCustomPresets] = useState<any[]>([]);
  
  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [presetFilter, setPresetFilter] = useState<'all' | 'factory' | 'custom'>('all');
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  // Core EQ State
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

  // --- DATA PERSISTENCE ---

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load both state and custom presets in parallel
        const [stateJson, presetsJson] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_EQ_STATE),
          AsyncStorage.getItem(STORAGE_KEY_CUSTOM_PRESETS)
        ]);

        if (stateJson) {
          const parsedState = JSON.parse(stateJson) as EQState;
          setEqState(parsedState);
        }
        
        if (presetsJson) {
          setCustomPresets(JSON.parse(presetsJson));
        }
      } catch (error) {
        console.log('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      AsyncStorage.setItem(STORAGE_KEY_EQ_STATE, JSON.stringify(eqState));
    }
  }, [eqState, isLoading]);

  // --- HANDLERS ---

  // Helper to check if we need to detach from factory preset
  const detachFromFactory = useCallback(() => {
    if (eqState.presetType === 'factory') {
      setEqState(prev => ({
        ...prev,
        selectedPreset: 'Custom',
        presetType: 'custom'
      }));
    }
  }, [eqState.presetType]);

  const handleBandChange = useCallback((index: number, value: number) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      graphic: {
        ...prev.graphic,
        bands: prev.graphic.bands.map((v, i) => i === index ? value : v)
      }
    }));
  }, [detachFromFactory]);

  const handlePreampChange = useCallback((value: number) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, preamp: value }
    }));
  }, [detachFromFactory]);

  const handleBassChange = useCallback((value: number) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, bass: value }
    }));
  }, [detachFromFactory]);

  const handleTrebleChange = useCallback((value: number) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      graphic: { ...prev.graphic, treble: value }
    }));
  }, [detachFromFactory]);

  const handleParametricUpdate = useCallback((updates: Partial<EQState['parametric']>) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      parametric: { ...prev.parametric, ...updates }
    }));
  }, [detachFromFactory]);

  const handleFXUpdate = useCallback((updates: Partial<EQState['fx']>) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      fx: { ...prev.fx, ...updates }
    }));
  }, [detachFromFactory]);

  const handleMasteringUpdate = useCallback((updates: Partial<EQState['mastering']>) => {
    detachFromFactory();
    setEqState(prev => ({
      ...prev,
      mastering: { ...prev.mastering, ...updates }
    }));
  }, [detachFromFactory]);

  const toggleEQ = useCallback(() => {
    setEqState(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  // --- PRESET MANAGEMENT ---

  const selectPreset = useCallback((preset: any) => {
    setEqState(prev => ({
      ...prev,
      enabled: true,
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

  const handleSavePreset = useCallback(async () => {
    if (!newPresetName.trim()) {
      Alert.alert("Error", "Please enter a preset name");
      return;
    }

    const newPreset = {
      id: `c${Date.now()}`,
      name: newPresetName.trim(),
      values: eqState.graphic.bands,
      preamp: eqState.graphic.preamp,
      type: 'custom' as const
    };

    const updatedPresets = [...customPresets, newPreset];
    setCustomPresets(updatedPresets);
    
    try {
      await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(updatedPresets));
      
      // Update current state to reflect newly saved preset
      setEqState(prev => ({
        ...prev,
        selectedPreset: newPreset.name,
        presetType: 'custom'
      }));
      
      setNewPresetName('');
      setSaveModalVisible(false);
      Alert.alert("Success", "Preset saved!");
    } catch (e) {
      Alert.alert("Error", "Failed to save preset");
    }
  }, [newPresetName, eqState.graphic, customPresets]);

  const allPresets = useMemo(() => {
    if (presetFilter === 'factory') return FACTORY_PRESETS;
    if (presetFilter === 'custom') return customPresets;
    return [...FACTORY_PRESETS, ...customPresets];
  }, [presetFilter, customPresets]);

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

          <Watermark source={require("@/assets/images/mavins.png")} />

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
            paddingTop: insets.top + 100, 
            paddingBottom: insets.bottom + verticalScale(10)
          }]}>
            
            <NowPlayingBar 
              track={validatedTrack} 
              compact 
              isPlaying={isMusicPlaying}
              progress={0.42}
              onPlayPause={() => Alert.alert('Player', 'Play/Pause tapped')}
              onPress={() => router.push('/player')}
            />

            {/* EQ PAGE */}
            {activePage === "eq" && (
              <View style={styles.pageContainer}>
                {eqMode === 'graphic' ? (
                  <>
                    <View style={styles.eqSlidersContainer}>
                      <VerticalEQSlider
                        value={graphic.preamp}
                        onChange={handlePreampChange}
                        isPreamp={true}
                        label="Level"
                        enabled={enabled} // Unlocked logic: allow editing, just switch mode internally
                      />
                      {FREQUENCY_BANDS.map((band, index) => (
                        <VerticalEQSlider
                          key={band.label}
                          value={graphic.bands[index]}
                          onChange={(value) => handleBandChange(index, value)}
                          label={band.label}
                          enabled={enabled}
                          frequency={band.frequency}
                        />
                      ))}
                    </View>

                    <EQGraph values={graphic.bands} enabled={enabled} />

                    <View style={styles.controlRow}>
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

                      <TouchableOpacity 
                        style={styles.saveButton}
                        onPress={() => setSaveModalVisible(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.saveButtonText}>SAVE</Text>
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
                    </View>
                  </>
                ) : (
                  <ParametricEQ 
                    enabled={enabled}
                    parametricState={parametric}
                    onUpdate={handleParametricUpdate}
                  />
                )}
              </View>
            )}

            {/* FX PAGE */}
            {activePage === "fx" && (
              <View style={styles.pageContainer}>
                <FXControls 
                  enabled={enabled}
                  fxState={fx}
                  onUpdate={handleFXUpdate}
                />
              </View>
            )}

            {/* MASTERING PAGE */}
            {activePage === "mastering" && (
              <View style={styles.pageContainer}>
                <MasteringControls 
                  enabled={enabled}
                  masteringState={mastering}
                  onUpdate={handleMasteringUpdate}
                />
              </View>
            )}

          </View>

          {/* PRESET SELECTION MODAL */}
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

                <View style={styles.filterTabs}>
                  {(['all', 'factory', 'custom'] as const).map((filter) => (
                    <TouchableOpacity 
                      key={filter}
                      style={[styles.filterTab, presetFilter === filter && styles.filterTabActive]}
                      onPress={() => setPresetFilter(filter)}
                    >
                      <Text style={[styles.filterTabText, presetFilter === filter && styles.filterTabTextActive]}>
                        {filter.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
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
                  ListEmptyComponent={<Text style={{color: '#666', textAlign: 'center', marginTop: 20}}>No custom presets yet</Text>}
                />
              </View>
            </BlurView>
          </Modal>

          {/* SAVE PRESET MODAL (Cross-Platform) */}
          <Modal
            animationType="fade"
            transparent
            visible={saveModalVisible}
            onRequestClose={() => setSaveModalVisible(false)}
          >
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalOverlay}
            >
              <View style={styles.saveModalContainer}>
                <View style={styles.saveModalContent}>
                  <Text style={styles.modalTitle}>Save Preset</Text>
                  
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter preset name"
                    placeholderTextColor="#666"
                    value={newPresetName}
                    onChangeText={setNewPresetName}
                    autoFocus
                  />

                  <View style={styles.saveModalButtons}>
                    <TouchableOpacity 
                      style={[styles.saveModalBtn, { backgroundColor: '#333' }]}
                      onPress={() => setSaveModalVisible(false)}
                    >
                      <Text style={styles.saveModalBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.saveModalBtn, { backgroundColor: Colors.metallicBrown.primary }]}
                      onPress={handleSavePreset}
                    >
                      <Text style={[styles.saveModalBtnText, { color: '#000' }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
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
  // Save Modal Styles
  saveModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  saveModalContent: {
    width: SCREEN_WIDTH * 0.85,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: scale(25),
    alignItems: 'center',
  },
  textInput: {
    width: '100%',
    height: verticalScale(50),
    backgroundColor: '#333',
    borderRadius: 10,
    paddingHorizontal: scale(15),
    color: '#fff',
    fontSize: moderateScale(16),
    marginVertical: verticalScale(20),
  },
  saveModalButtons: {
    flexDirection: 'row',
    gap: scale(15),
    width: '100%',
    justifyContent: 'space-between',
  },
  saveModalBtn: {
    flex: 1,
    height: verticalScale(45),
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveModalBtnText: {
    color: '#fff',
    fontSize: moderateScale(15),
    fontWeight: '600',
  },
});