// components/equalizer/NowPlayingBar.tsx
//
// Fixes vs original:
//  1. handleSeek: reads bar width via onLayout stored in ref — not from nativeEvent.layout
//  2. Waveform bar heights: each bar has its own Animated.Value updated via setInterval
//     on the JS thread — no shared value reads in JSX
//  3. barHeights.value.map() removed — shared value arrays must not be read in JSX
//  4. BlurView background removed (unreliable Android) — replaced with semi-transparent View

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated as RNAnimated,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  withSequence, withRepeat, interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const NUM_BARS = 8;

interface NowPlayingBarProps {
  track: {
    title:     string;
    artist:    string;
    artwork?:  string | number;
    duration?: number;
  };
  compact?:         boolean;
  isPlaying:        boolean;
  progress:         number;   // 0–1
  elapsed?:         number;   // seconds
  onPlayPause:      () => void;
  onPress?:         () => void;
  onSeek?:          (progress: number) => void;
  artworkFallback?: string | number;
}

function formatTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const NowPlayingBar: React.FC<NowPlayingBarProps> = ({
  track,
  compact          = false,
  isPlaying,
  progress,
  elapsed          = 0,
  onPlayPause,
  onPress,
  onSeek,
  artworkFallback  = require('@/assets/images/icon.png'),
}) => {
  // Animated values
  const buttonScale   = useSharedValue(1);
  const progressWidth = useSharedValue(0);
  const artworkScale  = useSharedValue(1);

  // Waveform: individual Animated.Values per bar (JS thread — safe to read in JSX)
  const barAnims = useRef(
    Array.from({ length: NUM_BARS }, () => new RNAnimated.Value(0.3))
  ).current;
  const waveInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Progress bar container width (measured on layout)
  const progressBarWidth = useRef<number>(1);

  // ── Progress bar animation ─────────────────────────────────────────────
  useEffect(() => {
    progressWidth.value = withSpring(progress * 100, { damping: 20, stiffness: 150 });
  }, [progress]);

  // ── Artwork scale + waveform on play/pause ─────────────────────────────
  useEffect(() => {
    artworkScale.value = withSpring(isPlaying ? 1.05 : 1, { damping: 15, stiffness: 200 });

    if (isPlaying) {
      waveInterval.current = setInterval(() => {
        barAnims.forEach(bar => {
          RNAnimated.spring(bar, {
            toValue:         Math.random() * 0.75 + 0.25,
            damping:         8,
            stiffness:       120,
            useNativeDriver: false,
          }).start();
        });
      }, 140);
    } else {
      if (waveInterval.current) clearInterval(waveInterval.current);
      barAnims.forEach(bar => {
        RNAnimated.spring(bar, { toValue: 0.2, damping: 12, stiffness: 100, useNativeDriver: false }).start();
      });
    }
    return () => {
      if (waveInterval.current) clearInterval(waveInterval.current);
    };
  }, [isPlaying]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    buttonScale.value = withSequence(
      withSpring(0.82, { damping: 10, stiffness: 300 }),
      withSpring(1,    { damping: 12, stiffness: 350 })
    );
    onPlayPause();
  }, [onPlayPause]);

  const handlePress = useCallback(() => {
    Haptics.selectionAsync();
    onPress?.();
  }, [onPress]);

  // Seek: use measured bar width, not nativeEvent.layout
  const handleSeekPress = useCallback((event: any) => {
    if (!onSeek || compact) return;
    const { locationX } = event.nativeEvent;
    const w = progressBarWidth.current;
    if (!w) return;
    const p = Math.max(0, Math.min(1, locationX / w));
    Haptics.selectionAsync();
    onSeek(p);
  }, [onSeek, compact]);

  // ── Animated styles ─────────────────────────────────────────────────────
  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const artStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artworkScale.value }],
    shadowOpacity: isPlaying ? 0.4 : 0,
    shadowRadius:  isPlaying ? 12  : 0,
    shadowColor:   Colors.metallicBrown.primary,
  }));

  const src = !track.artwork
    ? artworkFallback
    : typeof track.artwork === 'number'
    ? track.artwork
    : { uri: track.artwork as string };

  return (
    <Animated.View style={[
      styles.container,
      compact && styles.containerCompact,
      { borderColor: isPlaying ? 'rgba(139,115,85,0.35)' : 'rgba(255,255,255,0.08)' },
    ]}>
      <TouchableOpacity
        style={styles.touchArea}
        onPress={handlePress}
        activeOpacity={0.75}
      >
        {/* Glass background */}
        <View style={styles.glassBg} />

        <View style={styles.row}>
          {/* Artwork */}
          <Animated.View style={[styles.artWrap, artStyle]}>
            <Image
              source={src}
              style={[styles.art, compact && styles.artCompact]}
              contentFit="cover"
              transition={200}
            />
            {isPlaying && (
              <View style={styles.playingDot}>
                <View style={[styles.dot, { backgroundColor: Colors.metallicBrown.primary }]} />
              </View>
            )}
          </Animated.View>

          {/* Track info */}
          <View style={[styles.info, compact && styles.infoCompact]}>
            <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>

            {/* Waveform bars — uses individual RNAnimated.Value per bar */}
            {isPlaying && !compact && (
              <View style={styles.waveform}>
                {barAnims.map((anim, i) => (
                  <RNAnimated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: anim.interpolate({
                          inputRange:  [0, 1],
                          outputRange: [2, verticalScale(16)],
                        }),
                        backgroundColor: Colors.metallicBrown.primary,
                      },
                    ]}
                  />
                ))}
              </View>
            )}

            {/* Progress + time — full mode only */}
            {!compact && (
              <View style={styles.progressSection}>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(elapsed)}</Text>
                  <Text style={styles.timeText}>
                    {track.duration ? formatTime(track.duration) : '--:--'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.progressTouchable}
                  onPress={handleSeekPress}
                  activeOpacity={onSeek ? 0.7 : 1}
                  disabled={!onSeek}
                  onLayout={e => { progressBarWidth.current = e.nativeEvent.layout.width; }}
                >
                  <View style={styles.progressBg}>
                    <Animated.View
                      style={[styles.progressFill, progressStyle,
                        { backgroundColor: Colors.metallicBrown.primary }]}
                    />
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Play/Pause button */}
          <Animated.View style={[styles.btnWrap, btnStyle]}>
            <TouchableOpacity
              style={[styles.playBtn, { backgroundColor: Colors.metallicBrown.primary }]}
              onPress={handlePlayPause}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={isPlaying ? 'pause' : 'play-arrow'}
                size={compact ? 22 : 26}
                color="#000"
              />
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Compact progress stripe at bottom */}
        {compact && (
          <View style={styles.compactProgressWrap}>
            <View style={styles.compactProgressBg}>
              <Animated.View
                style={[styles.compactProgressFill, progressStyle,
                  { backgroundColor: Colors.metallicBrown.primary }]}
              />
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow:     'hidden',
    borderWidth:  1,
    marginVertical: verticalScale(6),
  },
  containerCompact: { borderRadius: 12 },
  touchArea:   { width: '100%' },
  glassBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,20,24,0.85)',
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    padding:       scale(10),
    gap:           scale(10),
  },
  artWrap: {
    position:     'relative',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  art: {
    width:        scale(46),
    height:       scale(46),
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  artCompact: { width: scale(38), height: scale(38) },
  playingDot: {
    position:        'absolute',
    top:             -scale(3),
    right:           -scale(3),
    width:           scale(14),
    height:          scale(14),
    borderRadius:    7,
    backgroundColor: '#000',
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     1.5,
    borderColor:     '#fff',
  },
  dot: { width: scale(6), height: scale(6), borderRadius: 3 },
  info:        { flex: 1 },
  infoCompact: {},
  title: {
    color:        '#fff',
    fontSize:     moderateScale(13),
    fontWeight:   '600',
    marginBottom: verticalScale(2),
  },
  artist: {
    color:    'rgba(255,255,255,0.55)',
    fontSize: moderateScale(11),
  },
  waveform: {
    flexDirection:  'row',
    alignItems:     'flex-end',
    height:         verticalScale(18),
    gap:            scale(2),
    marginTop:      verticalScale(4),
  },
  waveBar: {
    flex:        1,
    borderRadius: 1,
    opacity:      0.75,
    minHeight:    2,
  },
  progressSection: { marginTop: verticalScale(6) },
  timeRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   verticalScale(3),
  },
  timeText: {
    color:      'rgba(255,255,255,0.35)',
    fontSize:   moderateScale(9),
    fontFamily: 'monospace',
  },
  progressTouchable: { width: '100%' },
  progressBg: {
    height:          verticalScale(3),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius:    2,
    overflow:        'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },

  btnWrap: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius:  4,
  },
  playBtn: {
    width:          scale(38),
    height:         scale(38),
    borderRadius:   19,
    justifyContent: 'center',
    alignItems:     'center',
  },

  // Compact progress
  compactProgressWrap: {
    paddingHorizontal: scale(10),
    paddingBottom:     scale(10),
  },
  compactProgressBg: {
    height:          verticalScale(2),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius:    1,
    overflow:        'hidden',
  },
  compactProgressFill: { height: '100%', borderRadius: 1 },
});