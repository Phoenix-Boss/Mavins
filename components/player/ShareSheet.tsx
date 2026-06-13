// components/player/ShareSheet.tsx
//
// Premium portrait-modal share sheet
// — "Portrait in a portrait": outer card = blurred art bg, inner card floats
// — Artist name + smart title displayed at TOP of outer card (like cover art)
// — Long mixtape titles auto-collapse to "Mixtape"
// — No caption pill, no pen icon
// — Share targets as a flat bottom tab row (single row, evenly spaced) with labels
// — MAVIN-PLAYER branding bottom-right with music note icon
// — Theme picker: static always-visible vertical swatch column (frosted-glass panel)
//   floating on the card's right edge — no toggle, no slide animation.
//
// ZERO RE-RENDER THEME SWITCHING:
//   All 10 tint overlays are pre-rendered as stacked Animated.Views on mount.
//   Each has its own Animated.Value (opacity). Switching themes calls
//   `.setValue()` imperatively on those values — the native layer updates
//   opacity without React ever scheduling a re-render. The card content
//   (artwork, text, branding) never unmounts or re-renders on theme change.
//
// ANIMATION FIX:
//   Sheet reliably slides in from the bottom on first render with visible=true.
//   useLayoutEffect resets translateY/backdropOp synchronously before paint.

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
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';

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
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function smartTitle(title: string): string {
  return title.length > MIXTAPE_CHAR_LIMIT ? 'Mixtape' : title;
}

// ─────────────────────────────────────────────────────────────────────────────
// SWATCH DEFINITIONS  (10 total)
// ─────────────────────────────────────────────────────────────────────────────
interface ThemeSwatch {
  key: string;
  /** Color shown as the circular dot in the swatch column */
  dotColors: [string, string, ...string[]];
  /** rgba tint overlaid on the blurred artwork — used in SwatchTintStack */
  tint: string;
  /** Gradient colours for the outer card background fallback (no thumbnail) */
  bgColors: [string, string, ...string[]];
}

const SWATCHES: ThemeSwatch[] = [
  // ── Original 8 ────────────────────────────────────────────────────────────
  {
    key: 'natural',
    dotColors:  ['#1a1a2e', '#16213e'],
    tint:       'rgba(0,0,0,0.18)',
    bgColors:   ['#1a1a2e', '#16213e'],
  },
  {
    key: 'midnight',
    dotColors:  ['#0f0c29', '#302b63', '#24243e'],
    tint:       'rgba(15,12,41,0.55)',
    bgColors:   ['#0f0c29', '#302b63', '#24243e'],
  },
  {
    key: 'carbon',
    dotColors:  ['#1a1a1a', '#2d2d2d'],
    tint:       'rgba(10,10,10,0.60)',
    bgColors:   ['#1a1a1a', '#2d2d2d'],
  },
  {
    key: 'gold',
    dotColors:  ['#3d2300', '#b06820', '#3d2300'],
    tint:       'rgba(61,35,0,0.52)',
    bgColors:   ['#3d2300', '#b06820', '#3d2300'],
  },
  {
    key: 'ocean',
    dotColors:  ['#071929', '#1a3a4a', '#0d2e40'],
    tint:       'rgba(7,25,41,0.55)',
    bgColors:   ['#071929', '#1a3a4a', '#0d2e40'],
  },
  {
    key: 'rose',
    dotColors:  ['#280a16', '#9e1f40', '#280a16'],
    tint:       'rgba(40,10,22,0.55)',
    bgColors:   ['#280a16', '#9e1f40', '#280a16'],
  },
  {
    key: 'forest',
    dotColors:  ['#071410', '#164d24', '#071410'],
    tint:       'rgba(7,20,16,0.55)',
    bgColors:   ['#071410', '#164d24', '#071410'],
  },
  {
    key: 'violet',
    dotColors:  ['#12032a', '#5a189a', '#12032a'],
    tint:       'rgba(18,3,42,0.55)',
    bgColors:   ['#12032a', '#5a189a', '#12032a'],
  },

  // ── New #9: B&W Old-School ─────────────────────────────────────────────────
  // Monochrome silver-to-charcoal gradient with a sepia-tinged overlay —
  // evokes classic vinyl sleeve aesthetics and silver-gelatin photography.
  {
    key: 'oldschool',
    dotColors:  ['#e8e0d0', '#7a7060', '#2a2420'],
    tint:       'rgba(20,16,10,0.62)',
    bgColors:   ['#e8e0d0', '#7a7060', '#2a2420'],
  },

  // ── New #10: Neon Noir Cinematic ───────────────────────────────────────────
  // A vibe that doesn't exist in mainstream apps: deep wet-asphalt black
  // shot through with magenta-to-cyan underglow — think rain-slicked alley
  // neon reflections in a city that never sleeps. The tint is a near-opaque
  // magenta-purple with just enough transparency to let blurred art breathe.
  {
    key: 'neonnoir',
    dotColors:  ['#0a001a', '#8b005d', '#00d4ff'],
    tint:       'rgba(90,0,60,0.48)',
    bgColors:   ['#0a001a', '#3d0040', '#001833'],
  },
];

// Pre-build a fast key→swatch lookup
const SWATCH_MAP = new Map<string, ThemeSwatch>(SWATCHES.map(s => [s.key, s]));

// ─────────────────────────────────────────────────────────────────────────────
// SWATCH TINT STACK
// Pre-renders all 10 tint overlays at mount. Only the active one has opacity 1;
// the rest are 0. Switching is done imperatively via Animated.Value.setValue()
// on the native driver — React never re-renders.
// ─────────────────────────────────────────────────────────────────────────────
interface SwatchTintStackProps {
  /** Ref map: key → Animated.Value (opacity). Created once in parent. */
  animMap: Map<string, Animated.Value>;
}

function SwatchTintStack({ animMap }: SwatchTintStackProps) {
  return (
    <>
      {SWATCHES.map(sw => (
        <Animated.View
          key={sw.key}
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: sw.tint, opacity: animMap.get(sw.key) },
          ]}
          pointerEvents="none"
        />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ICON CIRCLE
// ─────────────────────────────────────────────────────────────────────────────
function IconCircle({
  bg,
  children,
  border,
}: {
  bg: string;
  children: React.ReactNode;
  border?: boolean;
}) {
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
function ShareTarget({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  // Both scale and opacity are Animated.Values on the native driver.
  // No useState, no JS re-render on press — the native layer responds instantly.
  const scaleAnim   = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    triggerHaptic('light');
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 0.82, useNativeDriver: true, speed: 50, bounciness: 2 }),
      Animated.timing(opacityAnim, { toValue: 0.7,  useNativeDriver: true, duration: 60 }),
    ]).start();
  }, []);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }),
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
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: verticalScale(6),
    flex: 1,
    paddingVertical: verticalScale(4),
  },
  label: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: moderateScale(10),
    fontWeight: '500',
    textAlign: 'center',
    marginTop: verticalScale(2),
  },
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
// Static frosted-glass panel, always visible. 10 swatches.
// ─────────────────────────────────────────────────────────────────────────────
const SWATCH_D = scale(24); // slightly smaller to fit 10 in column comfortably

function ThemeSwatchColumn({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (k: string) => void;
}) {
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
                style={({ pressed }) => [
                  sidePanelStyles.dotWrap,
                  pressed && sidePanelStyles.dotWrapPressed,
                ]}
              >
                <LinearGradient
                  colors={sw.dotColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    sidePanelStyles.dot,
                    isActive && sidePanelStyles.dotActive,
                  ]}
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
    // Panel height ≈ 10*(SWATCH_D + 4px padding*2) + 9 gaps*8 + 20 vert padding
    // ≈ 10*32 + 72 + 20 = 412 scaled → -206 margin
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
  panelTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  panelRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(20),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  } as any,
  column: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: scale(8),
  },
  dotWrap: {
    padding: scale(2),
    borderRadius: SWATCH_D / 2 + scale(2),
  },
  dotWrapPressed: {
    transform: [{ scale: 0.88 }],
    opacity: 0.7,
  },
  dot: {
    width: SWATCH_D,
    height: SWATCH_D,
    borderRadius: SWATCH_D / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.12 }],
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW CARD
// Receives `animMap` — the pre-built opacity Animated.Value map for all tints.
// SwatchTintStack is rendered inside the card; switching themes never causes
// this component to re-render because selectedKey doesn't flow into it.
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

      {/* Blurred artwork background */}
      {track.thumbnail ? (
        <Image
          source={{ uri: track.thumbnail }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          blurRadius={26}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, outerCardStyles.fallbackBg]} />
      )}

      {/* All 10 tint overlays pre-rendered — only active one has opacity 1 */}
      <SwatchTintStack animMap={animMap} />

      {/* Cinematic vignette */}
      <LinearGradient
        colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* TOP TEXT: artist + title */}
      <View style={outerCardStyles.topTextBlock}>
        {artist.length > 0 && (
          <Text style={outerCardStyles.artistText} numberOfLines={1}>
            {artist.toUpperCase()}
          </Text>
        )}
        <Text style={outerCardStyles.titleText} numberOfLines={2} adjustsFontSizeToFit>
          {displayTitle}
        </Text>
        <View style={outerCardStyles.titleRule} />
      </View>

      {/* INNER CARD: floating frosted art frame */}
      <View style={innerCardStyles.card}>
        <BlurView intensity={16} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, innerCardStyles.glassOverlay]} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFillObject, innerCardStyles.glassRim]} pointerEvents="none" />
        <LinearGradient
          colors={['rgba(255,255,255,0.10)', 'transparent']}
          style={innerCardStyles.topGloss}
          pointerEvents="none"
        />

        <View style={innerCardStyles.artworkWrap}>
          {track.thumbnail ? (
            <Image
              source={{ uri: track.thumbnail }}
              style={innerCardStyles.artwork}
              contentFit="cover"
            />
          ) : (
            <View style={[innerCardStyles.artwork, innerCardStyles.artworkFallback]}>
              <Ionicons name="musical-notes" size={moderateScale(40)} color="rgba(255,255,255,0.3)" />
            </View>
          )}
          <View style={innerCardStyles.artGlassRim} pointerEvents="none" />
          <View
            style={[innerCardStyles.artwork, { position: 'absolute', overflow: 'hidden', borderRadius: moderateScale(14) }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={['rgba(255,255,255,0.13)', 'transparent']}
              style={{ height: '40%', width: '100%' }}
            />
          </View>
        </View>
      </View>

      {/* BOTTOM-RIGHT branding */}
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
  fallbackBg: {
    backgroundColor: '#0f0c29',
  },
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
  brandRow: {
    position: 'absolute',
    bottom: scale(16),
    right: scale(14),
  },
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
  glassOverlay: {
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  glassRim: {
    borderRadius: moderateScale(20),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
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
  artwork: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: moderateScale(14),
  },
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
export default function ShareSheet({ visible, onClose, track }: ShareSheetProps) {
  const insets = useSafeAreaInsets();

  // ── Theme state + imperative anim map ─────────────────────────────────────
  // `animMap` is created once (useMemo with [] deps) — a Map of key →
  // Animated.Value. Initial values: first swatch = 1, rest = 0.
  // When selectedSwatch changes we call .setValue() imperatively so the
  // native layer flips opacity without touching React's render cycle.
  const animMap = useMemo(() => {
    const m = new Map<string, Animated.Value>();
    SWATCHES.forEach((sw, i) => m.set(sw.key, new Animated.Value(i === 0 ? 1 : 0)));
    return m;
  }, []);

  const [selectedSwatch, setSelectedSwatch] = useState(SWATCHES[0].key);

  const handleSwatchSelect = useCallback((key: string) => {
    // Flip old → 0, new → 1 imperatively (native driver, no React re-render)
    animMap.get(selectedSwatch)?.setValue(0);
    animMap.get(key)?.setValue(1);
    // Update React state only for the swatch column highlight — the card
    // itself does NOT read selectedSwatch, so it does NOT re-render.
    setSelectedSwatch(key);
  }, [selectedSwatch, animMap]);

  const [copyToast, setCopyToast] = useState(false);

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

  const dismiss = useCallback(() => { onClose(); }, [onClose]);

  // ── Share helpers ──────────────────────────────────────────────────────────
  const displayTitle = smartTitle(track.title);
  const shareUrl = track.videoId
    ? `https://www.youtube.com/watch?v=${track.videoId}`
    : (track.url ?? '');
  const shareMsg = `🎵 ${displayTitle}${track.artist ? ` · ${track.artist}` : ''}\n\n${shareUrl}`;

  const deepLink = useCallback((url: string) => {
    triggerHaptic();
    Linking.canOpenURL(url)
      .then(ok => { ok ? Linking.openURL(url) : Share.share({ title: displayTitle, message: shareMsg }); })
      .catch(() => Share.share({ title: displayTitle, message: shareMsg }));
  }, [displayTitle, shareMsg]);

  const handleCopy      = useCallback(() => { triggerHaptic(); Clipboard.setString(shareUrl); setCopyToast(false); setTimeout(() => setCopyToast(true), 10); }, [shareUrl]);
  const handleWhatsApp  = useCallback(() => deepLink(`whatsapp://send?text=${encodeURIComponent(shareMsg)}`), [deepLink, shareMsg]);
  const handleTelegram  = useCallback(() => deepLink(`tg://msg?text=${encodeURIComponent(shareMsg)}`), [deepLink, shareMsg]);
  const handleX         = useCallback(() => deepLink(`twitter://post?message=${encodeURIComponent(`${displayTitle} ${shareUrl}`)}`), [deepLink, displayTitle, shareUrl]);
  const handleInstagram = useCallback(() => { triggerHaptic(); Linking.canOpenURL('instagram://').then(ok => { ok ? Linking.openURL('instagram://') : Share.share({ title: displayTitle, message: shareMsg }); }); }, [displayTitle, shareMsg]);
  const handleMore      = useCallback(() => { triggerHaptic(); Share.share({ title: displayTitle, message: Platform.OS === 'android' ? shareMsg : `🎵 ${displayTitle}`, url: Platform.OS === 'ios' ? shareUrl : undefined }); }, [displayTitle, shareMsg, shareUrl]);

  const TARGETS = [
    { key: 'cp', label: 'Copy',      bg: 'rgba(255,255,255,0.08)', border: true, icon: <Ionicons name="copy-outline"          size={moderateScale(19)} color="#fff" />, onPress: handleCopy },
    { key: 'wa', label: 'WhatsApp',  bg: '#25D366',                              icon: <MaterialCommunityIcons name="whatsapp"  size={moderateScale(21)} color="#fff" />, onPress: handleWhatsApp },
    { key: 'tg', label: 'Telegram',  bg: '#2AABEE',                              icon: <MaterialCommunityIcons name="send"      size={moderateScale(19)} color="#fff" />, onPress: handleTelegram },
    { key: 'x',  label: 'X',         bg: '#000000',                              icon: <MaterialCommunityIcons name="twitter"   size={moderateScale(20)} color="#fff" />, onPress: handleX },
    { key: 'ig', label: 'Instagram', bg: '#C13584',                              icon: <MaterialCommunityIcons name="instagram" size={moderateScale(21)} color="#fff" />, onPress: handleInstagram },
    { key: 'mo', label: 'More',      bg: 'rgba(255,255,255,0.08)', border: true, icon: <Ionicons name="ellipsis-horizontal"    size={moderateScale(19)} color="#fff" />, onPress: handleMore },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>

      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.75)', opacity: backdropOp }]} />
      </TouchableWithoutFeedback>

      {/* Portrait bottom sheet */}
      <Animated.View
        style={[ss.sheet, { maxHeight: MAX_SHEET_H, transform: [{ translateY }] }]}
      >
        {/* Drag handle */}
        <View style={ss.dragIndicator}>
          <View style={ss.dragBar} />
        </View>

        {/* Card zone: PreviewCard (memo, never re-renders on theme switch)
            + ThemeSwatchColumn (re-renders only for highlight update) */}
        <View style={ss.cardZone}>
          <PreviewCard track={track} animMap={animMap} />
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

// ─────────────────────────────────────────────────────────────────────────────
// SHEET STYLES
// ─────────────────────────────────────────────────────────────────────────────
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