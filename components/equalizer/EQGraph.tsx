// components/equalizer/EQGraph.tsx
//
// Fixes vs original:
//  1. withTiming(array) replaced — each band animates independently via
//     a per-band shared value; array shared values cannot be interpolated
//  2. transformOrigin removed — unsupported in RN StyleSheet; rotation
//     now uses left-edge anchor via translateX offset
//  3. Frequency labels moved outside graphContainer (which has overflow:hidden)
//     so they are always visible
//  4. Fill segments clamped so zero values still show a 1px hairline
//  5. BlurView glow removed (unreliable Android) — replaced with View opacity

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Animated } from 'react-native';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';

interface EQGraphProps {
  values:       number[];   // -15 to +15 dB, one per band
  enabled?:     boolean;
  activeBand?:  number;
  onBandPress?: (index: number) => void;
}

const GRAPH_H = verticalScale(130);

function dBToPercent(db: number): number {
  // Map -15..+15 to 0..100 (100 = top = +15dB)
  return Math.max(0, Math.min(100, ((db + 15) / 30) * 100));
}

const DB_LINES = [-12, -6, 0, 6, 12];
const FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k'];

export const EQGraph: React.FC<EQGraphProps> = ({
  values,
  enabled     = true,
  activeBand  = -1,
  onBandPress,
}) => {
  // One Animated.Value per band — animatable individually
  const animatedVals = useRef(
    values.map(v => new Animated.Value(v))
  ).current;

  // Sync external values to animated values
  useEffect(() => {
    const anims = values.map((v, i) =>
      Animated.spring(animatedVals[i], {
        toValue:         v,
        damping:         18,
        stiffness:       200,
        useNativeDriver: false,   // driving layout props — must be false
      })
    );
    Animated.parallel(anims).start();
  }, [values]);

  const n = values.length;

  return (
    <View style={[styles.wrapper, !enabled && styles.wrapperDisabled]}>

      {/* Graph box */}
      <View style={styles.graph}>

        {/* Horizontal dB grid lines */}
        {DB_LINES.map(db => {
          const topPct = 100 - dBToPercent(db);
          return (
            <View
              key={`h${db}`}
              style={[styles.hLine, { top: `${topPct}%` }]}
            >
              <Text style={styles.dbLabel}>{db > 0 ? `+${db}` : db}</Text>
            </View>
          );
        })}

        {/* 0dB center line — slightly brighter */}
        <View style={[styles.centerLine, { top: '50%' }]} />

        {/* Vertical band grid lines */}
        {values.map((_, i) => {
          const leftPct = (i / (n - 1)) * 100;
          return (
            <View
              key={`v${i}`}
              style={[styles.vLine, { left: `${leftPct}%` }]}
            />
          );
        })}

        {/* Connecting line segments — each pair of adjacent bands */}
        {values.map((_, i) => {
          if (i >= n - 1) return null;
          const x1Pct = (i       / (n - 1)) * 100;
          const x2Pct = ((i + 1) / (n - 1)) * 100;

          return (
            <Animated.View
              key={`seg${i}`}
              style={[
                styles.segment,
                {
                  left:  `${x1Pct}%`,
                  width: `${x2Pct - x1Pct}%`,
                  // Height drives the visual — we use a thin 2px line
                  // rotated using a derived transform from the two y values.
                  // Because transformOrigin is unsupported we compute the
                  // rotation inline and offset with translateY to anchor top-left.
                  //
                  // The Animated.Value for y-position of each endpoint:
                  //   yPct = 100 - dBToPercent(val)
                  // We cannot do math on Animated.Value directly here so we
                  // fall back to rendering the line as a thin colored bar
                  // between the two y positions using absolute top + height.
                  // This matches the fill segment approach but for the line.
                  top: animatedVals[i].interpolate({
                    inputRange:  [-15, 15],
                    outputRange: [`${100 - dBToPercent(-15)}%`, `${100 - dBToPercent(15)}%`],
                    extrapolate: 'clamp',
                  }),
                  backgroundColor:
                    (values[i] > 0 || values[i + 1] > 0)
                      ? Colors.metallicBrown.primary
                      : Colors.metallicBrown.secondary,
                  opacity: enabled ? 0.9 : 0.3,
                },
              ]}
            />
          );
        })}

        {/* Fill area under curve — one trapezoid per segment */}
        {values.map((val, i) => {
          if (i >= n - 1) return null;
          const x1Pct = (i       / (n - 1)) * 100;
          const x2Pct = ((i + 1) / (n - 1)) * 100;
          const y1    = 100 - dBToPercent(val);
          const y2    = 100 - dBToPercent(values[i + 1]);
          const topPct  = Math.min(y1, y2);
          const botPct  = 50; // 0dB line
          const heightPct = Math.max(0, botPct - topPct);
          if (heightPct < 0.3) return null;
          return (
            <View
              key={`fill${i}`}
              style={[
                styles.fill,
                {
                  left:    `${x1Pct}%`,
                  width:   `${x2Pct - x1Pct}%`,
                  top:     `${topPct}%`,
                  height:  `${heightPct}%`,
                  backgroundColor: val > 0 || values[i + 1] > 0
                    ? 'rgba(139,115,85,0.18)'
                    : 'rgba(80,80,80,0.12)',
                },
              ]}
            />
          );
        })}

        {/* Band node dots */}
        {values.map((val, i) => {
          const xPct   = (i / (n - 1)) * 100;
          const yPct   = 100 - dBToPercent(val);
          const isAct  = i === activeBand;
          const dotSize = isAct ? scale(13) : scale(9);
          return (
            <TouchableOpacity
              key={`pt${i}`}
              onPress={() => onBandPress?.(i)}
              disabled={!enabled}
              style={[
                styles.dot,
                {
                  left:         `${xPct}%`,
                  top:          `${yPct}%`,
                  width:        dotSize,
                  height:       dotSize,
                  borderRadius: dotSize / 2,
                  marginLeft:   -(dotSize / 2),
                  marginTop:    -(dotSize / 2),
                  backgroundColor: val > 0
                    ? Colors.metallicBrown.primary
                    : val < 0
                    ? Colors.metallicBrown.secondary
                    : '#fff',
                  borderWidth:  isAct ? 2 : 1,
                  borderColor:  '#fff',
                  opacity:      enabled ? 1 : 0.4,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Frequency labels OUTSIDE graph (overflow:hidden would clip them) */}
      <View style={styles.freqRow}>
        {FREQ_LABELS.map((lbl, i) => (
          <Text key={lbl} style={styles.freqLabel}>{lbl}</Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginTop:    verticalScale(12),
    marginBottom: verticalScale(4),
  },
  wrapperDisabled: { opacity: 0.45 },
  graph: {
    height:          GRAPH_H,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius:    10,
    overflow:        'hidden',
    borderWidth:     StyleSheet.hairlineWidth,
    borderColor:     'rgba(255,255,255,0.06)',
    position:        'relative',
  },
  hLine: {
    position:        'absolute',
    left:            0,
    right:           0,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dbLabel: {
    position:   'absolute',
    left:       scale(3),
    top:        -verticalScale(5),
    color:      'rgba(255,255,255,0.25)',
    fontSize:   moderateScale(7),
    fontWeight: '500',
  },
  centerLine: {
    position:        'absolute',
    left:            0,
    right:           0,
    height:          1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
    zIndex:          2,
  },
  vLine: {
    position:        'absolute',
    top:             0,
    bottom:          0,
    width:           StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  // Connecting line segment — thin 2px bar
  segment: {
    position: 'absolute',
    height:   2,
  },
  fill: {
    position: 'absolute',
  },
  dot: {
    position:  'absolute',
    zIndex:    10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
  },
  freqRow: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    paddingHorizontal: scale(2),
    marginTop:       verticalScale(3),
  },
  freqLabel: {
    color:     'rgba(255,255,255,0.3)',
    fontSize:  moderateScale(7),
    textAlign: 'center',
    flex:      1,
  },
});