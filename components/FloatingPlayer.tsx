// components/FloatingPlayer.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated as RNAnimated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';

import { usePlayerEngine, useMusicPlayer } from '@/libs/playerSetup';
import { usePlayerOverlay } from '@/libs/playerOverlay';
import { useTheme } from '@/contexts/ThemeContext';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';

const MINI_PLAYER_HEIGHT = verticalScale(64);
const PROGRESS_BAR_HEIGHT = 3;

// ─── Progress Bar Component ───────────────────────────────────────────────────

interface ProgressBarProps {
  progress: number;
  color: string;
  backgroundColor: string;
}

function ProgressBar({ progress, color, backgroundColor }: ProgressBarProps) {
  const progressAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.timing(progressAnim, {
      toValue: progress,
      duration: 100,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const widthInterpolate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.progressBarContainer, { backgroundColor }]}>
      <RNAnimated.View
        style={[
          styles.progressBarFill,
          {
            width: widthInterpolate,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}

// ─── FloatingPlayer ───────────────────────────────────────────────────────────

export default function FloatingPlayer() {
  const { colors, isDark } = useTheme();
  const { totalHeight: tabBarTotalHeight, shadowOffset, shadowRadius, shadowOpacity } = useTabBarHeight();
  
  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const { expandPlayer, playerMode } = usePlayerOverlay();
  const { setPlayerOverlayRefs } = useMusicPlayer();
  const engine = usePlayerEngine();

  const track = engine.currentTrack;
  const isPlaying = engine.isPlaying;
  const isBuffering = engine.isBuffering;
  const hasVideoStream = engine.hasVideoStream;
  const isAudioOnlyTrack = engine.isAudioOnlyTrack;
  const isVideoOnlyTrack = engine.isVideoOnlyTrack;

  // Register overlay functions (but don't auto-expand)
  useEffect(() => {
    if (setPlayerOverlayRefs) {
      // We only need expandPlayer - collapsePlayer is handled internally
      setPlayerOverlayRefs(expandPlayer, () => {});
    }
  }, [setPlayerOverlayRefs, expandPlayer]);

  // Progress tracking
  useEffect(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }

    if (isPlaying && track?.duration && track.duration > 0) {
      progressInterval.current = setInterval(() => {
        if (engine.position !== undefined && track.duration) {
          const newProgress = engine.position / track.duration;
          const clampedProgress = Math.min(1, Math.max(0, newProgress));
          setProgress(clampedProgress);
        }
      }, 100);
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, [isPlaying, track?.duration, engine.position]);

  // Reset progress on track change
  useEffect(() => {
    setProgress(0);
  }, [track?.id]);

  // Show mini-player ONLY in 'collapsed' mode.
  // Hidden when playerMode === 'expanded' (full player covers screen)
  // Hidden when playerMode === 'hidden' (no track loaded yet)
  if (playerMode !== 'collapsed') return null;

  const showPlayingState = isBuffering ? false : isPlaying;

  const artworkSource = (() => {
    if (track?.thumbnail && typeof track.thumbnail === 'string' && track.thumbnail.length > 0) {
      return { uri: track.thumbnail };
    }
    return require('@/assets/images/mavins.png');
  })();

  const handlePlayPause = (e: any) => {
    e?.stopPropagation?.();
    engine.togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await engine.skipToNext();
      setProgress(0);
    } catch (error) {
      console.warn('[FloatingPlayer] Skip next error:', error);
    }
  };

  const handleSkipPrevious = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await engine.skipToPrevious();
      setProgress(0);
    } catch (error) {
      console.warn('[FloatingPlayer] Skip previous error:', error);
    }
  };

  const handleExpandPlayer = () => {
    expandPlayer();
  };

  const trackTitle = track?.title || 'Unknown Track';
  const trackArtist = track?.artist || 'Unknown Artist';

  // Determine which icons to show based on track type
  const showShuffle = !isAudioOnlyTrack && !isVideoOnlyTrack;
  const showRepeat = !isAudioOnlyTrack && !isVideoOnlyTrack;

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={handleExpandPlayer}
      style={[
        styles.container,
        { 
          marginBottom: tabBarTotalHeight,
          backgroundColor: colors.surfaceRaised,
          shadowColor: isDark ? '#000' : '#888',
          shadowOffset: { width: 0, height: shadowOffset },
          shadowOpacity: shadowOpacity,
          shadowRadius: shadowRadius,
          elevation: 15,
        },
      ]}
    >
      <View style={[styles.accentLine, { backgroundColor: colors.gold }]} />

      <ProgressBar 
        progress={progress} 
        color={colors.gold}
        backgroundColor={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}
      />

      {/* Artwork */}
      <Image
        source={artworkSource}
        style={styles.artwork}
        contentFit="cover"
        transition={200}
      />

      {/* Track Info */}
      <View style={styles.textWrapper}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {trackTitle}
        </Text>
        <Text style={[styles.artist, { color: colors.textSub }]} numberOfLines={1}>
          {trackArtist}
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Shuffle Button */}
        {showShuffle && (
          <TouchableOpacity
            onPress={(e) => { e?.stopPropagation(); engine.setShuffleMode(engine.shuffleMode === 'off' ? 'on' : 'off'); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
            style={styles.controlButton}
          >
            <Feather
              name="shuffle"
              size={moderateScale(16)}
              color={engine.shuffleMode === 'off' ? colors.textMuted : colors.gold}
            />
          </TouchableOpacity>
        )}

        {/* Previous Button */}
        <TouchableOpacity
          onPress={handleSkipPrevious}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={styles.controlButton}
        >
          <Ionicons
            name="play-skip-back"
            size={moderateScale(22)}
            color={colors.text}
          />
        </TouchableOpacity>

        {/* Play/Pause Button */}
        <TouchableOpacity
          onPress={handlePlayPause}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={styles.playButton}
        >
          <Ionicons
            name={showPlayingState ? 'pause' : 'play'}
            size={moderateScale(24)}
            color={colors.textInverse}
          />
        </TouchableOpacity>

        {/* Next Button */}
        <TouchableOpacity
          onPress={handleSkipNext}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={styles.controlButton}
        >
          <Ionicons
            name="play-skip-forward"
            size={moderateScale(22)}
            color={colors.text}
          />
        </TouchableOpacity>

        {/* Repeat Button */}
        {showRepeat && (
          <TouchableOpacity
            onPress={(e) => { 
              e?.stopPropagation(); 
              if (engine.repeatMode === 'off') engine.setRepeatMode('all');
              else if (engine.repeatMode === 'all') engine.setRepeatMode('one');
              else engine.setRepeatMode('off');
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
            style={styles.controlButton}
          >
            <MaterialIcons
              name={engine.repeatMode === 'off' ? 'repeat-off' : engine.repeatMode === 'all' ? 'repeat' : 'repeat-on'}
              size={moderateScale(18)}
              color={engine.repeatMode === 'off' ? colors.textMuted : colors.gold}
            />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: scale(12),
    right: scale(12),
    flexDirection: 'row',
    alignItems: 'center',
    height: MINI_PLAYER_HEIGHT,
    borderRadius: 14,
    paddingHorizontal: scale(10),
    overflow: 'hidden',
    zIndex: 1000,
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.8,
    zIndex: 1,
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: PROGRESS_BAR_HEIGHT,
    zIndex: 1,
  },
  progressBarFill: {
    height: PROGRESS_BAR_HEIGHT,
    borderRadius: PROGRESS_BAR_HEIGHT / 2,
  },
  artwork: {
    width: verticalScale(44),
    height: verticalScale(44),
    borderRadius: 8,
  },
  textWrapper: {
    flex: 1,
    marginLeft: scale(10),
    justifyContent: 'center',
  },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  artist: {
    fontSize: moderateScale(11),
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(12),
  },
  controlButton: {
    padding: scale(4),
  },
  playButton: {
    width: scale(36),
    height: scale(36),
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});