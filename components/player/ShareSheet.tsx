// components/player/ShareSheet.tsx
//
// Premium portrait-modal share sheet with cover art design
// — Shows beautiful card with track artwork and metadata
// — No video processing, no FFmpeg, no waveform extraction
// — Shares custom Mavin share links with rich previews
// — Clean, fast, and simple

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
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  Alert,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import RNShare from 'react-native-share';
import { triggerHaptic } from '@/helpers/haptics';

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
  userId?: string; // User ID for tracking shares
  onShareGenerated?: (shareUrl: string) => void; // Callback when share URL is generated
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
const SNAP_MS = 320;
const MAX_SHEET_H = SCREEN_H * 0.94;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — ARTIST & TITLE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function extractAllArtists(title: string, existingArtist?: string): string {
  if (existingArtist && existingArtist.trim().length > 0) return existingArtist.trim();
  
  const combined = `${title}`;
  let artists: string[] = [];

  const ftMatches = combined.match(/^([^-–—•|]+?)\s+(?:ft\.|feat\.|featuring)\s+([^-–—•|]+)/i);
  if (ftMatches) {
    const mainArtist = ftMatches[1].trim();
    const featuredArtists = ftMatches[2].split(/[,&]/).map(a => a.trim());
    artists = [mainArtist, ...featuredArtists];
  }

  if (artists.length === 0) {
    const multiMatches = combined.match(/^([^-–—•|]+?)\s+(?:x|&)\s+([^-–—•|]+)/i);
    if (multiMatches) {
      const mainArtist = multiMatches[1].trim();
      const otherArtists = multiMatches[2].split(/[,&]/).map(a => a.trim());
      artists = [mainArtist, ...otherArtists];
    }
  }

  if (artists.length > 1) {
    artists = [...new Set(artists)];
    if (artists.length === 2) return `${artists[0]} & ${artists[1]}`;
    const last = artists.pop()!;
    return `${artists.join(', ')} & ${last}`;
  }

  if (artists.length === 1) return artists[0];

  const titleMatch = title.match(/^([^-–—•|]+?)\s*[-–—•|]/);
  if (titleMatch) {
    let potentialArtist = titleMatch[1].trim();
    potentialArtist = potentialArtist.replace(/ft\..*$/, '').trim();
    potentialArtist = potentialArtist.replace(/feat\..*$/, '').trim();
    potentialArtist = potentialArtist.replace(/x\s*[^-]*$/, '').trim();
    return potentialArtist || 'Artist';
  }

  return 'Artist';
}

function normalizeSongTitle(title: string, artistName?: string): string {
  if (!title) return 'Untitled';
  let cleaned = title;

  if (artistName) {
    const artistClean = artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`^${artistClean}\\s*[-–—]\\s*`, 'i'),
      new RegExp(`^${artistClean}\\s*[•|]\\s*`, 'i'),
    ];
    for (const pattern of patterns) cleaned = cleaned.replace(pattern, '');
  }

  const descriptors = [
    /\(Official\s*(Music\s*)?Video\)/gi, /\(Official\s*Audio\)/gi,
    /\(Music\s*Video\)/gi, /\(Lyric\s*Video\)/gi, /\(Visualizer\)/gi,
    /\(Audio\)/gi, /\(Official\)/gi, /\(VEVO\)/gi, /\(vevo\)/gi,
    /\[Official\s*(Music\s*)?Video\]/gi, /\[Official\s*Audio\]/gi,
    /\[Music\s*Video\]/gi, /\[Lyric\s*Video\]/gi, /\[Audio\]/gi,
    /\[Official\]/gi, /\[VEVO\]/gi,
  ];

  for (const pattern of descriptors) cleaned = cleaned.replace(pattern, '');
  
  cleaned = cleaned.replace(/^[-–—•|:\s]+/, '');
  cleaned = cleaned.replace(/[-–—•|:\s]+$/, '');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  
  if (!cleaned.trim()) cleaned = title;
  cleaned = cleaned.trim();
  if (cleaned.length > 0) cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  
  return cleaned || 'Untitled';
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE URL GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function generateShareUrl(
  trackId: string,
  userId: string,
  title: string,
  artist?: string,
  thumbnail?: string,
  taskId?: string
): Promise<string> {
  try {
    const baseUrl = 'https://mavins.vercel.app';
    
    const response = await fetch(`${baseUrl}/api/share/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trackId,
        userId,
        title,
        artist: artist || '',
        thumbnail: thumbnail || '',
        taskId: taskId || null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate share URL: ${response.status}`);
    }

    const data = await response.json();
    return data.shareUrl;
  } catch (error) {
    console.error('[ShareSheet] Error generating share URL:', error);
    // Fallback to YouTube URL
    return `https://www.youtube.com/watch?v=${trackId}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SWATCH DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeSwatch {
  key: string;
  dotColors: [string, string, ...string[]];
  tint: string;
  bgColors: [string, string, ...string[]];
}

const SWATCHES: ThemeSwatch[] = [
  { key: 'gold', dotColors: ['#3d2300', '#b06820', '#3d2300'], tint: 'rgba(61,35,0,0.52)', bgColors: ['#3d2300', '#b06820', '#3d2300'] },
  { key: 'midnight', dotColors: ['#0f0c29', '#302b63', '#24243e'], tint: 'rgba(15,12,41,0.55)', bgColors: ['#0f0c29', '#302b63', '#24243e'] },
  { key: 'ocean', dotColors: ['#071929', '#1a3a4a', '#0d2e40'], tint: 'rgba(7,25,41,0.55)', bgColors: ['#071929', '#1a3a4a', '#0d2e40'] },
  { key: 'rose', dotColors: ['#280a16', '#9e1f40', '#280a16'], tint: 'rgba(40,10,22,0.55)', bgColors: ['#280a16', '#9e1f40', '#280a16'] },
  { key: 'violet', dotColors: ['#12032a', '#5a189a', '#12032a'], tint: 'rgba(18,3,42,0.55)', bgColors: ['#12032a', '#5a189a', '#12032a'] },
  { key: 'neonnoir', dotColors: ['#0a001a', '#8b005d', '#00d4ff'], tint: 'rgba(90,0,60,0.48)', bgColors: ['#0a001a', '#3d0040', '#001833'] },
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

function ShareTarget({ icon, label, onPress, disabled }: { 
  icon: React.ReactNode; 
  label: string; 
  onPress: () => void; 
  disabled?: boolean 
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    triggerHaptic('light');
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 0.82, useNativeDriver: true, speed: 50, bounciness: 2 }),
      Animated.timing(opacityAnim, { toValue: 0.7, useNativeDriver: true, duration: 60 }),
    ]).start();
  }, [disabled]);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }),
      Animated.timing(opacityAnim, { toValue: 1, useNativeDriver: true, duration: 100 }),
    ]).start();
  }, []);

  return (
    <Pressable
      style={[shareTargetStyles.wrap, disabled && shareTargetStyles.disabled]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
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
  disabled: { opacity: 0.4 },
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
  const displayArtist = extractAllArtists(track.title, track.artist);
  const displayTitle = normalizeSongTitle(track.title, displayArtist);

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
        {displayArtist.length > 0 && (
          <Text style={outerCardStyles.artistText} numberOfLines={1}>{displayArtist.toUpperCase()}</Text>
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
  card: {
    width: OUTER_CARD_W,
    height: OUTER_CARD_H,
    borderRadius: moderateScale(22),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 14,
  },
  fallbackBg: { backgroundColor: '#0f0c29' },
  topTextBlock: {
    position: 'absolute',
    top: scale(14),
    left: scale(16),
    right: scale(16),
    alignItems: 'center',
    gap: verticalScale(3),
  },
  artistText: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: moderateScale(9.5),
    fontWeight: '600',
    letterSpacing: 2.5,
    textAlign: 'center',
  },
  titleText: {
    color: '#ffffff',
    fontSize: moderateScale(18),
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    lineHeight: moderateScale(22),
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  titleRule: {
    marginTop: verticalScale(4),
    width: scale(36),
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 1,
  },
  brandRow: { position: 'absolute', bottom: scale(16), right: scale(14) },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: scale(20),
    paddingHorizontal: scale(9),
    paddingVertical: verticalScale(4),
  },
  brandTxt: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: moderateScale(8),
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});

const innerCardStyles = StyleSheet.create({
  card: {
    width: INNER_CARD_W,
    height: INNER_CARD_H,
    borderRadius: moderateScale(20),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.65,
    shadowRadius: 28,
  },
  glassOverlay: { backgroundColor: 'rgba(255,255,255,0.055)' },
  glassRim: { borderRadius: moderateScale(20), borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  topGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '30%',
    borderTopLeftRadius: moderateScale(20),
    borderTopRightRadius: moderateScale(20),
  },
  artworkWrap: {
    elevation: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
  },
  artwork: { width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: moderateScale(14) },
  artworkFallback: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artGlassRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: moderateScale(14),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.14)',
  } as any,
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function ShareSheet({ visible, onClose, track, userId, onShareGenerated }: ShareSheetProps) {
  const insets = useSafeAreaInsets();
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string>('');

  const animMap = useMemo(() => {
    const m = new Map<string, Animated.Value>();
    SWATCHES.forEach((sw, i) => m.set(sw.key, new Animated.Value(i === 0 ? 1 : 0)));
    return m;
  }, []);

  const [selectedSwatch, setSelectedSwatch] = useState(SWATCHES[0].key);
  const [copyToast, setCopyToast] = useState(false);

  // ─── Sheet slide animation ──────────────────────────────────────────────
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
      
      // Generate share URL when sheet opens
      if (!shareUrl && !isGenerating) {
        generateShareUrlForTrack();
      }
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SCREEN_H, duration: SNAP_MS, useNativeDriver: true }),
        Animated.timing(backdropOp, { toValue: 0, duration: SNAP_MS, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSwatchSelect = useCallback((key: string) => {
    animMap.get(selectedSwatch)?.setValue(0);
    animMap.get(key)?.setValue(1);
    setSelectedSwatch(key);
  }, [selectedSwatch, animMap]);

  // ─── Generate share URL ──────────────────────────────────────────────────
  const generateShareUrlForTrack = useCallback(async () => {
    if (!track.id && !track.videoId) {
      console.warn('[ShareSheet] No track ID available');
      return;
    }

    if (!userId) {
      console.warn('[ShareSheet] No user ID available');
      return;
    }

    setIsGenerating(true);
    try {
      const trackId = track.videoId || track.id || '';
      const url = await generateShareUrl(
        trackId,
        userId,
        track.title,
        track.artist,
        track.thumbnail
      );
      setShareUrl(url);
      onShareGenerated?.(url);
    } catch (error) {
      console.error('[ShareSheet] Failed to generate share URL:', error);
      // Fallback to YouTube
      const fallbackUrl = track.videoId 
        ? `https://www.youtube.com/watch?v=${track.videoId}`
        : track.url || '';
      setShareUrl(fallbackUrl);
    } finally {
      setIsGenerating(false);
    }
  }, [track, userId, onShareGenerated]);

  // ─── Share helpers ──────────────────────────────────────────────────────
  const displayArtist = extractAllArtists(track.title, track.artist);
  const displayTitle = normalizeSongTitle(track.title, displayArtist);
  
  // Use custom share URL if generated, otherwise fallback to YouTube
  const finalShareUrl = shareUrl || (track.videoId ? `https://www.youtube.com/watch?v=${track.videoId}` : track.url || '');
  
  // Format: "Listen to [Song Title] 🎵" with URL embedded
  const shareText = `Listen to ${displayTitle} 🎵`;
  const shareMessage = `${shareText}\n\n${finalShareUrl}`;

  const handleCopy = useCallback(async () => {
    triggerHaptic();
    
    if (isGenerating) {
      Alert.alert('Generating link...', 'Please wait while we prepare your share link.');
      return;
    }

    if (!finalShareUrl) {
      Alert.alert('Error', 'Unable to generate share link. Please try again.');
      return;
    }

    try {
      // On iOS, set both the text and URL in the clipboard
      // On Android, set the full message with URL
      if (Platform.OS === 'ios') {
        // iOS can store both text and URL separately
        Clipboard.setString(shareText);
        // Also store URL separately for iOS rich previews
        // Note: iOS automatically detects URLs in clipboard text
      } else {
        // Android: set the full message with URL
        Clipboard.setString(shareMessage);
      }
      
      setCopyToast(false);
      setTimeout(() => setCopyToast(true), 10);
    } catch (error) {
      console.error('[ShareSheet] Copy error:', error);
      Alert.alert('Error', 'Failed to copy link. Please try again.');
    }
  }, [isGenerating, finalShareUrl, shareText, shareMessage]);

  const handleShare = useCallback(async (platform?: string) => {
    triggerHaptic();

    if (isGenerating) {
      Alert.alert('Generating link...', 'Please wait while we prepare your share link.');
      return;
    }

    if (!finalShareUrl) {
      Alert.alert('Error', 'Unable to generate share link. Please try again.');
      return;
    }

    // Different platforms handle messages differently
    const platformMessage = platform === 'instagram' 
      ? `${shareText}` // Instagram doesn't support clickable URLs in posts
      : shareMessage;

    if (platform) {
      const shareOptions: any = {
        title: displayTitle,
        message: platformMessage,
        url: finalShareUrl,
      };

      switch (platform) {
        case 'whatsapp':
          shareOptions.social = RNShare.Social.WHATSAPP;
          break;
        case 'instagram':
          shareOptions.social = RNShare.Social.INSTAGRAM;
          break;
        case 'telegram':
          shareOptions.social = RNShare.Social.TELEGRAM;
          break;
        case 'x':
          shareOptions.social = RNShare.Social.TWITTER;
          break;
        default:
          try {
            await RNShare.open(shareOptions);
          } catch (error) {
            console.error('[ShareSheet] Share failed:', error);
          }
          return;
      }

      try {
        await RNShare.shareSingle(shareOptions);
      } catch (error) {
        console.error('[ShareSheet] Share failed:', error);
        try {
          await RNShare.open(shareOptions);
        } catch (fallbackError) {
          console.error('[ShareSheet] Fallback share failed:', fallbackError);
        }
      }
    } else {
      // More - generic share using React Native Share
      try {
        await Share.share({ 
          title: displayTitle, 
          message: Platform.OS === 'android' ? shareMessage : shareText,
          url: Platform.OS === 'ios' ? finalShareUrl : undefined,
        });
      } catch (error) {
        console.error('[ShareSheet] Generic share failed:', error);
      }
    }
  }, [isGenerating, finalShareUrl, shareText, shareMessage, displayTitle]);

  const TARGETS = [
    { 
      key: 'cp', 
      label: 'Copy', 
      bg: 'rgba(255,255,255,0.08)', 
      border: true, 
      icon: <Ionicons name="copy-outline" size={moderateScale(19)} color="#fff" />, 
      onPress: handleCopy 
    },
    { 
      key: 'wa', 
      label: 'WhatsApp', 
      bg: '#25D366', 
      icon: <MaterialCommunityIcons name="whatsapp" size={moderateScale(21)} color="#fff" />, 
      onPress: () => handleShare('whatsapp') 
    },
    { 
      key: 'tg', 
      label: 'Telegram', 
      bg: '#2AABEE', 
      icon: <MaterialCommunityIcons name="send" size={moderateScale(19)} color="#fff" />, 
      onPress: () => handleShare('telegram') 
    },
    { 
      key: 'x', 
      label: 'X', 
      bg: '#000000', 
      icon: <MaterialCommunityIcons name="twitter" size={moderateScale(20)} color="#fff" />, 
      onPress: () => handleShare('x') 
    },
    { 
      key: 'ig', 
      label: 'Instagram', 
      bg: '#C13584', 
      icon: <MaterialCommunityIcons name="instagram" size={moderateScale(21)} color="#fff" />, 
      onPress: () => handleShare('instagram') 
    },
    { 
      key: 'mo', 
      label: 'More', 
      bg: 'rgba(255,255,255,0.08)', 
      border: true, 
      icon: <Ionicons name="ellipsis-horizontal" size={moderateScale(19)} color="#fff" />, 
      onPress: () => handleShare() 
    },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
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
          <PreviewCard track={{ ...track, artist: displayArtist }} animMap={animMap} />
          <ThemeSwatchColumn selected={selectedSwatch} onSelect={handleSwatchSelect} />
        </View>

        {/* Divider */}
        <View style={ss.divider} />

        {/* Share targets */}
        <View style={[ss.tabRow, { paddingBottom: Math.max(insets.bottom, verticalScale(10)) }]}>
          {TARGETS.map(t => (
            <ShareTarget
              key={t.key}
              label={t.label}
              onPress={t.onPress}
              disabled={isGenerating}
              icon={<IconCircle bg={t.bg} border={(t as any).border}>{t.icon}</IconCircle>}
            />
          ))}
        </View>

        <CopyToast visible={copyToast} />
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
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