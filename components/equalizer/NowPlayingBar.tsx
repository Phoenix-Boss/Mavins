// components/equalizer/NowPlayingBar.tsx - PROFESSIONAL NOW PLAYING BAR

import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '@/constants/Colors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';

interface NowPlayingBarProps {
  track: {
    title: string;
    artist: string;
    artwork?: string | number;
    duration?: number; // in seconds
  };
  compact?: boolean;
  isPlaying: boolean;
  progress: number; // 0-1
  elapsed?: number; // elapsed time in seconds
  onPlayPause: () => void;
  onPress?: () => void;
  onSeek?: (progress: number) => void;
  artworkFallback?: string | number;
  showWaveform?: boolean; // Show animated waveform when playing
}

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
  showWaveform = true,
}) => {
  // Animation values
  const buttonScale = useSharedValue(1);
  const progressWidth = useSharedValue(0);
  const artworkGlow = useSharedValue(0);
  const playIconRotation = useSharedValue(0);
  const waveformScale = useSharedValue(1);
  const barHeights = useSharedValue([0.3, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.4]);

  // Update progress bar width with spring animation
  useEffect(() => {
    progressWidth.value = withSpring(progress * 100, {
      damping: 20,
      stiffness: 150,
    });
  }, [progress]);

  // Animate artwork glow and icon when playing state changes
  useEffect(() => {
    artworkGlow.value = withTiming(isPlaying ? 1 : 0, { duration: 300 });
    playIconRotation.value = withSpring(isPlaying ? 0 : 180, {
      damping: 15,
      stiffness: 200,
    });

    // Animate waveform when playing
    if (isPlaying && showWaveform) {
      waveformScale.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 200 }),
          withTiming(0.8, { duration: 200 }),
          withTiming(1, { duration: 200 })
        ),
        -1,
        true
      );
    } else {
      waveformScale.value = withSpring(1);
    }
  }, [isPlaying, showWaveform]);

  // Animate bar heights for waveform
  useEffect(() => {
    if (!isPlaying || !showWaveform) return;

    const interval = setInterval(() => {
      barHeights.value = barHeights.value.map(() => Math.random() * 0.8 + 0.2) as any;
    }, 150);

    return () => clearInterval(interval);
  }, [isPlaying, showWaveform]);

  const handlePlayPause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    buttonScale.value = withSequence(
      withSpring(0.8, { damping: 10, stiffness: 300 }),
      withSpring(1, { damping: 12, stiffness: 350 })
    );
    
    onPlayPause();
  };

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress?.();
  };

  const handleSeek = (event: any) => {
    if (!onSeek || compact) return;
    
    const { locationX, layout } = event.nativeEvent;
    const newProgress = Math.max(0, Math.min(1, locationX / layout.width));
    Haptics.selectionAsync();
    onSeek(newProgress);
  };

  // Format time (seconds to mm:ss)
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Animated styles
  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const artworkStyle = useAnimatedStyle(() => ({
    shadowColor: Colors.metallicBrown.primary,
    shadowOpacity: artworkGlow.value * 0.5,
    shadowRadius: interpolate(artworkGlow.value, [0, 1], [0, 15]),
    elevation: interpolate(artworkGlow.value, [0, 1], [2, 8]),
    transform: [{
      scale: withSpring(isPlaying ? 1.05 : 1, {
        damping: 15,
        stiffness: 200,
      })
    }]
  }));

  const playIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${playIconRotation.value}deg` }],
  }));

  const waveformStyle = useAnimatedStyle(() => ({
    transform: [{ scale: waveformScale.value }],
  }));

  const getImageSource = (artwork: string | number | undefined) => {
    if (!artwork) return artworkFallback;
    if (typeof artwork === 'number') return artwork;
    return { uri: artwork };
  };

  return (
    <Animated.View style={[
      styles.container,
      compact && styles.containerCompact,
      { borderColor: isPlaying ? 'rgba(139, 115, 85, 0.3)' : 'rgba(255,255,255,0.1)' }
    ]}>
      <TouchableOpacity
        style={styles.touchableArea}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <BlurView intensity={20} style={styles.blurBackground} />
        
        <View style={styles.content}>
          {/* Artwork with glow effect */}
          <Animated.View style={[styles.artworkContainer, artworkStyle]}>
            <Image
              source={getImageSource(track.artwork)}
              style={[
                styles.artwork,
                compact && styles.artworkCompact,
              ]}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
            />
            {isPlaying && (
              <View style={styles.playingIndicator}>
                <View style={[styles.playingDot, { backgroundColor: Colors.metallicBrown.primary }]} />
              </View>
            )}
          </Animated.View>

          {/* Track Info */}
          <View style={[styles.info, compact && styles.infoCompact]}>
            <Text style={styles.title} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {track.artist}
            </Text>

            {/* Waveform Visualization (when playing) */}
            {showWaveform && isPlaying && !compact && (
              <Animated.View style={[styles.waveformContainer, waveformStyle]}>
                {barHeights.value.map((height, index) => (
                  <Animated.View
                    key={index}
                    style={[
                      styles.waveformBar,
                      {
                        height: `${height * 100}%`,
                        backgroundColor: Colors.metallicBrown.primary,
                      },
                    ]}
                  />
                ))}
              </Animated.View>
            )}

            {/* Progress Bar with Time */}
            {!compact && (
              <View style={styles.progressSection}>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(elapsed)}</Text>
                  <Text style={styles.timeText}>
                    {track.duration ? formatTime(track.duration) : '--:--'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.progressContainer}
                  onPress={handleSeek}
                  activeOpacity={onSeek ? 0.7 : 1}
                  disabled={!onSeek}
                >
                  <View style={styles.progressBackground}>
                    <Animated.View
                      style={[
                        styles.progressFill,
                        progressStyle,
                        { backgroundColor: Colors.metallicBrown.primary }
                      ]}
                    />
                    {/* Progress handle (only when seeking) */}
                    {onSeek && (
                      <Animated.View
                        style={[
                          styles.progressHandle,
                          { left: `${progressWidth.value}%` }
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Play/Pause Button */}
          <Animated.View style={[styles.buttonContainer, buttonStyle]}>
            <TouchableOpacity
              style={[
                styles.playButton,
                { backgroundColor: Colors.metallicBrown.primary }
              ]}
              onPress={handlePlayPause}
              activeOpacity={0.8}
            >
              <Animated.View style={playIconStyle}>
                <MaterialIcons
                  name={isPlaying ? "pause" : "play-arrow"}
                  size={compact ? 24 : 28}
                  color="#000"
                />
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Compact Progress Bar (shown at bottom in compact mode) */}
        {compact && (
          <View style={styles.compactProgress}>
            <View style={styles.compactProgressBackground}>
              <Animated.View
                style={[
                  styles.compactProgressFill,
                  progressStyle,
                  { backgroundColor: Colors.metallicBrown.primary }
                ]}
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
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    marginVertical: verticalScale(5),
  },
  containerCompact: {
    borderRadius: 12,
  },
  touchableArea: {
    width: '100%',
  },
  blurBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: scale(12),
    gap: scale(12),
  },
  artworkContainer: {
    position: 'relative',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  artwork: {
    width: scale(50),
    height: scale(50),
    borderRadius: 8,
  },
  artworkCompact: {
    width: scale(40),
    height: scale(40),
  },
  playingIndicator: {
    position: 'absolute',
    top: -scale(4),
    right: -scale(4),
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  playingDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: 4,
  },
  info: {
    flex: 1,
  },
  infoCompact: {
    // Compact specific styles
  },
  title: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginBottom: verticalScale(2),
  },
  artist: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(12),
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: verticalScale(20),
    gap: scale(2),
    marginTop: verticalScale(4),
    marginBottom: verticalScale(4),
  },
  waveformBar: {
    flex: 1,
    borderRadius: 2,
    opacity: 0.7,
  },
  progressSection: {
    marginTop: verticalScale(6),
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: verticalScale(4),
  },
  timeText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(9),
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  progressContainer: {
    width: '100%',
  },
  progressBackground: {
    height: verticalScale(4),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressHandle: {
    position: 'absolute',
    top: -scale(3),
    width: scale(10),
    height: scale(10),
    borderRadius: 5,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: Colors.metallicBrown.primary,
    marginLeft: -scale(5),
  },
  buttonContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  playButton: {
    width: scale(40),
    height: scale(40),
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactProgress: {
    paddingHorizontal: scale(12),
    paddingBottom: scale(12),
  },
  compactProgressBackground: {
    height: verticalScale(2),
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  compactProgressFill: {
    height: '100%',
    borderRadius: 1,
  },
});