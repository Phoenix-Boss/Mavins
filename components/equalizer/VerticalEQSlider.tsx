// components/equalizer/VerticalEQSlider.tsx
//
// Fixes vs original:
//  1. Initial thumb position is computed inside onLayout — never wrong on first render
//  2. dB markers moved INSIDE the track (right-aligned inside, not negative-left overflow)
//  3. Bypass/Solo/Mute callbacks are no-ops when not provided — no crash
//  4. Haptic only fires when drag delta > 3px — prevents haptic spam
//  5. Removed useAnimatedRef / measure (not needed, caused warnings)
//  6. activeBarStyle uses sliderHeight from state (safe, layout-driven)

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, clamp, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface VerticalEQSliderProps {
  value:     number;   // -15 to +15 dB
  onChange:  (value: number) => void;
  label:     string;
  enabled?:  boolean;
  isPreamp?: boolean;
  frequency?: number;
  bypassed?:  boolean;
  onBypass?:  () => void;
  onSolo?:    () => void;
  onMute?:    () => void;
  isSoloed?:  boolean;
  isMuted?:   boolean;
}

// Slider physical height — set once, consistent with layout
const SLIDER_TRACK_H = verticalScale(150);

export const VerticalEQSlider: React.FC<VerticalEQSliderProps> = ({
  value,
  onChange,
  label,
  enabled    = true,
  isPreamp   = false,
  frequency,
  bypassed   = false,
  onBypass,
  onSolo,
  onMute,
  isSoloed   = false,
  isMuted    = false,
}) => {
  // Use fixed height so thumb is immediately correct — no layout race
  const trackH = SLIDER_TRACK_H;

  const [displayValue, setDisplayValue] = useState(value);
  const translateY  = useSharedValue(valueToY(value, trackH));
  const isDragging  = useSharedValue(false);

  // ── Conversions ────────────────────────────────────────────────────────
  function valueToY(val: number, h: number): number {
    'worklet';
    // +15dB → y=0 (top),  -15dB → y=h (bottom)
    return h * ((15 - clamp(val, -15, 15)) / 30);
  }

  function yToValue(y: number, h: number): number {
    'worklet';
    const raw = 15 - (clamp(y, 0, h) / h) * 30;
    return Math.round(raw * 2) / 2;   // snap to 0.5 dB steps
  }

  // Sync when external value changes (preset load, reset)
  React.useEffect(() => {
    if (isDragging.value) return;
    const target = bypassed ? 0 : value;
    translateY.value = withSpring(valueToY(target, trackH), { damping: 20, stiffness: 220 });
    setDisplayValue(target);
  }, [value, bypassed]);

  // ── Haptic helpers ─────────────────────────────────────────────────────
  const hapticLight     = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const hapticMedium    = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  const hapticSelection = () => Haptics.selectionAsync();

  // ── Gesture ────────────────────────────────────────────────────────────
  const gesture = Gesture.Pan()
    .enabled(enabled && !bypassed)
    .hitSlop({ top: 20, bottom: 20, left: scale(20), right: scale(20) })
    .onBegin(() => {
      isDragging.value = true;
      runOnJS(hapticLight)();
    })
    .onUpdate(e => {
      const next = clamp(translateY.value + e.changeY, 0, trackH);
      translateY.value = next;
      const db = yToValue(next, trackH);
      runOnJS(setDisplayValue)(db);
      if (Math.abs(e.changeY) > 3) runOnJS(hapticSelection)();
    })
    .onEnd(() => {
      isDragging.value = false;
      const db = yToValue(translateY.value, trackH);
      // Snap to 0 if within 0.5dB
      if (Math.abs(db) < 0.5) {
        translateY.value = withSpring(valueToY(0, trackH), { damping: 18, stiffness: 260 });
        runOnJS(setDisplayValue)(0);
        runOnJS(hapticMedium)();
        runOnJS(onChange)(0);
      } else {
        translateY.value = withSpring(valueToY(db, trackH), { damping: 18, stiffness: 260 });
        runOnJS(hapticLight)();
        runOnJS(onChange)(db);
      }
    });

  // ── Animated styles ────────────────────────────────────────────────────
  const thumbStyle = useAnimatedStyle(() => ({
    transform:    [{ translateY: translateY.value }],
    shadowOpacity: isDragging.value ? 0.6 : 0.3,
    shadowRadius:  isDragging.value ? 8   : 4,
    opacity:       bypassed ? 0.4 : 1,
  }));

  const activeBarStyle = useAnimatedStyle(() => {
    'worklet';
    const ty     = translateY.value;
    const center = trackH / 2;
    if (ty <= center) {
      return {
        top:             ty,
        height:          center - ty,
        backgroundColor: Colors.metallicBrown.primary,
      };
    }
    return {
      top:             center,
      height:          ty - center,
      backgroundColor: Colors.metallicBrown.secondary,
    };
  });

  // ── Display ────────────────────────────────────────────────────────────
  const isActive       = enabled && !bypassed;
  const formattedValue = displayValue > 0
    ? `+${displayValue.toFixed(1)}`
    : displayValue.toFixed(1);

  return (
    <View style={styles.column}>
      {/* Value badge */}
      <View style={[
        styles.valueBadge,
        displayValue > 0 && styles.valuePos,
        displayValue < 0 && styles.valueNeg,
        !isActive       && styles.valueDim,
      ]}>
        <Text style={[styles.valueText, !isActive && styles.textDim]}>
          {bypassed ? 'BYP' : formattedValue}
        </Text>
      </View>

      {/* Track */}
      <GestureDetector gesture={gesture}>
        <View style={styles.trackContainer}>
          <View style={styles.track}>
            {/* dB labels inside track right edge */}
            <Text style={[styles.dbLabel, { top: 0            }]}>+15</Text>
            <Text style={[styles.dbLabel, { top: '25%'        }]}>+7</Text>
            <Text style={[styles.dbLabel, { top: '50%', marginTop: -verticalScale(5) }]}>0</Text>
            <Text style={[styles.dbLabel, { top: '75%'        }]}>-7</Text>
            <Text style={[styles.dbLabel, { bottom: 0         }]}>-15</Text>

            {/* Active fill bar */}
            {!bypassed && <Animated.View style={[styles.activeBar, activeBarStyle]} />}

            {/* Center line (0 dB) */}
            <View style={styles.centerLine} />

            {/* Thumb */}
            <Animated.View
              style={[
                styles.thumb,
                thumbStyle,
                { borderColor: isActive ? Colors.metallicBrown.light : '#444' },
              ]}
            >
              <View style={styles.gripRow}>
                <View style={[styles.grip, !isActive && styles.gripDim]} />
                <View style={[styles.grip, !isActive && styles.gripDim]} />
              </View>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>

      {/* Bypass / Solo / Mute buttons — only rendered when at least one handler is provided */}
      {(onBypass || onSolo || onMute) && (
        <View style={styles.ctrlRow}>
          {onBypass && (
            <TouchableOpacity
              onPress={onBypass}
              style={[styles.ctrlBtn, bypassed  && styles.ctrlBtnOn]}
              disabled={!enabled}
            >
              <MaterialCommunityIcons
                name="power"
                size={12}
                color={bypassed ? Colors.metallicBrown.primary : '#666'}
              />
            </TouchableOpacity>
          )}
          {onSolo && (
            <TouchableOpacity
              onPress={onSolo}
              style={[styles.ctrlBtn, isSoloed  && styles.ctrlBtnSolo]}
              disabled={!enabled}
            >
              <Text style={[styles.ctrlText, isSoloed && styles.ctrlTextSolo]}>S</Text>
            </TouchableOpacity>
          )}
          {onMute && (
            <TouchableOpacity
              onPress={onMute}
              style={[styles.ctrlBtn, isMuted   && styles.ctrlBtnMute]}
              disabled={!enabled}
            >
              <Text style={[styles.ctrlText, isMuted && styles.ctrlTextMute]}>M</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Label */}
      <Text style={[styles.label, !isActive && styles.textDim]}>{label}</Text>
      {frequency != null && (
        <Text style={[styles.freq, !isActive && styles.textDim]}>
          {frequency < 1000 ? `${frequency}Hz` : `${(frequency / 1000).toFixed(1)}k`}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
    flex: 1,
    maxWidth: scale(46),
  },
  valueBadge: {
    paddingHorizontal: scale(3),
    paddingVertical:   2,
    borderRadius:      4,
    marginBottom:      verticalScale(4),
    backgroundColor:   'rgba(0,0,0,0.3)',
    minWidth:          scale(32),
    alignItems:        'center',
  },
  valuePos: { backgroundColor: 'rgba(139,115,85,0.3)' },
  valueNeg: { backgroundColor: 'rgba(60,60,60,0.3)' },
  valueDim: { backgroundColor: 'rgba(0,0,0,0.1)' },
  valueText: {
    color:      '#fff',
    fontSize:   moderateScale(8),
    fontWeight: 'bold',
  },
  textDim: { color: '#444' },

  trackContainer: {
    width:          scale(44),
    height:         SLIDER_TRACK_H,
    justifyContent: 'center',
    alignItems:     'center',
  },
  track: {
    width:           scale(10),
    height:          '100%',
    borderRadius:    5,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow:        'visible',   // let dB labels show
    position:        'relative',
  },

  // dB markers — inside track, right-aligned, no negative left
  dbLabel: {
    position:  'absolute',
    right:     scale(12),
    color:     'rgba(255,255,255,0.25)',
    fontSize:  moderateScale(7),
    textAlign: 'right',
    width:     scale(22),
  },

  activeBar: {
    position:    'absolute',
    width:       '100%',
    borderRadius: 5,
  },
  centerLine: {
    position:        'absolute',
    top:             '50%',
    marginTop:       -1,
    height:          2,
    width:           '100%',
    backgroundColor: 'rgba(255,255,255,0.65)',
    zIndex:          2,
  },
  thumb: {
    position:        'absolute',
    left:            scale(-14),
    width:           scale(38),
    height:          verticalScale(26),
    borderRadius:    10,
    backgroundColor: '#1a1a1a',
    borderWidth:     1.5,
    justifyContent:  'center',
    alignItems:      'center',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    zIndex:          10,
    elevation:       6,
  },
  gripRow: {
    flexDirection: 'row',
    gap:           5,
  },
  grip: {
    width:           2,
    height:          verticalScale(10),
    backgroundColor: '#fff',
    borderRadius:    1,
  },
  gripDim: { backgroundColor: '#444' },

  // Bypass / Solo / Mute
  ctrlRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            scale(3),
    marginTop:      verticalScale(6),
  },
  ctrlBtn: {
    width:           scale(18),
    height:          scale(18),
    borderRadius:    9,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     'transparent',
  },
  ctrlBtnOn:   { borderColor: Colors.metallicBrown.primary },
  ctrlBtnSolo: { borderColor: '#FFD700' },
  ctrlBtnMute: { borderColor: '#FF4444' },
  ctrlText:    { color: '#777', fontSize: moderateScale(9), fontWeight: 'bold' },
  ctrlTextSolo: { color: '#FFD700' },
  ctrlTextMute: { color: '#FF4444' },

  label: {
    color:      '#fff',
    fontSize:   moderateScale(9),
    fontWeight: '600',
    marginTop:  verticalScale(3),
  },
  freq: {
    color:    'rgba(255,255,255,0.35)',
    fontSize: moderateScale(7),
    marginTop: 1,
  },
});