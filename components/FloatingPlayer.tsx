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
import { Ionicons } from '@expo/vector-icons';
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

  const { expandPlayer, collapsePlayer, isPlayerVisible } = usePlayerOverlay();
  const { setPlayerOverlayRefs } = useMusicPlayer();
  const engine = usePlayerEngine();

  const track = engine.currentTrack;
  const isPlaying = engine.isPlaying;
  const isBuffering = engine.isBuffering;

  // Register the overlay's expand/collapse functions with MusicPlayerContext
  useEffect(() => {
    if (setPlayerOverlayRefs) {
      setPlayerOverlayRefs(expandPlayer, collapsePlayer);
    }
  }, [setPlayerOverlayRefs, expandPlayer, collapsePlayer]);

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

  useEffect(() => {
    setProgress(0);
  }, [track?.id]);

  if (!track || isPlayerVisible) return null;

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

  const handleExpandPlayer = () => {
    expandPlayer();
  };

  const trackTitle = track?.title || 'Unknown Track';
  const trackArtist = track?.artist || 'Unknown Artist';

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

      <Image
        source={artworkSource}
        style={styles.artwork}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.textWrapper}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {trackTitle}
        </Text>
        <Text style={[styles.artist, { color: colors.textSub }]} numberOfLines={1}>
          {trackArtist}
        </Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handlePlayPause}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={showPlayingState ? 'pause' : 'play'}
            size={moderateScale(26)}
            color={colors.text}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSkipNext}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={{ marginLeft: scale(16) }}
        >
          <Ionicons
            name="play-skip-forward"
            size={moderateScale(22)}
            color={colors.textSub}
          />
        </TouchableOpacity>
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
    paddingLeft: scale(8),
  },
});