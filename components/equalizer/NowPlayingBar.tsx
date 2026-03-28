// ============================================================================
// COMPONENTS/EQUALIZER/NowPlayingBar.tsx (REVAMPED)
// ============================================================================

import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated as RNAnimated } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

interface NowPlayingBarProps {
  track: {
    title: string;
    artist: string;
    artwork?: string | number;
    duration?: number;
  };
  compact?: boolean;
  isPlaying: boolean;
  progress: number;
  elapsed?: number;
  onPlayPause: () => void;
  onPress?: () => void;
  onSeek?: (progress: number) => void;
  artworkFallback?: string | number;
}

function formatTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const NUM_BARS = 6;

export const NowPlayingBar: React.FC<NowPlayingBarProps> = ({
  track,
  compact = false,
  isPlaying,
  progress,
  elapsed = 0,
  onPlayPause,
  onPress,
  onSeek,
  artworkFallback = require('@/assets/images/icon.png'),
}) => {
  const buttonScale = useSharedValue(1);
  const progressWidth = useSharedValue(0);
  const barAnims = useRef(
    Array.from({ length: NUM_BARS }, () => new RNAnimated.Value(0.3))
  ).current;
  const waveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressBarWidth = useRef<number>(1);

  useEffect(() => {
    progressWidth.value = withSpring(progress * 100, { damping: 20, stiffness: 150 });
  }, [progress]);

  useEffect(() => {
    if (isPlaying) {
      waveInterval.current = setInterval(() => {
        barAnims.forEach(bar => {
          RNAnimated.spring(bar, {
            toValue: Math.random() * 0.7 + 0.3,
            damping: 8,
            stiffness: 120,
            useNativeDriver: false,
          }).start();
        });
      }, 120);
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

  const handlePlayPause = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    buttonScale.value = withSpring(0.9, { damping: 10, stiffness: 300 });
    setTimeout(() => {
      buttonScale.value = withSpring(1, { damping: 12, stiffness: 350 });
    }, 100);
    onPlayPause();
  }, [onPlayPause]);

  const handleSeekPress = useCallback((event: any) => {
    if (!onSeek || compact) return;
    const { locationX } = event.nativeEvent;
    const p = Math.max(0, Math.min(1, locationX / progressBarWidth.current));
    Haptics.selectionAsync();
    onSeek(p);
  }, [onSeek, compact]);

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const src = !track.artwork ? artworkFallback : 
    typeof track.artwork === 'number' ? track.artwork : { uri: track.artwork };

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <TouchableOpacity style={styles.touchArea} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.row}>
          <Image source={src} style={[styles.art, compact && styles.artCompact]} contentFit="cover" />
          
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
            
            {!compact && isPlaying && (
              <View style={styles.waveform}>
                {barAnims.map((anim, i) => (
                  <RNAnimated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [2, verticalScale(14)],
                        }),
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>

          <Animated.View style={[styles.playBtn, btnStyle]}>
            <TouchableOpacity onPress={handlePlayPause} activeOpacity={0.8}>
              <MaterialIcons
                name={isPlaying ? 'pause' : 'play-arrow'}
                size={compact ? 22 : 24}
                color="#4ade80"
              />
            </TouchableOpacity>
          </Animated.View>
        </View>

        {!compact && (
          <View style={styles.progressSection}>
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatTime(elapsed)}</Text>
              <Text style={styles.time}>{track.duration ? formatTime(track.duration) : '--:--'}</Text>
            </View>
            <TouchableOpacity
              style={styles.progressTouch}
              onPress={handleSeekPress}
              onLayout={e => { progressBarWidth.current = e.nativeEvent.layout.width; }}
            >
              <View style={styles.progressBg}>
                <Animated.View style={[styles.progressFill, progressStyle]} />
              </View>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 12,
    marginHorizontal: scale(16),
    marginVertical: verticalScale(6),
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  containerCompact: {
    borderRadius: 10,
  },
  touchArea: {
    padding: scale(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  art: {
    width: scale(44),
    height: scale(44),
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  artCompact: {
    width: scale(36),
    height: scale(36),
  },
  info: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
  artist: {
    color: '#888',
    fontSize: moderateScale(11),
    marginTop: verticalScale(2),
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: verticalScale(16),
    gap: scale(2),
    marginTop: verticalScale(6),
  },
  waveBar: {
    flex: 1,
    backgroundColor: '#4ade80',
    borderRadius: 1,
    opacity: 0.8,
  },
  playBtn: {
    width: scale(40),
    height: scale(40),
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressSection: {
    marginTop: verticalScale(8),
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: verticalScale(4),
  },
  time: {
    color: '#555',
    fontSize: moderateScale(9),
    fontFamily: 'monospace',
  },
  progressTouch: {
    height: verticalScale(16),
    justifyContent: 'center',
  },
  progressBg: {
    height: 3,
    backgroundColor: '#2a2a2a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4ade80',
    borderRadius: 2,
  },
});