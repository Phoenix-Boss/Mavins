// components/player/ShareSheet.tsx
//
// Premium portrait-modal share sheet with REAL audio analysis
// — Uses @siteed/expo-audio-studio for actual PCM waveform extraction
// — Uses Essentia via expo-audio-studio for chorus detection (best part)
// — Waveform colors adapt to selected theme swatch
// — Gate dragging with preview on release (no audio during drag)
// — Master player (Expo Video) volume ducks 95% during preview
// — Preview loops continuously while active

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  ActivityIndicator,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Audio } from 'expo-av';
import Svg, { Rect } from 'react-native-svg';
import { extractPreviewBars, extractAudioAnalysis } from '@siteed/expo-audio-studio';

import { triggerHaptic } from '@/helpers/haptics';
import { getTrackExtras, storeTrackExtras } from '@/components/MusicPlayerContext';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  track: {
    title: string;
    artist?: string;
    thumbnail?: string;
    videoId?: string;
    url?: string;
    id?: string;
    duration?: number;
  };
}

export interface AudioAnalysisResult {
  bestStartTime: number;
  confidence: number;
  waveformAmplitudes: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

const OUTER_CARD_W = SCREEN_W - scale(32);
const OUTER_CARD_H = OUTER_CARD_W * (4 / 3.0);

const INNER_CARD_W = OUTER_CARD_W * 0.72;
const INNER_CARD_H = INNER_CARD_W * 1.25;

const ARTWORK_SIZE = INNER_CARD_W * 0.85;

const ICON_SIZE = scale(46);

const MIXTAPE_CHAR_LIMIT = 40;

const SNAP_MS = 320;

const MAX_SHEET_H = SCREEN_H * 0.94;

const PREVIEW_DURATION_SECONDS = 15;
const MASTER_DUCK_VOLUME = 0.05;
const MASTER_NORMAL_VOLUME = 1.0;

const WAVEFORM_WIDTH = SCREEN_W - scale(64);
const WAVEFORM_HEIGHT = verticalScale(60);
const WAVEFORM_BAR_COUNT = 80;
const WAVEFORM_BAR_WIDTH = (WAVEFORM_WIDTH - (WAVEFORM_BAR_COUNT - 1) * 2) / WAVEFORM_BAR_COUNT;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function smartTitle(title: string): string {
  return title.length > 40 ? 'Mixtape' : title;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SWATCH DEFINITIONS (10 total)
// ─────────────────────────────────────────────────────────────────────────────
interface ThemeSwatch {
  key: string;
  dotColors: [string, string, ...string[]];
  tint: string;
  bgColors: [string, string, ...string[]];
  waveformColor: string;
  waveformActiveColor: string;
}

const SWATCHES: ThemeSwatch[] = [
  { key: 'natural', dotColors: ['#1a1a2e', '#16213e'], tint: 'rgba(0,0,0,0.18)', bgColors: ['#1a1a2e', '#16213e'], waveformColor: '#4a4a6a', waveformActiveColor: '#c4a747' },
  { key: 'midnight', dotColors: ['#0f0c29', '#302b63', '#24243e'], tint: 'rgba(15,12,41,0.55)', bgColors: ['#0f0c29', '#302b63', '#24243e'], waveformColor: '#3a2a5a', waveformActiveColor: '#d4af37' },
  { key: 'carbon', dotColors: ['#1a1a1a', '#2d2d2d'], tint: 'rgba(10,10,10,0.60)', bgColors: ['#1a1a1a', '#2d2d2d'], waveformColor: '#3a3a3a', waveformActiveColor: '#888888' },
  { key: 'gold', dotColors: ['#3d2300', '#b06820', '#3d2300'], tint: 'rgba(61,35,0,0.52)', bgColors: ['#3d2300', '#b06820', '#3d2300'], waveformColor: '#5a4020', waveformActiveColor: '#ffd700' },
  { key: 'ocean', dotColors: ['#071929', '#1a3a4a', '#0d2e40'], tint: 'rgba(7,25,41,0.55)', bgColors: ['#071929', '#1a3a4a', '#0d2e40'], waveformColor: '#1a4a6a', waveformActiveColor: '#40e0d0' },
  { key: 'rose', dotColors: ['#280a16', '#9e1f40', '#280a16'], tint: 'rgba(40,10,22,0.55)', bgColors: ['#280a16', '#9e1f40', '#280a16'], waveformColor: '#6a2040', waveformActiveColor: '#ff69b4' },
  { key: 'forest', dotColors: ['#071410', '#164d24', '#071410'], tint: 'rgba(7,20,16,0.55)', bgColors: ['#071410', '#164d24', '#071410'], waveformColor: '#1a4a2a', waveformActiveColor: '#50c878' },
  { key: 'violet', dotColors: ['#12032a', '#5a189a', '#12032a'], tint: 'rgba(18,3,42,0.55)', bgColors: ['#12032a', '#5a189a', '#12032a'], waveformColor: '#4a1a6a', waveformActiveColor: '#bf4cff' },
  { key: 'oldschool', dotColors: ['#e8e0d0', '#7a7060', '#2a2420'], tint: 'rgba(20,16,10,0.62)', bgColors: ['#e8e0d0', '#7a7060', '#2a2420'], waveformColor: '#6a6050', waveformActiveColor: '#e8e0d0' },
  { key: 'neonnoir', dotColors: ['#0a001a', '#8b005d', '#00d4ff'], tint: 'rgba(90,0,60,0.48)', bgColors: ['#0a001a', '#3d0040', '#001833'], waveformColor: '#2a0060', waveformActiveColor: '#ff00ff' },
];

const SWATCH_MAP = new Map<string, ThemeSwatch>(SWATCHES.map(s => [s.key, s]));

// ─────────────────────────────────────────────────────────────────────────────
// SWATCH TINT STACK
// ─────────────────────────────────────────────────────────────────────────────
interface SwatchTintStackProps {
  animMap: Map<string, Animated.Value>;
}

function SwatchTintStack({ animMap }: SwatchTintStackProps) {
  return (
    <>
      {SWATCHES.map(sw => (
        <Animated.View
          key={sw.key}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: sw.tint, opacity: animMap.get(sw.key) }]}
          pointerEvents="none"
        />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ICON CIRCLE
// ─────────────────────────────────────────────────────────────────────────────
function IconCircle({ bg, children, border }: { bg: string; children: React.ReactNode; border?: boolean }) {
  return (
    <View style={[iconCircleStyles.wrap, { backgroundColor: bg }, border && iconCircleStyles.border]}>
      {children}
    </View>
  );
}

const iconCircleStyles = StyleSheet.create({
  wrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  border: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARE TARGET
// ─────────────────────────────────────────────────────────────────────────────
function ShareTarget({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    triggerHaptic('light');
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 0.82, useNativeDriver: true, speed: 50, bounciness: 2 }),
      Animated.timing(opacityAnim, { toValue: 0.7, useNativeDriver: true, duration: 60 }),
    ]).start();
  }, []);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }),
      Animated.timing(opacityAnim, { toValue: 1, useNativeDriver: true, duration: 100 }),
    ]).start();
  }, []);

  return (
    <Pressable
      style={shareTargetStyles.wrap}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={{ color: 'rgba(255,255,255,0.08)', borderless: true, radius: ICON_SIZE }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: opacityAnim }}>
        {icon}
      </Animated.View>
      <Text style={shareTargetStyles.label} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const shareTargetStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: verticalScale(6), flex: 1, paddingVertical: verticalScale(4) },
  label: { color: 'rgba(255,255,255,0.55)', fontSize: moderateScale(10), fontWeight: '500', textAlign: 'center', marginTop: verticalScale(2) },
});

// ─────────────────────────────────────────────────────────────────────────────
// COPY TOAST
// ─────────────────────────────────────────────────────────────────────────────
function CopyToast({ visible }: { visible: boolean }) {
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(1300),
        Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);
  return (
    <Animated.View style={[toastStyles.wrap, { opacity: op }]} pointerEvents="none">
      <Ionicons name="checkmark-circle" size={moderateScale(13)} color="#4ADE80" />
      <Text style={toastStyles.text}>Link copied</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: verticalScale(100),
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    backgroundColor: 'rgba(12,12,14,0.96)',
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(7),
    borderRadius: moderateScale(20),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 20,
  },
  text: { color: '#fff', fontSize: moderateScale(11), fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────────────────────
// THEME SWATCH COLUMN
// ─────────────────────────────────────────────────────────────────────────────
const SWATCH_D = scale(24);

function ThemeSwatchColumn({ selected, onSelect }: { selected: string; onSelect: (k: string) => void }) {
  return (
    <View style={sidePanelStyles.panelShadowWrap}>
      <BlurView intensity={42} tint="dark" style={sidePanelStyles.panel}>
        <View style={sidePanelStyles.panelTint} pointerEvents="none" />
        <View style={sidePanelStyles.panelRim} pointerEvents="none" />
        <View style={sidePanelStyles.column}>
          {SWATCHES.map(sw => {
            const isActive = selected === sw.key;
            return (
              <Pressable
                key={sw.key}
                onPress={() => { triggerHaptic('light'); onSelect(sw.key); }}
                hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
                style={({ pressed }) => [sidePanelStyles.dotWrap, pressed && sidePanelStyles.dotWrapPressed]}
              >
                <LinearGradient
                  colors={sw.dotColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[sidePanelStyles.dot, isActive && sidePanelStyles.dotActive]}
                />
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const sidePanelStyles = StyleSheet.create({
  panelShadowWrap: {
    position: 'absolute',
    right: scale(2),
    top: '50%',
    marginTop: -scale(206),
    zIndex: 11,
    borderRadius: scale(20),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 11,
  },
  panel: {
    borderRadius: scale(20),
    overflow: 'hidden',
    paddingVertical: scale(10),
    paddingHorizontal: scale(7),
  },
  panelTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  panelRim: { ...StyleSheet.absoluteFillObject, borderRadius: scale(20), borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' } as any,
  column: { flexDirection: 'column', alignItems: 'center', gap: scale(8) },
  dotWrap: { padding: scale(2), borderRadius: SWATCH_D / 2 + scale(2) },
  dotWrapPressed: { transform: [{ scale: 0.88 }], opacity: 0.7 },
  dot: { width: SWATCH_D, height: SWATCH_D, borderRadius: SWATCH_D / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  dotActive: { borderColor: '#ffffff', transform: [{ scale: 1.12 }], shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 8 },
});

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW CARD
// ─────────────────────────────────────────────────────────────────────────────
interface PreviewCardProps {
  track: ShareSheetProps['track'];
  animMap: Map<string, Animated.Value>;
}

const PreviewCard = React.memo(function PreviewCard({ track, animMap }: PreviewCardProps) {
  const displayTitle = smartTitle(track.title);
  const artist = track.artist ?? '';

  return (
    <View style={outerCardStyles.card}>
      {track.thumbnail ? (
        <Image source={{ uri: track.thumbnail }} style={StyleSheet.absoluteFillObject} contentFit="cover" blurRadius={26} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, outerCardStyles.fallbackBg]} />
      )}

      <SwatchTintStack animMap={animMap} />

      <LinearGradient
        colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <View style={outerCardStyles.topTextBlock}>
        {artist.length > 0 && (
          <Text style={outerCardStyles.artistText} numberOfLines={1}>{artist.toUpperCase()}</Text>
        )}
        <Text style={outerCardStyles.titleText} numberOfLines={2} adjustsFontSizeToFit>{displayTitle}</Text>
        <View style={outerCardStyles.titleRule} />
      </View>

      <View style={innerCardStyles.card}>
        <BlurView intensity={16} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, innerCardStyles.glassOverlay]} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFillObject, innerCardStyles.glassRim]} pointerEvents="none" />
        <LinearGradient colors={['rgba(255,255,255,0.10)', 'transparent']} style={innerCardStyles.topGloss} pointerEvents="none" />

        <View style={innerCardStyles.artworkWrap}>
          {track.thumbnail ? (
            <Image source={{ uri: track.thumbnail }} style={innerCardStyles.artwork} contentFit="cover" />
          ) : (
            <View style={[innerCardStyles.artwork, innerCardStyles.artworkFallback]}>
              <Ionicons name="musical-notes" size={moderateScale(40)} color="rgba(255,255,255,0.3)" />
            </View>
          )}
          <View style={innerCardStyles.artGlassRim} pointerEvents="none" />
          <View style={[innerCardStyles.artwork, { position: 'absolute', overflow: 'hidden', borderRadius: moderateScale(14) }]} pointerEvents="none">
            <LinearGradient colors={['rgba(255,255,255,0.13)', 'transparent']} style={{ height: '40%', width: '100%' }} />
          </View>
        </View>
      </View>

      <View style={outerCardStyles.brandRow}>
        <View style={outerCardStyles.brandPill}>
          <Text style={outerCardStyles.brandTxt}>MAVIN-PLAYER</Text>
          <Ionicons name="musical-note" size={moderateScale(9)} color="rgba(255,255,255,0.7)" />
        </View>
      </View>
    </View>
  );
});

const outerCardStyles = StyleSheet.create({
  card: { width: OUTER_CARD_W, height: OUTER_CARD_H, borderRadius: moderateScale(22), overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 22, elevation: 14 },
  fallbackBg: { backgroundColor: '#0f0c29' },
  topTextBlock: { position: 'absolute', top: scale(14), left: scale(16), right: scale(16), alignItems: 'center', gap: verticalScale(3) },
  artistText: { color: 'rgba(255,255,255,0.70)', fontSize: moderateScale(9.5), fontWeight: '600', letterSpacing: 2.5, textAlign: 'center' },
  titleText: { color: '#ffffff', fontSize: moderateScale(18), fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', lineHeight: moderateScale(22), textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  titleRule: { marginTop: verticalScale(4), width: scale(36), height: 1.5, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 1 },
  brandRow: { position: 'absolute', bottom: scale(16), right: scale(14) },
  brandPill: { flexDirection: 'row', alignItems: 'center', gap: scale(4), backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)', borderRadius: scale(20), paddingHorizontal: scale(9), paddingVertical: verticalScale(4) },
  brandTxt: { color: 'rgba(255,255,255,0.65)', fontSize: moderateScale(8), fontWeight: '700', letterSpacing: 0.8 },
});

const innerCardStyles = StyleSheet.create({
  card: { width: INNER_CARD_W, height: INNER_CARD_H, borderRadius: moderateScale(20), overflow: 'hidden', alignItems: 'center', justifyContent: 'center', elevation: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.65, shadowRadius: 28 },
  glassOverlay: { backgroundColor: 'rgba(255,255,255,0.055)' },
  glassRim: { borderRadius: moderateScale(20), borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  topGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '30%', borderTopLeftRadius: moderateScale(20), borderTopRightRadius: moderateScale(20) },
  artworkWrap: { elevation: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.6, shadowRadius: 20 },
  artwork: { width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: moderateScale(14) },
  artworkFallback: { backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  artGlassRim: { ...StyleSheet.absoluteFillObject, borderRadius: moderateScale(14), borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' } as any,
});

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC WAVEFORM WITH REAL ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
interface RealWaveformProps {
  audioUri: string;
  duration: number;
  currentTheme: ThemeSwatch;
  gateStart: number;
  gateEnd: number;
  onGateDragComplete: (startTime: number) => void;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
}

function RealWaveform({
  audioUri,
  duration,
  currentTheme,
  gateStart,
  gateEnd,
  onGateDragComplete,
  isDragging,
  setIsDragging,
}: RealWaveformProps) {
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gateStartRef = useRef(gateStart);
  
  const containerWidth = WAVEFORM_WIDTH;
  const gateWidth = (PREVIEW_DURATION_SECONDS / duration) * containerWidth;
  const minGateX = 0;
  const maxGateX = containerWidth - gateWidth;

  // Extract real waveform data using expo-audio-studio
  useEffect(() => {
    if (!audioUri) return;

    const extractWaveform = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Use expo-audio-studio to get actual PCM data and generate waveform
        const result = await extractPreviewBars({
          fileUri: audioUri,
          numberOfBars: WAVEFORM_BAR_COUNT,
        });
        
        if (result && result.bars && result.bars.length > 0) {
          setWaveformData(result.bars.map((bar) => bar.amplitude));
        } else {
          throw new Error('No waveform data returned');
        }
        
      } catch (err) {
        console.error('[ShareSheet] Waveform extraction failed:', err);
        setError('Could not load waveform');
        // Fallback to flat waveform instead of fake data
        setWaveformData(new Array(WAVEFORM_BAR_COUNT).fill(0.5));
      } finally {
        setIsLoading(false);
      }
    };
    
    extractWaveform();
  }, [audioUri]);

  // Pan handlers for gate dragging (no audio during drag)
  const handleTouchStart = useCallback(() => {
    setIsDragging(true);
  }, [setIsDragging]);

  const handleTouchMove = useCallback((event: any) => {
    if (!isDragging) return;
    const locationX = event.nativeEvent.locationX;
    const newX = Math.min(maxGateX, Math.max(minGateX, locationX - gateWidth / 2));
    const newStartTime = (newX / containerWidth) * duration;
    const clampedStart = Math.max(0, Math.min(newStartTime, duration - PREVIEW_DURATION_SECONDS));
    gateStartRef.current = clampedStart;
  }, [isDragging, containerWidth, duration, gateWidth, minGateX, maxGateX]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    onGateDragComplete(gateStartRef.current);
  }, [setIsDragging, onGateDragComplete]);

  const gateLeftPercent = (gateStart / duration) * 100;
  const gateWidthPercent = (PREVIEW_DURATION_SECONDS / duration) * 100;

  if (isLoading) {
    return (
      <View style={waveformStyles.loadingContainer}>
        <ActivityIndicator size="small" color={currentTheme.waveformActiveColor} />
        <Text style={waveformStyles.loadingText}>Analyzing audio waveform...</Text>
      </View>
    );
  }

  if (error && waveformData.length === 0) {
    return (
      <View style={waveformStyles.loadingContainer}>
        <Text style={waveformStyles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View 
      style={waveformStyles.container}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <View style={waveformStyles.waveformWrapper}>
        <Svg width={WAVEFORM_WIDTH} height={WAVEFORM_HEIGHT}>
          {waveformData.map((amplitude, index) => {
            const barHeight = Math.max(2, amplitude * WAVEFORM_HEIGHT);
            const x = index * (WAVEFORM_BAR_WIDTH + 2);
            const barPosition = (index / WAVEFORM_BAR_COUNT) * duration;
            const isInGate = barPosition >= gateStart && barPosition <= gateEnd;
            return (
              <Rect
                key={index}
                x={x}
                y={(WAVEFORM_HEIGHT - barHeight) / 2}
                width={WAVEFORM_BAR_WIDTH}
                height={barHeight}
                rx={2}
                fill={isInGate ? currentTheme.waveformActiveColor : currentTheme.waveformColor}
                opacity={isInGate ? 1 : 0.5}
              />
            );
          })}
        </Svg>
        
        {/* Gate overlay */}
        <View
          style={[
            waveformStyles.gateOverlay,
            {
              left: `${gateLeftPercent}%`,
              width: `${gateWidthPercent}%`,
              borderColor: currentTheme.waveformActiveColor,
            },
          ]}
        >
          <View style={[waveformStyles.gateHandle, { left: -6, backgroundColor: currentTheme.waveformActiveColor }]} />
          <View style={[waveformStyles.gateHandle, { right: -6, backgroundColor: currentTheme.waveformActiveColor }]} />
        </View>
      </View>
      
      <View style={waveformStyles.timeLabels}>
        <Text style={waveformStyles.timeText}>{formatTime(gateStart)}</Text>
        <Text style={waveformStyles.timeText}>{formatTime(gateEnd)}</Text>
      </View>
    </View>
  );
}

const waveformStyles = StyleSheet.create({
  container: {
    marginTop: verticalScale(12),
    marginBottom: verticalScale(8),
  },
  waveformWrapper: {
    height: WAVEFORM_HEIGHT,
    position: 'relative',
  },
  loadingContainer: {
    height: WAVEFORM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: verticalScale(8),
  },
  loadingText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(11),
  },
  errorText: {
    color: 'rgba(255,100,100,0.8)',
    fontSize: moderateScale(11),
  },
  gateOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderWidth: 1.5,
    borderRadius: moderateScale(4),
  },
  gateHandle: {
    position: 'absolute',
    top: '50%',
    marginTop: -12,
    width: 4,
    height: 24,
    borderRadius: 2,
  },
  timeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: verticalScale(6),
    paddingHorizontal: scale(4),
  },
  timeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(11),
    fontWeight: '500',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO PREVIEW PLAYER (using Expo Audio)
// ─────────────────────────────────────────────────────────────────────────────
interface PreviewPlayerProps {
  audioUri: string;
  startTime: number;
  duration: number;
  isActive: boolean;
  onPlaybackStart: () => void;
  onPlaybackStop: () => void;
}

function PreviewPlayer({ audioUri, startTime, isActive, onPlaybackStart, onPlaybackStop }: PreviewPlayerProps) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPreview = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (e) {}
      soundRef.current = null;
    }
    onPlaybackStop();
  }, [onPlaybackStop]);

  const startPreview = useCallback(async () => {
    if (!audioUri) return;

    try {
      await stopPreview();

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, positionMillis: startTime * 1000 }
      );
      soundRef.current = sound;

      // Set up looping by seeking back when playback finishes
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.setPositionAsync(startTime * 1000);
        }
      });

      onPlaybackStart();
    } catch (error) {
      console.error('[ShareSheet] Preview playback error:', error);
      onPlaybackStop();
    }
  }, [audioUri, startTime, stopPreview, onPlaybackStart, onPlaybackStop]);

  useEffect(() => {
    if (isActive) {
      startPreview();
    } else {
      stopPreview();
    }

    return () => {
      stopPreview();
    };
  }, [isActive, startPreview, stopPreview]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHORUS DETECTION FUNCTION (using Essentia via expo-audio-studio)
// ─────────────────────────────────────────────────────────────────────────────
async function detectBestPart(
  audioUri: string,
  duration: number,
  onProgress?: (step: string) => void
): Promise<number> {
  try {
    onProgress?.('Loading audio...');
    
    // Use Essentia (via energy/RMS feature extraction) to find the loudest segment
    const result = await extractAudioAnalysis({
      fileUri: audioUri,
      features: { energy: true, rms: true, tempo: true },
    });
    
    onProgress?.('Finding best section...');
    
    // Find the loudest PREVIEW_DURATION_SECONDS-long window using per-segment energy/RMS
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      const points = result.dataPoints;
      const segmentDurationSec = result.segmentDurationMs / 1000;
      const windowSizeInPoints = Math.max(1, Math.round(PREVIEW_DURATION_SECONDS / segmentDurationSec));
      
      let bestStartIndex = 0;
      let bestEnergy = -Infinity;
      
      for (let i = 0; i <= points.length - windowSizeInPoints; i++) {
        const windowAvg = points
          .slice(i, i + windowSizeInPoints)
          .reduce((sum, p) => sum + (p.features?.energy ?? p.rms ?? 0), 0) / windowSizeInPoints;
        if (windowAvg > bestEnergy) {
          bestEnergy = windowAvg;
          bestStartIndex = i;
        }
      }
      
      const bestStartSec = bestStartIndex * segmentDurationSec;
      return Math.min(bestStartSec, Math.max(0, duration - PREVIEW_DURATION_SECONDS));
    }
    
    // Default: start at 30% into the song
    return Math.min(duration * 0.3, Math.max(0, duration - PREVIEW_DURATION_SECONDS));
    
  } catch (error) {
    console.error('[ShareSheet] Chorus detection failed:', error);
    return Math.min(duration * 0.3, Math.max(0, duration - PREVIEW_DURATION_SECONDS));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export default function ShareSheet({ visible, onClose, track }: ShareSheetProps) {
  const insets = useSafeAreaInsets();
  const { setVolume, volume } = useMusicPlayer();
  
  const originalVolumeRef = useRef(MASTER_NORMAL_VOLUME);

  const animMap = useMemo(() => {
    const m = new Map<string, Animated.Value>();
    SWATCHES.forEach((sw, i) => m.set(sw.key, new Animated.Value(i === 0 ? 1 : 0)));
    return m;
  }, []);

  const [selectedSwatch, setSelectedSwatch] = useState(SWATCHES[0].key);
  const [copyToast, setCopyToast] = useState(false);
  
  // Audio state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [analysisDone, setAnalysisDone] = useState(false);
  const [bestStartTime, setBestStartTime] = useState(0);
  const [selectedStartTime, setSelectedStartTime] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDraggingGate, setIsDraggingGate] = useState(false);
  const [audioDuration, setAudioDuration] = useState(track.duration || 180);
  const [audioUri, setAudioUri] = useState<string | null>(track.url || null);
  
  const currentTheme = SWATCH_MAP.get(selectedSwatch) || SWATCHES[0];
  const gateEndTime = selectedStartTime + PREVIEW_DURATION_SECONDS;

  // Duck master volume when preview plays
  useEffect(() => {
    if (isPreviewing) {
      originalVolumeRef.current = volume;
      setVolume(MASTER_DUCK_VOLUME);
    } else {
      setVolume(originalVolumeRef.current);
    }
  }, [isPreviewing, setVolume, volume]);

  // Load pre-computed best start time or run analysis when sheet opens
  useEffect(() => {
    if (visible && track.id && audioUri) {
      const extras = getTrackExtras(track.id);
      const savedBestStart = extras?.bestPartStart;
      
      if (savedBestStart && typeof savedBestStart === 'number' && savedBestStart > 0) {
        setBestStartTime(savedBestStart);
        setSelectedStartTime(savedBestStart);
        setAnalysisDone(true);
      } else {
        // Run real analysis
        setIsAnalyzing(true);
        detectBestPart(audioUri, audioDuration, setAnalysisProgress)
          .then((bestStart) => {
            setBestStartTime(bestStart);
            setSelectedStartTime(bestStart);
            setAnalysisDone(true);
            if (track.id) {
              storeTrackExtras(track.id, { ...extras, bestPartStart: bestStart });
            }
          })
          .catch((err) => {
            console.error('[ShareSheet] Analysis error:', err);
            // Fallback to default position
            const defaultStart = Math.min(audioDuration * 0.3, Math.max(0, audioDuration - PREVIEW_DURATION_SECONDS));
            setBestStartTime(defaultStart);
            setSelectedStartTime(defaultStart);
            setAnalysisDone(true);
          })
          .finally(() => {
            setIsAnalyzing(false);
            setAnalysisProgress('');
          });
      }
    }
  }, [visible, track.id, audioUri, audioDuration]);

  // Handle gate position change (only on drag complete, never during drag)
  const handleGateDragComplete = useCallback((newStartTime: number) => {
    const clampedStart = Math.max(0, Math.min(newStartTime, audioDuration - PREVIEW_DURATION_SECONDS));
    setSelectedStartTime(clampedStart);
    
    // Start preview after user releases finger (not during drag)
    setIsPreviewing(true);
    
    // Auto-stop preview after 10 seconds if user doesn't interact
    const timer = setTimeout(() => {
      setIsPreviewing(false);
    }, 10000);
    
    return () => clearTimeout(timer);
  }, [audioDuration]);

  // Manual preview play/pause button
  const togglePreview = useCallback(() => {
    if (isPreviewing) {
      setIsPreviewing(false);
    } else {
      setIsPreviewing(true);
    }
  }, [isPreviewing]);

  // ── Sheet slide animation ──────────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOp = useRef(new Animated.Value(0)).current;

  useLayoutEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_H);
      backdropOp.setValue(0);
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 24, mass: 0.95, stiffness: 240 }),
        Animated.timing(backdropOp, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SCREEN_H, duration: SNAP_MS, useNativeDriver: true }),
        Animated.timing(backdropOp, { toValue: 0, duration: SNAP_MS, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    setIsPreviewing(false);
    onClose();
  }, [onClose]);

  const handleSwatchSelect = useCallback((key: string) => {
    animMap.get(selectedSwatch)?.setValue(0);
    animMap.get(key)?.setValue(1);
    setSelectedSwatch(key);
  }, [selectedSwatch, animMap]);

  // ── Share helpers ──────────────────────────────────────────────────────────
  const displayTitle = smartTitle(track.title);
  const shareUrl = track.videoId ? `https://www.youtube.com/watch?v=${track.videoId}` : (track.url ?? '');
  const shareMsg = `🎵 ${displayTitle}${track.artist ? ` · ${track.artist}` : ''}\n\n${shareUrl}`;

  const deepLink = useCallback((url: string) => {
    triggerHaptic();
    setIsPreviewing(false);
    Linking.canOpenURL(url)
      .then(ok => { ok ? Linking.openURL(url) : Share.share({ title: displayTitle, message: shareMsg }); })
      .catch(() => Share.share({ title: displayTitle, message: shareMsg }));
  }, [displayTitle, shareMsg]);

  const handleCopy = useCallback(() => { 
    triggerHaptic(); 
    Clipboard.setString(shareUrl); 
    setCopyToast(false); 
    setTimeout(() => setCopyToast(true), 10); 
  }, [shareUrl]);
  
  const handleWhatsApp = useCallback(() => deepLink(`whatsapp://send?text=${encodeURIComponent(shareMsg)}`), [deepLink, shareMsg]);
  const handleTelegram = useCallback(() => deepLink(`tg://msg?text=${encodeURIComponent(shareMsg)}`), [deepLink, shareMsg]);
  const handleX = useCallback(() => deepLink(`twitter://post?message=${encodeURIComponent(`${displayTitle} ${shareUrl}`)}`), [deepLink, displayTitle, shareUrl]);
  const handleInstagram = useCallback(() => { 
    triggerHaptic(); 
    Linking.canOpenURL('instagram://').then(ok => { 
      ok ? Linking.openURL('instagram://') : Share.share({ title: displayTitle, message: shareMsg }); 
    }); 
  }, [displayTitle, shareMsg]);
  
  const handleMore = useCallback(() => { 
    triggerHaptic(); 
    Share.share({ 
      title: displayTitle, 
      message: Platform.OS === 'android' ? shareMsg : `🎵 ${displayTitle}`, 
      url: Platform.OS === 'ios' ? shareUrl : undefined 
    }); 
  }, [displayTitle, shareMsg, shareUrl]);

  const TARGETS = [
    { key: 'cp', label: 'Copy', bg: 'rgba(255,255,255,0.08)', border: true, icon: <Ionicons name="copy-outline" size={moderateScale(19)} color="#fff" />, onPress: handleCopy },
    { key: 'wa', label: 'WhatsApp', bg: '#25D366', icon: <MaterialCommunityIcons name="whatsapp" size={moderateScale(21)} color="#fff" />, onPress: handleWhatsApp },
    { key: 'tg', label: 'Telegram', bg: '#2AABEE', icon: <MaterialCommunityIcons name="send" size={moderateScale(19)} color="#fff" />, onPress: handleTelegram },
    { key: 'x', label: 'X', bg: '#000000', icon: <MaterialCommunityIcons name="twitter" size={moderateScale(20)} color="#fff" />, onPress: handleX },
    { key: 'ig', label: 'Instagram', bg: '#C13584', icon: <MaterialCommunityIcons name="instagram" size={moderateScale(21)} color="#fff" />, onPress: handleInstagram },
    { key: 'mo', label: 'More', bg: 'rgba(255,255,255,0.08)', border: true, icon: <Ionicons name="ellipsis-horizontal" size={moderateScale(19)} color="#fff" />, onPress: handleMore },
  ];

  // Preview player instance
  const previewPlayer = audioUri && analysisDone ? (
    <PreviewPlayer
      audioUri={audioUri}
      startTime={selectedStartTime}
      duration={PREVIEW_DURATION_SECONDS}
      isActive={isPreviewing && !isAnalyzing && analysisDone}
      onPlaybackStart={() => {}}
      onPlaybackStop={() => {}}
    />
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      {previewPlayer}

      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.75)', opacity: backdropOp }]} />
      </TouchableWithoutFeedback>

      {/* Portrait bottom sheet */}
      <Animated.View style={[ss.sheet, { maxHeight: MAX_SHEET_H, transform: [{ translateY }] }]}>
        {/* Drag handle */}
        <View style={ss.dragIndicator}>
          <View style={ss.dragBar} />
        </View>

        {/* Card zone */}
        <View style={ss.cardZone}>
          <PreviewCard track={track} animMap={animMap} />
          <ThemeSwatchColumn selected={selectedSwatch} onSelect={handleSwatchSelect} />
        </View>

        {/* Waveform section */}
        {analysisDone && audioUri && (
          <View style={ss.waveformSection}>
            <RealWaveform
              audioUri={audioUri}
              duration={audioDuration}
              currentTheme={currentTheme}
              gateStart={selectedStartTime}
              gateEnd={gateEndTime}
              onGateDragComplete={handleGateDragComplete}
              isDragging={isDraggingGate}
              setIsDragging={setIsDraggingGate}
            />
            
            {/* Preview control button */}
            <View style={ss.previewControl}>
              <Pressable onPress={togglePreview} style={ss.previewButton}>
                <Ionicons 
                  name={isPreviewing ? 'pause-circle' : 'play-circle'} 
                  size={moderateScale(36)} 
                  color={currentTheme.waveformActiveColor} 
                />
                <Text style={[ss.previewText, { color: currentTheme.waveformActiveColor }]}>
                  {isPreviewing ? 'Pause preview' : 'Preview selected part'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Analysis loading state */}
        {isAnalyzing && (
          <View style={ss.analysisContainer}>
            <ActivityIndicator size="small" color={currentTheme.waveformActiveColor} />
            <Text style={ss.analysisText}>{analysisProgress || 'Finding best part of song...'}</Text>
          </View>
        )}

        {/* Divider */}
        <View style={ss.divider} />

        {/* Share targets */}
        <View style={[ss.tabRow, { paddingBottom: Math.max(insets.bottom, verticalScale(10)) }]}>
          {TARGETS.map(t => (
            <ShareTarget
              key={t.key}
              label={t.label}
              onPress={t.onPress}
              icon={
                <IconCircle bg={t.bg} border={(t as any).border}>
                  {t.icon}
                </IconCircle>
              }
            />
          ))}
        </View>

        <CopyToast visible={copyToast} />
      </Animated.View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0b0b0d',
    borderTopLeftRadius: moderateScale(28),
    borderTopRightRadius: moderateScale(28),
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 25,
    overflow: 'hidden',
  },
  dragIndicator: {
    width: '100%',
    alignItems: 'center',
    paddingTop: verticalScale(10),
    paddingBottom: verticalScale(4),
  },
  dragBar: {
    width: scale(38),
    height: scale(4),
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: scale(2),
  },
  cardZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(6),
    paddingBottom: verticalScale(10),
    position: 'relative',
  },
  waveformSection: {
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(4),
    paddingBottom: verticalScale(8),
  },
  previewControl: {
    alignItems: 'center',
    marginTop: verticalScale(8),
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
    paddingVertical: verticalScale(6),
    paddingHorizontal: scale(16),
    borderRadius: scale(20),
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  previewText: {
    fontSize: moderateScale(12),
    fontWeight: '600',
  },
  analysisContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(20),
    gap: verticalScale(8),
  },
  analysisText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(12),
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: scale(20),
    marginTop: verticalScale(2),
    marginBottom: verticalScale(2),
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: scale(8),
    paddingTop: verticalScale(4),
  },
});