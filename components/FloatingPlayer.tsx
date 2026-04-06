/**
 * FloatingPlayer.tsx
 *
 * A mini player bar that floats above the tab bar on allowed screens.
 * Tapping it navigates to the full /(player) modal.
 *
 * This is a PURE PRESENTATIONAL COMPONENT — no Stack/navigator inside.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';

import { useActiveTrack, usePlaybackState, State } from '@/modules/mavin-eq';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { usePlayerStore } from '@/store/player';

const MINI_PLAYER_HEIGHT = verticalScale(64);

// ─── Skeleton pulse ───────────────────────────────────────────────────────────

function SkeletonPulse({
  width,
  height,
  borderRadius = 4,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
}) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: false }),
      ])
    ).start();
  }, []);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: ['#1A1A1A', '#2A2A2A'] });
  return <RNAnimated.View style={{ width, height, borderRadius, backgroundColor: bg }} />;
}

// ─── FloatingPlayer ───────────────────────────────────────────────────────────

interface FloatingPlayerProps {
  playerReady: boolean;
}

export default function FloatingPlayer({ playerReady }: FloatingPlayerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause } = useMusicPlayer();

  type PS = ReturnType<typeof usePlayerStore.getState>;
  const storeTrack = usePlayerStore((s: PS) => s.currentTrack);

  // Prefer live active track, fall back to last track in store
  const track = activeTrack ?? (storeTrack
    ? { title: storeTrack.title, artist: storeTrack.artist, artwork: storeTrack.thumbnail }
    : null);

  const isPlaying =
    playbackState?.state === State.Playing ||
    playbackState?.state === State.Buffering;

  if (!playerReady) return null;

  const artwork =
    typeof track?.artwork === 'string'
      ? { uri: track.artwork }
      : require('@/assets/images/mavins.png');

  const handleOpen = () => router.push('/(player)');

  const handlePlayPause = (e: any) => {
    e?.stopPropagation?.();
    togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e?.stopPropagation?.();
    try {
      const TrackPlayer = (await import('@/modules/mavin-eq')).default;
      await TrackPlayer.skipToNext();
    } catch {}
  };

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={handleOpen}
      style={[
        styles.container,
        { marginBottom: insets.bottom > 0 ? insets.bottom : 8 },
      ]}
    >
      {/* Gold accent line at top */}
      <View style={styles.accentLine} />

      {/* Artwork */}
      <Image
        source={artwork}
        style={styles.artwork}
        contentFit="cover"
        transition={200}
      />

      {/* Title + artist */}
      <View style={styles.textWrapper}>
        {track?.title ? (
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
        ) : (
          <SkeletonPulse width={140} height={12} />
        )}
        {track?.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
        ) : (
          <View style={{ marginTop: 5 }}>
            <SkeletonPulse width={90} height={10} />
          </View>
        )}
      </View>

      {/* Play/pause + skip */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handlePlayPause}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={moderateScale(26)}
            color="#fff"
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
            color="rgba(255,255,255,0.75)"
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  scale(12),
    height:            MINI_PLAYER_HEIGHT,
    backgroundColor:   '#1C1C1E',
    borderRadius:      14,
    paddingHorizontal: scale(10),
    overflow:          'hidden',
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.4,
    shadowRadius:      8,
    elevation:         10,
  },
  accentLine: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    height:          2,
    backgroundColor: '#D4AF37',
    opacity:         0.6,
  },
  artwork: {
    width:           verticalScale(44),
    height:          verticalScale(44),
    borderRadius:    8,
    backgroundColor: '#2a2a2a',
  },
  textWrapper: {
    flex:           1,
    marginLeft:     scale(10),
    justifyContent: 'center',
  },
  title: {
    color:         '#fff',
    fontSize:      moderateScale(13),
    fontWeight:    '600',
    letterSpacing: 0.1,
  },
  artist: {
    color:     'rgba(255,255,255,0.55)',
    fontSize:  moderateScale(11),
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingLeft:   scale(8),
  },
});